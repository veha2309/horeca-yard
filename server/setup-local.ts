import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Database } from './db.js';
import { passwordHash } from './auth.js';
import { seed } from './seed.js';
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL)
  throw new Error(
    'Use npm run setup with explicit owner configuration for PostgreSQL or production.',
  );
const db = await new Database().init();
await seed(db);
try {
  await db.transaction(async (tx) => {
    if ((await tx.query("SELECT id FROM users WHERE role='Owner'")).rows.length) {
      console.log('An owner already exists; no credentials changed.');
      return;
    }
    const email = 'admin@horecayard.com',
      password = randomBytes(18).toString('base64url');
    await tx.query("INSERT INTO users(id,email,name,role,password) VALUES($1,$2,$3,'Owner',$4)", [
      randomUUID(),
      email,
      'Horeca Yard Owner',
      passwordHash(password),
    ]);
    await mkdir('.data', { recursive: true });
    await writeFile(
      '.data/local-access.txt',
      `Horeca Yard local development access\n\nSign in: http://localhost:3000/admin/login\nEmail: ${email}\nPassword: ${password}\n\nThis password was randomly generated for the new LOCAL application.\nIt is not the Emergent reference password.\nChange it from Staff & access after signing in.\nThis file is ignored by Git. Do not share or deploy it.\n`,
      { mode: 0o600 },
    );
    console.log('Local owner created. Credentials saved to .data/local-access.txt (not printed).');
  });
} finally {
  await db.close();
}
