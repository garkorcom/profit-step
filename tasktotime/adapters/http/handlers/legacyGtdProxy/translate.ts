/**
 * Translate between legacy `gtd_tasks` wire shapes and the canonical
 * `tasktotime_tasks` wire shapes used by `/api/tasktotime/*` routes.
 *
 * Two-direction translation:
 *   - `legacyCreateToTasktotime`  — `POST /api/gtd-tasks`        body
 *   - `legacyPatchToTasktotime`   — `PATCH /api/gtd-tasks/:id`   body
 *   - `legacyListQueryToTasktotime` — `GET /api/gtd-tasks`       query
 *   - `tasktotimeTaskToLegacy`    — outbound: any task response
 *
 * Field-level rules (full table in `spec/04-storage/migration-mapping.md`):
 *
 *   Legacy field           ↔ Tasktotime field
 *   ---------------------- ↔ ----------------------
 *   status                 ↔ lifecycle (via STATUS_DRIFT_MAP)
 *   taskHistory            ↔ history (rename)
 *   dueDate (ISO string)   ↔ dueAt (epoch ms)
 *   estimatedDurationMinutes ↔ estimatedDurationMinutes (identity)
 *   assigneeId/assigneeName ↔ assignedTo: { id, name }
 *
 * Dropped legacy fields (per migration-mapping.md):
 *   `zone`, `isMilestone`, `ganttColor`, `clientApprovalRequired`,
 *   `reminderEnabled`, `reminderTime`, `taskType`, `context`, `siteId`,
 *   `ownerId`, `ownerName` — silently ignored on input. The bot does not
 *   use them on output, so we do not synthesise them on the legacy
 *   response either (see `tasktotimeTaskToLegacy`).
 *
 * Computed fields are NOT exposed on the legacy outbound shape so the bot
 * never accidentally caches a value that is recomputed by triggers
 * (`isCriticalPath`, `slackMinutes`, `subtaskRollup`, `blocksTaskIds`).
 */

import type { Task, TaskBucket, Priority } from '../../../../domain/Task';
import type { TaskLifecycle } from '../../../../domain/lifecycle';
import {
  legacyStatusToLifecycle,
  lifecycleToLegacyStatus,
} from './statusDriftMap';

// ─── Result types ───────────────────────────────────────────────────────

export interface TranslateResult<T> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(value: T): TranslateResult<T> {
  return { ok: true, value };
}

function fail<T = never>(
  code: string,
  message: string,
  field?: string,
): TranslateResult<T> {
  return { ok: false, error: { code, message, field } };
}

// ─── Bucket inference ───────────────────────────────────────────────────

/**
 * Some legacy `status` values doubled as bucket tags (e.g. `'inbox'`,
 * `'someday'`, `'archived'`). When we see one of those, derive the
 * tasktotime `bucket` field too — otherwise default to `'next'`.
 *
 * Bucket independence from lifecycle: `spec/03-state-machine/bucket.md`.
 */
const STATUS_TO_BUCKET: Readonly<Record<string, TaskBucket>> = Object.freeze({
  inbox: 'inbox',
  someday: 'someday',
  archived: 'archive',
});

function inferBucketFromLegacyStatus(status: string | undefined): TaskBucket {
  if (!status) return 'next';
  const lower = status.toLowerCase();
  return STATUS_TO_BUCKET[lower] ?? 'next';
}

// ─── Priority normalisation ─────────────────────────────────────────────

/**
 * Legacy GTD writes priorities as `'high' | 'medium' | 'low' | 'none'`
 * (see `functions/src/agent/schemas/taskSchemas.ts`). The canonical
 * lifecycle uses `'critical' | 'high' | 'medium' | 'low'`. Legacy `'none'`
 * has no clean inverse; we treat it as `'low'` to keep the lifecycle
 * priority always-defined.
 */
function legacyPriorityToTasktotime(p: unknown): Priority | undefined {
  if (typeof p !== 'string') return undefined;
  switch (p.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
    case 'none':
      return 'low';
    default:
      return undefined;
  }
}

function tasktotimePriorityToLegacy(p: Priority): 'high' | 'medium' | 'low' | 'critical' {
  // Identity for the lifecycle priorities; the legacy bot accepts these
  // strings (see UpdateTaskSchema enum).
  return p;
}

// ─── Date helpers ───────────────────────────────────────────────────────

