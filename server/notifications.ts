import type { Sql } from './db.js';

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
  tx: Sql,
  entity: string,
  recordId: string,
  message: string,
  actorId: string | null = null,
) {
  await tx.query(
    'INSERT INTO app_events(entity,record_id,message,actor_id,audience) VALUES($1,$2,$3,$4,$5)',
    [entity, recordId, message, actorId, audiences[entity] || ['Owner']],
  );
}

export async function notificationFeed(
  tx: Sql,
  user: { id: string; role: string },
  after?: string,
) {
  const cursor = String(
    (await tx.query('SELECT COALESCE(MAX(id),0) AS cursor FROM app_events')).rows[0].cursor,
  );
  const visible = '$1 = ANY(audience)';
  const lastRead = String(
    (await tx.query('SELECT last_read FROM notification_reads WHERE user_id=$1', [user.id])).rows[0]
      ?.last_read || '0',
  );
  const notificationRows = (
    await tx.query(
      `SELECT id::text,entity,record_id AS "recordId",message,created_at AS "createdAt",id > $3::bigint AS unread
     FROM app_events WHERE ${visible} AND (actor_id IS NULL OR actor_id <> $2)
     ORDER BY id DESC LIMIT 30`,
      [user.role, user.id, lastRead],
    )
  ).rows;
  const unread = Number(
    (
      await tx.query(
        `SELECT COUNT(*) AS count FROM app_events WHERE ${visible} AND (actor_id IS NULL OR actor_id <> $2) AND id > $3::bigint`,
        [user.role, user.id, lastRead],
      )
    ).rows[0].count,
  );
  const sectionRows = (
    await tx.query(
      `SELECT CASE WHEN entity='media' THEN 'products' ELSE entity END AS section, COUNT(*) AS count
     FROM app_events WHERE ${visible} AND (actor_id IS NULL OR actor_id <> $2) AND id > $3::bigint
     GROUP BY 1`,
      [user.role, user.id, lastRead],
    )
  ).rows;
  const sections = Object.fromEntries(sectionRows.map((row) => [row.section, Number(row.count)]));
  const events =
    after === undefined
      ? []
      : (
          await tx.query(
            `SELECT id::text,entity,record_id AS "recordId",message,actor_id AS "actorId" FROM app_events
     WHERE ${visible} AND id > $2::bigint ORDER BY id DESC LIMIT 100`,
            [user.role, after],
          )
        ).rows;
  return {
    cursor,
    notifications: notificationRows,
    unread,
    sections,
    events,
    changed: events.length > 0,
  };
}
