/** Changes the signed-in owner's Firebase Auth password.
 *  Usage: OWNER_EMAIL=... CURRENT_PASSWORD=... NEW_PASSWORD=... tsx scripts/set-password.mts */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, updatePassword } from 'firebase/auth';
import { firebaseConfig } from '../src/core/firebase.js';

const { OWNER_EMAIL, CURRENT_PASSWORD, NEW_PASSWORD } = process.env;
if (!OWNER_EMAIL || !CURRENT_PASSWORD || !NEW_PASSWORD)
  throw new Error('OWNER_EMAIL, CURRENT_PASSWORD and NEW_PASSWORD are all required');

const auth = getAuth(initializeApp(firebaseConfig));
const cred = await signInWithEmailAndPassword(auth, OWNER_EMAIL.toLowerCase(), CURRENT_PASSWORD);
await updatePassword(cred.user, NEW_PASSWORD);
console.log(`Password updated for ${OWNER_EMAIL}.`);
process.exit(0);
