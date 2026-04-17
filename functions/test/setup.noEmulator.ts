/**
 * Lightweight jest setup for unit tests that fully mock firebase-admin and
 * do NOT need the Firestore emulator. The main `setup.ts` imports
 * `firebase-functions-test`, which internally requires `firebase-functions/v1`
 * — a path that doesn't exist in firebase-functions@5 and crashes test boot.
 * Tests using this file sidestep that chain entirely.
 */
export {};
