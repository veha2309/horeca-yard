import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database, list, get, save } from '../server/db.js';
import { seed } from '../server/seed.js';
import { passwordHash, hashToken } from '../server/auth.js';
import { createApp } from '../server/app.js';
import { today } from '../server/domain.js';

let db: Database, app: ReturnType<typeof createApp>, owner: any, sales: any, warehouse: any;
const password = 'test-only-strong-password-42';
const future = '2099-12-31';
let product: any, customer: any, quote: any, order: any, inv: any;
async function post(agent: any, path: string, data: any, key = randomUUID()) {
  return agent
    .post('/api/admin/' + path)
    .set('Idempotency-Key', key)
    .send(data);
}
async function put(agent: any, path: string, data: any) {
  return agent
    .put('/api/admin/' + path)
    .set('Idempotency-Key', randomUUID())
    .send(data);
}
async function createQuote(agent: any, quantity = 4) {
  return post(agent, 'quotes', {
    customerId: customer.id,
    validUntil: future,
    notes: 'Payment by bank transfer',
    delivery: 50,
    deliveryTaxRate: 18,
    items: [{ productId: product.id, quantity, rate: 250, discount: 10, taxRate: 18 }],
  });
}
async function accept(q: any) {
  await post(owner, `quotes/${q.id}/status`, { status: 'Sent' }).then((r: any) =>
    assert.equal(r.status, 200),
  );
  await post(owner, `quotes/${q.id}/status`, {
    status: 'Accepted',
    acceptanceNote: 'Customer confirmed by telephone; test reference.',
  }).then((r: any) => assert.equal(r.status, 200));
}
before(async () => {
  db = await new Database('', 'memory://').init();
  await seed(db);
  app = createApp(db);
  for (const role of ['Owner', 'Sales', 'Warehouse'])
    await db.query('INSERT INTO users(id,email,name,role,password) VALUES($1,$2,$3,$4,$5)', [
      randomUUID(),
      `${role.toLowerCase()}@test.example`,
      role,
      role,
      passwordHash(password),
    ]);
  [owner, sales, warehouse] = [request.agent(app), request.agent(app), request.agent(app)];
  for (const [agent, role] of [
    [owner, 'owner'],
    [sales, 'sales'],
    [warehouse, 'warehouse'],
  ] as any[])
    assert.equal(
      (await agent.post('/api/auth/login').send({ email: `${role}@test.example`, password }))
        .status,
      200,
    );
  product = (await list(db, 'products')).find((p) => p.name === 'French Fries (Regular 9mm)');
});
after(async () => {
  await db.close();
});

