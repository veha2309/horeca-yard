/**
 * Exercises the ported business workflow against the Firestore emulator with the
 * production security rules loaded: anonymous enquiry through quotation, stock
 * reservation, invoicing and payment, plus the role boundaries.
 *
 * Run with: npm run test:firestore
 */
import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { auth, firestore } from '../src/core/firebase.js';
import { handle } from '../src/core/routes.js';
import { seedRecords, settings } from '../src/core/seed.js';

const uuid = () => randomUUID();
const key = () => ({ 'Idempotency-Key': randomUUID() });
const post = (path: string, body: any) => handle(path, { method: 'POST', body, headers: key() });
const put = (path: string, body: any) => handle(path, { method: 'PUT', body, headers: key() });
const get = (path: string) => handle(path, { method: 'GET' });

const owner = { email: `owner-${uuid()}@test.local`, password: 'ownerpassword123' };
const sales = { email: `sales-${uuid()}@test.local`, password: 'salespassword123' };
let productId = '';

/** Writes a staff record through the emulator's admin channel, bypassing rules the
 *  way the one-time bootstrap script does against the real project. */
async function signUp(who: { email: string; password: string }, role: string) {
  const cred = await createUserWithEmailAndPassword(auth, who.email, who.password);
  const uid = cred.user.uid;
  const url = `http://127.0.0.1:8080/v1/projects/horecayard/databases/(default)/documents/users/${uid}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        id: { stringValue: uid },
        email: { stringValue: who.email },
        name: { stringValue: role },
        role: { stringValue: role },
        active: { booleanValue: true },
      },
    }),
  });
  assert.ok(response.ok, `seeding ${role} failed: ${await response.text()}`);
  return uid;
}
const login = (who: { email: string; password: string }) =>
  post('/api/auth/login', { email: who.email, password: who.password });

before(async () => {
  await signUp(owner, 'Owner');
  await signOut(auth);
  await signUp(sales, 'Sales');
  await signOut(auth);
  // The catalogue is written as the Owner, which is how the real seed runs.
  await login(owner);
  const records = seedRecords(uuid);
  const batch = writeBatch(firestore);
  for (const [kind, rows] of Object.entries(records))
    for (const row of rows) batch.set(doc(firestore, kind, row.id), row);
  batch.set(doc(firestore, 'public', 'site'), {
    id: 'site',
    businessName: settings.businessName,
    phone: settings.phone,
    instagram: settings.instagram,
    heroTitle: settings.heroTitle,
    heroDescription: settings.heroDescription,
    version: 1,
  });
  await batch.commit();
  productId = records.products[0].id;
  await signOut(auth);
});

test('public catalogue exposes published products but no bank details', async () => {
  const c = await get('/api/catalogue');
  assert.equal(c.products.length, 12);
  assert.equal(c.settings.businessName, 'Horeca Yard');
  assert.equal((c.settings as any).bankDetails, undefined);
  assert.equal(c.products.every((p: any) => p.hsn === undefined), true);
});

test('an anonymous visitor can file an enquiry and gets a reference', async () => {
  const result = await post('/api/enquiries', {
    name: 'Test Kitchen',
    business: 'Test Cafe',
    phone: '9876543210',
    outletType: 'Cafe',
    message: 'Please quote',
    interests: [],
    items: [{ productId, quantity: 20 }],
  });
  assert.match(result.reference, /^E-\d{4}-\d{5}$/);
});

test('a repeated idempotency key returns the first result, not a second record', async () => {
  const headers = key();
  const body = {
    name: 'Repeat', business: 'Repeat Co', phone: '9876543211',
    outletType: 'Hotel', message: '', interests: [], items: [{ productId, quantity: 20 }],
  };
  const a = await handle('/api/enquiries', { method: 'POST', body, headers });
  const b = await handle('/api/enquiries', { method: 'POST', body, headers });
  assert.equal(a.reference, b.reference);
});

test('reference numbers increment', async () => {
  const enquiries = await (async () => {
    await login(owner);
    return get('/api/admin/enquiries');
  })();
  const refs = enquiries.map((e: any) => e.reference).sort();
  assert.equal(new Set(refs).size, refs.length, 'references must be unique');
});

test('quotation to invoice to payment', async () => {
  await login(owner);
  await put('/api/admin/settings/business-settings', {
    ...settings,
    address: '1 Test Road, Delhi',
    gstin: '07AAAAA0000A1Z5',
    stateCode: '07',
  });
  const customer = await post('/api/admin/customers', {
    name: 'Buyer', business: 'Buyer Foods', phone: '9876500000', email: '',
    address: '2 Buyer Street, Delhi', gstin: '', stateCode: '07', notes: '',
  });
  await put(`/api/admin/products/${productId}`, {
    ...(await get('/api/admin/products')).find((p: any) => p.id === productId),
    hsn: '2106',
  });
  const batch = await post('/api/admin/batches', {
    productId, batch: 'B-1', expiry: '2027-12-31', quantity: 500, reason: 'Opening stock',
  });
  assert.equal(batch.reserved, 0);

  const quote = await post('/api/admin/quotes', {
    customerId: customer.id, validUntil: '2027-01-01', notes: '', delivery: 0,
    deliveryTaxRate: 0,
    items: [{ productId, quantity: 20, rate: 100, discount: 0, taxRate: 12 }],
  });
  assert.equal(quote.taxable, 200000);
  assert.equal(quote.tax, 24000);
  assert.equal(quote.total, 224000);

  await post(`/api/admin/quotes/${quote.id}/status`, { status: 'Sent' });
  await post(`/api/admin/quotes/${quote.id}/status`, {
    status: 'Accepted', acceptanceNote: 'Confirmed by phone',
  });
  const order = await post(`/api/admin/quotes/${quote.id}/order`, {});
  assert.equal(order.status, 'Confirmed');
  assert.equal(order.allocations[0].quantity, 20);

  const batches = await get('/api/admin/batches');
  assert.equal(batches.find((b: any) => b.id === batch.id).reserved, 20, 'stock reserved');

  const inv = await post(`/api/admin/orders/${order.id}/invoice`, {});
  assert.match(inv.reference, /^INV-\d{4}-\d{5}$/);
  assert.equal(inv.taxType, 'CGST + SGST', 'same state means CGST+SGST');
  assert.equal(inv.cgst + inv.sgst, 24000);

  await post(`/api/admin/orders/${order.id}/payment`, {
    amount: 1000, method: 'UPI', reference: 'PAY-1', date: '2026-09-05',
  });
  const paid = (await get('/api/admin/orders')).find((o: any) => o.id === order.id);
  assert.equal(paid.paid, 100000);

  await assert.rejects(
    () => post(`/api/admin/orders/${order.id}/payment`, {
      amount: 99999, method: 'UPI', reference: 'PAY-2', date: '2026-09-05',
    }),
    /exceeds the outstanding balance/,
  );
});

test('stock cannot be over-reserved', async () => {
  await login(owner);
  const customers = await get('/api/admin/customers');
  const quote = await post('/api/admin/quotes', {
    customerId: customers[0].id, validUntil: '2027-01-01', notes: '', delivery: 0,
    deliveryTaxRate: 0,
    items: [{ productId, quantity: 100000, rate: 100, discount: 0, taxRate: 12 }],
  });
  await post(`/api/admin/quotes/${quote.id}/status`, { status: 'Sent' });
  await post(`/api/admin/quotes/${quote.id}/status`, {
    status: 'Accepted', acceptanceNote: 'ok',
  });
  await assert.rejects(
    () => post(`/api/admin/quotes/${quote.id}/order`, {}),
    /Insufficient unexpired stock/,
  );
});

test('Sales cannot edit the catalogue or read staff', async () => {
  await login(sales);
  await assert.rejects(
    () => post('/api/admin/products', { name: 'Nope' }),
    /Edit not permitted/,
  );
  await assert.rejects(() => get('/api/admin/staff'), /cannot perform this action/);
  const reports = await get('/api/admin/reports');
  assert.equal(typeof reports.orderTotal, 'number');
});

test('signed-out callers are refused', async () => {
  await signOut(auth);
  await assert.rejects(() => get('/api/admin/orders'), /sign in/);
});
