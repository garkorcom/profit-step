/**
 * Firebase Configuration
 * Инициализация Firebase SDK
 */

import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Firebase конфигурация из .env файла
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);

// Экспорт сервисов
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

// 🛠️ Подключение к Firebase Emulators (для локальной разработки)
// Используется только если REACT_APP_USE_EMULATORS=true в .env.local
if (process.env.REACT_APP_USE_EMULATORS === 'true') {
  console.log('🔧 Connecting to Firebase Emulators...');

  // Auth Emulator: http://localhost:9099
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });

  // Firestore Emulator: http://localhost:8080
  connectFirestoreEmulator(db, 'localhost', 8080);

  // Storage Emulator: http://localhost:9199
  connectStorageEmulator(storage, 'localhost', 9199);

  // Functions Emulator: http://localhost:5001
  connectFunctionsEmulator(functions, 'localhost', 5001);

  console.log('✅ Connected to Firebase Emulators');
  console.log('   - Auth: http://localhost:9099');
  console.log('   - Firestore: http://localhost:8080');
  console.log('   - Storage: http://localhost:9199');
  console.log('   - Functions: http://localhost:5001');
  console.log('   - Emulator UI: http://localhost:4000');
}

export default app;
