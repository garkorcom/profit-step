/**
 * Composition root for the tasktotime module.
 *
 * Resolves Cloud-Functions-side runtime dependencies (Firebase Admin SDK,
 * BigQuery, Pub/Sub, Brevo / Telegram tokens) and threads them through
 * `tasktotime/adapters/index.ts:createAdapters` to produce the full
 * `Adapters` bundle plus everything the application + HTTP + trigger
 * layers need.
 *
 * **Lazy initialization.** The bundle is built on first use, not at module
 * load. Cold starts of unrelated Cloud Functions don't pay the cost of
 * resolving secrets / spinning up clients. Once built, the bundle is
 * cached for the lifetime of the function instance.
 *
 * **Pub/Sub (PR-D).** The `@google-cloud/pubsub` client is wired here and
 * passed through `createAdapters` so `publishCriticalPathRecompute`
 * publishes real messages onto the `recomputeCriticalPath` topic. The
 * topic itself is auto-created by the matching subscriber Cloud Function
 * (`onTasktotimeRecomputeCriticalPath`) on its first deploy.
 *
 * **Secrets.** Each Cloud Function that uses this composition root MUST
 * bind `TASKTOTIME_TRIGGER_SECRETS` (or `AGENT_API_SECRETS` for the HTTP
 * mount). Failure to bind means `WORKER_BOT_TOKEN` and `BREVO_API_KEY`
 * resolve to empty strings; the adapters then skip-not-throw, but no
 * Telegram / Brevo traffic actually fires.
 */

import * as admin from 'firebase-admin';
import { BigQuery } from '@google-cloud/bigquery';
import { PubSub } from '@google-cloud/pubsub';

import {
  createAdapters,
  type Adapters,
  type CreateAdaptersDeps,
} from '../../../tasktotime/adapters';

import { TaskService } from '../../../tasktotime/domain/services/TaskService';
import { DependencyService } from '../../../tasktotime/domain/services/DependencyService';
import {
  CreateTaskHandler,
  TransitionTaskHandler,
  AddDependencyHandler,
  UpdateWikiHandler,
  PatchTaskHandler,
  DeleteTaskHandler,
  RemoveDependencyHandler,
} from '../../../tasktotime/application';

import {
  WORKER_BOT_TOKEN,
  BREVO_API_KEY,
} from '../config/secrets';
import {
  EMAIL_FROM,
  EMAIL_USER,
} from '../config/env';

// ─── Default storage bucket ────────────────────────────────────────────

const DEFAULT_STORAGE_BUCKET = (() => {
  // GCLOUD_PROJECT is auto-populated in Cloud Functions; storage bucket
  // mirrors `<project>.appspot.com`. Override with TASKTOTIME_BUCKET if
  // a non-default bucket is wired.
  return (
    process.env.TASKTOTIME_BUCKET ||
    `${process.env.GCLOUD_PROJECT ?? 'profit-step'}.appspot.com`
  );
})();

// ─── Pub/Sub client ─────────────────────────────────────────────────────

/**
 * `@google-cloud/pubsub` is structurally compatible with `PubSubLike` (the
 * adapter only relies on `topic(name).publishMessage({ data, attributes,
 * orderingKey })`). One client per function instance — Pub/Sub holds an
 * HTTP/2 connection and reusing the client across invocations matters
 * for cold-start latency.
 *
 * Auth picks up Application Default Credentials (the function's runtime
 * service account in prod; gcloud user creds locally). No secrets to bind.
 */
let pubsubClient: PubSub | null = null;
function getPubSub(): PubSub {
  if (!pubsubClient) pubsubClient = new PubSub();
  return pubsubClient;
}

// ─── Lazy bundle ───────────────────────────────────────────────────────

interface TasktotimeServices {
  adapters: Adapters;
  // Application handlers — wired with adapter ports + domain services.
  createTaskHandler: CreateTaskHandler;
  transitionTaskHandler: TransitionTaskHandler;
  addDependencyHandler: AddDependencyHandler;
  updateWikiHandler: UpdateWikiHandler;
  patchTaskHandler: PatchTaskHandler;
  deleteTaskHandler: DeleteTaskHandler;
  removeDependencyHandler: RemoveDependencyHandler;
  taskService: TaskService;
  dependencyService: DependencyService;
}

