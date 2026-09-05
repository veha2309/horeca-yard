import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { Database, audit } from './db.js';
import { passwordHash } from './auth.js';
if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL)
  throw new Error('This utility only changes the local development account.');
const password = z.string().min(12).max(200).parse(process.env.OWNER_PASSWORD);
const email = process.env.OWNER_EMAIL || 'admin@horecayard.com';
const db = await new Database().init();
try {
  await db.transaction(async (tx) => {
    const owner = (
      await tx.query("SELECT id,email FROM users WHERE email=$1 AND role='Owner' AND active=true", [
        email,
      ])
    ).rows[0];
    if (!owner) throw new Error('Local owner not found');
    await tx.query('UPDATE users SET password=$1 WHERE id=$2', [passwordHash(password), owner.id]);
    await tx.query('DELETE FROM password_resets WHERE user_id=$1', [owner.id]);
    await audit(tx, owner, 'Local account password updated', 'staff', owner.id);
  });
  const access = await readFile('.data/local-access.txt', 'utf8');
  await writeFile(
    '.data/local-access.txt',
    access
      .replace(/^Password: .*$/m, () => `Password: ${password}`)
      .replace(
        /This password was randomly generated for the new LOCAL application\.\nIt is not the Emergent reference password\./,
        'The local password was updated to the value requested by the owner.',
      ),
    { mode: 0o600 },
  );
  console.log('Local owner password updated. Existing local sessions are preserved.');
} finally {
  await db.close();
}
