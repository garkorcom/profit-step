/**
 * Barrel of tasktotime trigger Cloud Functions.
 *
 * `functions/src/index.ts` re-exports each Cloud Function exactly once;
 * this barrel exists so a single import line in `index.ts` covers all the
 * tasktotime entries instead of one line per file.
 *
 * **Trigger inventory (PR-C):**
 *   - onTasktotimeTaskCreate              firestore: tasktotime_tasks/{id} onCreate
 *   - onTasktotimeTaskUpdate              firestore: tasktotime_tasks/{id} onUpdate
 *   - onTasktotimeTaskTransition          firestore: tasktotime_transitions/{id} onCreate
 *   - onTasktotimeWorkSessionCompleted    firestore: work_sessions/{id} onUpdate
 *   - onTasktotimeWikiUpdate              firestore: tasktotime_tasks/{id} onUpdate (wiki branch)
 *
 * **Pub/Sub subscriber for `recomputeCriticalPath`** lives outside this
 * file — added in PR-D once `@google-cloud/pubsub` is installed.
 */

export { onTasktotimeTaskCreate } from './firestore/onTaskCreate';
export { onTasktotimeTaskUpdate } from './firestore/onTaskUpdate';
export { onTasktotimeTaskTransition } from './firestore/onTaskTransition';
export { onTasktotimeWorkSessionCompleted } from './firestore/onWorkSessionCompleted';
export { onTasktotimeWikiUpdate } from './firestore/onWikiUpdate';
