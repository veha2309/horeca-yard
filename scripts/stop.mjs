import { readFile } from 'node:fs/promises';
try {
  const { port, token } = JSON.parse(await readFile('.data/runtime.json', 'utf8'));
  const r = await fetch(`http://127.0.0.1:${Number(port)}/__local/stop`, {
    method: 'POST',
    headers: { 'x-local-control': token },
  });
  if (!r.ok) throw new Error('Local server did not accept shutdown');
  console.log('Local server is shutting down and flushing the database.');
} catch (e) {
  console.error(`Could not stop preview: ${e.message}`);
  process.exitCode = 1;
}
