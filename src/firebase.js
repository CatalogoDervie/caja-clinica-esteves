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
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
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
