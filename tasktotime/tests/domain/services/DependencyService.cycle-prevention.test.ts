/**
 * @fileoverview DependencyService.cycle-prevention.test.ts
 *
 * Spec source of truth:
 *   - tasktotime/spec/08-modules/graph-dependencies/cycle-prevention.md:174-188
 *
 * Why a separate file from `DependencyService.test.ts`?
 *   - The existing service test exercises orchestration (addDependency,
 *     removeDependency, computeCriticalPath cross-tenant scoping) and only
 *     spot-checks one cycle scenario.
 *   - The spec mandates dedicated coverage of the BFS cycle detector at the
 *     service entry point: 3-cycle, 4-cycle, 5-cycle, self-loop, plus the
 *     diamond shape that must NOT be flagged as a cycle. We pin those here
 *     so `canAddDependency`'s service contract stays observable.
 *
 * All tests are pure: `InMemoryTaskRepository` from
 * `tasktotime/shared/mocks/`, no Firebase, no I/O. Should run in <1s.
 */

import { DependencyService } from '../../../domain/services/DependencyService';
import { graph } from '../../../shared/test-helpers/buildDependencyGraph';
import { InMemoryTaskRepository } from '../../../shared/mocks/InMemoryTaskRepository';
import { FakeClock } from '../../../shared/mocks/FakeClock';
import { asTaskId } from '../../../domain/identifiers';

function buildService() {
  const taskRepo = new InMemoryTaskRepository();
  const clock = new FakeClock(1_700_000_000_000);
  const service = new DependencyService({ taskRepo, clock });
  return { taskRepo, clock, service };
}

// ─── 3-cycle: A → B → C → A ─────────────────────────────────────────────
//
// Pre-state (DSL): "A->B, B->C" → B.dependsOn=[A], C.dependsOn=[B], so C
// already transitively depends on A. Adding A.dependsOn += C closes the
// cycle A → C → B → A. The BFS in `dependencies.ts` walks predecessors of
// `to` and reports the path it found back to `from`.

describe('DependencyService.canAddDependency — 3-cycle', () => {
  test('detects 3-cycle when adding A → C on top of A→B→C', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, B->C'));

    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_C'),
    );

    expect(result.ok).toBe(false);
    expect(result.cyclePath).toBeDefined();
    expect(result.cyclePath!).toContain(asTaskId('task_A'));
    expect(result.cyclePath!).toContain(asTaskId('task_C'));
    // Path must traverse the intermediate node B that closes the cycle.
    expect(result.cyclePath!).toContain(asTaskId('task_B'));
    // 3-cycle ⇒ at least 3 unique IDs (allowing for `from` repeated at end).
    expect(new Set(result.cyclePath!).size).toBeGreaterThanOrEqual(3);
  });

  test('reverse direction is NOT a cycle (C → A is safe)', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, B->C'));

    // C.dependsOn += A: A is the root predecessor; this is just adding a
    // forward edge that's already implied transitively. Not a cycle.
    const result = await service.canAddDependency(
      asTaskId('task_C'),
      asTaskId('task_A'),
    );
    expect(result.ok).toBe(true);
  });
});

// ─── 4-cycle: A → B → C → D → A ─────────────────────────────────────────

describe('DependencyService.canAddDependency — 4-cycle', () => {
  test('detects 4-cycle when adding A → D on top of A→B→C→D', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, B->C, C->D'));

    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_D'),
    );

    expect(result.ok).toBe(false);
    expect(result.cyclePath).toBeDefined();
    expect(new Set(result.cyclePath!).size).toBeGreaterThanOrEqual(4);
  });

  test('intermediate-edge probe still detects cycle (B → D would close A→B→D→C→B... no)', async () => {
    // Adding B.dependsOn += D — D has predecessors C → B → A. So D
    // transitively depends on B. Closing B→D edges produces cycle B→D→C→B.
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, B->C, C->D'));

    const result = await service.canAddDependency(
      asTaskId('task_B'),
      asTaskId('task_D'),
    );

    expect(result.ok).toBe(false);
    expect(result.cyclePath!).toContain(asTaskId('task_B'));
    expect(result.cyclePath!).toContain(asTaskId('task_D'));
  });
});

