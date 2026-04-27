/**
 * Barrel for `tasktotime/adapters/triggers/*`.
 *
 * Each trigger is a **pure async handler** with its own `Deps` interface.
 * Cloud Function wrappers in `functions/src/triggers/firestore/tasktotime/`
 * (added in PR-C) build the Deps from `admin.firestore()` etc. and call
 * the handlers below.
 *
 * Spec: `tasktotime/spec/05-api/triggers.md`.
 *
 * Conventions enforced across this folder (see `_shared.ts`):
 *   - Watched-fields filter on every onUpdate handler.
 *   - `IdempotencyPort.reserve(key, TTL_MS)` BEFORE side effects.
 *   - Notification + audit failures are logged at `warn`, never thrown.
 *   - One handler per file; no cross-handler imports.
 *
 * **Cumulative scope:**
 *   - PR-B1: observer triggers — audit + notifications.
 *   - PR-B2: reverse `blocksTaskIds[]` denormalisation cascade.
 *   - PR-B3 (deferred): cascade auto-shift, parent rollup recompute,
 *     `recomputeCriticalPath` Pub/Sub fan-out.
 */

export { onTaskCreate } from './onTaskCreate';
export type { OnTaskCreateDeps } from './onTaskCreate';

export { onTaskUpdate } from './onTaskUpdate';
export type { OnTaskUpdateDeps } from './onTaskUpdate';

export { cascadeBlocksTaskIds } from './cascadeBlocksTaskIds';
export type {
  CascadeBlocksTaskIdsDeps,
  CascadeBlocksTaskIdsResult,
} from './cascadeBlocksTaskIds';

export { onTaskTransition } from './onTaskTransition';
export type { OnTaskTransitionDeps } from './onTaskTransition';

export { onWorkSessionCompleted } from './onWorkSessionCompleted';
export type {
  OnWorkSessionCompletedDeps,
  SessionDoc,
} from './onWorkSessionCompleted';

export { onWikiUpdate } from './onWikiUpdate';
export type { OnWikiUpdateDeps } from './onWikiUpdate';

export {
  TASK_WATCHED_FIELDS,
  diffWatchedFields,
  shallowEqual,
  idempotencyKey,
  applied,
  skipped,
} from './_shared';
export type {
  DocumentChange,
  TriggerDeps,
  TaskWatchedField,
  TriggerResult,
} from './_shared';
