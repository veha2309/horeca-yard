import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Database } from './db.js';
import { passwordHash } from './auth.js';
import { seed } from './seed.js';
import { z } from 'zod';
const email = z.string().email().parse(process.env.OWNER_EMAIL).toLowerCase();
const password = z.string().min(12).max(200).parse(process.env.OWNER_PASSWORD);
const db = await new Database().init();
await seed(db);
try {
  await db.transaction(async (tx) => {
    if ((await tx.query("SELECT id FROM users WHERE role='Owner'")).rows.length)
      throw new Error('An owner already exists. Use password recovery or owner staff management.');
    await tx.query("INSERT INTO users(id,email,name,role,password) VALUES($1,$2,$3,'Owner',$4)", [
      randomUUID(),
      email,
      'Horeca Yard Owner',
      passwordHash(password),
    ]);
  });
  console.log(
    'Owner created. Sign in at /admin/login. Remove OWNER_PASSWORD from your environment.',
  );
} finally {
  await db.close();
}
