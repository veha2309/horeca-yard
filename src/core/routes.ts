import { z } from 'zod';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  confirmPasswordReset,
  updatePassword,
} from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { auth, firestore, firebaseConfig } from './firebase.js';
import {
  AppError,
  audit,
  get,
  list,
  readAll,
  save,
  transaction,
  number,
  type Tx,
} from './db.js';
import {
  schemas,
  enquirySchema,
  makeQuote,
  reserveOrder,
  transitionOrder,
  invoice,
  payment,
  stock,
  adjustStock,
  reports,
} from './domain.js';
import { notificationFeed, publishEvent } from './notifications.js';

const commercial = ['Owner', 'Sales'],
  warehouse = ['Owner', 'Warehouse'];
const readRoles: Record<string, string[]> = {
  products: ['Owner', 'Sales', 'Warehouse'],
  categories: ['Owner', 'Sales', 'Warehouse'],
  brands: ['Owner', 'Sales', 'Warehouse'],
  customers: commercial,
  enquiries: commercial,
  quotes: commercial,
  orders: ['Owner', 'Sales', 'Warehouse'],
  invoices: commercial,
  batches: warehouse,
  movements: warehouse,
  settings: ['Owner'],
  audit: ['Owner'],
};
const warehouseOrder = (o: any) => ({
  id: o.id,
  reference: o.reference,
  status: o.status,
  customer: {
    name: o.customer.name,
    business: o.customer.business,
    address: o.customer.address,
    phone: o.customer.phone,
  },
  items: o.items.map((i: any) => ({ name: i.name, quantity: i.quantity, packSize: i.packSize })),
  deliveryReference: o.deliveryReference,
  createdAt: o.createdAt,
});
const visible = (kind: string, data: any[], role: string) =>
  role === 'Warehouse' && kind === 'orders' ? data.map(warehouseOrder) : data;

export type Session = { id: string; name: string; email: string; role: string };

/** The only settings fields anonymous visitors may read. Bank details stay private. */
export async function publishSite(tx: Tx, settings: any) {
  await save(
    tx,
    'public',
    {
      businessName: settings.businessName,
      phone: settings.phone,
      instagram: settings.instagram,
      heroTitle: settings.heroTitle,
      heroDescription: settings.heroDescription,
      version: Date.now(),
    },
    'site',
  );
}

async function currentUser(): Promise<Session> {
  await auth.authStateReady();
  const u = auth.currentUser;
  if (!u) throw new AppError(401, 'Please sign in');
  const snap = await getDoc(doc(firestore, 'users', u.uid));
  const data = snap.data();
  if (!snap.exists() || data!.active === false)
    throw new AppError(401, 'Your session expired. Please sign in again.');
  return { id: u.uid, name: data!.name, email: data!.email ?? u.email!, role: data!.role };
}
const require = (user: Session, ...allowed: string[]) => {
  if (!allowed.includes(user.role))
    throw new AppError(403, 'Your role cannot perform this action');
};

/** Replays a previous result for a repeated Idempotency-Key, as the API did. */
async function once<T>(tx: Tx, token: string, digest: string, fn: () => Promise<T>): Promise<T> {
  const key = token.replace(/[^\w.@+-]/g, '_').slice(0, 400);
  const prior = await getDoc(doc(firestore, 'requestKeys', key));
  if (prior.exists()) {
    const stored = prior.data();
    if (stored.digest !== digest)
      throw new AppError(409, 'Request key was already used with different data');
    return JSON.parse(stored.data) as T;
  }
  const data = await fn();
  await save(tx, 'requestKeys', { digest, data: JSON.stringify(data ?? null) }, key);
  return data;
}
const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** Downscales an uploaded image in the browser, replacing the server's sharp pipeline. */
async function toWebp(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new AppError(400, 'Only JPEG, PNG, and WebP files are allowed');
  if (file.size > 5 * 1024 * 1024) throw new AppError(400, 'Images must be smaller than 5 MB');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AppError(400, 'Image is invalid or cannot be read');
  });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.88, 0.75, 0.6, 0.45]) {
    const url = canvas.toDataURL('image/webp', quality);
    // ponytail: images live inline in the product document because Cloud Storage
    // needs the Blaze plan. Firestore caps a document at 1 MB, so keep well under it.
    if (url.length <= 700_000) return url;
  }
  throw new AppError(400, 'Image is too detailed to store. Crop or shrink it and try again.');
}

