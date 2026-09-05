import { z } from 'zod';
import { AppError, audit, get, list, number, save, type Row, type Sql } from './db.js';

const text = z.string().trim().max(300);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid date',
  );
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const schemas: Record<string, z.ZodTypeAny> = {
  products: z.object({
    name: text.min(2),
    brand: text.min(1),
    category: text.min(1),
    packSize: text.min(1),
    moq: text.min(1),
    minQuantity: z.coerce.number().int().min(1).max(100000),
    image: z
      .string()
      .max(1000)
      .refine(
        (v) =>
          v === '' ||
          /^\/images\/[\w.-]+$/.test(v) ||
          /^\/uploads\/[\w.-]+$/.test(v) ||
          /^https:\/\//.test(v),
        'Use an uploaded image or HTTPS URL',
      ),
    description: z.string().max(3000),
    published: z.boolean(),
    featured: z.boolean(),
    availability: z.enum(['On request', 'Available', 'Unavailable']),
    lowStockThreshold: z.coerce.number().int().min(0).max(1000000),
    hsn: z.string().regex(/^(\d{4}|\d{6}|\d{8})?$/),
  }),
  brands: z.object({ name: text.min(1), active: z.boolean() }),
  categories: z.object({ name: text.min(1), active: z.boolean() }),
  customers: z.object({
    name: text.min(2),
    business: text.min(1),
    phone: z.string().regex(/^\+?[\d\s()-]{10,18}$/),
    email: z.union([z.string().email(), z.literal('')]),
    address: z.string().max(2000),
    gstin: z.string().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/),
    stateCode: z.string().regex(/^(0[1-9]|[12][0-9]|3[0-8])?$/),
    notes: z.string().max(4000),
  }),
  settings: z.object({
    businessName: text.min(2),
    phone: z.string().regex(/^\d{10}$/),
    instagram: z.string().url().startsWith('https://www.instagram.com/'),
    heroTitle: text.min(10),
    heroDescription: z.string().min(10).max(1000),
    address: z.string().max(2000),
    gstin: z.string().regex(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/),
    stateCode: z.string().regex(/^(0[1-9]|[12][0-9]|3[0-8])?$/),
    email: z.union([z.string().email(), z.literal('')]),
    invoiceTerms: z.string().max(2000),
    bankDetails: z.string().max(1000),
    warehouseName: text.min(1),
  }),
};
export const enquirySchema = z.object({
  name: text.min(2),
  business: text,
  phone: z.string().regex(/^\+?[\d\s()-]{10,18}$/),
  outletType: text.min(1),
  message: z.string().max(3000),
  interests: z.array(text).max(6),
  items: z
    .array(
      z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) }),
    )
    .max(100),
  website: z.string().max(0).optional(),
});
export const quoteSchema = z.object({
  customerId: z.string().uuid(),
  enquiryId: z.string().optional(),
  validUntil: date,
  notes: z.string().max(2000),
  delivery: z.coerce.number().min(0).max(1000000),
  deliveryTaxRate: z.coerce.number().min(0).max(40),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(100000),
        rate: z.coerce.number().min(0.01).max(1000000),
        discount: z.coerce.number().min(0).max(100),
        taxRate: z.coerce.number().min(0).max(40),
      }),
    )
    .min(1)
    .max(100),
});
export const cents = (n: number) => Math.round(n * 100);
export async function makeQuote(tx: Sql, input: unknown, id?: string) {
  const data = quoteSchema.parse(input);
  if (data.validUntil < today())
    throw new AppError(400, 'Quotation validity cannot be in the past');
  const customer = await get(tx, 'customers', data.customerId);
  const settings = await get(tx, 'settings', 'business-settings');
  if (data.enquiryId) await get(tx, 'enquiries', data.enquiryId);
  if (id && (await get(tx, 'quotes', id)).status !== 'Draft')
    throw new AppError(409, 'Only draft quotations can be edited');
  const items = [];
  let taxable = 0,
    tax = 0;
  for (const item of data.items) {
    const p = await get(tx, 'products', item.productId);
    if (item.quantity < p.minQuantity)
      throw new AppError(400, `${p.name}: minimum ${p.minQuantity} packs`);
    const amount = Math.round(cents(item.rate) * item.quantity * (1 - item.discount / 100));
    const itemTax = Math.round((amount * item.taxRate) / 100);
    if (!Number.isSafeInteger(amount) || amount > 100000000000)
      throw new AppError(400, 'Line amount is too large');
    taxable += amount;
    tax += itemTax;
    items.push({ ...item, name: p.name, packSize: p.packSize, hsn: p.hsn, amount, tax: itemTax });
  }
  const delivery = cents(data.delivery),
    deliveryTax = Math.round((delivery * data.deliveryTaxRate) / 100);
  const original = id ? await get(tx, 'quotes', id) : null;
  return save(
    tx,
    'quotes',
    {
      ...data,
      items,
      customer,
      seller: settings,
      reference: original?.reference || (await number(tx, 'Q')),
      status: 'Draft',
      taxable,
      tax: tax + deliveryTax,
      deliveryAmount: delivery,
      deliveryTax,
      total: taxable + tax + delivery + deliveryTax,
      createdAt: original?.createdAt || new Date().toISOString(),
    },
    id,
  );
}
export async function reserveOrder(tx: Sql, quote: Row) {
  if (quote.orderId) return get(tx, 'orders', quote.orderId);
  if (quote.status !== 'Accepted')
    throw new AppError(409, 'Record customer acceptance before creating an order');
  if (quote.validUntil < today())
    throw new AppError(409, 'Quotation has expired. Create a new quotation.');
  const batches = (await list(tx, 'batches'))
    .filter((b) => b.expiry >= today())
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  const allocations: any[] = [];
  for (const item of quote.items) {
    let remaining = item.quantity;
    for (const batch of batches.filter((b) => b.productId === item.productId)) {
      const take = Math.min(remaining, batch.quantity - batch.reserved);
      if (take > 0) {
        batch.reserved += take;
        remaining -= take;
        allocations.push({ batchId: batch.id, productId: item.productId, quantity: take });
        await save(tx, 'batches', batch, batch.id);
      }
      if (!remaining) break;
    }
    if (remaining)
      throw new AppError(
        409,
        `Insufficient unexpired stock for ${item.name}. Receive stock before confirming.`,
      );
  }
  const order = await save(tx, 'orders', {
    ...quote,
    id: undefined,
    quoteId: quote.id,
    reference: await number(tx, 'O'),
    status: 'Confirmed',
    allocations,
    payments: [],
    paid: 0,
    deliveryReference: '',
    createdAt: new Date().toISOString(),
  });
  await save(tx, 'quotes', { ...quote, orderId: order.id }, quote.id);
  return order;
}
export async function transitionOrder(
  tx: Sql,
  id: string,
  status: string,
  deliveryReference: string,
) {
  const order = await get(tx, 'orders', id);
  const transitions: Record<string, string[]> = {
    Confirmed: ['Packing', 'Cancelled'],
    Packing: ['Dispatched', 'Cancelled'],
    Dispatched: ['Delivered'],
    Delivered: [],
    Cancelled: [],
  };
  if (!transitions[order.status]?.includes(status))
    throw new AppError(409, 'This order status change is not allowed');
  if (status === 'Cancelled' && (order.invoiceId || order.paid > 0))
    throw new AppError(
      409,
      'An invoiced or paid order cannot be cancelled. Reconcile it outside this workflow.',
    );
  if (status === 'Dispatched' && !deliveryReference.trim())
    throw new AppError(400, 'Enter a delivery or dispatch reference');
  if (status === 'Dispatched' || status === 'Cancelled')
    for (const a of order.allocations) {
      const b = await get(tx, 'batches', a.batchId);
      if (status === 'Dispatched' && b.expiry < today())
        throw new AppError(
          409,
          'Reserved stock has expired. Cancel and recreate the order with fresh stock.',
        );
      b.reserved -= a.quantity;
      if (status === 'Dispatched') b.quantity -= a.quantity;
      if (b.reserved < 0 || b.quantity < 0) throw new AppError(409, 'Stock allocation mismatch');
      await save(tx, 'batches', b, b.id);
      await save(tx, 'movements', {
        productId: a.productId,
        batchId: b.id,
        quantity: status === 'Dispatched' ? -a.quantity : 0,
        reason: `${status}: ${order.reference}`,
        at: new Date().toISOString(),
      });
    }
  return save(tx, 'orders', { ...order, status, deliveryReference }, id);
}
export async function invoice(tx: Sql, id: string) {
  const order = await get(tx, 'orders', id);
  if (order.invoiceId) return get(tx, 'invoices', order.invoiceId);
  if (order.status === 'Cancelled') throw new AppError(409, 'Cannot invoice a cancelled order');
  const seller = await get(tx, 'settings', 'business-settings');
  const customer = order.customer;
  if (
    !seller.gstin ||
    !seller.address ||
    !seller.stateCode ||
    seller.gstin.slice(0, 2) !== seller.stateCode
  )
    throw new AppError(
      400,
      'Configure the seller GSTIN, matching state code, and business address before invoicing',
    );
  if (!customer.address || !customer.stateCode)
    throw new AppError(
      400,
      'Customer address and place-of-supply state are required. Update the customer and create a new quotation.',
    );
  if (customer.gstin && customer.gstin.slice(0, 2) !== customer.stateCode)
    throw new AppError(400, 'Customer GSTIN and state code do not match');
  if (order.items.some((i: any) => !i.hsn))
    throw new AppError(
      400,
      'All product lines need HSN codes. Update the catalogue and create a new quotation.',
    );
  const intra = seller.stateCode === customer.stateCode;
  const inv = await save(tx, 'invoices', {
    ...order,
    id: undefined,
    orderId: order.id,
    reference: await number(tx, 'INV'),
    seller,
    issuedAt: new Date().toISOString(),
    taxType: intra ? 'CGST + SGST' : 'IGST',
    cgst: intra ? Math.floor(order.tax / 2) : 0,
    sgst: intra ? order.tax - Math.floor(order.tax / 2) : 0,
    igst: intra ? 0 : order.tax,
  });
  await save(tx, 'orders', { ...order, invoiceId: inv.id }, id);
  return inv;
}
export async function payment(tx: Sql, id: string, input: unknown) {
  const data = z
    .object({
      amount: z.coerce.number().positive().max(100000000),
      method: z.enum(['Bank transfer', 'Cash', 'UPI', 'Cheque']),
      reference: text.min(1),
      date,
    })
    .parse(input);
  if (data.date > today()) throw new AppError(400, 'Payment date cannot be in the future');
  const order = await get(tx, 'orders', id);
  const amount = cents(data.amount);
  if (amount < 1 || Math.abs(amount - data.amount * 100) > 0.000001)
    throw new AppError(400, 'Payment amount must use at most two decimal places');
  if (order.status === 'Cancelled' || !order.invoiceId)
    throw new AppError(409, 'Issue an invoice before recording payments');
  if (amount > order.total - order.paid)
    throw new AppError(400, 'Payment exceeds the outstanding balance');
  if (order.payments.some((p: any) => p.reference === data.reference))
    throw new AppError(409, 'This payment reference has already been recorded');
  return save(
    tx,
    'orders',
    {
      ...order,
      paid: order.paid + amount,
      payments: [...order.payments, { ...data, amount, recordedAt: new Date().toISOString() }],
    },
    id,
  );
}
export async function stock(tx: Sql, input: unknown, user: any) {
  const data = z
    .object({
      productId: z.string().uuid(),
      batch: text.min(1),
      expiry: date,
      quantity: z.coerce.number().int().positive().max(1000000),
      reason: text.min(3),
    })
    .parse(input);
  await get(tx, 'products', data.productId);
  if (data.expiry < today()) throw new AppError(400, 'Cannot receive an expired batch');
  if (
    (await list(tx, 'batches')).some(
      (b) => b.productId === data.productId && b.batch === data.batch,
    )
  )
    throw new AppError(409, 'Batch already exists. Use a stock adjustment.');
  const b = await save(tx, 'batches', { ...data, reserved: 0 });
  await save(tx, 'movements', {
    ...data,
    batchId: b.id,
    at: new Date().toISOString(),
    actor: user.email,
  });
  return b;
}
export async function adjustStock(tx: Sql, id: string, input: unknown, user: any) {
  const data = z
    .object({
      quantity: z.coerce
        .number()
        .int()
        .min(-1000000)
        .max(1000000)
        .refine((n) => n !== 0),
      reason: text.min(3),
    })
    .parse(input);
  const b = await get(tx, 'batches', id);
  if (b.quantity + data.quantity < b.reserved)
    throw new AppError(409, 'Adjustment would consume reserved stock or make stock negative');
  await save(tx, 'movements', {
    ...data,
    batchId: id,
    productId: b.productId,
    at: new Date().toISOString(),
    actor: user.email,
  });
  return save(tx, 'batches', { ...b, quantity: b.quantity + data.quantity }, id);
}
export async function reports(tx: Sql) {
  const enquiries = await list(tx, 'enquiries'),
    quotes = await list(tx, 'quotes'),
    orders = await list(tx, 'orders'),
    products = await list(tx, 'products'),
    batches = await list(tx, 'batches');
  const active = orders.filter((o) => o.status !== 'Cancelled');
  const until = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const lowStock = products
    .map((p) => ({
      ...p,
      lowStockThreshold: p.lowStockThreshold,
      stock: batches
        .filter((b) => b.productId === p.id && b.expiry >= today())
        .reduce((s, b) => s + b.quantity - b.reserved, 0),
    }))
    .filter((p) => p.stock <= p.lowStockThreshold);
  return {
    enquiries: enquiries.length,
    newEnquiries: enquiries.filter((e) => e.status === 'New').length,
    conversion: enquiries.length
      ? Math.round(
          (new Set(quotes.filter((q) => q.orderId && q.enquiryId).map((q) => q.enquiryId)).size /
            enquiries.length) *
            100,
        )
      : 0,
    orderTotal: active.reduce((s, o) => s + o.total, 0),
    outstanding: active.filter((o) => o.invoiceId).reduce((s, o) => s + o.total - o.paid, 0),
    orders: active.length,
    lowStock,
    expiring: batches.filter((b) => b.expiry <= until && b.quantity > 0),
  };
}
