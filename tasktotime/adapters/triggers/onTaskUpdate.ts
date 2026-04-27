/**
 * `onTaskUpdate` — fires on `tasktotime_tasks/{taskId}` onUpdate. Pure handler.
 *
 * **CRITICAL — read CLAUDE.md §2.1 before touching this file.** A single
 * `onUpdate` trigger that writes back to the same document without proper
 * guards is a $10,000+ Firebase bill in days. The guards below are
 * non-negotiable:
 *
 *   1. **Watched-fields filter.** Only react to changes in
 *      `TASK_WATCHED_FIELDS` (see `_shared.ts`). Never react to changes in
 *      computed fields (`subtaskRollup`, `isCriticalPath`, `slackMinutes`,
 *      `blocksTaskIds`, `actualDurationMinutes`, `totalEarnings`,
 *      `lastReminderSentAt`, `payrollProcessedAt`, `metricsProcessedAt`,
 *      `updatedAt`). The list lives in `_shared.ts` so any field added
 *      gets a deliberate decision.
 *   2. **Early return on no relevant change.** Two writes that touch only
 *      computed fields → handler exits with `skipped`.
 *   3. **Idempotency reservation** keyed by `<eventType>_<taskId>_<eventId>`.
 *
 * **Scope (cumulative):**
 *   - PR-B1: audit each watched-field change to BigQuery.
 *   - PR-B2: reverse `blocksTaskIds[]` update on `dependsOn` change.
 *     Loop-safe because `blocksTaskIds` is on the EXCLUDED list inside
 *     `_shared.ts`, so the follow-up `onTaskUpdate` on each target exits
 *     with `no_watched_field_change`. See `cascadeBlocksTaskIds.ts`.
 *   - PR-B3: parent `subtaskRollup` recompute on subtask field changes.
 *     Loop-safe via the same `EXCLUDED` mechanism — see
 *     `recomputeParentRollup.ts`.
 *   - PR-B4 (this PR): cascade auto-shift on `plannedStartAt` /
 *     `completedAt` change. BFS depth-limited (5 hops) over
 *     `findByDependsOn` + patch-level idempotency (skip when
 *     `target.plannedStartAt === entry.newPlannedStartAt`). The cascade
 *     terminates because `cascadeShift` returns 0 entries on the second
 *     pass when topology is already correct. See `cascadeAutoShift.ts`
 *     for the full proof.
 *   - PR-B5 (this PR): debounced Pub/Sub publish to
 *     `recomputeCriticalPath` on graph-affecting fields. The subscriber
 *     (separate Cloud Function) runs `domain/criticalPath.computeSchedule`
 *     and patches `isCriticalPath` + `slackMinutes` per task — both are
 *     EXCLUDED watched fields, so this never re-fires
 *     `onTaskUpdate`. See `publishCriticalPathRecompute.ts` and
 *     `handleRecomputeCriticalPath.ts`.
 *
 * **Lifecycle changes** are NOT handled here — they flow through
 * `TaskService.transition` → `tasktotime_transitions/` → `onTaskTransition`
 * trigger. If the watched-field set includes `lifecycle`, this trigger
 * still emits an audit row but nothing else.
 */

import type { Task } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories';
import type {
  BigQueryAuditPort,
  ClockPort,
  PubSubPort,
} from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import {
  type DocumentChange,
  type TriggerResult,
  TASK_WATCHED_FIELDS,
  type TaskWatchedField,
  applied,
  diffWatchedFields,
  idempotencyKey,
  skipped,
} from './_shared';
import {
  cascadeBlocksTaskIds,
  type CascadeBlocksTaskIdsResult,
} from './cascadeBlocksTaskIds';
import {
  recomputeParentRollup,
  shouldRecomputeParentRollup,
} from './recomputeParentRollup';
import {
  cascadeAutoShift,
  type CascadeAutoShiftResult,
} from './cascadeAutoShift';
import {
  publishCriticalPathRecompute,
  shouldPublishCriticalPathRecompute,
} from './publishCriticalPathRecompute';

