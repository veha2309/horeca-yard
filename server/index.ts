import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { Database } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.DATABASE_URL || !process.env.APP_URL?.startsWith('https://')))
  throw new Error('Production requires DATABASE_URL and an HTTPS APP_URL');
const db = await new Database().init();
await seed(db);
const app = createApp(db);
const server = createHttpServer(app);
let vite: import('vite').ViteDevServer | undefined;
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await vite?.close();
  server.closeAllConnections();
  server.close();
  await db.close();
  if (!production) await unlink('.data/runtime.json').catch(() => {});
  process.exit(0);
}
if (production) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const controlToken = randomBytes(32).toString('hex');
  app.post('/__local/stop', (req, res) => {
    if (req.headers['x-local-control'] !== controlToken) return res.sendStatus(403);
    res.json({ ok: true });
    setTimeout(() => void shutdown(), 100);
  });
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
  await mkdir('.data', { recursive: true });
  await writeFile(
    '.data/runtime.json',
    JSON.stringify({ port: Number(process.env.PORT || 3000), token: controlToken }),
    { mode: 0o600 },
  );
}
const port = Number(process.env.PORT || 3000);
server.listen(port, production ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(`Horeca Yard: http://localhost:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown());
