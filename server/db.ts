import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir, open, readFile, unlink, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishEvent } from './notifications.js';

export type Row = { id: string; [key: string]: any };
export interface Sql {
  query<T = any>(text: string, values?: any[]): Promise<{ rows: T[] }>;
}
export class Database implements Sql {
  private local?: PGlite;
  private pool?: pg.Pool;
  private queue: Promise<unknown> = Promise.resolve();
  private lockPath?: string;
  constructor(
    private url = process.env.DATABASE_URL,
    private directory = process.env.DATA_DIR || '.data/postgres',
  ) {}
  async init() {
    if (this.url) this.pool = new pg.Pool({ connectionString: this.url });
    else {
      if (this.directory !== 'memory://') {
        this.directory = resolve(this.directory);
        await mkdir(this.directory, { recursive: true });
        const path = `${this.directory}.runtime.lock`;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const handle = await open(path, 'wx');
            await handle.writeFile(String(process.pid));
            await handle.close();
            this.lockPath = path;
            break;
          } catch (e: any) {
            if (e.code !== 'EEXIST') throw e;
            const pid = Number(await readFile(path, 'utf8'));
            let active = true;
            try {
              process.kill(pid, 0);
            } catch (probe: any) {
              if (probe.code === 'ESRCH') active = false;
            }
            if (active)
              throw new Error(
                'The local database is already open. Run npm run stop before setup or restarting the server.',
              );
            await unlink(path);
          }
        }
      }
      try {
        this.local = new PGlite(this.directory);
        await this.local.waitReady;
      } catch (e) {
        if (this.lockPath) await unlink(this.lockPath).catch(() => {});
        throw e;
      }
    }
    await this.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(resolve('migrations')))
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort()) {
      if (
        (await this.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rows.length
      )
        continue;
      const sql = await readFile(resolve('migrations', name), 'utf8');
      const client = this.pool ? await this.pool.connect() : null;
      const migration: Sql = client || this;
      await migration.query('BEGIN');
      try {
        for (const statement of sql
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean))
          await migration.query(statement);
        await migration.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        await migration.query('COMMIT');
      } catch (e) {
        await migration.query('ROLLBACK');
        throw e;
      } finally {
        client?.release();
      }
    }
    return this;
  }
  async query<T = any>(text: string, values: any[] = []): Promise<{ rows: T[] }> {
    if (this.pool) return this.pool.query(text, values) as unknown as Promise<{ rows: T[] }>;
    return this.local!.query<T>(text, values);
  }
  async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
    const perform = async () => {
      const client = this.pool ? await this.pool.connect() : null;
      const tx: Sql = client || this;
      try {
        await tx.query('BEGIN');
        await tx.query('SELECT id FROM app_lock WHERE id=1 FOR UPDATE');
        const result = await fn(tx);
        await tx.query('COMMIT');
        return result;
      } catch (e) {
        await tx.query('ROLLBACK');
        throw e;
      } finally {
        client?.release();
      }
    };
    if (this.pool) return perform();
    const next = this.queue.then(perform, perform);
    this.queue = next.catch(() => {});
    return next;
  }
  async close() {
    await this.pool?.end();
    await this.local?.close();
    if (this.lockPath) {
      await unlink(this.lockPath).catch(() => {});
      this.lockPath = undefined;
    }
  }
}
export async function list(tx: Sql, kind: string): Promise<Row[]> {
  return (
    await tx.query<{ id: string; data: any }>(
      'SELECT id,data FROM app_records WHERE kind=$1 ORDER BY created_at DESC,id',
      [kind],
    )
  ).rows.map((r) => ({ ...r.data, id: r.id }));
}
export async function get(tx: Sql, kind: string, id: string): Promise<Row> {
  const r = (await tx.query('SELECT id,data FROM app_records WHERE kind=$1 AND id=$2', [kind, id]))
    .rows[0];
  if (!r) throw new AppError(404, 'Record not found');
  return { ...r.data, id: r.id };
}
export async function save(
  tx: Sql,
  kind: string,
  data: any,
  id: string = randomUUID(),
): Promise<Row> {
  const record = { ...data, id, updatedAt: new Date().toISOString() };
  await tx.query(
    'INSERT INTO app_records(id,kind,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE app_records.kind=excluded.kind',
    [id, kind, JSON.stringify(record)],
  );
  return record;
}
export async function number(tx: Sql, prefix: string) {
  const current = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const start = Number(current.slice(0, 4)) - (Number(current.slice(5, 7)) < 4 ? 1 : 0);
  const year =
    prefix === 'INV'
      ? `${String(start).slice(-2)}${String(start + 1).slice(-2)}`
      : current.slice(0, 4);
  const name = `${prefix}-${year}`;
  const result = await tx.query(
    'INSERT INTO counters(name,value) VALUES($1,1) ON CONFLICT(name) DO UPDATE SET value=counters.value+1 RETURNING value',
    [name],
  );
  const reference = `${name}-${String(result.rows[0].value).padStart(5, '0')}`;
  if (prefix === 'INV' && reference.length > 16)
    throw new AppError(409, 'Invoice series limit reached');
  return reference;
}
export async function audit(tx: Sql, user: any, action: string, entity: string, id: string) {
  const record = (await tx.query('SELECT data FROM app_records WHERE id=$1', [id])).rows[0]?.data;
  const label = record?.reference || record?.name || record?.batch || '';
  await publishEvent(tx, entity, id, `${action}${label ? ': ' + label : ''}`, user.id);
  return save(tx, 'audit', {
    actor: user.email,
    action,
    entity,
    recordId: id,
    at: new Date().toISOString(),
  });
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
