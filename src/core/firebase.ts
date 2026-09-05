import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  projectId: 'horecayard',
  appId: '1:355453297867:web:4a622f17ec7de9b05de74e',
  storageBucket: 'horecayard.firebasestorage.app',
  apiKey: 'AIzaSyDDAQRaTQPaf_7E-El6oyzl6Eh6WhIrS3A',
  authDomain: 'horecayard.firebaseapp.com',
  messagingSenderId: '355453297867',
};
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);

// Point the tests at the local emulators instead of the live project.
if (typeof process !== 'undefined' && process.env?.FIREBASE_EMULATOR) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
}
