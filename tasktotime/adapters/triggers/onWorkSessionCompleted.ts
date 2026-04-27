/**
 * `onWorkSessionCompleted` — fires when a `work_sessions/{id}` document
 * transitions to `completed` (i.e. `before.status !== 'completed' &&
 * after.status === 'completed'`). Pure handler.
 *
 * Side effects (per spec/05-api/triggers.md §onWorkSessionCompleted):
 *   1. Look up the session's related task via `relatedTaskId`.
 *   2. Recompute the task's actuals from the full session history (via
 *      `WorkSessionPort.aggregateForTask`). The aggregation is idempotent —
 *      replaying the trigger produces the same `actualDurationMinutes` and
 *      `totalEarnings`. We don't keep a `metricsProcessedAt` marker on the
 *      session because the trigger uses `IdempotencyPort` for retry-window
 *      deduplication and the recomputation itself is exact.
 *   3. Patch the task's `actualDurationMinutes` and `totalEarnings`.
 *      `actualStartAt` is set when missing (first session that completed).
 *   4. BigQuery audit row.
 *
 * **Idempotency** — `tasktotime_session_completed_<sessionId>_<eventId>`.
 *
 * **Why this trigger lives in tasktotime even though `work_sessions` is a
 * shared collection** — per spec, the task-domain effects belong here.
 * The legacy `clientJourneyTriggers` chunk that did the same job is being
 * extracted; tasktotime takes ownership of the task-domain branch.
 */

import type { TaskId, UserId } from '../../domain/identifiers';
import type { WorkSessionPort } from '../../ports/work';
import type { TaskRepository } from '../../ports/repositories';
import type { BigQueryAuditPort, ClockPort } from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import {
  type DocumentChange,
  type TriggerResult,
  applied,
  idempotencyKey,
  skipped,
} from './_shared';

const EVENT_TYPE = 'tasktotime_session_completed';
const TTL_MS = 5 * 60 * 1000;

export interface OnWorkSessionCompletedDeps {
  taskRepo: TaskRepository;
  workSession: WorkSessionPort;
  idempotency: IdempotencyPort;
  bigQueryAudit: BigQueryAuditPort;
  clock: ClockPort;
  logger?: AdapterLogger;
}

/**
 * Shape of the relevant subset of `work_sessions/{id}`. The session
 * document has more fields in production; this type narrows to what the
 * handler reads.
 */
export interface SessionDoc {
  id: string;
  relatedTaskId?: string;
  employeeId?: string;
  status?: 'active' | 'paused' | 'completed' | 'discarded';
  durationMinutes?: number;
  startTime?: number;
  endTime?: number;
}

export async function onWorkSessionCompleted(
  change: DocumentChange<SessionDoc>,
  deps: OnWorkSessionCompletedDeps,
): Promise<TriggerResult> {
  const log = deps.logger ?? noopLogger;
  const { before, after, docId, eventId } = change;

  if (!after) return skipped('no_after_data');

  // ── Field-change guard: only on transition INTO completed ───────────
  // Skip if not a transition; without this guard every later edit to a
  // completed session would re-fire the aggregation.
  const wasCompleted = before?.status === 'completed';
  const isCompleted = after.status === 'completed';
  if (wasCompleted || !isCompleted) {
    return skipped('not_a_completion_transition');
  }

  // No related task → nothing to aggregate. Fold/idle sessions land here.
  const relatedTaskId = after.relatedTaskId;
  if (!relatedTaskId) {
    return skipped('no_related_task');
  }

  // ── Idempotency guard ───────────────────────────────────────────────
  const key = idempotencyKey(EVENT_TYPE, docId, eventId);
  const reserved = await deps.idempotency.reserve(key, TTL_MS);
  if (!reserved) {
    log.debug?.('onWorkSessionCompleted.skipped — already processed', {
      docId,
      eventId,
    });
    return skipped('idempotency');
  }

  // ── Fetch task for company scope check + current snapshot ───────────
  const taskId = relatedTaskId as TaskId;
  const task = await deps.taskRepo.findById(taskId);
  if (!task) {
    log.warn?.('onWorkSessionCompleted.task_not_found', { taskId, sessionId: docId });
    return skipped('task_not_found');
  }

  const effects: string[] = [];

  // ── Recompute aggregates from the full history ──────────────────────
  // Re-reading all sessions makes this idempotent: replay produces the
  // same totals because completed sessions don't move backwards.
  const agg = await deps.workSession.aggregateForTask(taskId);
  const patch: Record<string, unknown> = {
    actualDurationMinutes: agg.totalDurationMinutes,
    totalEarnings: agg.totalEarnings,
  };
  // First completed session also pins `actualStartAt`. Don't overwrite a
  // value already on the task — historical edits should not retro-shift.
  if (task.actualStartAt == null && agg.earliestStartAt != null) {
    patch.actualStartAt = agg.earliestStartAt;
  }
  await deps.taskRepo.patch(taskId, patch);
  effects.push('taskRepo.patch(actuals)');

  // ── Audit ───────────────────────────────────────────────────────────
  await deps.bigQueryAudit.log({
    eventType: 'task.actuals.aggregated',
    companyId: task.companyId,
    actorId: pickEmployeeId(after) ?? task.assignedTo.id,
    taskId,
    occurredAt: deps.clock.now(),
    payload: {
      sessionId: docId,
      durationMinutes: agg.totalDurationMinutes,
      totalEarnings: agg.totalEarnings,
      sessionCount: (await deps.workSession.findByTask(taskId)).length,
    },
  });
  effects.push('bigQueryAudit.log');

  return applied(effects);
}

function pickEmployeeId(s: SessionDoc): UserId | undefined {
  return s.employeeId ? (s.employeeId as UserId) : undefined;
}

// Re-export for test convenience.
export const __test__ = { TTL_MS, EVENT_TYPE };
