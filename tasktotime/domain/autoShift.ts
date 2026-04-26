/**
 * Auto-shift cascade — when a predecessor task's `completedAt` (or its
 * `plannedStartAt`) shifts, recompute `plannedStartAt` for downstream tasks
 * with `autoShiftEnabled: true`.
 *
 * Pure function operating on task arrays. Service walks the result and
 * persists via TaskRepository. NO I/O here.
 *
 * See blueprint §3.2 DependencyService.computeShiftPlan.
 */

import type { Task, EpochMs } from './Task';
import type { TaskId } from './identifiers';
import { topologicalSort, buildDependencyGraph } from './dependencies';

export interface ShiftEntry {
  taskId: TaskId;
  oldPlannedStartAt?: EpochMs;
  newPlannedStartAt: EpochMs;
  reason: string;
  cascadeDepth: number;
}

const MINUTE_MS = 60_000;

/**
 * Compute the shift plan triggered by `triggerTaskId`. The trigger task's
 * effective finish (completedAt or plannedStartAt+duration) becomes the new
 * baseline. Successors with `autoShiftEnabled` are pushed forward as needed.
 *
 * Tasks WITHOUT autoShiftEnabled are skipped (not shifted, but their
 * downstream successors are still walked relative to original plan).
 */
export function cascadeShift(
  tasks: ReadonlyArray<Task>,
  triggerTaskId: TaskId,
): ShiftEntry[] {
  const byId = new Map<TaskId, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const trigger = byId.get(triggerTaskId);
  if (!trigger) return [];

  // Build forward adjacency: predecessor -> successors that depend on it.
  const successors = new Map<TaskId, TaskId[]>();
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      const arr = successors.get(dep.taskId) ?? [];
      arr.push(t.id);
      successors.set(dep.taskId, arr);
    }
  }

  // Topo order ensures we process predecessors before successors (we'll
  // re-use computed earliestStart for downstream).
  const graph = buildDependencyGraph(tasks);
  const topo = topologicalSort(graph);
  if (!topo) return []; // cycle — caller should have prevented this

  // Effective start/finish for each task — tracks shifts as we go.
  const effStart = new Map<TaskId, EpochMs>();
  const effFinish = new Map<TaskId, EpochMs>();

  for (const id of topo) {
    const task = byId.get(id);
    if (!task) continue;
    const baseStart =
      task.plannedStartAt ?? task.actualStartAt ?? task.createdAt;
    effStart.set(id, baseStart);
    effFinish.set(id, baseStart + task.estimatedDurationMinutes * MINUTE_MS);
  }

  // Trigger's "new" finish = its current completedAt or recomputed effFinish
  if (trigger.completedAt) {
    effFinish.set(trigger.id, trigger.completedAt);
  }

  const shifts: ShiftEntry[] = [];
  const cascadeDepth = new Map<TaskId, number>();
  cascadeDepth.set(trigger.id, 0);

  // Walk topologically AFTER the trigger
  const triggerIdx = topo.indexOf(trigger.id);
  for (let i = triggerIdx + 1; i < topo.length; i++) {
    const id = topo[i]!;
    const task = byId.get(id);
    if (!task) continue;
    if (!task.autoShiftEnabled) continue;

    // New start = max( predecessor effFinish + lag ) over hard-block deps
    let newStart = effStart.get(id) ?? 0;
    let triggeredBy: TaskId | null = null;
    let parentDepth = 0;
    for (const dep of task.dependsOn ?? []) {
      if (!dep.isHardBlock) continue;
      const predFinish = effFinish.get(dep.taskId);
      if (predFinish === undefined) continue;
      const lag = (dep.lagMinutes ?? 0) * MINUTE_MS;
      const candidate = predFinish + lag;
      if (candidate > newStart) {
        newStart = candidate;
        triggeredBy = dep.taskId;
        parentDepth = cascadeDepth.get(dep.taskId) ?? 0;
      }
    }

    const oldStart = task.plannedStartAt;
    if (oldStart === newStart) continue; // no movement
    if (newStart <= (oldStart ?? 0)) continue; // do not pull tasks earlier

    effStart.set(id, newStart);
    effFinish.set(id, newStart + task.estimatedDurationMinutes * MINUTE_MS);
    cascadeDepth.set(id, parentDepth + 1);

    shifts.push({
      taskId: id,
      oldPlannedStartAt: oldStart,
      newPlannedStartAt: newStart,
      reason: triggeredBy
        ? `predecessor ${triggeredBy} shifted`
        : `cascade from ${triggerTaskId}`,
      cascadeDepth: parentDepth + 1,
    });
  }

  return shifts;
}