/**
 * Legacy uses ISO-8601 strings for `dueDate`. Tasktotime uses epoch ms.
 * Returns `null` if the input is missing/invalid; callers decide whether
 * that is a 400 or a default.
 */
function isoToEpochMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function epochMsToIso(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// ─── Inbound: POST /api/gtd-tasks → tasktotime CreateTaskCommand body ─

export interface LegacyCreateBody {
  /** Tasktotime body that callers can forward to the existing handler. */
  body: Record<string, unknown>;
  /** Bucket inferred from legacy status (e.g. `'archived' → 'archive'`). */
  bucket: TaskBucket;
  /** Resolved canonical lifecycle for the create call. */
  initialLifecycle: 'draft' | 'ready';
}

/**
 * Translate the legacy create body into a tasktotime create body. The bot
 * sends a flat shape with `title`, `status`, `priority`, etc.; we expand it
 * into the structured tasktotime command (which has `assignedTo` as a
 * UserRef object, separate `costInternal` / `priceClient`, etc.).
 *
 * Defaults applied (so the bot's minimal payload still passes tasktotime
 * schema validation):
 *   - `dueAt`: 7 days from `now` if `dueDate` is missing
 *   - `estimatedDurationMinutes`: 60 if missing
 *   - `bucket`: derived from legacy status (or `'next'`)
 *   - `priority`: `'low'` if missing or `'none'`
 *   - `source`: `'api'`
 *   - `requiredHeadcount`: 1
 *   - `assignedTo`: caller's UserRef when no assigneeId provided
 *   - `costInternal` / `priceClient`: { amount: 0, currency: 'USD' }
 *
 * @param legacyBody  raw `req.body` from the legacy POST
 * @param caller      `req.auth.by` from `attachAuthContext`
 * @param companyId   `req.auth.companyId`
 * @param idempotencyKey  required by tasktotime; caller may have read it
 *                        from header or body
 * @param now         epoch ms — used for default `dueAt`. Inject via
 *                    `Clock` from the composition root in production.
 */
export function legacyCreateToTasktotime(
  legacyBody: unknown,
  caller: { id: string; name: string },
  companyId: string,
  idempotencyKey: string,
  now: number,
): TranslateResult<LegacyCreateBody> {
  if (typeof legacyBody !== 'object' || legacyBody === null || Array.isArray(legacyBody)) {
    return fail('VALIDATION_ERROR', 'request body must be an object');
  }
  const body = legacyBody as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title : undefined;
  if (!title || title.length === 0) {
    return fail('VALIDATION_ERROR', 'title is required', 'title');
  }

  // Status → lifecycle. Default 'inbox' if not supplied (legacy default in
  // CreateGTDTaskSchema is also 'inbox').
  const legacyStatusRaw = body.status;
  const lifecycle = legacyStatusRaw !== undefined
    ? legacyStatusToLifecycle(legacyStatusRaw)
    : 'ready';
  if (lifecycle === null) {
    return fail(
      'INVALID_LEGACY_STATUS',
      `Unknown legacy status '${String(legacyStatusRaw)}'. ` +
        `Supported: draft, pending, in_progress, completed, accepted, cancelled, ` +
        `todo, done, next, scheduled, approved, inbox, next_action, waiting, ` +
        `projects, estimate, someday, archived.`,
      'status',
    );
  }

  // Tasktotime CreateTaskCommand only allows `'draft' | 'ready'` as initial
  // lifecycle (see CreateTaskCommand.ts). Anything beyond that is set via
  // a follow-up transition. The proxy honours the initial state but rejects
  // values that would skip the state machine — bot prompt should issue a
  // separate transition call for `started`/`completed`/etc.
  let initialLifecycle: 'draft' | 'ready';
  if (lifecycle === 'draft' || lifecycle === 'ready') {
    initialLifecycle = lifecycle;
  } else {
    // Legacy callers sent `'in_progress'` / `'completed'` etc. directly on
    // create. Tasktotime forbids that — we MUST use a transition. Map the
    // create to `'ready'` and ignore the implied transition; document this
    // in the response so the bot can issue the transition itself if needed.
    initialLifecycle = 'ready';
  }

  const bucket = inferBucketFromLegacyStatus(
    typeof legacyStatusRaw === 'string' ? legacyStatusRaw : undefined,
  );

  const priority = legacyPriorityToTasktotime(body.priority) ?? 'low';

  const dueAtFromBody = isoToEpochMs(body.dueDate);
  const dueAt =
    dueAtFromBody ?? now + 7 * 24 * 60 * 60 * 1000; // default 7 days out

  const estimatedDurationMinutes =
    typeof body.estimatedDurationMinutes === 'number' &&
    Number.isFinite(body.estimatedDurationMinutes)
      ? body.estimatedDurationMinutes
      : 60;

  const assigneeId =
    typeof body.assigneeId === 'string' && body.assigneeId.length > 0
      ? body.assigneeId
      : undefined;
  const assigneeName =
    typeof body.assigneeName === 'string' && body.assigneeName.length > 0
      ? body.assigneeName
      : undefined;
  const assignedTo = assigneeId
    ? { id: assigneeId, name: assigneeName ?? assigneeId }
    : { id: caller.id, name: caller.name };

  const out: Record<string, unknown> = {
    idempotencyKey,
    companyId,
    title,
    dueAt,
    estimatedDurationMinutes,
    bucket,
    priority,
    source: 'api',
    requiredHeadcount: 1,
    assignedTo,
    costInternal: { amount: 0, currency: 'USD' },
    priceClient: { amount: 0, currency: 'USD' },
    initialLifecycle,
  };

  // Optional passthrough fields — copy when present.
  if (typeof body.description === 'string') out.description = body.description;
  if (typeof body.clientId === 'string') out.clientId = body.clientId;
  if (typeof body.clientName === 'string') out.clientName = body.clientName;
  if (typeof body.projectId === 'string') out.projectId = body.projectId;
  if (typeof body.projectName === 'string') out.projectName = body.projectName;
  if (typeof body.parentTaskId === 'string') out.parentTaskId = body.parentTaskId;
  if (typeof body.memo === 'string') out.memo = body.memo;

  return ok({ body: out, bucket, initialLifecycle });
}

// ─── Inbound: PATCH /api/gtd-tasks/:id → tasktotime patch body ────────

export interface LegacyPatchPlan {
  /** Patch body for `PATCH /api/tasktotime/tasks/:id` (may be empty). */
  patchBody: Record<string, unknown>;
  /**
   * Lifecycle target if the legacy patch carried a status change. The
   * proxy must follow up with a `POST /transition` call to drive the
   * state machine.
   */
  lifecycleTarget?: TaskLifecycle;
  /**
   * Whether the patch contained ANY field to forward (excluding the
   * lifecycle change which goes through `/transition`). The proxy uses
   * this to decide whether to call `PATCH /tasks/:id` at all.
   */
  hasPatchFields: boolean;
}

/**
 * Translate a legacy PATCH body. Two-output design:
 *   - `patchBody`     — fields that flow through `PATCH /tasks/:id`
 *   - `lifecycleTarget` — if `status` was present, the lifecycle to drive
 *                         via `POST /tasks/:id/transition`
 *
 * The proxy router orchestrates both calls; this function stays pure and
 * unaware of the application handlers.
 *
 * Legacy fields that have no tasktotime equivalent are dropped silently
 * (see DROP list in `spec/04-storage/migration-mapping.md`):
 *   `payments`, `budgetAmount`, `paidAmount`, `budgetCategory`,
 *   `progressPercentage`, `parentTaskId` (allowed via patch),
 *   `isSubtask` (derived), `billable`, `production` (CRM-specific),
 *   `unit`, `quantity`, `rate` (estimate-line legacy fields).
 *
 * Forbidden tasktotime patch keys are NEVER forwarded — see
 * `PATCHABLE_KEYS` in `tasktotime/adapters/http/schemas.ts`.
 */
export function legacyPatchToTasktotime(
  legacyBody: unknown,
): TranslateResult<LegacyPatchPlan> {
  if (typeof legacyBody !== 'object' || legacyBody === null || Array.isArray(legacyBody)) {
    return fail('VALIDATION_ERROR', 'request body must be an object');
  }
  const body = legacyBody as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  let lifecycleTarget: TaskLifecycle | undefined;

  // Status — split into either patch (no-op) or transition target.
  if (body.status !== undefined) {
    const lifecycle = legacyStatusToLifecycle(body.status);
    if (lifecycle === null) {
      return fail(
        'INVALID_LEGACY_STATUS',
        `Unknown legacy status '${String(body.status)}'`,
        'status',
      );
    }
    lifecycleTarget = lifecycle;
  }

  if (typeof body.title === 'string' && body.title.length > 0) {
    patch.title = body.title;
  }
  if (typeof body.description === 'string') patch.description = body.description;
  if (typeof body.memo === 'string') patch.memo = body.memo;

  if (body.priority !== undefined) {
    const p = legacyPriorityToTasktotime(body.priority);
    if (p) patch.priority = p;
  }

  // dueDate — null means "clear", string means "set". Tasktotime requires
  // dueAt as a number; clearing means we cannot null-out (tasktotime treats
  // dueAt as required). Drop the clear silently — bot will not encounter
  // this in production for a long time.
  if (body.dueDate !== undefined && body.dueDate !== null) {
    const ms = isoToEpochMs(body.dueDate);
    if (ms === null) {
      return fail(
        'VALIDATION_ERROR',
        'dueDate must be an ISO-8601 string',
        'dueDate',
      );
    }
    patch.dueAt = ms;
  }

  if (body.assigneeId !== undefined && body.assigneeId !== null) {
    if (typeof body.assigneeId !== 'string') {
      return fail('VALIDATION_ERROR', 'assigneeId must be a string', 'assigneeId');
    }
    const name =
      typeof body.assigneeName === 'string' && body.assigneeName.length > 0
        ? body.assigneeName
        : body.assigneeId;
    patch.assignedTo = { id: body.assigneeId, name };
  }

  if (
    typeof body.estimatedDurationMinutes === 'number' &&
    Number.isFinite(body.estimatedDurationMinutes) &&
    body.estimatedDurationMinutes > 0
  ) {
    patch.estimatedDurationMinutes = body.estimatedDurationMinutes;
  }

  if (typeof body.projectId === 'string') patch.projectId = body.projectId;
  if (typeof body.parentTaskId === 'string') patch.parentTaskId = body.parentTaskId;

  return ok({
    patchBody: patch,
    lifecycleTarget,
    hasPatchFields: Object.keys(patch).length > 0,
  });
}

/**
 * Map a tasktotime lifecycle target to the transition action that gets us
 * there. `TRANSITIONS_TABLE` (`tasktotime/domain/lifecycle.ts`) is the
 * source of truth; this is the inverse lookup used only by the proxy.
 *
 * Returns `null` when the target lifecycle has no canonical action (e.g.
 * `'draft'` is the initial state, not a transition target).
 */
export function lifecycleToTransitionAction(
  lifecycle: TaskLifecycle,
): 'ready' | 'start' | 'block' | 'unblock' | 'complete' | 'accept' | 'cancel' | null {
  switch (lifecycle) {
    case 'draft':
      return null; // initial only
    case 'ready':
      return 'ready';
    case 'started':
      return 'start';
    case 'blocked':
      return 'block';
    case 'completed':
      return 'complete';
    case 'accepted':
      return 'accept';
    case 'cancelled':
      return 'cancel';
    default:
      return null;
  }
}

// ─── Inbound: GET /api/gtd-tasks query → tasktotime list query ─────────

/**
 * Translate the legacy list query string. The bot uses `?status=...` with
 * comma-separated legacy values — translate each to its lifecycle and
 * forward as `?lifecycle=...`.
 *
 * Unknown legacy statuses in the comma list cause a 400 (the bot prompt
 * needs to learn the new vocabulary if it sends garbage).
 */
export function legacyListQueryToTasktotime(
  legacyQuery: Record<string, unknown>,
  companyId: string,
): TranslateResult<Record<string, unknown>> {
  const out: Record<string, unknown> = { companyId };

  if (typeof legacyQuery.status === 'string' && legacyQuery.status.length > 0) {
    const parts = legacyQuery.status.split(',').map((s) => s.trim()).filter(Boolean);
    const lifecycles = new Set<TaskLifecycle>();
    for (const p of parts) {
      const l = legacyStatusToLifecycle(p);
      if (l === null) {
        return fail(
          'INVALID_LEGACY_STATUS',
          `Unknown legacy status '${p}' in query`,
          'status',
        );
      }
      lifecycles.add(l);
    }
    if (lifecycles.size > 0) {
      out.lifecycle = [...lifecycles].join(',');
    }
  }

  if (typeof legacyQuery.priority === 'string') {
    // Tasktotime list does not currently filter by priority — drop silently
    // (bot uses it rarely, and adding the filter is a separate spec change).
  }

  if (typeof legacyQuery.clientId === 'string') {
    out.clientId = legacyQuery.clientId;
  }
  if (typeof legacyQuery.projectId === 'string') {
    out.projectId = legacyQuery.projectId;
  }
  if (typeof legacyQuery.assigneeId === 'string') {
    out.assigneeId = legacyQuery.assigneeId;
  }
  if (typeof legacyQuery.dueBefore === 'string') {
    const ms = isoToEpochMs(legacyQuery.dueBefore);
    if (ms !== null) out.dueBefore = String(ms);
  }
  if (typeof legacyQuery.limit === 'string') {
    out.limit = legacyQuery.limit;
  } else if (typeof legacyQuery.limit === 'number') {
    out.limit = String(legacyQuery.limit);
  }
  if (typeof legacyQuery.cursor === 'string' && legacyQuery.cursor.length > 0) {
    out.cursor = legacyQuery.cursor;
  }

  return ok(out);
}

// ─── Outbound: tasktotime Task → legacy GTD wire shape ────────────────

/**
 * Translate a tasktotime `Task` (full domain shape) back to the legacy
 * `gtd_tasks`-compatible JSON the bot expects. We deliberately:
 *
 *   - Rename `lifecycle` → `status` (using `lifecycleToLegacyStatus`)
 *   - Rename `history` → `taskHistory`
 *   - Convert `assignedTo: UserRef` → `assigneeId` + `assigneeName`
 *   - Convert `dueAt: number` → `dueDate: ISO string`
 *   - Convert `createdAt` / `updatedAt` to ISO strings
 *   - Drop ALL computed fields (`isCriticalPath`, `slackMinutes`,
 *     `subtaskRollup`, `blocksTaskIds`, `subtaskIds`) — the bot never
 *     consumed them and exposing them now would invite caching bugs.
 *   - Drop new-only fields (`wiki`, `dependsOn`, `category`, `phase`,
 *     `acceptance`, `requiredTools`, `location`, `bonusOnTime`,
 *     `penaltyOverdue`) — the bot has no concept of them.
 *
 * The output shape is compatible with the bot's existing prompt, plus a
 * small `_canonical` envelope for debugging during the proxy's lifetime.
 */
export interface LegacyTaskShape {
  id: string;
  title: string;
  status: string;
  priority: string;
  description: string;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  estimatedDurationMinutes: number | null;
  totalTimeSpentMinutes: number;
  totalEarnings: number;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  parentTaskId: string | null;
  isSubtask: boolean;
  taskType: string | null;
  taskHistory: ReadonlyArray<unknown>;
  /**
   * Diagnostic envelope — exposes the canonical lifecycle so external
   * callers can verify the proxy mapped correctly. Removed at Phase 6
   * cutover when the proxy itself goes away.
   */
  _canonical: {
    lifecycle: TaskLifecycle;
    bucket: string;
    taskNumber: string;
  };
}

export function tasktotimeTaskToLegacy(task: Task): LegacyTaskShape {
  return {
    id: task.id,
    title: task.title,
    status: lifecycleToLegacyStatus(task.lifecycle),
    priority: tasktotimePriorityToLegacy(task.priority),
    description: task.description ?? '',
    clientId: task.clientId ?? null,
    clientName: task.clientName ?? null,
    projectId: task.projectId ?? null,
    assigneeId: task.assignedTo?.id ?? null,
    assigneeName: task.assignedTo?.name ?? null,
    dueDate: epochMsToIso(task.dueAt),
    estimatedDurationMinutes: task.estimatedDurationMinutes ?? null,
    totalTimeSpentMinutes: task.actualDurationMinutes ?? 0,
    totalEarnings: task.totalEarnings ?? 0,
    source: task.source ?? null,
    createdAt: epochMsToIso(task.createdAt),
    updatedAt: epochMsToIso(task.updatedAt),
    parentTaskId: task.parentTaskId ?? null,
    isSubtask: task.isSubtask ?? false,
    taskType: null, // dropped on tasktotime side
    taskHistory: task.history ?? [],
    _canonical: {
      lifecycle: task.lifecycle,
      bucket: task.bucket,
      taskNumber: task.taskNumber,
    },
  };
}
