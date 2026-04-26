/**
 * DSL helper for building dependency graphs in tests.
 *
 * Usage:
 *   const tasks = graph('A->B, B->C, A->D');
 *   // tasks: [A, B, C, D]; A.dependsOn = [], B.dependsOn = [A], ...
 *
 * Convention: edge `X->Y` means "X is predecessor of Y" (i.e. Y depends on X).
 */

import type { Task, TaskDependency, EpochMs, UserRef } from '../../domain/Task';
import { makeTask, resetTaskIdCounter } from './makeTask';
import { asTaskId, asUserId } from '../../domain/identifiers';

const DEFAULT_USER: UserRef = {
  id: asUserId('user_graph_test'),
  name: 'Graph Test User',
};

export interface BuildGraphOptions {
  startTime?: EpochMs;
  durationMinutes?: number;
  autoShiftEnabled?: boolean;
}

/**
 * Parse "A->B, B->C, A->D" into Task[] with dependsOn populated.
 *
 * Each unique node-letter becomes a Task. Edge `X->Y` means Y depends on X.
 */
export function graph(spec: string, options: BuildGraphOptions = {}): Task[] {
  resetTaskIdCounter(1000);

  const edges: Array<[string, string]> = [];
  const nodes = new Set<string>();
  for (const piece of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const arrow = piece.includes('->') ? '->' : piece.includes('→') ? '→' : null;
    if (!arrow) {
      // Single node, no edge
      nodes.add(piece);
      continue;
    }
    const [from, to] = piece.split(arrow).map((s) => s.trim());
    if (!from || !to) continue;
    nodes.add(from);
    nodes.add(to);
    edges.push([from, to]);
  }

  const startTime: EpochMs = options.startTime ?? (1_700_000_000_000 as EpochMs);
  const duration = options.durationMinutes ?? 60;

  const taskByLabel = new Map<string, Task>();
  for (const label of nodes) {
    const task = makeTask({
      id: asTaskId(`task_${label}`),
      title: `Task ${label}`,
      lifecycle: 'ready',
      createdAt: startTime,
      updatedAt: startTime,
      dueAt: (startTime + 7 * 24 * 60 * 60 * 1000) as EpochMs,
      plannedStartAt: startTime,
      estimatedDurationMinutes: duration,
      autoShiftEnabled: options.autoShiftEnabled ?? false,
    });
    taskByLabel.set(label, task);
  }

  // Apply edges: for each X -> Y, add Y.dependsOn += X
  for (const [from, to] of edges) {
    const fromTask = taskByLabel.get(from);
    const toTask = taskByLabel.get(to);
    if (!fromTask || !toTask) continue;
    const dep: TaskDependency = {
      taskId: fromTask.id,
      type: 'finish_to_start',
      lagMinutes: 0,
      isHardBlock: true,
      createdAt: startTime,
      createdBy: DEFAULT_USER,
    };
    const existing = toTask.dependsOn ?? [];
    toTask.dependsOn = [...existing, dep];
  }

  return [...taskByLabel.values()];
}
