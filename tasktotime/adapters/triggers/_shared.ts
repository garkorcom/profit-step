/**
 * Shared types + helpers for tasktotime Firestore triggers.
 *
 * Triggers live as **pure handler functions** in this directory. The actual
 * Cloud Function wiring (region, document path, runtime config) belongs in
 * `functions/src/triggers/firestore/tasktotime/*.ts` — those wrappers build
 * the deps from `admin.firestore()` etc. and call the pure handlers below.
 *
 * Why split:
 *   - Handlers are unit-testable without the Firebase emulator.
 *   - Composition root (PR-C) decides when to wire the wrappers into
 *     `functions/src/index.ts`.
 *   - Hexagonal: nothing in this directory imports `firebase-admin` or
 *     `firebase-functions` directly — adapters communicate via ports.
 *
 * **Idempotency contract (CLAUDE.md §2.1).** Every handler MUST:
 *   1. Compose an idempotency key from the trigger's stable identifiers
 *      (`<docId>_<operation>` — never include timestamps that drift on
 *      retry).
 *   2. Call `idempotency.reserve(key, ttlMs)` — if `false` returned, the
 *      handler MUST early-return without side effects.
 *   3. Apply field-change guards (compare before vs after on watched fields
 *      only) — never react to changes in computed fields like
 *      `subtaskRollup`, `isCriticalPath`, `slackMinutes`, `blocksTaskIds`.
 *
 * Without these guards, a single misbehaving trigger can produce a $10k+
 * Firebase bill in a few days. There is no second chance — review every
 * trigger handler against this contract.
 */

import type { Task } from '../../domain/Task';
import type { TaskRepository, TransitionLogPort } from '../../ports/repositories';
import type {
  EmailNotifyPort,
  PushNotifyPort,
  TelegramNotifyPort,
} from '../../ports/notify';
import type {
  BigQueryAuditPort,
  ClockPort,
} from '../../ports/infra';
import type {
  AIAuditPort,
  IdempotencyPort,
} from '../../ports/ai';
import type {
  PayrollPort,
  WorkSessionPort,
} from '../../ports/work';

import type { AdapterLogger } from '../firestore/_shared';

// ─── Trigger event shape ───────────────────────────────────────────────

/**
 * Onomastic shape of a Firestore document change event, decoupled from the
 * Firebase SDK. The Cloud Function wrapper translates a `Change<DocumentSnapshot>`
 * + `EventContext` into this object before calling the pure handler.
 *
 * `before === null` → onCreate. `after === null` → onDelete.
 * Either field never being null is the onUpdate case.
 *
 * `eventId` MUST be the Firebase `context.eventId` (or its synthetic
 * equivalent) — it is the stable identifier used to compose idempotency
 * keys. **Never** generate a new eventId per call.
 */
export interface DocumentChange<T> {
  before: T | null;
  after: T | null;
  /** Document id (stable across retries). */
  docId: string;
  /** Stable eventId from the Cloud Function context; used for idempotency. */
  eventId: string;
}

/**
 * The full deps bag consumed by the trigger router. Individual handlers
 * declare narrower deps so tests stay tight. The composition root in
 * `functions/` builds this once and passes it.
 */
export interface TriggerDeps {
  taskRepo: TaskRepository;
  transitionLog: TransitionLogPort;
  idempotency: IdempotencyPort;
  workSession: WorkSessionPort;
  payroll: PayrollPort;
  telegram: TelegramNotifyPort;
  email: EmailNotifyPort;
  push: PushNotifyPort;
  bigQueryAudit: BigQueryAuditPort;
  aiAudit: AIAuditPort;
  clock: ClockPort;
  logger: AdapterLogger;
}

// ─── Watched-field guards ───────────────────────────────────────────────

/**
 * Fields whose change should fire `onTaskUpdate` side effects.
 *
 * **Excluded on purpose** (would otherwise create infinite-loop risk per
 * CLAUDE.md §2.1):
 *   - `subtaskRollup`     — computed by triggers themselves
 *   - `isCriticalPath`    — computed by `recomputeCriticalPath`
 *   - `slackMinutes`      — computed by CPM forward/backward pass
 *   - `blocksTaskIds`     — denormalised; written from `dependsOn` of others
 *   - `actualDurationMinutes` — written by `onWorkSessionCompleted`
 *   - `totalEarnings`     — written by `onWorkSessionCompleted`
 *   - `lastReminderSentAt`— written by `deadlineReminders`
 *   - `payrollProcessedAt`— written by `overdueEscalation`
 *   - `metricsProcessedAt`— legacy session aggregation marker
 *   - `updatedAt`         — strictly clock-driven; never trigger on its
 *                           change alone
 *
 * Adding a new computed/marker field here is the single most important
 * mental check in this codebase.
 */
export const TASK_WATCHED_FIELDS = [
  'lifecycle',
  'dueAt',
  'plannedStartAt',
  'actualStartAt',
  'completedAt',
  'acceptedAt',
  'archivedAt',
  'assignedTo',
  'reviewedBy',
  'coAssignees',
  'dependsOn',
  'parentTaskId',
  'wiki',
  'priority',
  'bucket',
  'estimatedDurationMinutes',
  'requiredHeadcount',
  'description',
  'memo',
] as const satisfies ReadonlyArray<keyof Task>;

export type TaskWatchedField = (typeof TASK_WATCHED_FIELDS)[number];

/**
 * Returns the set of watched fields that differ between `before` and `after`.
 * Uses strict `!==` for primitives and JSON-equality for objects/arrays.
 */
export function diffWatchedFields(
  before: Pick<Task, TaskWatchedField> | Partial<Task>,
  after: Pick<Task, TaskWatchedField> | Partial<Task>,
): TaskWatchedField[] {
  const changed: TaskWatchedField[] = [];
  for (const field of TASK_WATCHED_FIELDS) {
    if (!shallowEqual(before[field], after[field])) changed.push(field);
  }
  return changed;
}

/**
 * Equality good enough for trigger guards. Primitives via `===`; arrays /
 * objects via JSON snapshot. Domain objects are JSON-safe by construction
 * (no Date instances, no functions).
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Idempotency keys ───────────────────────────────────────────────────

/**
 * Compose an idempotency key. Format: `<event-type>_<doc-id>_<eventId>`.
 *
 * The eventId comes from the Firebase trigger context and is stable across
 * retries, so re-firing the same event gets blocked. Using only `docId`
 * would over-block (legitimate later updates would skip); using only
 * `eventId` would under-block on collisions.
 */
export function idempotencyKey(
  eventType: string,
  docId: string,
  eventId: string,
): string {
  return `${eventType}_${docId}_${eventId}`;
}

// ─── Result envelope ────────────────────────────────────────────────────

/**
 * Each handler returns a small report so callers (tests, the wrapper, ops
 * tooling) can observe what happened. Handlers MUST NOT throw on routine
 * skip paths — return `{ skipped: 'reason' }` instead.
 */
export type TriggerResult =
  | { applied: true; effects: string[] }
  | { skipped: string };

export const skipped = (reason: string): TriggerResult => ({
  skipped: reason,
});

export const applied = (effects: string[]): TriggerResult => ({
  applied: true,
  effects,
});
