/**
 * Test Setup for Firebase Functions
 * Initializes Firebase Admin and Test Environment
 */

import * as admin from 'firebase-admin';
import * as testEnv from 'firebase-functions-test';

// Initialize test environment
export const test = testEnv({
  projectId: 'profit-step-test',
});

// Set emulator host
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

// Initialize admin with emulator
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'profit-step-test',
  });
}

export { admin };

// Export Firestore instance
export const db = admin.firestore();

// Cleanup function
export const cleanup = async () => {
  await test.cleanup();
};
