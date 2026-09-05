import {
  doc,
  collection,
  getDocs,
  runTransaction,
  query,
  where,
  orderBy,
  limit as fsLimit,
  type DocumentReference,
  type Transaction,
} from 'firebase/firestore';
import { firestore } from './firebase.js';
import { publishEvent } from './notifications.js';

export type Row = { id: string; [key: string]: any };
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A unit of work over a Firestore transaction.
 *
 * Firestore forbids reads after writes inside a transaction, but the ported
 * domain logic interleaves them freely. So writes are buffered here and flushed
 * once the callback returns, which keeps every `t.get` ahead of every `t.set`.
 * Reads consult the buffer first so a caller sees its own pending writes.
 */
export type Tx = {
  t: Transaction;
  buffer: Map<string, { ref: DocumentReference; data: any }>;
  read: Set<string>;
};
/** Kept so the ported domain modules can import the original type name. */
export type Sql = Tx;

const ref = (kind: string, id: string) => doc(firestore, kind, id);
const now = () => new Date().toISOString();

/** Enlists a document in the transaction's read set so writes get conflict detection. */
async function touch(tx: Tx, r: DocumentReference) {
  if (tx.read.has(r.path)) return tx.buffer.get(r.path)?.data;
  const snap = await tx.t.get(r);
  tx.read.add(r.path);
  return snap.exists() ? snap.data() : undefined;
}

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runTransaction(firestore, async (t) => {
    const tx: Tx = { t, buffer: new Map(), read: new Set() };
    const result = await fn(tx);
    for (const { ref: r, data } of tx.buffer.values()) t.set(r, data);
    return result;
  });
}

export async function get(tx: Tx, kind: string, id: string): Promise<Row> {
  const r = ref(kind, id);
  const pending = tx.buffer.get(r.path);
  if (pending) return { ...pending.data, id };
  const data = await touch(tx, r);
  if (!data) throw new AppError(404, 'Record not found');
  return { ...data, id };
}

/**
 * ponytail: list() reads outside the transaction snapshot, because the Firestore
 * web SDK cannot run queries inside a transaction. Documents this then writes are
 * still enlisted by save(), so concurrent edits to the same record are caught;
 * what is not caught is a record created by someone else mid-transaction.
 * Upgrade path: move these reads behind Cloud Functions with the Admin SDK.
 */
export async function list(tx: Tx, kind: string): Promise<Row[]> {
  const snap = await getDocs(collection(firestore, kind));
  const rows = new Map<string, Row>();
  for (const d of snap.docs) rows.set(d.id, { ...d.data(), id: d.id });
  for (const [path, { data }] of tx.buffer)
    if (path.startsWith(`${kind}/`)) rows.set(data.id, { ...data });
  return [...rows.values()].sort(
    (a, b) => String(b._createdAt ?? '').localeCompare(String(a._createdAt ?? '')) || a.id.localeCompare(b.id),
  );
}

export async function save(tx: Tx, kind: string, data: any, id?: string) {
  const creating = id === undefined;
  const r = ref(kind, id ?? crypto.randomUUID());
  // A brand-new document cannot exist, so skip the read. That matters beyond
  // saving a round trip: several collections allow append without read (audit,
  // enquiries from the public site), and reading first would be denied.
  const existing = tx.buffer.get(r.path)?.data ?? (creating ? undefined : await touch(tx, r));
  id = r.id;
  const record = {
    ...data,
    id,
    updatedAt: now(),
    _createdAt: existing?._createdAt ?? data._createdAt ?? now(),
  };
  tx.buffer.set(r.path, { ref: r, data: record });
  return record as Row;
}

export async function remove(tx: Tx, kind: string, id: string) {
  const r = ref(kind, id);
  await touch(tx, r);
  tx.buffer.delete(r.path);
  tx.t.delete(r);
}

/** Monotonic sequence used for both reference numbers and the notification feed. */
export async function bump(tx: Tx, name: string): Promise<number> {
  const r = ref('counters', name);
  const current = tx.buffer.get(r.path)?.data ?? (await touch(tx, r));
  const value = Number(current?.value ?? 0) + 1;
  tx.buffer.set(r.path, { ref: r, data: { id: name, value } });
  return value;
}

export async function number(tx: Tx, prefix: string) {
  const current = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const start = Number(current.slice(0, 4)) - (Number(current.slice(5, 7)) < 4 ? 1 : 0);
  const year =
    prefix === 'INV'
      ? `${String(start).slice(-2)}${String(start + 1).slice(-2)}`
      : current.slice(0, 4);
  const name = `${prefix}-${year}`;
  const reference = `${name}-${String(await bump(tx, name)).padStart(5, '0')}`;
  if (prefix === 'INV' && reference.length > 16)
    throw new AppError(409, 'Invoice series limit reached');
  return reference;
}

/** Collections that audit() may be asked to label a record from. */
const auditCollection: Record<string, string> = { staff: 'users' };

export async function audit(tx: Tx, user: any, action: string, entity: string, id: string) {
  let label = '';
  const kind = auditCollection[entity] ?? entity;
  const pending = tx.buffer.get(`${kind}/${id}`)?.data;
  const record = pending ?? (await touch(tx, ref(kind, id)).catch(() => undefined));
  if (record) label = record.reference || record.name || record.batch || '';
  await publishEvent(tx, entity, id, `${action}${label ? ': ' + label : ''}`, user.id);
  return save(tx, 'audit', {
    actor: user.email,
    action,
    entity,
    recordId: id,
    at: now(),
  });
}

/** Non-transactional helpers used by read-only endpoints. */
export const readAll = async (kind: string): Promise<Row[]> => {
  const snap = await getDocs(collection(firestore, kind));
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }) as Row)
    .sort(
      (a, b) =>
        String(b._createdAt ?? '').localeCompare(String(a._createdAt ?? '')) ||
        a.id.localeCompare(b.id),
    );
};
export { collection, query, where, orderBy, fsLimit, getDocs, firestore };