const EVENT_TYPE = 'tasktotime_task_update';
const TTL_MS = 5 * 60 * 1000;

export interface OnTaskUpdateDeps {
  taskRepo: TaskRepository;
  idempotency: IdempotencyPort;
  bigQueryAudit: BigQueryAuditPort;
  clock: ClockPort;
  /** Optional — when set, graph-affecting changes publish a debounced
   *  recomputeCriticalPath message. Composition root in PR-C wires this. */
  pubsub?: PubSubPort;
  logger?: AdapterLogger;
}

export async function onTaskUpdate(
  change: DocumentChange<Task>,
  deps: OnTaskUpdateDeps,
): Promise<TriggerResult> {
  const log = deps.logger ?? noopLogger;
  const { before, after, docId, eventId } = change;

  if (!before || !after) return skipped('missing_change_sides');

  // ── Watched-field filter ────────────────────────────────────────────
  // The single most important guard in this file. If only computed
  // fields changed (`subtaskRollup`, `isCriticalPath`, etc.), exit
  // immediately — reacting to those WOULD create the infinite-loop risk.
  const changedFields = diffWatchedFields(before, after);
  if (changedFields.length === 0) {
    return skipped('no_watched_field_change');
  }

  // ── Idempotency guard ───────────────────────────────────────────────
  const key = idempotencyKey(EVENT_TYPE, docId, eventId);
  const reserved = await deps.idempotency.reserve(key, TTL_MS);
  if (!reserved) {
    log.debug?.('onTaskUpdate.skipped — already processed', { docId, eventId });
    return skipped('idempotency');
  }

  const effects: string[] = [];

  // ── 1. Audit row with the diff ──────────────────────────────────────
  await deps.bigQueryAudit.log({
    eventType: 'task.updated',
    companyId: after.companyId,
    actorId: pickActor(before, after),
    taskId: after.id,
    occurredAt: deps.clock.now(),
    payload: {
      changedFields,
      ...summariseChanges(before, after, changedFields),
    },
  });
  effects.push('bigQueryAudit.log');

  // ── 2. Reverse-edge cascade on dependsOn change (PR-B2) ─────────────
  // Loop-safe: each target write fires onTaskUpdate again, but
  // `blocksTaskIds` is on the EXCLUDED list, so the follow-up exits with
  // `no_watched_field_change`. See cascadeBlocksTaskIds.ts for the proof.
  if (changedFields.includes('dependsOn')) {
    const cascadeResult = await cascadeBlocksTaskIds(before, after, {
      taskRepo: deps.taskRepo,
      logger: log,
    });
    summariseCascade(effects, cascadeResult);
  }

  // ── 3. Parent subtaskRollup recompute on subtask field change (PR-B3) ─
  // Loop-safe: the patch only writes to the parent doc, and `subtaskRollup`
  // is on the EXCLUDED list. The parent's onTaskUpdate exits with
  // `no_watched_field_change`. See recomputeParentRollup.ts.
  if (shouldRecomputeParentRollup(changedFields, after)) {
    const rollupResult = await recomputeParentRollup(
      changedFields,
      before,
      after,
      { taskRepo: deps.taskRepo, logger: log },
    );
    if ('applied' in rollupResult) {
      effects.push('recomputeParentRollup.applied');
    } else if (
      rollupResult.skipped !== 'no_parent' &&
      rollupResult.skipped !== 'no_relevant_field_change'
    ) {
      // Surface non-trivial skips (parent missing / cross-tenant /
      // unchanged-rollup / lookup_failed) for ops visibility.
      effects.push(`recomputeParentRollup.skipped(${rollupResult.skipped})`);
    }
  }

  // ── 4. Cascade auto-shift on plannedStartAt / completedAt (PR-B4) ───
  // BFS-bounded + patch-level idempotency. The cascade naturally
  // terminates because cascadeShift returns 0 entries on the second pass
  // when topology is already correct. See cascadeAutoShift.ts.
  if (
    changedFields.includes('plannedStartAt') ||
    changedFields.includes('completedAt')
  ) {
    const shiftResult = await cascadeAutoShift(after, {
      taskRepo: deps.taskRepo,
      logger: log,
    });
    summariseShift(effects, shiftResult);
  }

  // ── 5. Publish debounced recomputeCriticalPath (PR-B5) ──────────────
  // The actual CPM forward + backward pass runs in a separate subscriber
  // Cloud Function (handleRecomputeCriticalPath). Here we just publish a
  // debounced message — multiple rapid edits within the same project
  // collapse to one Pub/Sub send via IdempotencyPort.
  if (deps.pubsub && shouldPublishCriticalPathRecompute(changedFields, after)) {
    const cpmResult = await publishCriticalPathRecompute(changedFields, after, {
      pubsub: deps.pubsub,
      idempotency: deps.idempotency,
      clock: deps.clock,
      logger: log,
    });
    if ('published' in cpmResult) {
      effects.push('publishCriticalPathRecompute.published');
    } else if (cpmResult.skipped !== 'no_project' && cpmResult.skipped !== 'no_graph_affecting_change') {
      // Surface non-trivial skips (debounced / publish_failed) for ops.
      effects.push(`publishCriticalPathRecompute.skipped(${cpmResult.skipped})`);
    }
  }

  return applied(effects);
}

