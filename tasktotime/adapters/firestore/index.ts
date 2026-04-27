/**
 * Barrel for `tasktotime/adapters/firestore/*`.
 *
 * Composition root imports adapters from this module; individual files stay
 * under tree to keep the surface area easy to grep. One named export per
 * adapter — no default exports.
 *
 * Grouping below mirrors `spec/04-storage/adapter-mapping.md`:
 *   §1   TaskRepository       — root aggregate
 *   §2   TransitionLog        — append-only state machine log
 *   §3-9 Lookups               — read-only adapters (clients/users/etc.)
 *   §10  Estimate
 *   §11  Note
 *   §12  WorkSession
 *   §13  Payroll
 *   §14  InventoryCatalog
 *   §15  AIAudit / §16 AICache
 *   §17  Idempotency
 *   §24  File
 *   §25  ClockPort (RealClock)
 *   §26  IdGeneratorPort
 *
 * (External-port adapters live in `../external/`. Composition root barrel is
 * `../index.ts`.)
 */

// §1, §2 — task aggregate + transition log
export {
  FirestoreTaskRepository,
  TASKTOTIME_TASKS_COLLECTION,
  PATCH_FORBIDDEN_KEYS,
} from './FirestoreTaskRepository';
export {
  FirestoreTransitionLog,
  TRANSITION_LOG_COLLECTION,
  makeTransitionLogId,
} from './FirestoreTransitionLog';

// §3-9 — read-only lookups
export { FirestoreClientLookup } from './FirestoreClientLookup';
export { FirestoreProjectLookup } from './FirestoreProjectLookup';
export { FirestoreUserLookup } from './FirestoreUserLookup';
export { FirestoreEmployeeLookup } from './FirestoreEmployeeLookup';
export { FirestoreContactLookup } from './FirestoreContactLookup';
export { FirestoreSiteLookup } from './FirestoreSiteLookup';

// §10, §11 — estimates / notes
export { FirestoreEstimate } from './FirestoreEstimate';
export { FirestoreNote } from './FirestoreNote';

// §12, §13 — work sessions / payroll
export { FirestoreWorkSession } from './FirestoreWorkSession';
export { FirestorePayroll } from './FirestorePayroll';

// §14 — inventory
export { FirestoreInventoryCatalog } from './FirestoreInventoryCatalog';
export { FirestoreInventoryTx } from './FirestoreInventoryTx';

// §15, §16 — AI audit + cache
export { FirestoreAIAudit } from './FirestoreAIAudit';
export { FirestoreAICache } from './FirestoreAICache';

// §17 — idempotency
export { FirestoreIdempotency } from './FirestoreIdempotency';

// §24 — files metadata
export { FirestoreFile } from './FirestoreFile';

// §25, §26 — infra (live under firestore/ because IdGenerator touches Firestore)
export { RealClock } from './RealClock';
export { FirestoreIdGenerator } from './FirestoreIdGenerator';

// Helpers consumed by downstream tests / adapters.
export * from './_shared';
