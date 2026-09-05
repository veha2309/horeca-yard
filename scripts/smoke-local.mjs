import { readFile } from 'node:fs/promises';
const text = await readFile('.data/local-access.txt', 'utf8');
const email = text.match(/^Email: (.+)$/m)?.[1],
  password = text.match(/^Password: (.+)$/m)?.[1];
const origin = 'http://localhost:3000';
const home = await fetch(origin);
if (!home.ok) throw new Error('Homepage unavailable');
const catalogue = await fetch(origin + '/api/catalogue').then((r) => r.json());
if (catalogue.products.length !== 12 || catalogue.categories.length !== 6)
  throw new Error('Catalogue seed mismatch');
for (const p of catalogue.products) {
  const image = await fetch(origin + p.image);
  if (!image.ok) throw new Error('Missing image: ' + p.name);
}
const login = await fetch(origin + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: origin },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error('Owner login failed');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Missing session cookie');
const me = await fetch(origin + '/api/admin/me', { headers: { cookie } }).then((r) => r.json());
if (me.role !== 'Owner') throw new Error('Owner role mismatch');
await fetch(origin + '/api/auth/logout', { method: 'POST', headers: { cookie, origin: origin } });
console.log(
  'Local smoke check passed: homepage, 12 product images, catalogue, owner sign-in, role and sign-out.',
);
