import { getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  getFirestore,
} from 'firebase/firestore';

const emulatorMode = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true';

const firebaseConfig = emulatorMode
  ? {
      apiKey: 'demo-api-key',
      authDomain: 'demo-caja-clinica.firebaseapp.com',
      projectId: 'demo-caja-clinica',
      appId: '1:123456789:web:demo',
    }
  : {
      apiKey: 'AIzaSyAAKyb5gg1CsXxJ0LLEzi0Janf1_h2A3Ac',
      authDomain: 'caja-clinicas-online.firebaseapp.com',
      projectId: 'caja-clinicas-online',
      storageBucket: 'caja-clinicas-online.firebasestorage.app',
      messagingSenderId: '269288374717',
      appId: '1:269288374717:web:beece06a943efb555152d4',
    };

const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
export const missingFirebaseKeys = requiredKeys.filter((key) => !firebaseConfig[key]);
export const firebaseReady = missingFirebaseKeys.length === 0;
export const usingFirebaseEmulators = emulatorMode;

let auth = null;
let db = null;

if (firebaseReady) {
  const app = getApps()[0] || initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  if (emulatorMode) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  } else {
    enableIndexedDbPersistence(db).catch((error) => {
      if (!['failed-precondition', 'unimplemented'].includes(error.code)) throw error;
    });
  }
}

export { auth, db };

export async function configureAuthPersistence() {
  if (!auth) return;
  await setPersistence(auth, browserLocalPersistence);
}
