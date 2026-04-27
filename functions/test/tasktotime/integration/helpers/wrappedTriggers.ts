/**
 * Lazily-imported tasktotime Cloud Functions wrapped via `firebase-functions-test`.
 *
 * Why lazy: importing `functions/src/tasktotime/triggers/...` triggers the
 * `composition.ts` lazy bundle, which calls `admin.firestore()`. We need the
 * SDK's `FIRESTORE_EMULATOR_HOST` to already be set before that call —
 * `setupEmulators.getOrInitAdminApp()` does so, but only if the import
 * happens AFTER `getOrInitAdminApp()` runs. Each `wrap*()` here is a
 * function call so consumers control timing.
 *
 * Why a single helper: each test suite would otherwise re-import + re-wrap
 * by hand. Centralising the imports keeps the "wire-format" in one file —
 * if Phase 4 changes a trigger entry-point name we update one place.
 */

import { getFunctionsTest, getOrInitAdminApp } from './setupEmulators';

/**
 * Side-effecting boot guard: ensure admin is initialised against the
 * emulator BEFORE any Cloud Function module imports. Each `wrap*()` calls
 * this first so suites that forget can't shoot themselves in the foot.
 */
function bootAdminApp(): void {
  getOrInitAdminApp();
}

export function wrapOnTaskCreate(): unknown {
  bootAdminApp();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../../../src/tasktotime/triggers/firestore/onTaskCreate');
  return getFunctionsTest().wrap(mod.onTasktotimeTaskCreate);
}

export function wrapOnTaskUpdate(): unknown {
  bootAdminApp();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../../../src/tasktotime/triggers/firestore/onTaskUpdate');
  return getFunctionsTest().wrap(mod.onTasktotimeTaskUpdate);
}

export function wrapOnTaskTransition(): unknown {
  bootAdminApp();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../../../src/tasktotime/triggers/firestore/onTaskTransition');
  return getFunctionsTest().wrap(mod.onTasktotimeTaskTransition);
}

export function wrapOnRecomputeCriticalPath(): unknown {
  bootAdminApp();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../../../src/tasktotime/triggers/pubsub/onRecomputeCriticalPath');
  return getFunctionsTest().wrap(mod.onTasktotimeRecomputeCriticalPath);
}

/**
 * Build a Firestore DocumentSnapshot for use with the wrapped onCreate
 * trigger. Wraps the firebase-functions-test `firestore.makeDocumentSnapshot`
 * helper so suites don't import the test SDK directly.
 */
export function makeDocSnapshot(
  data: Record<string, unknown>,
  refPath: string,
): unknown {
  return getFunctionsTest().firestore.makeDocumentSnapshot(data, refPath);
}

/**
 * Build a Change<DocumentSnapshot> for use with the wrapped onUpdate
 * trigger. Both before/after sides receive the same refPath, mirroring the
 * way the platform itself produces the change.
 */
export function makeDocChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  refPath: string,
): unknown {
  const ft = getFunctionsTest();
  const beforeSnap = ft.firestore.makeDocumentSnapshot(before, refPath);
  const afterSnap = ft.firestore.makeDocumentSnapshot(after, refPath);
  return ft.makeChange(beforeSnap, afterSnap);
}

/**
 * Build a Pub/Sub Message from a JSON payload, suitable for invoking the
 * wrapped subscriber trigger.
 */
export function makePubSubMessage(
  payload: Record<string, unknown>,
  attributes?: Record<string, string>,
): unknown {
  return getFunctionsTest().pubsub.makeMessage(payload, attributes);
}
