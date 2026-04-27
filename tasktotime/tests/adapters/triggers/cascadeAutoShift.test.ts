/**
 * Tests for `cascadeAutoShift` — BFS-bounded auto-shift cascade fired by
 * `onTaskUpdate` when `plannedStartAt` or `completedAt` changes.
 *
 * Pins:
 *   - Linear chain T → A → B: shifting T pushes A, then B (cascadeDepth 1+2).
 *   - autoShiftEnabled: false on a target → that target is NOT patched.
 *   - Soft dependency (isHardBlock: false) is ignored by cascadeShift.
 *   - `target.plannedStartAt === entry.newPlannedStartAt` → patch skipped
 *     (idempotency at the patch level).
 *   - Cross-tenant target → BFS skips it; no patch issued.
 *   - BFS depth cap: a chain of 7 hops only walks 5.
 *   - Empty cascade (no dependents) → applied: [] without errors.
 */

import {
  cascadeAutoShift,
  MAX_BFS_DEPTH,
  MAX_CASCADE_DEPTH,
} from '../../../adapters/triggers/cascadeAutoShift';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asCompanyId,
  asTaskId,
  asUserId,
  type TaskId,
} from '../../../domain/identifiers';
import type { Task, TaskDependency, EpochMs } from '../../../domain/Task';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const SRC_USER = { id: asUserId('user_pm'), name: 'PM' };

function dep(targetId: string, isHardBlock = true): TaskDependency {
  return {
    taskId: asTaskId(targetId),
    type: 'finish_to_start',
    isHardBlock,
    createdAt: T0 as EpochMs,
    createdBy: SRC_USER,
  };
}

function buildDeps() {
  const ports = makeAllPorts(T0);
  return { ports, deps: { taskRepo: ports.taskRepo } };
}

