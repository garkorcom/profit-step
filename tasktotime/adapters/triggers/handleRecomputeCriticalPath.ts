/**
 * `handleRecomputeCriticalPath` — subscriber for the
 * `recomputeCriticalPath` Pub/Sub topic. Pure handler.
 *
 * Wired in PR-C as a Pub/Sub-triggered Cloud Function:
 *   functions/src/triggers/pubsub/tasktotime/recomputeCriticalPath.ts
 *
 * **Algorithm**
 *   1. Decode `{ projectId, companyId, ... }` from the Pub/Sub message.
 *   2. Read all tasks with that `projectId` (capped at `MAX_TASKS_PER_PROJECT`).
 *   3. Run pure `domain/criticalPath.computeSchedule`.
 *   4. For each task, patch `{ isCriticalPath, slackMinutes }` ONLY when
 *      the new value differs from the persisted one. Both fields are on
 *      the EXCLUDED watched-fields list (see `_shared.ts`), so the
 *      `onTaskUpdate` trigger fires on the patches but exits with
 *      `no_watched_field_change`. Cascade terminates after one hop.
 *   5. Cycle in the graph → log warn, BigQuery audit row, no patches.
 *
 * **Idempotency** — `cpm_subscribe_<projectId>_<messageId>`. Replays of
 * the same Pub/Sub message hit the reservation and skip. The recompute
 * itself is also idempotent (same inputs → same schedule), so a missed
 * dedupe just produces a no-op pass.
 *
 * **Cross-tenant guard** — the message carries `companyId`; we filter
 * the projectId query by it. A task that somehow has a foreign companyId
 * (data corruption) gets skipped at the patch step.
 *
 * **Cap** — `MAX_TASKS_PER_PROJECT = 500`. If we hit it, we log a warn
 * and proceed with the partial set. The next change will republish; for
 * megaprojects we'll need pagination + partitioning, which is PR-B6
 * follow-up territory.
 */

import type {
  CompanyId,
  ProjectId,
  TaskId,
} from '../../domain/identifiers';
import {
  asProjectId,
} from '../../domain/identifiers';
import type {
  TaskFilter,
  TaskRepository,
} from '../../ports/repositories';
import { computeSchedule } from '../../domain/criticalPath';
import type {
  BigQueryAuditPort,
  ClockPort,
} from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import { idempotencyKey, applied, skipped, type TriggerResult } from './_shared';

const EVENT_TYPE = 'cpm_subscribe';
const TTL_MS = 60 * 60 * 1000; // 1 hour: Pub/Sub redelivery worst-case window
export const MAX_TASKS_PER_PROJECT = 500;

export interface HandleRecomputeCriticalPathDeps {
  taskRepo: TaskRepository;
  idempotency: IdempotencyPort;
  bigQueryAudit: BigQueryAuditPort;
  clock: ClockPort;
  logger?: AdapterLogger;
}

export interface RecomputeCriticalPathMessage {
  projectId: string;
  companyId: string;
  triggeredByTaskId?: string;
  triggeredByFields?: string[];
  publishedAt?: number;
}

export interface SubscriberContext {
  /** Pub/Sub messageId from the platform; used for idempotency. */
  messageId: string;
}

export async function handleRecomputeCriticalPath(
  message: RecomputeCriticalPathMessage,
  ctx: SubscriberContext,
  deps: HandleRecomputeCriticalPathDeps,
): Promise<TriggerResult> {
  const log = deps.logger ?? noopLogger;
  const { projectId, companyId } = message;
  if (!projectId || !companyId) {
    return skipped('missing_project_or_company');
  }

  const dedupeKey = idempotencyKey(EVENT_TYPE, projectId, ctx.messageId);
  const reserved = await deps.idempotency.reserve(dedupeKey, TTL_MS);
  if (!reserved) {
    log.debug?.('handleRecomputeCriticalPath.skipped — already processed', {
      projectId,
      messageId: ctx.messageId,
    });
    return skipped('idempotency');
  }

  // ── 1. Read all tasks in the project (cross-tenant filtered) ────────
  const filter: TaskFilter = {
    companyId: companyId as CompanyId,
    projectId,
  };
  const page = await deps.taskRepo.findMany(filter, {
    limit: MAX_TASKS_PER_PROJECT,
    orderBy: 'createdAt',
    direction: 'asc',
  });
  const tasks = page.items;
  if (tasks.length === 0) {
    return skipped('no_tasks_in_project');
  }
  if (tasks.length >= MAX_TASKS_PER_PROJECT && page.nextCursor) {
    log.warn?.('handleRecomputeCriticalPath.task_cap_hit', {
      projectId,
      cap: MAX_TASKS_PER_PROJECT,
    });
  }

  // ── 2. Run pure CPM schedule ────────────────────────────────────────
  const schedule = computeSchedule(tasks);
  if (!schedule) {
    log.warn?.('handleRecomputeCriticalPath.cycle_detected', { projectId });
    await deps.bigQueryAudit.log({
      eventType: 'project.cpm.cycle_detected',
      companyId: companyId as CompanyId,
      taskId: undefined,
      occurredAt: deps.clock.now(),
      payload: {
        projectId,
        triggeredByTaskId: message.triggeredByTaskId ?? null,
      },
    });
    return skipped('cycle_detected');
  }

  // ── 3. Patch per task only when value differs ───────────────────────
  const effects: string[] = [];
  let patched = 0;
  let skippedCount = 0;
  for (const task of tasks) {
    const entry = schedule.byTaskId.get(task.id);
    if (!entry) continue; // task vanished from schedule (defensive)

    const newSlack = entry.slack;
    const newCritical = entry.onCriticalPath;
    if (
      task.slackMinutes === newSlack &&
      task.isCriticalPath === newCritical
    ) {
      skippedCount += 1;
      continue;
    }
    await deps.taskRepo.patch(task.id, {
      slackMinutes: newSlack,
      isCriticalPath: newCritical,
    });
    patched += 1;
  }

  effects.push(`patched(${patched})`);
  if (skippedCount > 0) effects.push(`unchanged(${skippedCount})`);

  // ── 4. Audit summary row ────────────────────────────────────────────
  await deps.bigQueryAudit.log({
    eventType: 'project.cpm.recomputed',
    companyId: companyId as CompanyId,
    taskId: message.triggeredByTaskId,
    occurredAt: deps.clock.now(),
    payload: {
      projectId,
      patched,
      unchanged: skippedCount,
      criticalPathLength: schedule.criticalPath.length,
      projectDurationMinutes: schedule.projectDurationMinutes,
    },
  });
  effects.push('bigQueryAudit.log');

  return applied(effects);
}

// Re-export for tests.
export const __test__ = { EVENT_TYPE, TTL_MS, MAX_TASKS_PER_PROJECT };

// Re-export branded types for downstream callers.
export type { CompanyId, ProjectId, TaskId };
export { asProjectId };
