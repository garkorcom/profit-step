/**
 * `recomputeParentRollup` — recompute a parent task's `subtaskRollup`
 * aggregate when one of its subtasks changes a field that contributes to
 * the rollup.
 *
 * Called from `onTaskUpdate` when the changed task has `parentTaskId` set
 * AND the diff includes any of:
 *   `lifecycle | dueAt | completedAt | estimatedDurationMinutes`
 *
 * Other watched-field changes (description, memo, assignee, etc.) do NOT
 * affect the rollup — skipping the recompute saves a parent read + write.
 *
 * **Loop safety (CLAUDE.md §2.1).** The patch only writes to the PARENT
 * doc, and the field written (`subtaskRollup`) is on the EXCLUDED list
 * inside `_shared.ts`. The follow-up `onTaskUpdate` on the parent therefore
 * exits with `no_watched_field_change`. The cascade terminates after one
 * hop. Removing `subtaskRollup` from the exclusion list without re-deriving
 * the loop proof would be a billing-bomb regression.
 *
 * **Cross-tenant guard.** Refuse to recompute when the parent belongs to a
 * different `companyId` than the subtask. Such a reference is a bug
 * upstream; we log a warn and leave the parent rollup as-is.
 *
 * **Idempotency at the patch level.** When the recomputed rollup matches
 * the parent's existing `subtaskRollup` we skip the write. This is the
 * common path on retried events.
 */

import type { Task, SubtaskRollup } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories';
import { computeSubtaskRollup } from '../../domain/rollup';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import type { TaskWatchedField } from './_shared';

/**
 * Subset of watched fields whose change should cause a parent rollup
 * recompute. Anything outside this set is structurally irrelevant to the
 * rollup aggregate.
 */
export const ROLLUP_AFFECTING_FIELDS: ReadonlyArray<TaskWatchedField> = [
  'lifecycle',
  'dueAt',
  'completedAt',
  'estimatedDurationMinutes',
] as const;

export interface RecomputeParentRollupDeps {
  taskRepo: TaskRepository;
  logger?: AdapterLogger;
}

export type RecomputeParentRollupResult =
  | { applied: true; parentTaskId: string; rollup: SubtaskRollup }
  | { skipped: 'no_parent' | 'no_relevant_field_change' | 'parent_missing' | 'cross_tenant' | 'unchanged_rollup' | 'lookup_failed' };

/**
 * Decide whether the change calls for a parent rollup recompute. Used by
 * `onTaskUpdate` to gate the call.
 */
export function shouldRecomputeParentRollup(
  changedFields: ReadonlyArray<TaskWatchedField>,
  after: Task,
): boolean {
  if (!after.parentTaskId) return false;
  return changedFields.some((f) => ROLLUP_AFFECTING_FIELDS.includes(f));
}

export async function recomputeParentRollup(
  changedFields: ReadonlyArray<TaskWatchedField>,
  before: Task,
  after: Task,
  deps: RecomputeParentRollupDeps,
): Promise<RecomputeParentRollupResult> {
  const log = deps.logger ?? noopLogger;
  const parentId = after.parentTaskId;
  if (!parentId) return { skipped: 'no_parent' };

  const relevant = changedFields.some((f) => ROLLUP_AFFECTING_FIELDS.includes(f));
  if (!relevant) return { skipped: 'no_relevant_field_change' };

  let parent: Task | null;
  try {
    parent = await deps.taskRepo.findById(parentId);
  } catch (err) {
    log.warn?.('recomputeParentRollup.parent_lookup_failed', {
      childId: after.id,
      parentId,
      err,
    });
    return { skipped: 'lookup_failed' };
  }
  if (!parent) {
    log.warn?.('recomputeParentRollup.parent_missing', {
      childId: after.id,
      parentId,
    });
    return { skipped: 'parent_missing' };
  }
  if (parent.companyId !== after.companyId) {
    log.warn?.('recomputeParentRollup.cross_tenant', {
      childId: after.id,
      parentId,
      childCompanyId: after.companyId,
      parentCompanyId: parent.companyId,
    });
    return { skipped: 'cross_tenant' };
  }

  // Read all siblings (including the changed task itself) so the rollup
  // is computed from the **after** state — not stale data.
  let siblings: Task[];
  try {
    siblings = await deps.taskRepo.findSubtasks(parent.id);
  } catch (err) {
    log.warn?.('recomputeParentRollup.subtasks_lookup_failed', {
      childId: after.id,
      parentId,
      err,
    });
    return { skipped: 'lookup_failed' };
  }

  // The repo may return the older snapshot of `after` (pre-change) — replace
  // it with the current after state so the rollup reflects the new values.
  const merged = siblings.map((s) => (s.id === after.id ? after : s));

  const rollup = computeSubtaskRollup(merged);

  if (rollupEquals(parent.subtaskRollup, rollup)) {
    return { skipped: 'unchanged_rollup' };
  }

  await deps.taskRepo.patch(parentId, { subtaskRollup: rollup });
  void before; // reserved for future telemetry; suppress noUnused
  return { applied: true, parentTaskId: parentId as string, rollup };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function rollupEquals(
  a: SubtaskRollup | undefined,
  b: SubtaskRollup,
): boolean {
  if (!a) return false;
  if (
    a.totalCostInternal !== b.totalCostInternal ||
    a.totalPriceClient !== b.totalPriceClient ||
    a.totalEstimatedMinutes !== b.totalEstimatedMinutes ||
    a.totalActualMinutes !== b.totalActualMinutes ||
    a.completedFraction !== b.completedFraction ||
    a.blockedCount !== b.blockedCount ||
    a.earliestDueAt !== b.earliestDueAt ||
    a.latestCompletedAt !== b.latestCompletedAt
  ) {
    return false;
  }
  return countByLifecycleEquals(a.countByLifecycle, b.countByLifecycle);
}

function countByLifecycleEquals(
  a: SubtaskRollup['countByLifecycle'],
  b: SubtaskRollup['countByLifecycle'],
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k as keyof typeof a] !== b[k as keyof typeof b]) return false;
  }
  return true;
}