test('catalogue is seeded without fabricated stock, private prices, or customer records', async () => {
  const r = await request(app).get('/api/catalogue');
  assert.equal(r.status, 200);
  assert.equal(r.body.products.length, 12);
  assert.equal(r.body.categories.length, 6);
  assert.equal(r.body.products[0].rate, undefined);
  assert.equal(r.body.products[0].hsn, undefined);
  assert.equal((await list(db, 'batches')).length, 0);
  assert.equal((await list(db, 'enquiries')).length, 0);
});
test('anonymous access, cross-origin writes and role escalation are rejected', async () => {
  assert.equal((await request(app).get('/api/admin/orders')).status, 401);
  assert.equal((await post(sales, 'products', { ...product, name: 'Unauthorised' })).status, 403);
  assert.equal((await warehouse.get('/api/admin/customers')).status, 403);
  assert.equal((await warehouse.get('/api/admin/reports')).status, 403);
  assert.equal((await sales.get('/api/admin/staff')).status, 403);
  assert.equal((await post(sales, 'batches', { productId: product.id })).status, 403);
  assert.equal(
    (
      await request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://untrusted.example')
        .send({ email: 'owner@test.example', password })
    ).status,
    403,
  );
});
test('enquiry -> customer is durable and retry-safe, with minimum quantities validated', async () => {
  const data = {
    name: 'Test Contact',
    business: 'Test Kitchen',
    phone: '9812345678',
    outletType: 'Restaurant',
    message: 'Monthly fries',
    interests: ['Frozen Foods'],
    items: [{ productId: product.id, quantity: 4 }],
  };
  const invalid = await request(app)
    .post('/api/enquiries')
    .set('Idempotency-Key', randomUUID())
    .send({ ...data, items: [{ productId: product.id, quantity: 1 }] });
  assert.equal(invalid.status, 400);
  const key = randomUUID();
  const first = await request(app).post('/api/enquiries').set('Idempotency-Key', key).send(data);
  assert.equal(first.status, 201);
  const second = await request(app).post('/api/enquiries').set('Idempotency-Key', key).send(data);
  assert.equal(first.body.reference, second.body.reference);
  assert.equal((await list(db, 'enquiries')).length, 1);
  const enquiry = (await list(db, 'enquiries'))[0];
  const r = await post(sales, `enquiries/${enquiry.id}/customer`, {});
  assert.equal(r.status, 200);
  customer = r.body;
  assert.equal((await post(owner, `enquiries/${enquiry.id}/customer`, {})).body.id, customer.id);
  customer = { ...customer, address: 'Test address, New Delhi', stateCode: '07' };
  assert.equal((await put(owner, `customers/${customer.id}`, customer)).status, 200);
});
test('quotation calculations and draft acceptance rules are enforced', async () => {
  const p = await put(owner, `products/${product.id}`, { ...product, hsn: '20041000' });
  assert.equal(p.status, 200);
  product = p.body;
  const r = await createQuote(sales);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  quote = r.body;
  assert.equal(quote.taxable, 90000);
  assert.equal(quote.tax, 17100);
  assert.equal(quote.total, 112100);
  assert.equal((await post(owner, `quotes/${quote.id}/order`, {})).status, 409);
  assert.equal(
    (await post(owner, `quotes/${quote.id}/status`, { status: 'Accepted' })).status,
    409,
  );
  await accept(quote);
  assert.equal((await put(owner, `quotes/${quote.id}`, quote)).status, 409);
});
test('stock receipt rejects expired and invalid batches; insufficient stock rolls back reservations', async () => {
  assert.equal(
    (
      await post(warehouse, 'batches', {
        productId: product.id,
        batch: 'EXPIRED',
        expiry: '2020-01-01',
        quantity: 5,
        reason: 'Test receipt',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(warehouse, 'batches', {
        productId: product.id,
        batch: 'INVALID',
        expiry: '2099-02-31',
        quantity: 5,
        reason: 'Test receipt',
      })
    ).status,
    400,
  );
  const result = await post(warehouse, 'batches', {
    productId: product.id,
    batch: 'FIRST',
    expiry: future,
    quantity: 2,
    reason: 'Test receipt',
  });
  assert.equal(result.status, 200);
  const failed = await post(owner, `quotes/${quote.id}/order`, {});
  assert.equal(failed.status, 409);
  assert.equal((await get(db, 'batches', result.body.id)).reserved, 0);
  assert.equal((await list(db, 'orders')).length, 0);
  assert.equal(
    (
      await post(warehouse, `batches/${result.body.id}/adjust`, {
        quantity: 10,
        reason: 'Additional receipt',
      })
    ).status,
    200,
  );
});
test('concurrent order conversion creates one order and reserves only once', async () => {
  const [a, b] = await Promise.all([
    post(owner, `quotes/${quote.id}/order`, {}),
    post(owner, `quotes/${quote.id}/order`, {}),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200);
  assert.equal(a.body.id, b.body.id);
  order = a.body;
  assert.equal((await list(db, 'orders')).length, 1);
  assert.equal((await list(db, 'batches'))[0].reserved, 4);
  const batch = (await list(db, 'batches'))[0];
  assert.equal(
    (
      await post(warehouse, `batches/${batch.id}/adjust`, {
        quantity: -9,
        reason: 'Invalid removal',
      })
    ).status,
    409,
  );
  const restricted = await warehouse.get('/api/admin/orders');
  assert.equal(restricted.body[0].total, undefined);
  assert.equal(restricted.body[0].items[0].rate, undefined);
});
test('invoice requires business identity and remains immutable after catalogue changes', async () => {
  assert.equal((await post(owner, `orders/${order.id}/invoice`, {})).status, 400);
  const settings = await get(db, 'settings', 'business-settings');
  assert.equal(
    (
      await put(owner, 'settings/business-settings', {
        ...settings,
        address: 'Test seller address',
        gstin: '07ABCDE1234F1Z5',
        stateCode: '07',
      })
    ).status,
    200,
  );
  const a = await post(sales, `orders/${order.id}/invoice`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  inv = a.body;
  assert.equal(inv.cgst + inv.sgst, 17100);
  assert.equal(inv.igst, 0);
  assert.equal((await post(owner, `orders/${order.id}/invoice`, {})).body.id, inv.id);
  await put(owner, `products/${product.id}`, { ...product, name: 'Changed catalogue name' });
  assert.equal((await get(db, 'invoices', inv.id)).items[0].name, 'French Fries (Regular 9mm)');
});
test('fulfilment deducts stock once and validates dispatch reference', async () => {
  assert.equal(
    (await post(sales, `orders/${order.id}/status`, { status: 'Packing', deliveryReference: '' }))
      .status,
    403,
  );
  assert.equal(
    (
      await post(warehouse, `orders/${order.id}/status`, {
        status: 'Delivered',
        deliveryReference: '',
      })
    ).status,
    409,
  );
  const packed = await post(warehouse, `orders/${order.id}/status`, {
    status: 'Packing',
    deliveryReference: '',
  });
  assert.equal(packed.status, 200);
  assert.equal(packed.body.total, undefined);
  assert.equal(packed.body.items[0].rate, undefined);
  assert.equal(
    (
      await post(warehouse, `orders/${order.id}/status`, {
        status: 'Dispatched',
        deliveryReference: '',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(warehouse, `orders/${order.id}/status`, {
        status: 'Dispatched',
        deliveryReference: 'TEST-DELIVERY',
      })
    ).status,
    200,
  );
  assert.equal((await list(db, 'batches'))[0].quantity, 8);
  assert.equal((await list(db, 'batches'))[0].reserved, 0);
  assert.equal(
    (
      await post(warehouse, `orders/${order.id}/status`, {
        status: 'Dispatched',
        deliveryReference: 'TEST-DELIVERY',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(warehouse, `orders/${order.id}/status`, {
        status: 'Delivered',
        deliveryReference: 'TEST-DELIVERY',
      })
    ).status,
    200,
  );
});
test('offline payments support partial amounts and reject duplicates and overpayment', async () => {
  const payment = {
    amount: 500,
    method: 'Bank transfer',
    reference: 'PAY-TEST-001',
    date: today(),
  };
  const key = randomUUID();
  const a = await post(sales, `orders/${order.id}/payment`, payment, key);
  assert.equal(a.status, 200);
  assert.equal(a.body.paid, 50000);
  const b = await post(sales, `orders/${order.id}/payment`, payment, key);
  assert.equal(b.body.paid, 50000);
  assert.equal((await post(sales, `orders/${order.id}/payment`, payment)).status, 409);
  assert.equal(
    (
      await post(owner, `orders/${order.id}/payment`, {
        ...payment,
        amount: 1000,
        reference: 'OVER',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(owner, `orders/${order.id}/payment`, {
        ...payment,
        amount: 621,
        reference: 'PAY-TEST-002',
      })
    ).body.paid,
    112100,
  );
  assert.equal((await owner.get('/api/admin/reports')).body.outstanding, 0);
});
test('cancellation releases reservations; expired reserved stock cannot dispatch', async () => {
  const q = (await createQuote(owner)).body;
  await accept(q);
  const o = (await post(owner, `quotes/${q.id}/order`, {})).body;
  assert.equal((await list(db, 'batches'))[0].reserved, 4);
  assert.equal(
    (await post(owner, `orders/${o.id}/status`, { status: 'Cancelled', deliveryReference: '' }))
      .status,
    200,
  );
  assert.equal((await list(db, 'batches'))[0].reserved, 0);
  const q2 = (await createQuote(owner)).body;
  await accept(q2);
  const o2 = (await post(owner, `quotes/${q2.id}/order`, {})).body;
  await post(owner, `orders/${o2.id}/status`, { status: 'Packing', deliveryReference: '' });
  const batch = (await list(db, 'batches'))[0];
  await db.transaction((tx) => save(tx, 'batches', { ...batch, expiry: '2020-01-01' }, batch.id));
  assert.equal(
    (
      await post(owner, `orders/${o2.id}/status`, {
        status: 'Dispatched',
        deliveryReference: 'TEST',
      })
    ).status,
    409,
  );
  assert.equal((await get(db, 'orders', o2.id)).status, 'Packing');
  assert.equal(
    (await post(owner, `orders/${o2.id}/status`, { status: 'Cancelled', deliveryReference: '' }))
      .status,
    200,
  );
});
test('CSV exports reflect stored values and escape spreadsheet formulas', async () => {
  const c = await get(db, 'customers', customer.id);
  await put(owner, `customers/${customer.id}`, { ...c, business: '=CMD()' });
  const r = await owner.get('/api/admin/customers/export');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes("'=CMD()"));
  assert.ok(r.text.includes(customer.phone));
  assert.equal((await warehouse.get('/api/admin/quotes/export')).status, 403);
});
test('competing orders cannot oversell the same stock', async () => {
  const batch = (await list(db, 'batches'))[0];
  await db.transaction((tx) => save(tx, 'batches', { ...batch, expiry: future }, batch.id));
  const q1 = (await createQuote(owner, 8)).body,
    q2 = (await createQuote(owner, 8)).body;
  await accept(q1);
  await accept(q2);
  const responses = await Promise.all([
    post(owner, `quotes/${q1.id}/order`, {}),
    post(owner, `quotes/${q2.id}/order`, {}),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await get(db, 'batches', batch.id)).reserved, 8);
  const confirmed = responses.find((r) => r.status === 200)!.body;
  await post(owner, `orders/${confirmed.id}/status`, {
    status: 'Cancelled',
    deliveryReference: '',
  });
});
test('PDF documents are generated from the stored snapshots', async () => {
  const r = await owner.get(`/api/admin/invoices/${inv.id}/pdf`);
  assert.equal(r.status, 200);
  assert.ok(r.headers['content-type'].includes('application/pdf'));
  assert.ok(Buffer.isBuffer(r.body));
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  await mkdir('tmp/pdfs', { recursive: true });
  await import('node:fs/promises').then((fs) => fs.writeFile('tmp/pdfs/test-invoice.pdf', r.body));
  const q = await owner.get(`/api/admin/quotes/${quote.id}/pdf`);
  assert.equal(q.status, 200);
  await import('node:fs/promises').then((fs) =>
    fs.writeFile('tmp/pdfs/test-quotation.pdf', q.body),
  );
});
test('invalid image uploads and non-owner uploads are rejected', async () => {
  assert.equal(
    (
      await owner
        .post('/api/admin/media/upload')
        .attach('image', Buffer.from('<svg onload="alert(1)"></svg>'), 'bad.svg')
    ).status,
    400,
  );
  assert.equal(
    (
      await owner
        .post('/api/admin/media/upload')
        .attach('image', Buffer.from([255, 216, 255, 0, 0, 0]), 'fake.jpg')
    ).status,
    400,
  );
  assert.equal(
    (await sales.post('/api/admin/media/upload').attach('image', Buffer.from('fake'), 'bad.png'))
      .status,
    403,
  );
  assert.equal(
    (
      await owner
        .post('/api/admin/media/upload')
        .attach('image', Buffer.alloc(6 * 1024 * 1024), 'large.png')
    ).status,
    400,
  );
});
test('notifications are role filtered, deduplicated and marked read independently', async () => {
  assert.equal((await request(app).get('/api/admin/notifications')).status, 401);
  const feed = (await owner.get('/api/admin/notifications')).body;
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT COUNT(*) AS count FROM app_events WHERE entity='enquiries' AND actor_id IS NULL",
        )
      ).rows[0].count,
    ),
    1,
  );
  assert.ok(feed.unread > 0);
  assert.equal(
    Object.values(feed.sections).reduce((sum: number, value) => sum + Number(value), 0),
    feed.unread,
  );
  const restricted = (await warehouse.get('/api/admin/notifications?after=0')).body;
  assert.ok(
    restricted.events.every(
      (e: any) => !['enquiries', 'customers', 'quotes', 'invoices', 'staff'].includes(e.entity),
    ),
  );
  assert.equal((await post(owner, 'notifications/read', { cursor: feed.cursor })).status, 200);
  assert.equal((await owner.get('/api/admin/notifications')).body.unread, 0);
  assert.deepEqual((await owner.get('/api/admin/notifications')).body.sections, {});
  assert.ok((await sales.get('/api/admin/notifications')).body.unread > 0);
  assert.equal(
    (await owner.get('/api/admin/notifications?after=' + feed.cursor)).body.changed,
    false,
  );
  assert.equal((await owner.get('/api/admin/notifications?after=bad')).status, 400);
  const key = randomUUID();
  const count = Number((await db.query('SELECT COUNT(*) AS count FROM app_events')).rows[0].count);
  const data = { name: 'Notification test brand', active: true };
  assert.equal((await post(owner, 'brands', data, key)).status, 200);
  assert.equal((await post(owner, 'brands', data, key)).status, 200);
  assert.equal(
    Number((await db.query('SELECT COUNT(*) AS count FROM app_events')).rows[0].count),
    count + 1,
  );
  const changed = (await owner.get('/api/admin/notifications?after=' + feed.cursor)).body;
  assert.equal(changed.changed, true);
  assert.equal(changed.unread, 0, 'own writes refresh data without duplicate alerts');
});

test('routine staff updates preserve sessions and return the updated profile', async () => {
  const users = (await owner.get('/api/admin/staff')).body;
  const user = users.find((u: any) => u.role === 'Sales');
  assert.equal(
    (await post(owner, 'staff', { ...user, name: 'Sales updated', password: '' })).status,
    200,
  );
  const response = await sales.get('/api/admin/notifications');
  assert.equal(response.status, 200);
  assert.equal(response.body.user.name, 'Sales updated');
});

test('last-owner protection and reset tokens revoke sessions and cannot be reused', async () => {
  const users = (await owner.get('/api/admin/staff')).body;
  const user = users.find((u: any) => u.role === 'Owner');
  assert.equal((await post(owner, 'staff', { ...user, role: 'Sales', password: '' })).status, 409);
  const salesUser = users.find((u: any) => u.role === 'Sales'),
    token = 'a'.repeat(64);
  await db.query(
    "INSERT INTO password_resets(token,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
    [hashToken(token), salesUser.id],
  );
  const expired = 'b'.repeat(64);
  await db.query(
    "INSERT INTO password_resets(token,user_id,expires_at) VALUES($1,$2,now()-interval '1 minute')",
    [hashToken(expired), salesUser.id],
  );
  assert.equal(
    (
      await request(app)
        .post('/api/auth/reset')
        .send({ token: expired, password: 'new-test-password-123' })
    ).status,
    400,
  );
  assert.equal(
    (await request(app).post('/api/auth/reset').send({ token, password: 'new-test-password-123' }))
      .status,
    200,
  );
  assert.equal((await sales.get('/api/admin/me')).status, 401);
  assert.equal(
    (
      await request(app)
        .post('/api/auth/reset')
        .send({ token, password: 'another-test-password-123' })
    ).status,
    400,
  );
});
test('local PostgreSQL records survive closing and reopening the database', async () => {
  await mkdir('tmp', { recursive: true });
  const dir = await mkdtemp(resolve('tmp', 'persistence-'));
  let persistent = await new Database('', dir).init();
  const saved = await persistent.transaction((tx) => save(tx, 'probe', { value: 'persists' }));
  await assert.rejects(() => new Database('', dir).init(), /already open/);
  await persistent.close();
  persistent = await new Database('', dir).init();
  assert.equal((await get(persistent, 'probe', saved.id)).value, 'persists');
  await persistent.close();
});