function summariseShift(
  effects: string[],
  result: CascadeAutoShiftResult,
): void {
  if (result.applied.length > 0) {
    effects.push(`cascadeAutoShift.applied(${result.applied.length})`);
  }
  if (result.skippedAlreadyShifted.length > 0) {
    effects.push(
      `cascadeAutoShift.skippedAlreadyShifted(${result.skippedAlreadyShifted.length})`,
    );
  }
  if (result.skippedCrossTenant.length > 0) {
    effects.push(
      `cascadeAutoShift.skippedCrossTenant(${result.skippedCrossTenant.length})`,
    );
  }
  if (result.skippedDepth.length > 0) {
    effects.push(`cascadeAutoShift.skippedDepth(${result.skippedDepth.length})`);
  }
  if (result.skippedNotFound.length > 0) {
    effects.push(
      `cascadeAutoShift.skippedNotFound(${result.skippedNotFound.length})`,
    );
  }
}

function summariseCascade(
  effects: string[],
  result: CascadeBlocksTaskIdsResult,
): void {
  if (result.added.length > 0) {
    effects.push(`cascadeBlocksTaskIds.added(${result.added.length})`);
  }
  if (result.removed.length > 0) {
    effects.push(`cascadeBlocksTaskIds.removed(${result.removed.length})`);
  }
  if (result.skippedCrossTenant.length > 0) {
    effects.push(
      `cascadeBlocksTaskIds.skippedCrossTenant(${result.skippedCrossTenant.length})`,
    );
  }
  if (result.skippedNotFound.length > 0) {
    effects.push(
      `cascadeBlocksTaskIds.skippedNotFound(${result.skippedNotFound.length})`,
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Best-effort actor for the audit row. The new `updatedAt` and
 * (eventually) `updatedBy` fields would be the source of truth; until
 * `updatedBy` is wired into the domain (see `spec/02-data-model/task.md`)
 * we fall back to the assignee.
 */
function pickActor(_before: Task, after: Task): string {
  return after.assignedTo.id;
}

/**
 * Compress the diff into a flat shape suitable for BigQuery's strongly-typed
 * audit table. Only non-PII fields appear here — full document snapshots
 * land in `task.history[]` if the user opts in elsewhere.
 */
function summariseChanges(
  before: Task,
  after: Task,
  changedFields: TaskWatchedField[],
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const field of changedFields) {
    summary[`${field}_from`] = serialiseFieldValue(before[field]);
    summary[`${field}_to`] = serialiseFieldValue(after[field]);
  }
  return summary;
}

function serialiseFieldValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  // Avoid huge payloads — JSON-stringify and cap at 200 chars.
  const json = JSON.stringify(value);
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

export const __test__ = { TTL_MS, EVENT_TYPE, TASK_WATCHED_FIELDS };
