import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Database, AppError, audit, get, list, number, save, type Sql } from './db.js';
import {
  auth,
  cookie,
  hashToken,
  passwordHash,
  passwordMatches,
  roles,
  sessionToken,
} from './auth.js';
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
import { documentPdf } from './pdf.js';
import sharp from 'sharp';
import { notificationFeed, publishEvent } from './notifications.js';

const commercial = ['Owner', 'Sales'],
  warehouse = ['Owner', 'Warehouse'];
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
export function createApp(db: Database) {
  const app = express(),
    prod = process.env.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.set('trust proxy', prod ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: prod
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'https:', 'data:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const expected = process.env.APP_URL || 'http://localhost:3000';
      if (origin && origin !== expected)
        return next(new AppError(403, 'Request origin not allowed'));
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return next(new AppError(403, 'Cross-site requests are not allowed'));
    }
    next();
  });
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  app.get('/api/catalogue', async (_req, res) => {
    res.json(
      await db.transaction(async (tx) => {
        const settings = await get(tx, 'settings', 'business-settings');
        return {
          version: String(
            (
              await tx.query(
                "SELECT COALESCE(MAX(id),0) AS version FROM app_events WHERE entity IN ('products','brands','categories','settings')",
              )
            ).rows[0].version,
          ),
          products: (await list(tx, 'products'))
            .filter((p) => p.published)
            .map(({ lowStockThreshold, hsn, ...p }) => p),
          categories: (await list(tx, 'categories')).filter((c) => c.active),
          brands: (await list(tx, 'brands')).filter((b) => b.active),
          settings: {
            businessName: settings.businessName,
            phone: settings.phone,
            instagram: settings.instagram,
            heroTitle: settings.heroTitle,
            heroDescription: settings.heroDescription,
          },
        };
      }),
    );
  });
  app.post(
    '/api/enquiries',
    rateLimit({ windowMs: 60 * 60_000, limit: 30, legacyHeaders: false }),
    async (req, res) => {
      const data = enquirySchema.parse(req.body);
      const key = z.string().uuid().parse(req.headers['idempotency-key']);
      const result = await db.transaction(async (tx) => {
        const prior = (
          await tx.query('SELECT result FROM request_keys WHERE key=$1', [`enquiry:${key}`])
        ).rows[0];
        if (prior) return prior.result;
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
        const result = { reference: record.reference };
        await tx.query('INSERT INTO request_keys(key,result) VALUES($1,$2)', [
          `enquiry:${key}`,
          JSON.stringify(result),
        ]);
        return result;
      });
      res.status(201).json(result);
    },
  );
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const data = z
      .object({ email: z.string().email(), password: z.string().min(1).max(200) })
      .parse(req.body);
    const user = (
      await db.query('SELECT * FROM users WHERE email=$1 AND active=true', [
        data.email.toLowerCase(),
      ])
    ).rows[0];
    if (!user || !passwordMatches(data.password, user.password))
      throw new AppError(401, 'Email or password is incorrect');
    const token = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [hashToken(token), user.id],
    );
    res.setHeader('Set-Cookie', cookie(token, prod));
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });
  app.post('/api/auth/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await db.query('DELETE FROM sessions WHERE token=$1', [hashToken(token)]);
    res.setHeader('Set-Cookie', cookie('', prod, 0));
    res.json({ ok: true });
  });
  app.post('/api/auth/forgot', authLimit, async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    if (!process.env.SMTP_HOST)
      throw new AppError(503, 'Email recovery is not configured. Contact the owner.');
    const user = (
      await db.query('SELECT id FROM users WHERE email=$1 AND active=true', [email.toLowerCase()])
    ).rows[0];
    if (user) {
      const token = randomBytes(32).toString('hex');
      await db.transaction(async (tx) => {
        await tx.query('DELETE FROM password_resets WHERE user_id=$1', [user.id]);
        await tx.query(
          "INSERT INTO password_resets(token,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
          [hashToken(token), user.id],
        );
      });
      const mail = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      });
      await mail.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: 'Reset your Horeca Yard password',
        text: `Reset your password within 30 minutes: ${process.env.APP_URL}/admin/reset#${token}\nIf you did not request this, ignore this email.`,
      });
    }
    res.json({ message: 'If that account exists, a reset link has been sent.' });
  });
  app.post('/api/auth/reset', authLimit, async (req, res) => {
    const data = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(12).max(200) })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const reset = (
        await tx.query('SELECT * FROM password_resets WHERE token=$1 AND expires_at>now()', [
          hashToken(data.token),
        ])
      ).rows[0];
      if (!reset) throw new AppError(400, 'Reset link has expired or has already been used');
      await tx.query('UPDATE users SET password=$1 WHERE id=$2', [
        passwordHash(data.password),
        reset.user_id,
      ]);
      await tx.query('DELETE FROM password_resets WHERE user_id=$1', [reset.user_id]);
      await tx.query('DELETE FROM sessions WHERE user_id=$1', [reset.user_id]);
    });
    res.json({ ok: true });
  });
  app.use('/api/admin', auth(db));
  app.get('/api/admin/me', (_req, res) => res.json(res.locals.user));
  app.get('/api/admin/notifications', async (req, res) => {
    const after =
      req.query.after === undefined
        ? undefined
        : z
            .string()
            .regex(/^\d{1,18}$/)
            .parse(req.query.after);
    const feed = await db.transaction((tx) => notificationFeed(tx, res.locals.user, after));
    res.json({ ...feed, user: res.locals.user });
  });
  app.get('/api/admin/workspace', async (_req, res) => {
    const settings = await get(db, 'settings', 'business-settings');
    res.json([{ id: 'workspace', warehouseName: settings.warehouseName }]);
  });
  app.get('/api/admin/reports', roles(...commercial), async (_req, res) =>
    res.json(await db.transaction(reports)),
  );
  app.get('/api/admin/staff-options', roles(...commercial), async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,name,email FROM users WHERE active=true AND role IN ('Owner','Sales') ORDER BY name",
        )
      ).rows,
    ),
  );
  app.get('/api/admin/staff', roles('Owner'), async (_req, res) =>
    res.json((await db.query('SELECT id,name,email,role,active FROM users ORDER BY name')).rows),
  );
  const mutation =
    (fn: (tx: Sql, req: Request, res: Response) => Promise<any>) =>
    async (req: Request, res: Response) => {
      const key = z.string().uuid().parse(req.headers['idempotency-key']);
      const digest = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      const result = await db.transaction(async (tx) => {
        const token = `${res.locals.user.id}:${req.method}:${req.path}:${key}`;
        const prior = (await tx.query('SELECT result FROM request_keys WHERE key=$1', [token]))
          .rows[0];
        if (prior) {
          if (prior.result.digest !== digest)
            throw new AppError(409, 'Request key was already used with different data');
          return prior.result.data;
        }
        const data = await fn(tx, req, res);
        await tx.query('INSERT INTO request_keys(key,result) VALUES($1,$2)', [
          token,
          JSON.stringify({ digest, data }),
        ]);
        return data;
      });
      res.json(
        res.locals.user.role === 'Warehouse' && req.path.includes('/orders/')
          ? warehouseOrder(result)
          : result,
      );
    };
  app.post(
    '/api/admin/notifications/read',
    mutation(async (tx, req, res) => {
      const { cursor } = z.object({ cursor: z.string().regex(/^\d{1,18}$/) }).parse(req.body);
      await tx.query(
        `INSERT INTO notification_reads(user_id,last_read)
      VALUES($1,LEAST($2::bigint,(SELECT COALESCE(MAX(id),0) FROM app_events)))
      ON CONFLICT(user_id) DO UPDATE SET last_read=GREATEST(notification_reads.last_read,excluded.last_read)`,
        [res.locals.user.id, cursor],
      );
      return { ok: true };
    }),
  );
  app.post(
    '/api/admin/staff',
    roles('Owner'),
    mutation(async (tx, req, res) => {
      const d = z
        .object({
          id: z.string().uuid().optional(),
          email: z.string().email(),
          name: z.string().min(2).max(100),
          role: z.enum(['Owner', 'Sales', 'Warehouse']),
          active: z.boolean(),
          password: z.string().max(200).optional(),
        })
        .parse(req.body);
      if (d.id) {
        const existing = (await tx.query('SELECT * FROM users WHERE id=$1', [d.id])).rows[0];
        if (!existing) throw new AppError(404, 'Staff member not found');
        if (existing.role === 'Owner' && (!d.active || d.role !== 'Owner')) {
          const owners = (await tx.query("SELECT id FROM users WHERE role='Owner' AND active=true"))
            .rows;
          if (owners.length <= 1) throw new AppError(409, 'Keep at least one active owner');
        }
        if (d.id === res.locals.user.id && !d.active)
          throw new AppError(400, 'You cannot deactivate your own account');
        await tx.query('UPDATE users SET name=$1,email=$2,role=$3,active=$4 WHERE id=$5', [
          d.name,
          d.email.toLowerCase(),
          d.role,
          d.active,
          d.id,
        ]);
        if (d.password) {
          if (d.password.length < 12)
            throw new AppError(400, 'Password must contain at least 12 characters');
          await tx.query('UPDATE users SET password=$1 WHERE id=$2', [
            passwordHash(d.password),
            d.id,
          ]);
        }
        if (d.password || d.role !== existing.role || !d.active) {
          const keepCurrent =
            d.id === res.locals.user.id && d.active ? sessionToken(req) : undefined;
          if (keepCurrent)
            await tx.query('DELETE FROM sessions WHERE user_id=$1 AND token<>$2', [
              d.id,
              hashToken(keepCurrent),
            ]);
          else await tx.query('DELETE FROM sessions WHERE user_id=$1', [d.id]);
        }
      } else {
        if (!d.password || d.password.length < 12)
          throw new AppError(400, 'Set a password of at least 12 characters');
        d.id = randomUUID();
        await tx.query(
          'INSERT INTO users(id,email,name,role,password,active) VALUES($1,$2,$3,$4,$5,$6)',
          [d.id, d.email.toLowerCase(), d.name, d.role, passwordHash(d.password), d.active],
        );
      }
      await audit(tx, res.locals.user, 'Save staff', 'staff', d.id);
      return { id: d.id };
    }),
  );
  app.post(
    '/api/admin/enquiries/:id/update',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const d = z
        .object({
          status: z.enum(['New', 'Contacted', 'Closed']),
          assignedTo: z.string(),
          notes: z.string().max(5000),
          followUp: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]),
        })
        .parse(req.body);
      if (
        d.assignedTo &&
        !(
          await tx.query(
            "SELECT id FROM users WHERE id=$1 AND active=true AND role IN ('Owner','Sales')",
            [d.assignedTo],
          )
        ).rows.length
      )
        throw new AppError(400, 'Choose an active sales staff member');
      const e = await get(tx, 'enquiries', String(req.params.id));
      const result = await save(tx, 'enquiries', { ...e, ...d }, e.id);
      await audit(tx, res.locals.user, 'Update enquiry', 'enquiries', e.id);
      return result;
    }),
  );
  app.post(
    '/api/admin/enquiries/:id/customer',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const e = await get(tx, 'enquiries', String(req.params.id));
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
      await audit(tx, res.locals.user, 'Create customer from enquiry', 'customers', c.id);
      return c;
    }),
  );
  app.post(
    '/api/admin/quotes',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const q = await makeQuote(tx, req.body);
      await audit(tx, res.locals.user, 'Create quotation', 'quotes', q.id);
      return q;
    }),
  );
  app.put(
    '/api/admin/quotes/:id',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const q = await makeQuote(tx, req.body, String(req.params.id));
      await audit(tx, res.locals.user, 'Edit quotation', 'quotes', q.id);
      return q;
    }),
  );
  app.post(
    '/api/admin/quotes/:id/status',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const d = z
        .object({
          status: z.enum(['Sent', 'Accepted', 'Declined']),
          acceptanceNote: z.string().max(2000).optional(),
        })
        .parse(req.body);
      const q = await get(tx, 'quotes', String(req.params.id));
      const allowed: Record<string, string[]> = { Draft: ['Sent'], Sent: ['Accepted', 'Declined'] };
      if (!allowed[q.status]?.includes(d.status))
        throw new AppError(409, 'Quotation status change is not allowed');
      if (d.status === 'Accepted' && !d.acceptanceNote?.trim())
        throw new AppError(400, 'Record how and when the customer accepted');
      const result = await save(tx, 'quotes', { ...q, ...d }, q.id);
      await audit(tx, res.locals.user, 'Quotation ' + d.status, 'quotes', q.id);
      return result;
    }),
  );
  app.post(
    '/api/admin/quotes/:id/order',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const result = await reserveOrder(tx, await get(tx, 'quotes', String(req.params.id)));
      await audit(tx, res.locals.user, 'Confirm order', 'orders', result.id);
      return result;
    }),
  );
  app.post(
    '/api/admin/orders/:id/status',
    roles('Owner', 'Warehouse'),
    mutation(async (tx, req, res) => {
      const d = z
        .object({
          status: z.enum(['Packing', 'Dispatched', 'Delivered', 'Cancelled']),
          deliveryReference: z.string().max(300),
        })
        .parse(req.body);
      const result = await transitionOrder(
        tx,
        String(req.params.id),
        d.status,
        d.deliveryReference,
      );
      await audit(tx, res.locals.user, 'Order ' + d.status, 'orders', result.id);
      return result;
    }),
  );
  app.post(
    '/api/admin/orders/:id/invoice',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const result = await invoice(tx, String(req.params.id));
      await audit(tx, res.locals.user, 'Issue invoice', 'invoices', result.id);
      return result;
    }),
  );
  app.post(
    '/api/admin/orders/:id/payment',
    roles(...commercial),
    mutation(async (tx, req, res) => {
      const result = await payment(tx, String(req.params.id), req.body);
      await audit(tx, res.locals.user, 'Record payment', 'orders', result.id);
      return result;
    }),
  );
  app.post(
    '/api/admin/batches',
    roles(...warehouse),
    mutation(async (tx, req, res) => {
      const r = await stock(tx, req.body, res.locals.user);
      await audit(tx, res.locals.user, 'Receive stock', 'batches', r.id);
      return r;
    }),
  );
  app.post(
    '/api/admin/batches/:id/adjust',
    roles(...warehouse),
    mutation(async (tx, req, res) => {
      const r = await adjustStock(tx, String(req.params.id), req.body, res.locals.user);
      await audit(tx, res.locals.user, 'Adjust stock', 'batches', r.id);
      return r;
    }),
  );
  app.get('/api/admin/:kind/:id/pdf', roles(...commercial), async (req, res) => {
    if (!['quotes', 'invoices'].includes(String(req.params.kind)))
      throw new AppError(404, 'Document not found');
    documentPdf(
      await get(db, String(req.params.kind), String(req.params.id)),
      String(req.params.kind),
      res,
    );
  });
  const visible = (kind: string, data: any[], role: string) =>
    role === 'Warehouse' && kind === 'orders'
      ? data.map((o) => ({
          id: o.id,
          reference: o.reference,
          status: o.status,
          customer: {
            name: o.customer.name,
            business: o.customer.business,
            address: o.customer.address,
            phone: o.customer.phone,
          },
          items: o.items.map((i: any) => ({
            name: i.name,
            quantity: i.quantity,
            packSize: i.packSize,
          })),
          deliveryReference: o.deliveryReference,
          createdAt: o.createdAt,
        }))
      : data;
  app.get('/api/admin/:kind/export', async (req, res) => {
    const kind = String(req.params.kind);
    if (!readRoles[kind]?.includes(res.locals.user.role))
      throw new AppError(403, 'Export not permitted');
    const rows = visible(kind, await list(db, kind), res.locals.user.role);
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const cell = (v: any) => {
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    res.type('text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="horeca-${kind}.csv"`);
    res.send(
      '\uFEFF' +
        [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join(
          '\r\n',
        ),
    );
  });
  app.get('/api/admin/:kind', async (req, res) => {
    const kind = String(req.params.kind);
    if (!readRoles[kind]?.includes(res.locals.user.role))
      throw new AppError(403, 'Access not permitted');
    res.json(visible(kind, await db.transaction((tx) => list(tx, kind)), res.locals.user.role));
  });
  const genericSave = mutation(async (tx, req, res) => {
    const kind = String(req.params.kind);
    const schema = schemas[kind];
    if (!schema) throw new AppError(404, 'Unknown operation');
    if (
      kind === 'customers'
        ? !commercial.includes(res.locals.user.role)
        : res.locals.user.role !== 'Owner'
    )
      throw new AppError(403, 'Edit not permitted');
    const data = schema.parse(req.body);
    const id = req.params.id ? String(req.params.id) : undefined;
    if (id) await get(tx, kind, id);
    if (kind === 'settings' && id !== 'business-settings')
      throw new AppError(400, 'Use business settings');
    if (['brands', 'categories'].includes(kind)) {
      const all = await list(tx, kind);
      if (all.some((r) => r.id !== id && r.name.toLowerCase() === data.name.toLowerCase()))
        throw new AppError(409, 'Name already exists');
      if (id) {
        const old = await get(tx, kind, id);
        for (const p of await list(tx, 'products')) {
          const field = kind === 'brands' ? 'brand' : 'category';
          if (p[field] === old.name) await save(tx, 'products', { ...p, [field]: data.name }, p.id);
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
    const r = await save(tx, kind, data, id);
    await audit(tx, res.locals.user, id ? 'Update' : 'Create', kind, r.id);
    return r;
  });
  app.post('/api/admin/:kind', genericSave);
  app.put('/api/admin/:kind/:id', genericSave);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post('/api/admin/media/upload', roles('Owner'), upload.single('image'), async (req, res) => {
    const f = req.file;
    if (!f) throw new AppError(400, 'Choose a JPEG, PNG, or WebP image');
    const original = f.buffer;
    const jpg = original[0] === 255 && original[1] === 216 && original[2] === 255;
    const png = original.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp =
      original.toString('ascii', 0, 4) === 'RIFF' && original.toString('ascii', 8, 12) === 'WEBP';
    if (!jpg && !png && !webp)
      throw new AppError(400, 'Only JPEG, PNG, and WebP files are allowed');
    let b: Buffer;
    try {
      b = await sharp(original, { limitInputPixels: 25_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      throw new AppError(400, 'Image is invalid or exceeds 25 megapixels');
    }
    const mime = 'image/webp',
      key = `${randomUUID()}.webp`;
    let url: string;
    if (process.env.S3_BUCKET) {
      if (!process.env.S3_PUBLIC_URL)
        throw new AppError(503, 'Storage public URL is not configured');
      const s3 = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        forcePathStyle: true,
      });
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: b,
          ContentType: mime,
        }),
      );
      url = `${process.env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
    } else {
      if (prod) throw new AppError(503, 'Object storage is not configured');
      await mkdir('uploads', { recursive: true });
      await writeFile(resolve('uploads', key), b);
      url = `/uploads/${key}`;
    }
    await db.transaction((tx) => audit(tx, res.locals.user, 'Upload image', 'media', key));
    res.json({ url });
  });
  app.use(
    '/uploads',
    express.static(resolve('uploads'), {
      immutable: true,
      maxAge: '1y',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Endpoint not found')));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'This record already exists' });
    if (err instanceof multer.MulterError)
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'Images must be smaller than 5 MB' : err.message,
      });
    console.error('Request failed', err.message);
    res.status(500).json({ error: 'Unable to complete this request. Please try again.' });
  });
  return app;
}
