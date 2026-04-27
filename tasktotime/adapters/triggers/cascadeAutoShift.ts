/**
 * `cascadeAutoShift` — when a task's `plannedStartAt` or `completedAt`
 * shifts, recompute `plannedStartAt` for downstream tasks with
 * `autoShiftEnabled: true` via the pure `domain/autoShift.cascadeShift`.
 *
 * Called from `onTaskUpdate` when the watched diff includes
 * `plannedStartAt` or `completedAt`. The handler is split into its own
 * file so the BFS + depth-limit + per-target idempotency live in one
 * grokable place.
 *
 * **Algorithm**
 *   1. BFS forward from the trigger task using `TaskRepository.findByDependsOn`.
 *      Cap at `MAX_BFS_DEPTH` (5) hops to bound the read cost on
 *      adversarial inputs.
 *   2. Run `cascadeShift(collectedTasks, triggerId)` from the domain
 *      module. Pure function — no I/O.
 *   3. For each `ShiftEntry` with `cascadeDepth <= MAX_CASCADE_DEPTH`,
 *      patch the target's `plannedStartAt`. Skip if the target's
 *      persisted `plannedStartAt` already equals the new value
 *      (idempotent on retries / re-fires).
 *   4. Cross-tenant guard: refuse to mutate targets in a different
 *      `companyId`.
 *
 * **Loop containment (CLAUDE.md §2.1).**
 *   Patching a target's `plannedStartAt` is a write to a watched field —
 *   the target's own `onTaskUpdate` WILL fire, and it will run its own
 *   cascade BFS rooted at itself. That secondary cascade is _bounded_:
 *
 *     - The depth limit is per-cascade-fire, not global, so the chain can
 *       extend further than 5 hops through fan-out — but each step does
 *       O(read fan-out) work, not exponential.
 *     - When the secondary cascade computes shifts on already-shifted
 *       tasks, `cascadeShift` returns 0 entries (the new starts are
 *       already correct), so no further writes happen — the cascade
 *       terminates.
 *     - On retried events the patch-level idempotency (`oldStart ===
 *       newStart`) skips the write entirely.
 *
 *   Net result: linear write cost in the number of dependent tasks, no
 *   infinite loop, no exponential blow-up. Removing `plannedStartAt` from
 *   the watched-fields list would silence the secondary cascade — at the
 *   cost of breaking long chains of auto-shift. Don't do that without
 *   replacing this proof with a different one.
 */

import type { Task } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories';
import type { TaskId } from '../../domain/identifiers';
import { cascadeShift, type ShiftEntry } from '../../domain/autoShift';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';

export const MAX_BFS_DEPTH = 5;
export const MAX_CASCADE_DEPTH = 5;

export interface CascadeAutoShiftDeps {
  taskRepo: TaskRepository;
  logger?: AdapterLogger;
}

export interface CascadeAutoShiftResult {
  applied: ShiftEntry[];
  skippedAlreadyShifted: TaskId[];
  skippedCrossTenant: TaskId[];
  skippedDepth: TaskId[];
  skippedNotFound: TaskId[];
  bfsVisited: number;
}

/**
 * Run the auto-shift cascade rooted at `trigger`. Pure orchestration over
 * `TaskRepository` + `cascadeShift`. The trigger task itself is NOT
 * patched — its plannedStartAt or completedAt was already set by the
 * application path that produced the change event.
 */
export async function cascadeAutoShift(
  trigger: Task,
  deps: CascadeAutoShiftDeps,
): Promise<CascadeAutoShiftResult> {
  const log = deps.logger ?? noopLogger;
  const result: CascadeAutoShiftResult = {
    applied: [],
    skippedAlreadyShifted: [],
    skippedCrossTenant: [],
    skippedDepth: [],
    skippedNotFound: [],
    bfsVisited: 0,
  };

  // ── 1. BFS forward ──────────────────────────────────────────────────
  // The trigger plus everything downstream it can reach within MAX_BFS_DEPTH
  // hops. We dedupe by task id so a diamond shape doesn't process a node
  // multiple times.
  const collected = new Map<TaskId, Task>();
  collected.set(trigger.id, trigger);

  let frontier: TaskId[] = [trigger.id];
  for (let depth = 0; depth < MAX_BFS_DEPTH && frontier.length > 0; depth++) {
    const next: TaskId[] = [];
    for (const id of frontier) {
      let dependents: Task[];
      try {
        // Pass `trigger.companyId` so the Firestore adapter binds the
        // `(companyId, blocksTaskIds array-contains)` composite index and
        // returns only same-tenant matches. Without this, the query falls
        // back to a single-field array-contains scan that returns matches
        // across every tenant — wasteful, and a theoretical cross-tenant
        // leak. The post-fetch `dep.companyId !== trigger.companyId` guard
        // below stays as belt-and-suspenders.
        dependents = await deps.taskRepo.findByDependsOn(id, trigger.companyId);
      } catch (err) {
        log.warn?.('cascadeAutoShift.bfs_lookup_failed', {
          triggerId: trigger.id,
          atId: id,
          err,
        });
        continue;
      }
      for (const dep of dependents) {
        if (dep.companyId !== trigger.companyId) {
          // Don't pull cross-tenant tasks into the calculation.
          if (!result.skippedCrossTenant.includes(dep.id)) {
            result.skippedCrossTenant.push(dep.id);
          }
          continue;
        }
        if (collected.has(dep.id)) continue;
        collected.set(dep.id, dep);
        next.push(dep.id);
      }
    }
    frontier = next;
  }
  result.bfsVisited = collected.size;

  // ── 2. Run pure cascade computation ─────────────────────────────────
  const shifts = cascadeShift(Array.from(collected.values()), trigger.id);

  // ── 3. Apply each shift entry ───────────────────────────────────────
  for (const entry of shifts) {
    if (entry.cascadeDepth > MAX_CASCADE_DEPTH) {
      result.skippedDepth.push(entry.taskId);
      continue;
    }

    let target: Task | null;
    try {
      target = await deps.taskRepo.findById(entry.taskId);
    } catch (err) {
      log.warn?.('cascadeAutoShift.target_lookup_failed', {
        triggerId: trigger.id,
        targetId: entry.taskId,
        err,
      });
      result.skippedNotFound.push(entry.taskId);
      continue;
    }
    if (!target) {
      result.skippedNotFound.push(entry.taskId);
      continue;
    }
    if (target.companyId !== trigger.companyId) {
      // Belt-and-suspenders — BFS already filtered, but a target id pulled
      // from a non-BFS path (e.g. cycle through external) could land here.
      if (!result.skippedCrossTenant.includes(entry.taskId)) {
        result.skippedCrossTenant.push(entry.taskId);
      }
      continue;
    }
    if (target.plannedStartAt === entry.newPlannedStartAt) {
      // Patch-level idempotency: if the persisted value already matches,
      // a previous cascade got there first. Skip the write entirely.
      result.skippedAlreadyShifted.push(entry.taskId);
      continue;
    }

    try {
      await deps.taskRepo.patch(entry.taskId, {
        plannedStartAt: entry.newPlannedStartAt,
      });
      result.applied.push(entry);
    } catch (err) {
      log.warn?.('cascadeAutoShift.patch_failed', {
        triggerId: trigger.id,
        targetId: entry.taskId,
        err,
      });
      // Continue the rest of the cascade rather than aborting.
      result.skippedNotFound.push(entry.taskId);
    }
  }

  return result;
}
