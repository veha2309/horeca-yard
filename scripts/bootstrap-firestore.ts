/**
 * One-time setup for the Firestore backend: creates the owner sign-in and writes
 * the seed catalogue. Safe to re-run — it never overwrites an existing owner or
 * an already-seeded catalogue.
 *
 * Usage: OWNER_EMAIL=you@example.com npm run bootstrap
 */
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { collection, doc, getDocs, getFirestore, setDoc, writeBatch } from 'firebase/firestore';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { firebaseConfig } from '../src/core/firebase.js';
import { seedRecords, settings } from '../src/core/seed.js';

const email = (process.env.OWNER_EMAIL || 'admin@horecayard.com').toLowerCase();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let password = process.env.OWNER_PASSWORD || randomBytes(18).toString('base64url');
let credentialsWritten = false;
try {
  await createUserWithEmailAndPassword(auth, email, password);
  await mkdir('.data', { recursive: true });
  await writeFile(
    '.data/firebase-access.txt',
    `Horeca Yard admin access (Firebase)\n\nSign in: https://${firebaseConfig.projectId}.web.app/admin/login\nEmail: ${email}\nPassword: ${password}\n\nChange it from Staff & access after signing in.\nThis file is ignored by Git. Do not share or deploy it.\n`,
    { mode: 0o600 },
  );
  credentialsWritten = true;
  console.log('Owner account created. Credentials saved to .data/firebase-access.txt');
} catch (e: any) {
  if (e?.code !== 'auth/email-already-in-use') throw e;
  if (!process.env.OWNER_PASSWORD)
    throw new Error(
      `${email} already exists. Re-run with OWNER_PASSWORD set to its password to finish seeding.`,
    );
  await signInWithEmailAndPassword(auth, email, password);
  console.log('Owner account already exists; signed in to continue seeding.');
}

const uid = auth.currentUser!.uid;
await setDoc(
  doc(db, 'users', uid),
  { id: uid, email, name: 'Horeca Yard Owner', role: 'Owner', active: true },
  { merge: true },
);
console.log('Owner role recorded.');

if ((await getDocs(collection(db, 'products'))).empty) {
  const records = seedRecords(randomUUID);
  const batch = writeBatch(db);
  for (const [kind, rows] of Object.entries(records))
    for (const row of rows) batch.set(doc(db, kind, row.id), row);
  batch.set(doc(db, 'public', 'site'), {
    id: 'site',
    businessName: settings.businessName,
    phone: settings.phone,
    instagram: settings.instagram,
    heroTitle: settings.heroTitle,
    heroDescription: settings.heroDescription,
    version: Date.now(),
  });
  await batch.commit();
  console.log('Catalogue seeded: 6 categories, 7 brands, 12 products, business settings.');
} else {
  console.log('Catalogue already present; left untouched.');
}
if (!credentialsWritten) console.log('Done.');
process.exit(0);
