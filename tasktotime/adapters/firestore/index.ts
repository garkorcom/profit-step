/**
 * Barrel for `tasktotime/adapters/firestore/*`. Composition root imports
 * adapters from this module; individual files stay under tree to keep the
 * surface area easy to grep.
 *
 * Other adapters (FirestoreClientLookup, FirestoreUserLookup, etc.) are
 * being added by parallel agents and will be re-exported from here as they
 * land. Keep one export per adapter to make the wiring obvious.
 */

export { FirestoreTaskRepository, TASKTOTIME_TASKS_COLLECTION, PATCH_FORBIDDEN_KEYS } from './FirestoreTaskRepository';
export {
  FirestoreTransitionLog,
  TRANSITION_LOG_COLLECTION,
  makeTransitionLogId,
} from './FirestoreTransitionLog';

// Helpers consumed by downstream tests / adapters.
export * from './_shared';
