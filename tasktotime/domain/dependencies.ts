/**
 * Pure dependency-graph algorithms — cycle detection (BFS) and reverse
 * index computation. Operate on plain `Task[]` (or compact graph maps),
 * no I/O. Adapters fetch tasks via `TaskRepository`, then pass to these
 * pure functions.
 *
 * See:
 *   - spec/08-modules/graph-dependencies/cycle-prevention.md
 *   - blueprint §3.2 DependencyService.canAddDependency uses this.
 */

import type { TaskId } from './identifiers';
import type { Task, TaskDependency } from './Task';
import { CycleDetected, SelfDependency } from './errors';

/**
 * Adjacency map: taskId -> set of taskIds it depends on (predecessors).
 * Equivalent: edge `from -> to` means "from depends on to" (`from.dependsOn`
 * includes `to`).
 */
export type DependencyGraph = Map<TaskId, Set<TaskId>>;

export interface CanAddDependencyResult {
  ok: boolean;
  cyclePath?: TaskId[];
}

/**
 * Build adjacency map from a list of tasks. Used by tests + services.
 */
export function buildDependencyGraph(tasks: ReadonlyArray<Task>): DependencyGraph {
  const graph: DependencyGraph = new Map();
  for (const task of tasks) {
    const deps = new Set<TaskId>();
    for (const d of task.dependsOn ?? []) {
      deps.add(d.taskId);
    }
    graph.set(task.id, deps);
  }
  return graph;
}

/**
 * Detect whether adding edge `from -> to` (i.e. making `from` depend on `to`)
 * would create a cycle in the dependency graph.
 *
 * Algorithm: from `to`, BFS through transitive dependencies; if we ever reach
 * `from`, cycle detected (returning the path).
 *
 * Self-dependency (`from === to`) returns cycle path = [from, from].
 *
 * Complexity: O(V + E) where V = tasks reachable from `to`.
 */
export function canAddDependency(
  graph: DependencyGraph,
  from: TaskId,
  to: TaskId,
): CanAddDependencyResult {
  if (from === to) {
    return { ok: false, cyclePath: [from, to] };
  }

  // BFS from `to` over `dependsOn` edges (predecessors). If we reach `from`,
  // adding `from -> to` would close a cycle.
  const visited = new Set<TaskId>();
  const parent = new Map<TaskId, TaskId>();
  const queue: TaskId[] = [to];
  visited.add(to);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = graph.get(current);
    if (!deps) continue;
    for (const next of deps) {
      if (visited.has(next)) continue;
      parent.set(next, current);
      if (next === from) {
        // Reconstruct path from `from` back to `to`
        const path: TaskId[] = [from];
        let node: TaskId | undefined = current;
        while (node !== undefined) {
          path.push(node);
          if (node === to) break;
          node = parent.get(node);
        }
        return { ok: false, cyclePath: path };
      }
      visited.add(next);
      queue.push(next);
    }
  }

  return { ok: true };
}

/**
 * Returns true if adding `from.dependsOn += to` is safe (no cycle, not self).
 * Throws on cycle (callers may prefer the boolean form `canAddDependency`).
 */
export function assertCanAddDependency(
  graph: DependencyGraph,
  from: TaskId,
  to: TaskId,
): void {
  if (from === to) {
    throw new SelfDependency(from);
  }
  const result = canAddDependency(graph, from, to);
  if (!result.ok) {
    throw new CycleDetected(result.cyclePath ?? [from, to]);
  }
}

/**
 * Compute reverse index `blocksTaskIds` for `targetTaskId`:
 * which tasks depend on `targetTaskId`?
 *
 * Returns a deduplicated list. Used by triggers to maintain `task.blocksTaskIds`
 * after `dependsOn` changes.
 */
export function computeBlocksTaskIds(
  tasks: ReadonlyArray<Task>,
  targetTaskId: TaskId,
): TaskId[] {
  const result: TaskId[] = [];
  const seen = new Set<TaskId>();
  for (const t of tasks) {
    for (const d of t.dependsOn ?? []) {
      if (d.taskId === targetTaskId && !seen.has(t.id)) {
        seen.add(t.id);
        result.push(t.id);
      }
    }
  }
  return result;
}

/**
 * Helper: detect dependencies that would prevent task from starting.
 * Returns IDs of predecessors not yet `completed` or `accepted`.
 */
export function findUnsatisfiedPredecessors(
  task: Task,
  predecessors: ReadonlyArray<Task>,
): TaskId[] {
  const blockers: TaskId[] = [];
  for (const dep of task.dependsOn ?? []) {
    if (!dep.isHardBlock) continue;
    const pred = predecessors.find((p) => p.id === dep.taskId);
    if (!pred) continue;
    if (pred.lifecycle !== 'completed' && pred.lifecycle !== 'accepted') {
      blockers.push(pred.id);
    }
  }
  return blockers;
}

/**
 * Topological sort of a dependency graph (Kahn's algorithm). Returns ordering
 * such that `dependsOn` predecessors come before successors. If the graph has
 * a cycle, returns null.
 */
export function topologicalSort(graph: DependencyGraph): TaskId[] | null {
  const inDegree = new Map<TaskId, number>();
  // Initialize in-degree = 0 for all known nodes
  for (const node of graph.keys()) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
  }
  // For each edge from -> to (i.e. from's dependsOn includes to), this means
  // to is a predecessor; in topological order from the "execute first" sense,
  // predecessors come first. So in our graph: to has dependsOn from `from`.
  // We want order where deps come first. So bump in-degree of `from` for each
  // dep it has: every time `from` depends on something, `from` must wait.
  for (const [from, deps] of graph.entries()) {
    if (!inDegree.has(from)) inDegree.set(from, 0);
    inDegree.set(from, (inDegree.get(from) ?? 0) + deps.size);
    for (const to of deps) {
      if (!inDegree.has(to)) inDegree.set(to, 0);
    }
  }

  // Reverse adjacency: for each node, who depends on it?
  const reverse = new Map<TaskId, TaskId[]>();
  for (const [from, deps] of graph.entries()) {
    for (const to of deps) {
      const arr = reverse.get(to);
      if (arr) arr.push(from);
      else reverse.set(to, [from]);
    }
  }

  // Start with nodes that have no dependencies (in-degree = 0)
  const queue: TaskId[] = [];
  for (const [node, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(node);
  }

  const result: TaskId[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    const dependents = reverse.get(node) ?? [];
    for (const dep of dependents) {
      const deg = (inDegree.get(dep) ?? 0) - 1;
      inDegree.set(dep, deg);
      if (deg === 0) queue.push(dep);
    }
  }

  if (result.length !== inDegree.size) return null; // cycle
  return result;
}