// ─── 5-cycle: A → B → C → D → E → A ─────────────────────────────────────

describe('DependencyService.canAddDependency — 5-cycle', () => {
  test('detects 5-cycle when adding A → E on top of A→B→C→D→E', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, B->C, C->D, D->E'));

    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_E'),
    );

    expect(result.ok).toBe(false);
    expect(result.cyclePath).toBeDefined();
    expect(new Set(result.cyclePath!).size).toBeGreaterThanOrEqual(5);
    // The full cycle should mention every intermediate node
    for (const id of ['task_A', 'task_B', 'task_C', 'task_D', 'task_E']) {
      expect(result.cyclePath!).toContain(asTaskId(id));
    }
  });
});

// ─── Self-loop: A → A ───────────────────────────────────────────────────

describe('DependencyService.canAddDependency — self-loop', () => {
  test('detects A → A as a cycle (cyclePath length 2: [A, A])', async () => {
    const { taskRepo, service } = buildService();
    // Seeding the lone task A so the service can find it; even on empty
    // graph the `from === to` branch should fire first.
    taskRepo.seed(graph('A'));

    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_A'),
    );

    expect(result.ok).toBe(false);
    expect(result.cyclePath).toEqual([
      asTaskId('task_A'),
      asTaskId('task_A'),
    ]);
  });

  test('self-loop check works even when the task is missing from the repo', async () => {
    const { service } = buildService();
    // No seed — `from === to` must short-circuit before any I/O.
    const result = await service.canAddDependency(
      asTaskId('task_loner'),
      asTaskId('task_loner'),
    );
    expect(result.ok).toBe(false);
  });
});

// ─── Diamond: NOT a cycle ──────────────────────────────────────────────
//
// Diamond shape:
//          A
//         / \
//        B   C
//         \ /
//          D
// Edges: A→B, A→C, B→D, C→D. D depends on B and on C; B and C depend on A.
// So D transitively depends on A via two paths, but A does NOT depend on D.
// Adding D → A is REDUNDANT (A is already the root predecessor) but does
// NOT close a cycle — so cycle detector must return ok: true.

describe('DependencyService.canAddDependency — diamond is NOT a cycle', () => {
  test('D → A on a diamond is safe (no cycle, just redundant edge)', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, A->C, B->D, C->D'));

    const result = await service.canAddDependency(
      asTaskId('task_D'),
      asTaskId('task_A'),
    );

    // No cycle: ok=true, no cyclePath populated.
    expect(result.ok).toBe(true);
    expect(result.cyclePath).toBeUndefined();
  });

  test('A → D on a diamond IS a cycle (A would transitively depend on itself)', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, A->C, B->D, C->D'));

    // Adding A.dependsOn += D — but D depends on B, B depends on A → cycle.
    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_D'),
    );

    expect(result.ok).toBe(false);
  });

  test('B → C on a diamond is safe (siblings have no transitive relationship)', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, A->C, B->D, C->D'));

    // B and C are sibling successors of A; making B depend on C does not
    // close a cycle (there's no path from C back to B).
    const result = await service.canAddDependency(
      asTaskId('task_B'),
      asTaskId('task_C'),
    );

    expect(result.ok).toBe(true);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────

describe('DependencyService.canAddDependency — edge cases', () => {
  test('empty graph: any A → B is safe', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph(''));

    const result = await service.canAddDependency(
      asTaskId('task_X'),
      asTaskId('task_Y'),
    );
    expect(result.ok).toBe(true);
  });

  test('two unrelated tasks (no edges): A → B is safe', async () => {
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A, B'));

    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_B'),
    );
    expect(result.ok).toBe(true);
  });

  test('linear chain unrelated to candidate edge: safe', async () => {
    // A → B → C is a chain. Adding D.dependsOn += E (with D, E not in the
    // chain at all) is safe. Tests that loadGraphTasks correctly limits
    // its frontier to the relevant subgraph and doesn't get confused.
    const { taskRepo, service } = buildService();
    taskRepo.seed(graph('A->B, B->C, D, E'));

    const result = await service.canAddDependency(
      asTaskId('task_D'),
      asTaskId('task_E'),
    );
    expect(result.ok).toBe(true);
  });
});
