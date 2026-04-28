/**
 * Emulator boot detection + SDK initialisation for tasktotime integration tests.
 *
 * Strategy
 * --------
 * These tests do NOT auto-start the Firestore emulator. The contributor is
 * expected to run `firebase emulators:start --only firestore,pubsub` (or the
 * project-level `npm run emulator`) in a sibling terminal before invoking
 * `npm --prefix functions run test:integration:tasktotime`. We make that
 * contract explicit:
 *
 *   1. We require `FIRESTORE_EMULATOR_HOST` to be set (the standard env var
 *      `firebase-admin` honours when picking a host). When missing we set a
 *      default of `localhost:8080` so simply launching the emulators with the
 *      default port works without ceremony.
 *   2. `assertEmulatorRunning()` makes a tiny HTTP probe to the emulator's
 *      well-known root endpoint. If the probe fails, the test suite throws a
 *      clear error explaining what to start. The probe is opt-in (suite
 *      controls when to run it) so a misconfigured CI doesn't waste 30 s
 *      timing out on every test before reporting.
 *   3. `firebase-admin` is initialised exactly once via
 *      `getOrInitAdminApp()`. Re-init across multiple test files is unsafe
 *      because admin caches the default app; subsequent `initializeApp()`
 *      calls would throw.
 *
 * The default Firebase project id is `profit-step-tasktotime-it` — distinct
 * from production `profit-step` AND from the unit-test placeholder
 * `profit-step-test` to keep emulator-stored docs separated. Each individual
 * suite layers a per-suite suffix (see `createTestProject.ts`) on the
 * companyId / projectId fields, NOT on the Firebase projectId, so all suites
 * share one emulator instance but never see each other's writes.
 */

import * as admin from 'firebase-admin';
import * as http from 'http';

import * as functionsTestFactory from 'firebase-functions-test';

const DEFAULT_FIRESTORE_HOST = 'localhost:8080';
const DEFAULT_PUBSUB_HOST = 'localhost:8085';
const DEFAULT_PROJECT_ID = 'profit-step-tasktotime-it';

let initialised = false;
/**
 * Singleton `firebase-functions-test` instance. The library caches state
 * (notably the env mutation it does on `init()` / `cleanup()`) so we keep
 * exactly one across the suite — calling the factory twice would clobber
 * envs the suite already arranged.
 */
let functionsTestInstance: ReturnType<typeof functionsTestFactory> | null = null;

/**
 * Ensures the Firebase Admin SDK is bootstrapped against the local emulator.
 * Idempotent — safe to call from multiple test files.
 */
export function getOrInitAdminApp(): admin.app.App {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = DEFAULT_FIRESTORE_HOST;
  }
  if (!process.env.PUBSUB_EMULATOR_HOST) {
    process.env.PUBSUB_EMULATOR_HOST = DEFAULT_PUBSUB_HOST;
  }
  if (!process.env.GCLOUD_PROJECT) {
    process.env.GCLOUD_PROJECT = DEFAULT_PROJECT_ID;
  }
  // Disable BigQuery telemetry — the BigQueryAuditAdapter is fire-and-forget
  // and its `systemErrors` fallback writes back to Firestore. Without
  // credentials in CI/sandbox, we still want the adapter to skip-not-throw.
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
  }

  if (admin.apps.length > 0) {
    const app = admin.apps[0];
    if (app) return app;
  }

  return admin.initializeApp({
    projectId: process.env.GCLOUD_PROJECT,
    // No real credentials — emulator accepts unauthenticated calls.
  });
}

/**
 * Gets (or lazily builds) the `firebase-functions-test` shim.
 *
 * The shim exposes `wrap(fn)` which lets us invoke a deployed Cloud Function
 * directly with synthetic snapshot + context — bypassing the Firestore →
 * trigger pipeline. That's the single most important capability for proving
 * trigger contracts without relying on the emulator's ability to
 * actually fire the function (which only works under
 * `firebase emulators:start --only functions`, a heavier setup that needs
 * the functions to be built and deployed to the emulator).
 */
export function getFunctionsTest(): ReturnType<typeof functionsTestFactory> {
  if (functionsTestInstance) return functionsTestInstance;
  functionsTestInstance = functionsTestFactory({
    projectId: process.env.GCLOUD_PROJECT ?? DEFAULT_PROJECT_ID,
  });
  initialised = true;
  return functionsTestInstance;
}

/** Pings the Firestore emulator. Throws a clear error if unreachable. */
export async function assertFirestoreEmulator(timeoutMs = 1000): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? DEFAULT_FIRESTORE_HOST;
  const [hostname, portStr] = host.split(':');
  const port = Number(portStr);
  await probeHttp(hostname, port, '/', timeoutMs).catch((err) => {
    throw new Error(
      `Firestore emulator not reachable at ${host}. ` +
        `Start it with \`firebase emulators:start --only firestore,pubsub\` ` +
        `(or \`npm run emulator\` from the project root) before running ` +
        `the integration suite. Underlying error: ${err.message}`,
    );
  });
}

/** Pings the Pub/Sub emulator. Same contract as above. */
export async function assertPubSubEmulator(timeoutMs = 1000): Promise<void> {
  const host = process.env.PUBSUB_EMULATOR_HOST ?? DEFAULT_PUBSUB_HOST;
  const [hostname, portStr] = host.split(':');
  const port = Number(portStr);
  await probeHttp(hostname, port, '/', timeoutMs).catch((err) => {
    throw new Error(
      `Pub/Sub emulator not reachable at ${host}. ` +
        `Start it with \`firebase emulators:start --only firestore,pubsub\` ` +
        `before running the integration suite (the project's firebase.json ` +
        `does not yet bind Pub/Sub — see PR body for instructions). ` +
        `Underlying error: ${err.message}`,
    );
  });
}

/**
 * Tear down the firebase-functions-test instance. Safe to call from
 * jest globalTeardown or `afterAll`. No-op if not initialised.
 */
export function cleanupFunctionsTest(): void {
  if (functionsTestInstance) {
    functionsTestInstance.cleanup();
    functionsTestInstance = null;
    initialised = false;
  }
}

export function isInitialised(): boolean {
  return initialised;
}

// ─── Internal HTTP probe ─────────────────────────────────────────────────

function probeHttp(
  hostname: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: 'GET', timeout: timeoutMs }, (res) => {
      // Any HTTP response (even 404) means the server is up.
      res.resume();
      resolve();
    });
    req.on('error', (err: Error) => reject(err));
    req.on('timeout', () => {
      req.destroy(new Error(`probe to ${hostname}:${port} timed out`));
    });
    req.end();
  });
}
