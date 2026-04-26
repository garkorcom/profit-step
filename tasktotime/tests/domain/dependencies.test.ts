/**
 * Tests for domain/dependencies.ts — cycle detection (BFS) + reverse index.
 */

import {
  buildDependencyGraph,
  canAddDependency,
  computeBlocksTaskIds,
  topologicalSort,
  findUnsatisfiedPredecessors,
} from '../../domain/dependencies';
import {
  diamond,
  linearChain,
  longChain,
  preCycle,
  twoStepCyclePreset,
} from '../../shared/fixtures/dependencies.fixture';
import { asTaskId } from '../../domain/identifiers';

describe('canAddDependency', () => {
  test('adding A->B in empty graph is OK', () => {
    const graph = buildDependencyGraph([]);
    expect(canAddDependency(graph, asTaskId('A'), asTaskId('B'))).toEqual({ ok: true });
  });

  test('self-dependency is detected', () => {
    const graph = buildDependencyGraph([]);
    const result = canAddDependency(graph, asTaskId('A'), asTaskId('A'));
    expect(result.ok).toBe(false);
    expect(result.cyclePath).toEqual([asTaskId('A'), asTaskId('A')]);
  });

  test('2-cycle: B already depends on A; making A depend on B creates cycle', () => {
    // DSL "A->B" → B.dependsOn=[A]. Making A.dependsOn += B closes: A→B→A.
    const tasks = twoStepCyclePreset();
    const graph = buildDependencyGraph(tasks);
    const a = asTaskId('task_A');
    const b = asTaskId('task_B');
    const result = canAddDependency(graph, a, b);
    expect(result.ok).toBe(false);
    expect(result.cyclePath).toContain(a);
    expect(result.cyclePath).toContain(b);
  });

  test('3-cycle: chain B->A, C->B exists; making A depend on C creates 3-cycle', () => {
    // DSL "A->B, B->C" → B.dependsOn=[A], C.dependsOn=[B].
    // Making A.dependsOn += C closes: A → C → B → A.
    const tasks = preCycle();
    const graph = buildDependencyGraph(tasks);
    const a = asTaskId('task_A');
    const c = asTaskId('task_C');
    const result = canAddDependency(graph, a, c);
    expect(result.ok).toBe(false);
    expect(result.cyclePath).toBeDefined();
    expect(result.cyclePath!.length).toBeGreaterThanOrEqual(3);
  });

  test('diamond shape: adding D->A is safe (D already transitively depends on A)', () => {
    // In diamond A->B, A->C, B->D, C->D: D already depends on A via B and C.
    // Adding D->A directly is redundant but does NOT close a cycle (A still
    // doesn't depend on D).
    const tasks = diamond();
    const graph = buildDependencyGraph(tasks);
    const a = asTaskId('task_A');
    const d = asTaskId('task_D');
    const result = canAddDependency(graph, d, a);
    expect(result.ok).toBe(true);
  });

  test('diamond: adding A->D creates cycle (A would transitively depend on itself)', () => {
    const tasks = diamond();
    const graph = buildDependencyGraph(tasks);
    const a = asTaskId('task_A');
    const d = asTaskId('task_D');
    // Make A depend on D — but D depends on B which depends on A → cycle.
    const result = canAddDependency(graph, a, d);
    expect(result.ok).toBe(false);
  });

  test('100-task linear chain: adding edge from N0 -> N99 creates cycle (perf check)', () => {
    // Linear chain N0 -> N1 -> ... -> N99 means each Ni depends on Ni-1.
    // Adding N0 -> N99 means making N0 depend on N99 — but N99 transitively
    // depends on N0 → cycle.
    const tasks = longChain(100);
    const graph = buildDependencyGraph(tasks);
    const start = Date.now();
    const result = canAddDependency(
      graph,
      asTaskId('task_N0'),
      asTaskId('task_N99'),
    );
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    // BFS over 100 nodes should be far below 100ms even on slow CI
    expect(elapsed).toBeLessThan(100);
  });
});

describe('computeBlocksTaskIds (reverse index)', () => {
  test('linear chain: A is blocked by no one; B is blocked by A', () => {
    const tasks = linearChain(); // A -> B -> C -> D
    const blocksA = computeBlocksTaskIds(tasks, asTaskId('task_A'));
    expect(blocksA).toEqual([asTaskId('task_B')]);
    const blocksB = computeBlocksTaskIds(tasks, asTaskId('task_B'));
    expect(blocksB).toEqual([asTaskId('task_C')]);
  });

  test('diamond: A blocks both B and C', () => {
    const tasks = diamond();
    const blocksA = computeBlocksTaskIds(tasks, asTaskId('task_A'));
    expect(blocksA).toContain(asTaskId('task_B'));
    expect(blocksA).toContain(asTaskId('task_C'));
    expect(blocksA).toHaveLength(2);
  });

  test('returns empty list for unconnected task', () => {
    const tasks = linearChain();
    const blocks = computeBlocksTaskIds(tasks, asTaskId('not_in_graph'));
    expect(blocks).toEqual([]);
  });
});

describe('topologicalSort', () => {
  test('linear chain returns predecessors first', () => {
    const tasks = linearChain();
    const graph = buildDependencyGraph(tasks);
    const order = topologicalSort(graph);
    expect(order).not.toBeNull();
    // A must come before B, B before C, etc.
    const idx = (s: string) => order!.indexOf(asTaskId(`task_${s}`));
    expect(idx('A')).toBeLessThan(idx('B'));
    expect(idx('B')).toBeLessThan(idx('C'));
    expect(idx('C')).toBeLessThan(idx('D'));
  });

  test('returns null when there is a cycle', () => {
    // Build A->B then B->A manually to create a cycle
    const tasks = twoStepCyclePreset();
    const graph = buildDependencyGraph(tasks);
    // Inject a back-edge: task_A.dependsOn += task_B
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    a.dependsOn = [
      {
        taskId: asTaskId('task_B'),
        type: 'finish_to_start',
        isHardBlock: true,
        createdAt: 0,
        createdBy: { id: 'u', name: 'u' } as never,
      },
    ];
    const cyclicGraph = buildDependencyGraph(tasks);
    expect(topologicalSort(cyclicGraph)).toBeNull();
  });
});

describe('findUnsatisfiedPredecessors', () => {
  test('empty when task has no dependsOn', () => {
    const tasks = linearChain();
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    expect(findUnsatisfiedPredecessors(a, tasks)).toEqual([]);
  });

  test('returns predecessor IDs not yet completed/accepted', () => {
    const tasks = linearChain();
    const b = tasks.find((t) => t.id === asTaskId('task_B'))!;
    // A is in 'ready' state — not satisfied
    expect(findUnsatisfiedPredecessors(b, tasks)).toContain(asTaskId('task_A'));
  });

  test('completed predecessor is satisfied', () => {
    const tasks = linearChain();
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    a.lifecycle = 'completed';
    const b = tasks.find((t) => t.id === asTaskId('task_B'))!;
    expect(findUnsatisfiedPredecessors(b, tasks)).toEqual([]);
  });

  test('soft-block dependencies are ignored', () => {
    const tasks = linearChain();
    const b = tasks.find((t) => t.id === asTaskId('task_B'))!;
    b.dependsOn = b.dependsOn?.map((d) => ({ ...d, isHardBlock: false }));
    expect(findUnsatisfiedPredecessors(b, tasks)).toEqual([]);
  });
});