export type Req = { method: string; body?: any; headers?: Record<string, string>; query?: URLSearchParams };

/** Routes an /api request against Firestore, in place of the Express server. */
export async function handle(path: string, req: Req = { method: 'GET' }): Promise<any> {
  const method = req.method.toUpperCase();
  const body = req.body;
  const segments = path.replace(/^\/api\//, '').split('/');
  const key = req.headers?.['Idempotency-Key'] ?? req.headers?.['idempotency-key'] ?? '';
  const digest = await sha256(JSON.stringify(body ?? null));
  const at = (i: number) => segments[i];

  // ---- public ----
  if (path === '/api/health') return { status: 'ok' };

  if (path === '/api/catalogue' && method === 'GET') {
    // Anonymous visitors may only read published/active rows, so each query carries
    // the same constraint the security rules require.
    const published = (name: string, field: string) =>
      getDocs(query(collection(firestore, name), where(field, '==', true)));
    const [site, products, categories, brands] = await Promise.all([
      getDoc(doc(firestore, 'public', 'site')),
      published('products', 'published'),
      published('categories', 'active'),
      published('brands', 'active'),
    ]);
    const rows = (snap: any) => snap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
    const data = site.data() ?? {};
    return {
      version: String(data.version ?? 0),
      products: rows(products).map(({ lowStockThreshold, hsn, ...p }: any) => p),
      categories: rows(categories),
      brands: rows(brands),
      settings: {
        businessName: data.businessName,
        phone: data.phone,
        instagram: data.instagram,
        heroTitle: data.heroTitle,
        heroDescription: data.heroDescription,
      },
    };
  }

  if (path === '/api/enquiries' && method === 'POST') {
    const data = enquirySchema.parse(body);
    z.string().uuid().parse(key);
    return transaction(async (tx) =>
      once(tx, `enquiry:${key}`, digest, async () => {
        const items = [];
        for (const i of data.items) {
          const p = await get(tx, 'products', i.productId);
          if (!p.published || p.availability === 'Unavailable')
            throw new AppError(400, 'A selected product is no longer available');
          if (i.quantity < p.minQuantity)
            throw new AppError(400, `${p.name}: minimum ${p.minQuantity} packs`);
          items.push({ ...i, name: p.name, packSize: p.packSize });
        }
        const record = await save(tx, 'enquiries', {
          ...data,
          items,
          reference: await number(tx, 'E'),
          status: 'New',
          assignedTo: '',
          notes: '',
          followUp: '',
          createdAt: new Date().toISOString(),
        });
        await publishEvent(
          tx,
          'enquiries',
          record.id,
          `New wholesale enquiry ${record.reference} from ${record.business || record.name}`,
        );
        return { reference: record.reference };
      }),
    );
  }

  // ---- authentication (Firebase Auth) ----
  if (path === '/api/auth/login' && method === 'POST') {
    const data = z
      .object({ email: z.string().email(), password: z.string().min(1).max(200) })
      .parse(body);
    try {
      await signInWithEmailAndPassword(auth, data.email.toLowerCase(), data.password);
    } catch {
      throw new AppError(401, 'Email or password is incorrect');
    }
    try {
      return await currentUser();
    } catch (e) {
      await signOut(auth);
      throw new AppError(401, 'This account is not enabled for the admin portal');
    }
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    await signOut(auth);
    return { ok: true };
  }
  if (path === '/api/auth/forgot' && method === 'POST') {
    const { email } = z.object({ email: z.string().email() }).parse(body);
    await sendPasswordResetEmail(auth, email.toLowerCase()).catch(() => {});
    return { message: 'If that account exists, a reset link has been sent.' };
  }
  if (path === '/api/auth/reset' && method === 'POST') {
    const data = z
      .object({ token: z.string().max(500), password: z.string().min(12).max(200) })
      .parse(body);
    const code = data.token || new URLSearchParams(location.search).get('oobCode') || '';
    if (!code) throw new AppError(400, 'Reset link has expired or has already been used');
    try {
      await confirmPasswordReset(auth, code, data.password);
    } catch {
      throw new AppError(400, 'Reset link has expired or has already been used');
    }
    return { ok: true };
  }

  if (!path.startsWith('/api/admin/')) throw new AppError(404, 'Endpoint not found');
  const user = await currentUser();

  // ---- admin reads ----
  if (path === '/api/admin/me') return user;
  if (path === '/api/admin/workspace') {
    const settings = await getDoc(doc(firestore, 'settings', 'business-settings'));
    return [{ id: 'workspace', warehouseName: settings.data()?.warehouseName ?? '' }];
  }
  if (path === '/api/admin/notifications' && method === 'GET') {
    const after = req.query?.get('after') ?? undefined;
    return { ...(await notificationFeed(user, after)), user };
  }
  if (path === '/api/admin/notifications/read' && method === 'POST') {
    const { cursor } = z.object({ cursor: z.string().regex(/^\d{1,18}$/) }).parse(body);
    await transaction(async (tx) => {
      const existing = await getDoc(doc(firestore, 'notificationReads', user.id));
      const lastRead = Math.max(Number(existing.data()?.lastRead ?? 0), Number(cursor));
      await save(tx, 'notificationReads', { lastRead }, user.id);
    });
    return { ok: true };
  }
  if (path === '/api/admin/reports') {
    require(user, ...commercial);
    return transaction(reports);
  }
  if (path === '/api/admin/staff-options') {
    require(user, ...commercial);
    return (await readAll('users'))
      .filter((u) => u.active !== false && ['Owner', 'Sales'].includes(u.role))
      .map((u) => ({ id: u.id, name: u.name, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  if (path === '/api/admin/staff' && method === 'GET') {
    require(user, 'Owner');
    return (await readAll('users'))
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active !== false }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- media ----
  if (path === '/api/admin/media/upload' && method === 'POST') {
    require(user, 'Owner');
    const file = body instanceof FormData ? (body.get('image') as File | null) : null;
    if (!file) throw new AppError(400, 'Choose a JPEG, PNG, or WebP image');
    const url = await toWebp(file);
    await transaction((tx) => audit(tx, user, 'Upload image', 'media', crypto.randomUUID()));
    return { url };
  }

  // ---- mutations ----
  const mutation = <T>(fn: (tx: Tx) => Promise<T>) => {
    z.string().uuid().parse(key);
    return transaction(async (tx) => {
      const result = await once(tx, `${user.id}:${method}:${path}:${key}`, digest, () => fn(tx));
      return user.role === 'Warehouse' && path.includes('/orders/')
        ? (warehouseOrder(result) as T)
        : result;
    });
  };

  const kind = at(1);
  const id = at(2);
  const action = at(3);

  if (kind === 'staff' && method === 'POST') {
    require(user, 'Owner');
    return mutation(async (tx) => {
      const d = z
        .object({
          id: z.string().optional(),
          email: z.string().email(),
          name: z.string().min(2).max(100),
          role: z.enum(['Owner', 'Sales', 'Warehouse']),
          active: z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true' || v === 'on'),
          password: z.string().max(200).optional(),
        })
        .parse(body);
      const staff = await readAll('users');
      if (d.id) {
        const existing = staff.find((u) => u.id === d.id);
        if (!existing) throw new AppError(404, 'Staff member not found');
        if (existing.role === 'Owner' && (!d.active || d.role !== 'Owner')) {
          if (staff.filter((u) => u.role === 'Owner' && u.active !== false).length <= 1)
            throw new AppError(409, 'Keep at least one active owner');
        }
        if (d.id === user.id && !d.active)
          throw new AppError(400, 'You cannot deactivate your own account');
        await save(tx, 'users', { ...existing, name: d.name, email: d.email.toLowerCase(), role: d.role, active: d.active }, d.id);
        if (d.password) {
          if (d.password.length < 12)
            throw new AppError(400, 'Password must contain at least 12 characters');
          if (d.id !== user.id)
            throw new AppError(
              400,
              'Without a server, only the signed-in user can change their own password. Ask this person to use “Forgot password”.',
            );
          await updatePassword(auth.currentUser!, d.password);
        }
      } else {
        if (!d.password || d.password.length < 12)
          throw new AppError(400, 'Set a password of at least 12 characters');
        if (staff.some((u) => u.email?.toLowerCase() === d.email.toLowerCase()))
          throw new AppError(409, 'This record already exists');
        // A second Firebase app creates the account without replacing the current session.
        const secondary = initializeApp(firebaseConfig, `staff-${Date.now()}`);
        try {
          const created = await createUserWithEmailAndPassword(
            getAuth(secondary),
            d.email.toLowerCase(),
            d.password,
          );
          d.id = created.user.uid;
          await signOut(getAuth(secondary));
        } catch (e: any) {
          throw new AppError(
            400,
            e?.code === 'auth/email-already-in-use'
              ? 'That email already has an account'
              : 'Could not create this staff account',
          );
        } finally {
          await deleteApp(secondary).catch(() => {});
        }
        await save(
          tx,
          'users',
          { email: d.email.toLowerCase(), name: d.name, role: d.role, active: d.active },
          d.id,
        );
      }
      await audit(tx, user, 'Save staff', 'staff', d.id!);
      return { id: d.id };
    });
  }

  if (kind === 'enquiries' && action === 'update') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const d = z
        .object({
          status: z.enum(['New', 'Contacted', 'Closed']),
          assignedTo: z.string(),
          notes: z.string().max(5000),
          followUp: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]),
        })
        .parse(body);
      if (d.assignedTo) {
        const staff = (await readAll('users')).find((u) => u.id === d.assignedTo);
        if (!staff || staff.active === false || !['Owner', 'Sales'].includes(staff.role))
          throw new AppError(400, 'Choose an active sales staff member');
      }
      const e = await get(tx, 'enquiries', id);
      const result = await save(tx, 'enquiries', { ...e, ...d }, e.id);
      await audit(tx, user, 'Update enquiry', 'enquiries', e.id);
      return result;
    });
  }
  if (kind === 'enquiries' && action === 'customer') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const e = await get(tx, 'enquiries', id);
      if (e.customerId) return get(tx, 'customers', e.customerId);
      const c = await save(tx, 'customers', {
        name: e.name,
        business: e.business || e.name,
        phone: e.phone,
        email: '',
        address: '',
        gstin: '',
        stateCode: '',
        notes: 'Created from ' + e.reference,
      });
      await save(tx, 'enquiries', { ...e, customerId: c.id }, e.id);
      await audit(tx, user, 'Create customer from enquiry', 'customers', c.id);
      return c;
    });
  }
  if (kind === 'quotes' && !id && method === 'POST') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const q = await makeQuote(tx, body);
      await audit(tx, user, 'Create quotation', 'quotes', q.id);
      return q;
    });
  }
  if (kind === 'quotes' && id && !action && method === 'PUT') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const q = await makeQuote(tx, body, id);
      await audit(tx, user, 'Edit quotation', 'quotes', q.id);
      return q;
    });
  }
  if (kind === 'quotes' && action === 'status') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const d = z
        .object({
          status: z.enum(['Sent', 'Accepted', 'Declined']),
          acceptanceNote: z.string().max(2000).optional(),
        })
        .parse(body);
      const q = await get(tx, 'quotes', id);
      const allowed: Record<string, string[]> = { Draft: ['Sent'], Sent: ['Accepted', 'Declined'] };
      if (!allowed[q.status]?.includes(d.status))
        throw new AppError(409, 'Quotation status change is not allowed');
      if (d.status === 'Accepted' && !d.acceptanceNote?.trim())
        throw new AppError(400, 'Record how and when the customer accepted');
      const result = await save(tx, 'quotes', { ...q, ...d }, q.id);
      await audit(tx, user, 'Quotation ' + d.status, 'quotes', q.id);
      return result;
    });
  }
  if (kind === 'quotes' && action === 'order') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const result = await reserveOrder(tx, await get(tx, 'quotes', id));
      await audit(tx, user, 'Confirm order', 'orders', result.id);
      return result;
    });
  }
  if (kind === 'orders' && action === 'status') {
    require(user, 'Owner', 'Warehouse');
    return mutation(async (tx) => {
      const d = z
        .object({
          status: z.enum(['Packing', 'Dispatched', 'Delivered', 'Cancelled']),
          deliveryReference: z.string().max(300),
        })
        .parse(body);
      const result = await transitionOrder(tx, id, d.status, d.deliveryReference);
      await audit(tx, user, 'Order ' + d.status, 'orders', result.id);
      return result;
    });
  }
  if (kind === 'orders' && action === 'invoice') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const result = await invoice(tx, id);
      await audit(tx, user, 'Issue invoice', 'invoices', result.id);
      return result;
    });
  }
  if (kind === 'orders' && action === 'payment') {
    require(user, ...commercial);
    return mutation(async (tx) => {
      const result = await payment(tx, id, body);
      await audit(tx, user, 'Record payment', 'orders', result.id);
      return result;
    });
  }
  if (kind === 'batches' && !id && method === 'POST') {
    require(user, ...warehouse);
    return mutation(async (tx) => {
      const r = await stock(tx, body, user);
      await audit(tx, user, 'Receive stock', 'batches', r.id);
      return r;
    });
  }
  if (kind === 'batches' && action === 'adjust') {
    require(user, ...warehouse);
    return mutation(async (tx) => {
      const r = await adjustStock(tx, id, body, user);
      await audit(tx, user, 'Adjust stock', 'batches', r.id);
      return r;
    });
  }

  // ---- generic list and save ----
  if (method === 'GET' && !id) {
    if (!readRoles[kind]?.includes(user.role)) throw new AppError(403, 'Access not permitted');
    return visible(kind, await readAll(kind), user.role);
  }
  if (method === 'POST' || method === 'PUT') {
    const schema = schemas[kind];
    if (!schema) throw new AppError(404, 'Unknown operation');
    if (kind === 'customers' ? !commercial.includes(user.role) : user.role !== 'Owner')
      throw new AppError(403, 'Edit not permitted');
    return mutation(async (tx) => {
      const data = schema.parse(body);
      const target = method === 'PUT' ? id : undefined;
      if (target) await get(tx, kind, target);
      if (kind === 'settings' && target !== 'business-settings')
        throw new AppError(400, 'Use business settings');
      if (['brands', 'categories'].includes(kind)) {
        const all = await list(tx, kind);
        if (all.some((r) => r.id !== target && r.name.toLowerCase() === data.name.toLowerCase()))
          throw new AppError(409, 'Name already exists');
        if (target) {
          const old = await get(tx, kind, target);
          for (const p of await list(tx, 'products')) {
            const field = kind === 'brands' ? 'brand' : 'category';
            if (p[field] === old.name)
              await save(tx, 'products', { ...p, [field]: data.name }, p.id);
          }
        }
      }
      if (kind === 'products') {
        if (
          !(await list(tx, 'brands')).some((b) => b.name === data.brand) ||
          !(await list(tx, 'categories')).some((c) => c.name === data.category)
        )
          throw new AppError(400, 'Select an existing brand and category');
      }
      const r = await save(tx, kind, data, target);
      // The public site document doubles as the catalogue's change cursor.
      if (['settings', 'products', 'brands', 'categories'].includes(kind))
        await publishSite(tx, kind === 'settings' ? r : await get(tx, 'settings', 'business-settings'));
      await audit(tx, user, target ? 'Update' : 'Create', kind, r.id);
      return r;
    });
  }
  throw new AppError(404, 'Endpoint not found');
}

/** CSV of a collection, matching the server's export format. */
export async function exportCsv(kind: string) {
  const user = await currentUser();
  if (!readRoles[kind]?.includes(user.role)) throw new AppError(403, 'Export not permitted');
  const rows = visible(kind, await readAll(kind), user.role);
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cell = (v: any) => {
    let s = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const csv =
    '﻿' +
    [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join(
      '\r\n',
    );
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export async function documentBlob(kind: string, id: string) {
  const user = await currentUser();
  require(user, ...commercial);
  if (!['quotes', 'invoices'].includes(kind)) throw new AppError(404, 'Document not found');
  const snap = await getDoc(doc(firestore, kind, id));
  if (!snap.exists()) throw new AppError(404, 'Document not found');
  const { documentPdf } = await import('./pdf.js');
  return { blob: await documentPdf({ ...snap.data(), id } as any, kind), record: snap.data() };
}
