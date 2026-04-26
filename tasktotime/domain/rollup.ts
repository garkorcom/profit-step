/**
 * Pure subtask roll-up computation.
 *
 * `SubtaskRollup` is a denormalized aggregate persisted on the parent task
 * (computed by trigger). This module is the pure function that, given a list
 * of subtask Tasks, produces the rollup. Triggers call this then write.
 *
 * See spec/08-modules/hierarchy/subtask-rollup-aggregate.md.
 */

import type { Task, SubtaskRollup, EpochMs } from './Task';
import type { TaskLifecycle } from './lifecycle';

const ALL_LIFECYCLES: ReadonlyArray<TaskLifecycle> = [
  'draft',
  'ready',
  'started',
  'blocked',
  'completed',
  'accepted',
  'cancelled',
];

const COMPLETED_LIFECYCLES: ReadonlySet<TaskLifecycle> = new Set([
  'completed',
  'accepted',
] as const);

/**
 * Compute aggregate rollup from a list of subtasks. Pure function.
 *
 * Edge cases:
 *   - Empty list → all counters zero, completedFraction = 0, undefined dates.
 *   - Cancelled subtasks excluded from `completedFraction` denominator.
 */
export function computeSubtaskRollup(subtasks: ReadonlyArray<Task>): SubtaskRollup {
  const countByLifecycle: Partial<Record<TaskLifecycle, number>> = {};
  for (const lc of ALL_LIFECYCLES) countByLifecycle[lc] = 0;

  let totalCostInternal = 0;
  let totalPriceClient = 0;
  let totalEstimatedMinutes = 0;
  let totalActualMinutes = 0;
  let earliestDueAt: EpochMs | undefined;
  let latestCompletedAt: EpochMs | undefined;
  let blockedCount = 0;
  let activeCount = 0; // exclude `cancelled`
  let doneCount = 0;

  for (const t of subtasks) {
    countByLifecycle[t.lifecycle] = (countByLifecycle[t.lifecycle] ?? 0) + 1;

    totalCostInternal += t.costInternal?.amount ?? 0;
    totalPriceClient += t.priceClient?.amount ?? 0;
    totalEstimatedMinutes += t.estimatedDurationMinutes ?? 0;
    totalActualMinutes += t.actualDurationMinutes ?? 0;

    if (t.dueAt && t.dueAt > 0) {
      if (earliestDueAt === undefined || t.dueAt < earliestDueAt) {
        earliestDueAt = t.dueAt;
      }
    }
    if (t.completedAt && t.completedAt > 0) {
      if (latestCompletedAt === undefined || t.completedAt > latestCompletedAt) {
        latestCompletedAt = t.completedAt;
      }
    }
    if (t.lifecycle === 'blocked') blockedCount += 1;
    if (t.lifecycle !== 'cancelled') {
      activeCount += 1;
      if (COMPLETED_LIFECYCLES.has(t.lifecycle)) doneCount += 1;
    }
  }

  const completedFraction = activeCount === 0 ? 0 : doneCount / activeCount;

  return {
    countByLifecycle,
    totalCostInternal,
    totalPriceClient,
    totalEstimatedMinutes,
    totalActualMinutes,
    completedFraction,
    earliestDueAt,
    latestCompletedAt,
    blockedCount,
  };
}

/**
 * Predicate: should the parent be considered "complete enough" for an auto
 * `complete` suggestion? True when ALL non-cancelled subtasks are completed
 * or accepted.
 */
export function allSubtasksDone(subtasks: ReadonlyArray<Task>): boolean {
  const active = subtasks.filter((t) => t.lifecycle !== 'cancelled');
  if (active.length === 0) return false;
  return active.every((t) => COMPLETED_LIFECYCLES.has(t.lifecycle));
}