let cached: TasktotimeServices | null = null;

/**
 * Build (or fetch the cached) tasktotime services bundle. Safe to call
 * many times per function invocation — initialisation runs at most once
 * per function instance.
 */
export function getTasktotimeServices(): TasktotimeServices {
  if (cached) return cached;
  cached = build();
  return cached;
}

function build(): TasktotimeServices {
  // Firebase Admin is initialised in functions/src/index.ts at boot.
  const db = admin.firestore();
  const messaging = admin.messaging();
  const storage = admin.storage();
  const bigquery = new BigQuery();

  const deps: CreateAdaptersDeps = {
    db,
    messaging,
    storage,
    bigquery,
    pubsub: getPubSub(),

    telegramBotToken: safeSecret(WORKER_BOT_TOKEN, 'WORKER_BOT_TOKEN'),
    brevoApiKey: safeSecret(BREVO_API_KEY, 'BREVO_API_KEY'),
    brevoSenderEmail: EMAIL_FROM || EMAIL_USER || 'noreply@profit-step.dev',
    brevoSenderName: 'Profit Step',

    defaultStorageBucket: DEFAULT_STORAGE_BUCKET,
  };

  const adapters = createAdapters(deps);

  const taskService = new TaskService({
    taskRepo: adapters.taskRepo,
    transitionLog: adapters.transitionLog,
    workSessions: adapters.workSession,
    payroll: adapters.payroll,
    idempotency: adapters.idempotency,
    clock: adapters.clock,
    idGenerator: adapters.idGenerator,
  });

  const dependencyService = new DependencyService({
    taskRepo: adapters.taskRepo,
    clock: adapters.clock,
  });

  const createTaskHandler = new CreateTaskHandler({ taskService });
  const transitionTaskHandler = new TransitionTaskHandler({ taskService });
  const addDependencyHandler = new AddDependencyHandler({ dependencyService });
  const updateWikiHandler = new UpdateWikiHandler({
    taskRepo: adapters.taskRepo,
    clock: adapters.clock,
  });
  const patchTaskHandler = new PatchTaskHandler({
    taskRepo: adapters.taskRepo,
    idempotency: adapters.idempotency,
  });
  const deleteTaskHandler = new DeleteTaskHandler({
    taskRepo: adapters.taskRepo,
    idempotency: adapters.idempotency,
    clock: adapters.clock,
  });
  const removeDependencyHandler = new RemoveDependencyHandler({
    dependencyService,
    taskRepo: adapters.taskRepo,
    idempotency: adapters.idempotency,
  });

  return {
    adapters,
    createTaskHandler,
    transitionTaskHandler,
    addDependencyHandler,
    updateWikiHandler,
    patchTaskHandler,
    deleteTaskHandler,
    removeDependencyHandler,
    taskService,
    dependencyService,
  };
}

/**
 * Resolve a `defineSecret(...)` value. Returns the empty string when the
 * function did not bind the secret — the calling adapter then skip-not-
 * throws (e.g. TelegramNotifyAdapter logs warn and returns
 * `{ skipped: true, reason: 'no_telegram_id' }`).
 *
 * The `(...).value()` call only succeeds inside a function whose
 * `runtimeOptions.secrets` includes this token; outside that scope it
 * throws. We catch + swallow so a misconfigured deploy degrades to "no
 * notifications" instead of "trigger blows up".
 */
function safeSecret(secret: { value: () => string }, name: string): string {
  try {
    return secret.value();
  } catch (err) {
    // Allowed direct console — logger may itself depend on this resolver.
    // eslint-disable-next-line no-console
    console.warn(
      `[tasktotime/composition] secret ${name} not bound to this function; ` +
        `dependent adapters will skip-not-throw. ${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
}

// ─── Convenience accessors ─────────────────────────────────────────────

export function getAdapters(): Adapters {
  return getTasktotimeServices().adapters;
}

/** Reset cache — used in tests. Production code does NOT call this. */
export function __resetTasktotimeCacheForTests(): void {
  cached = null;
}
