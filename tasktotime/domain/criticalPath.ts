/**
 * Critical Path Method (CPM) — forward + backward pass on a DAG.
 *
 * In-memory only — operates on plain Task[] arrays. Caller (DependencyService)
 * fetches tasks from a project then runs this. Result is `slackMinutes` per
 * task and `isCriticalPath: boolean`. These are persisted via TaskRepository
 * by the service.
 *
 * No I/O, no Firebase. See spec/08-modules/graph-dependencies/critical-path.md.
 */

import type { Task, EpochMs } from './Task';
import type { TaskId } from './identifiers';
import { topologicalSort, buildDependencyGraph } from './dependencies';

/**
 * Per-task scheduling info computed by CPM.
 *
 * - earliestStart / earliestFinish — forward pass (ASAP)
 * - latestStart / latestFinish     — backward pass (ALAP)
 * - slack = latestStart - earliestStart  (minutes)
 * - onCriticalPath = (slack === 0)
 */
export interface ScheduleEntry {
  taskId: TaskId;
  durationMinutes: number;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  slack: number;
  onCriticalPath: boolean;
}

export interface ScheduleResult {
  byTaskId: Map<TaskId, ScheduleEntry>;
  /** Ordered IDs forming the critical path (slack=0 chain). */
  criticalPath: TaskId[];
  /** Total project duration (from earliest start of first to latest finish). */
  projectDurationMinutes: number;
  earliestProjectFinish: number;
  latestProjectFinish: number;
}

/**
 * Forward pass (ASAP scheduling): compute earliestStart/earliestFinish.
 *
 * For each task in topological order:
 *   earliestStart(t) = max( earliestFinish(p) + lag(p, t) )  for predecessors p
 *   earliestFinish(t) = earliestStart(t) + duration(t)
 *
 * Time is measured in MINUTES from a relative origin (0 = first task starts).
 * Returns a partially populated map (slack/latest filled later by backwardPass).
 */
export function forwardPass(
  tasks: ReadonlyArray<Task>,
  topoOrder: ReadonlyArray<TaskId>,
): Map<TaskId, ScheduleEntry> {
  const byId = new Map<TaskId, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const schedule = new Map<TaskId, ScheduleEntry>();
  for (const id of topoOrder) {
    const task = byId.get(id);
    if (!task) continue;

    let earliestStart = 0;
    for (const dep of task.dependsOn ?? []) {
      const predEntry = schedule.get(dep.taskId);
      if (!predEntry) continue;
      const lag = dep.lagMinutes ?? 0;
      // We model FS only here; SS / FF / SF would adjust the equation. Keep
      // FS-baseline for Phase 1; richer types are TODO (see open questions).
      const candidate = predEntry.earliestFinish + lag;
      if (candidate > earliestStart) earliestStart = candidate;
    }
    const duration = task.estimatedDurationMinutes ?? 0;
    schedule.set(id, {
      taskId: id,
      durationMinutes: duration,
      earliestStart,
      earliestFinish: earliestStart + duration,
      latestStart: 0,
      latestFinish: 0,
      slack: 0,
      onCriticalPath: false,
    });
  }
  return schedule;
}

/**
 * Backward pass (ALAP scheduling): compute latestStart/latestFinish + slack.
 *
 * Walks topo order REVERSED. Anchor: project finish = max(earliestFinish).
 * For each task:
 *   latestFinish(t) = min( latestStart(s) - lag(t, s) )  for successors s
 *                  OR projectFinish for terminal nodes
 *   latestStart(t) = latestFinish(t) - duration(t)
 *   slack(t) = latestStart(t) - earliestStart(t)
 */
export function backwardPass(
  tasks: ReadonlyArray<Task>,
  topoOrder: ReadonlyArray<TaskId>,
  schedule: Map<TaskId, ScheduleEntry>,
): { projectFinish: number } {
  // Build reverse adjacency: task -> successors with lag
  const successors = new Map<TaskId, Array<{ taskId: TaskId; lag: number }>>();
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      const arr = successors.get(dep.taskId) ?? [];
      arr.push({ taskId: t.id, lag: dep.lagMinutes ?? 0 });
      successors.set(dep.taskId, arr);
    }
  }

  // Project finish = max earliestFinish
  let projectFinish = 0;
  for (const e of schedule.values()) {
    if (e.earliestFinish > projectFinish) projectFinish = e.earliestFinish;
  }

  const reversed = [...topoOrder].reverse();
  for (const id of reversed) {
    const entry = schedule.get(id);
    if (!entry) continue;

    const succ = successors.get(id) ?? [];
    if (succ.length === 0) {
      entry.latestFinish = projectFinish;
    } else {
      let minLatestStart = Number.POSITIVE_INFINITY;
      for (const s of succ) {
        const sEntry = schedule.get(s.taskId);
        if (!sEntry) continue;
        const candidate = sEntry.latestStart - s.lag;
        if (candidate < minLatestStart) minLatestStart = candidate;
      }
      entry.latestFinish = minLatestStart === Number.POSITIVE_INFINITY
        ? projectFinish
        : minLatestStart;
    }
    entry.latestStart = entry.latestFinish - entry.durationMinutes;
    entry.slack = entry.latestStart - entry.earliestStart;
    entry.onCriticalPath = entry.slack === 0;
  }

  return { projectFinish };
}

/**
 * Compute full schedule for a list of tasks (one project's worth).
 * Returns null if the graph has a cycle.
 */
export function computeSchedule(
  tasks: ReadonlyArray<Task>,
): ScheduleResult | null {
  const graph = buildDependencyGraph(tasks);
  const topo = topologicalSort(graph);
  if (!topo) return null;

  const schedule = forwardPass(tasks, topo);
  const { projectFinish } = backwardPass(tasks, topo, schedule);

  // Critical path: nodes with slack === 0, ordered by earliestStart
  const criticalPath: TaskId[] = [];
  const sorted = [...schedule.values()].sort(
    (a, b) => a.earliestStart - b.earliestStart,
  );
  for (const e of sorted) {
    if (e.onCriticalPath) criticalPath.push(e.taskId);
  }

  let earliestProjectFinish = 0;
  for (const e of schedule.values()) {
    if (e.earliestFinish > earliestProjectFinish) {
      earliestProjectFinish = e.earliestFinish;
    }
  }

  return {
    byTaskId: schedule,
    criticalPath,
    projectDurationMinutes: projectFinish,
    earliestProjectFinish,
    latestProjectFinish: projectFinish,
  };
}

/**
 * Convert relative-minutes schedule into absolute-time fields on the task
 * (`plannedStartAt`, `slackMinutes`, `isCriticalPath`). Pure function — does
 * not write to repository; service composes the persistence call.
 */
export function applyScheduleToTask(
  task: Task,
  entry: ScheduleEntry,
  projectStartAt: EpochMs,
): Task {
  const minuteMs = 60_000;
  return {
    ...task,
    plannedStartAt: projectStartAt + entry.earliestStart * minuteMs,
    slackMinutes: entry.slack,
    isCriticalPath: entry.onCriticalPath,
  };
}