describe('cascadeAutoShift', () => {
  test('linear chain T → A → B: shifts both successors', async () => {
    const { ports, deps } = buildDeps();

    // Trigger T already shifted: plannedStartAt + duration sets effFinish.
    const T = makeTask({
      id: asTaskId('T'),
      plannedStartAt: (T0 + 4 * HOUR) as EpochMs,
      estimatedDurationMinutes: 60,
      autoShiftEnabled: true,
    });
    const A = makeTask({
      id: asTaskId('A'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 30,
      autoShiftEnabled: true,
      dependsOn: [dep('T')],
    });
    const B = makeTask({
      id: asTaskId('B'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 60,
      autoShiftEnabled: true,
      dependsOn: [dep('A')],
    });
    await ports.taskRepo.save(T);
    await ports.taskRepo.save(A);
    await ports.taskRepo.save(B);

    const result = await cascadeAutoShift(T, deps);

    expect(result.applied.map((s) => s.taskId)).toEqual(['A', 'B'].map(asTaskId));
    expect(result.bfsVisited).toBe(3);

    const refreshedA = await ports.taskRepo.findById(A.id);
    const refreshedB = await ports.taskRepo.findById(B.id);
    // T finishes at T0 + 4h + 60m → A starts there.
    expect(refreshedA?.plannedStartAt).toBe(T0 + 4 * HOUR + 60 * MIN);
    // A finishes at T0 + 4h + 60m + 30m → B starts there.
    expect(refreshedB?.plannedStartAt).toBe(T0 + 4 * HOUR + 60 * MIN + 30 * MIN);
  });

  test('does not shift a target with autoShiftEnabled=false', async () => {
    const { ports, deps } = buildDeps();
    const T = makeTask({
      id: asTaskId('T'),
      plannedStartAt: (T0 + 5 * HOUR) as EpochMs,
      estimatedDurationMinutes: 60,
    });
    const NoShift = makeTask({
      id: asTaskId('NoShift'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 30,
      autoShiftEnabled: false, // explicit
      dependsOn: [dep('T')],
    });
    await ports.taskRepo.save(T);
    await ports.taskRepo.save(NoShift);

    const result = await cascadeAutoShift(T, deps);

    expect(result.applied).toHaveLength(0);
    const refreshed = await ports.taskRepo.findById(NoShift.id);
    expect(refreshed?.plannedStartAt).toBe(T0);
  });

  test('soft dependency (isHardBlock=false) does not trigger shift', async () => {
    const { ports, deps } = buildDeps();
    const T = makeTask({
      id: asTaskId('T'),
      plannedStartAt: (T0 + 5 * HOUR) as EpochMs,
      estimatedDurationMinutes: 60,
    });
    const Soft = makeTask({
      id: asTaskId('Soft'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 30,
      autoShiftEnabled: true,
      dependsOn: [dep('T', false)], // soft
    });
    await ports.taskRepo.save(T);
    await ports.taskRepo.save(Soft);

    const result = await cascadeAutoShift(T, deps);

    expect(result.applied).toHaveLength(0);
    const refreshed = await ports.taskRepo.findById(Soft.id);
    expect(refreshed?.plannedStartAt).toBe(T0);
  });

  test('skips patch when target.plannedStartAt already equals new value', async () => {
    const { ports, deps } = buildDeps();
    const T = makeTask({
      id: asTaskId('T'),
      plannedStartAt: (T0 + 4 * HOUR) as EpochMs,
      estimatedDurationMinutes: 60,
    });
    // Pre-shifted: A's plannedStartAt already matches T's effective finish.
    const A = makeTask({
      id: asTaskId('A'),
      plannedStartAt: (T0 + 4 * HOUR + 60 * MIN) as EpochMs,
      estimatedDurationMinutes: 30,
      autoShiftEnabled: true,
      dependsOn: [dep('T')],
    });
    await ports.taskRepo.save(T);
    await ports.taskRepo.save(A);

    const result = await cascadeAutoShift(T, deps);

    // cascadeShift treats `oldStart === newStart` as no-op and returns
    // 0 entries → result.applied stays empty + nothing else fires.
    expect(result.applied).toHaveLength(0);
    expect(result.skippedAlreadyShifted).toEqual([]);
  });

  test('cross-tenant target: BFS skips it; no patch issued', async () => {
    const { ports, deps } = buildDeps();
    const T = makeTask({
      id: asTaskId('T'),
      companyId: asCompanyId('co_self'),
      plannedStartAt: (T0 + 4 * HOUR) as EpochMs,
      estimatedDurationMinutes: 60,
    });
    const xtenant = makeTask({
      id: asTaskId('XT'),
      companyId: asCompanyId('co_other'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 30,
      autoShiftEnabled: true,
      dependsOn: [dep('T')],
    });
    await ports.taskRepo.save(T);
    await ports.taskRepo.save(xtenant);

    const result = await cascadeAutoShift(T, deps);

    expect(result.applied).toHaveLength(0);
    expect(result.skippedCrossTenant).toContain(xtenant.id);
    const refreshed = await ports.taskRepo.findById(xtenant.id);
    expect(refreshed?.plannedStartAt).toBe(T0);
  });

  test('BFS depth cap: a chain of 7 hops only walks 5', async () => {
    const { ports, deps } = buildDeps();
    // Build: T → N1 → N2 → N3 → N4 → N5 → N6 → N7
    const T = makeTask({
      id: asTaskId('T'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 30,
    });
    await ports.taskRepo.save(T);
    let prev: TaskId = T.id;
    const ids: TaskId[] = [];
    for (let i = 1; i <= 7; i++) {
      const id = asTaskId(`N${i}`);
      ids.push(id);
      await ports.taskRepo.save(
        makeTask({
          id,
          plannedStartAt: T0 as EpochMs,
          estimatedDurationMinutes: 30,
          autoShiftEnabled: true,
          dependsOn: [dep(prev as string)],
        }),
      );
      prev = id;
    }

    const result = await cascadeAutoShift(T, deps);

    // BFS visits T plus the first MAX_BFS_DEPTH layers (N1..N5).
    expect(result.bfsVisited).toBe(1 + MAX_BFS_DEPTH);
    // N6, N7 never make it into the candidate set, so cascadeShift can't
    // see them. They stay at their original plannedStartAt.
    const n6 = await ports.taskRepo.findById(ids[5]);
    const n7 = await ports.taskRepo.findById(ids[6]);
    expect(n6?.plannedStartAt).toBe(T0);
    expect(n7?.plannedStartAt).toBe(T0);
    // The first 5 hops shift correctly because they are within the BFS
    // window.
    const n1 = await ports.taskRepo.findById(ids[0]);
    expect(n1?.plannedStartAt).toBe(T0 + 30 * MIN);
  });

  test('empty cascade: trigger with no dependents returns applied: []', async () => {
    const { deps } = buildDeps();
    const T = makeTask({
      id: asTaskId('T_alone'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 60,
    });
    const result = await cascadeAutoShift(T, deps);
    expect(result.applied).toEqual([]);
    expect(result.bfsVisited).toBe(1);
  });

  test('uses completedAt as effective finish when set', async () => {
    const { ports, deps } = buildDeps();
    // Trigger has completedAt 6 hours after T0 — that becomes the effective
    // finish for the cascade rather than plannedStartAt + duration.
    const T = makeTask({
      id: asTaskId('T_done'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 60,
      completedAt: (T0 + 6 * HOUR) as EpochMs,
    });
    const A = makeTask({
      id: asTaskId('A_after'),
      plannedStartAt: T0 as EpochMs,
      estimatedDurationMinutes: 30,
      autoShiftEnabled: true,
      dependsOn: [dep('T_done')],
    });
    await ports.taskRepo.save(T);
    await ports.taskRepo.save(A);

    const result = await cascadeAutoShift(T, deps);

    expect(result.applied.map((s) => s.taskId)).toEqual([A.id]);
    const refreshed = await ports.taskRepo.findById(A.id);
    expect(refreshed?.plannedStartAt).toBe(T0 + 6 * HOUR);
  });

  test('exposes MAX_CASCADE_DEPTH constant in line with MAX_BFS_DEPTH', () => {
    expect(MAX_BFS_DEPTH).toBe(5);
    expect(MAX_CASCADE_DEPTH).toBe(5);
  });
});
