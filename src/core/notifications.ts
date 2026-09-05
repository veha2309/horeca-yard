import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { firestore } from './firebase.js';
import { bump, type Tx } from './db.js';

const audiences: Record<string, string[]> = {
  products: ['Owner', 'Sales', 'Warehouse'],
  brands: ['Owner', 'Sales', 'Warehouse'],
  categories: ['Owner', 'Sales', 'Warehouse'],
  enquiries: ['Owner', 'Sales'],
  customers: ['Owner', 'Sales'],
  quotes: ['Owner', 'Sales'],
  orders: ['Owner', 'Sales', 'Warehouse'],
  invoices: ['Owner', 'Sales'],
  batches: ['Owner', 'Warehouse'],
  media: ['Owner'],
  settings: ['Owner'],
  staff: ['Owner'],
};

export async function publishEvent(
  tx: Tx,
  entity: string,
  recordId: string,
  message: string,
  actorId: string | null = null,
) {
  const seq = await bump(tx, '__events');
  const id = String(seq).padStart(12, '0');
  const r = doc(firestore, 'events', id);
  tx.buffer.set(r.path, {
    ref: r,
    data: {
      id,
      seq,
      entity,
      recordId,
      message,
      actorId,
      audience: audiences[entity] || ['Owner'],
      createdAt: new Date().toISOString(),
    },
  });
}

/** Newest events this role may see, capped so a busy log cannot grow the read unbounded. */
const feedWindow = 200;
async function visibleEvents(role: string, max = feedWindow) {
  const snap = await getDocs(
    query(
      collection(firestore, 'events'),
      where('audience', 'array-contains', role),
      orderBy('seq', 'desc'),
      limit(max),
    ),
  );
  return snap.docs.map((d) => d.data() as any);
}

export async function notificationFeed(user: { id: string; role: string }, after?: string) {
  const rows = await visibleEvents(user.role);
  const cursor = String(rows[0]?.seq ?? 0);
  const readSnap = await getDoc(doc(firestore, 'notificationReads', user.id));
  const lastRead = Number(readSnap.data()?.lastRead ?? 0);

  const mine = rows.filter((e) => !e.actorId || e.actorId !== user.id);
  const unreadRows = mine.filter((e) => Number(e.seq) > lastRead);
  const sections: Record<string, number> = {};
  for (const e of unreadRows) {
    const section = e.entity === 'media' ? 'products' : e.entity;
    sections[section] = (sections[section] || 0) + 1;
  }
  const events =
    after === undefined ? [] : rows.filter((e) => Number(e.seq) > Number(after)).slice(0, 100);
  return {
    cursor,
    notifications: mine.slice(0, 30).map((e) => ({
      id: String(e.seq),
      entity: e.entity,
      recordId: e.recordId,
      message: e.message,
      createdAt: e.createdAt,
      unread: Number(e.seq) > lastRead,
    })),
    unread: unreadRows.length,
    sections,
    events: events.map((e) => ({
      id: String(e.seq),
      entity: e.entity,
      recordId: e.recordId,
      message: e.message,
      actorId: e.actorId,
    })),
    changed: events.length > 0,
  };
}
