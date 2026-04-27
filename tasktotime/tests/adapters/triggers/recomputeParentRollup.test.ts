/**
 * Tests for `recomputeParentRollup` — parent `subtaskRollup` recompute on
 * subtask field changes.
 *
 * Pins:
 *   - Skip when no parent (root task).
 *   - Skip when changedFields is empty / contains only non-affecting fields.
 *   - Skip when parent missing / cross-tenant.
 *   - Skip when recomputed rollup matches existing (idempotent no-write).
 *   - Apply patch when rollup differs.
 *   - Rollup reflects the **after** state of the changed subtask, not the
 *     stale snapshot from the repo.
 */

import {
  recomputeParentRollup,
  shouldRecomputeParentRollup,
  ROLLUP_AFFECTING_FIELDS,
} from '../../../adapters/triggers/recomputeParentRollup';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asCompanyId,
  asTaskId,
} from '../../../domain/identifiers';
import type { Task, EpochMs } from '../../../domain/Task';
import type { TaskWatchedField } from '../../../adapters/triggers/_shared';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  return { ports, deps: { taskRepo: ports.taskRepo } };
}

describe('shouldRecomputeParentRollup', () => {
  test('false when no parentTaskId on after', () => {
    const after = makeTask({ id: asTaskId('t1') });
    expect(shouldRecomputeParentRollup(['lifecycle'], after)).toBe(false);
  });

  test('false when changed fields are not in ROLLUP_AFFECTING_FIELDS', () => {
    const after = makeTask({
      id: asTaskId('t2'),
      parentTaskId: asTaskId('parent'),
    });
    const nonAffecting: TaskWatchedField[] = ['description', 'memo', 'priority'];
    expect(shouldRecomputeParentRollup(nonAffecting, after)).toBe(false);
  });

  test('true on lifecycle / dueAt / completedAt / estimatedDurationMinutes', () => {
    const after = makeTask({
      id: asTaskId('t3'),
      parentTaskId: asTaskId('parent'),
    });
    for (const f of ROLLUP_AFFECTING_FIELDS) {
      expect(shouldRecomputeParentRollup([f], after)).toBe(true);
    }
  });
});

describe('recomputeParentRollup', () => {
  test('skips when no parent', async () => {
    const { deps } = buildDeps();
    const before = makeTask({ id: asTaskId('orphan') });
    const after = before;
    const r = await recomputeParentRollup(['lifecycle'], before, after, deps);
    expect(r).toEqual({ skipped: 'no_parent' });
  });

  test('skips when changedFields are not affecting', async () => {
    const { deps } = buildDeps();
    const before = makeTask({
      id: asTaskId('child'),
      parentTaskId: asTaskId('p1'),
    });
    const r = await recomputeParentRollup(['description'], before, before, deps);
    expect(r).toEqual({ skipped: 'no_relevant_field_change' });
  });

  test('skips when parent missing', async () => {
    const { deps } = buildDeps();
    const before = makeTask({
      id: asTaskId('child_missing_parent'),
      parentTaskId: asTaskId('p_missing'),
    });
    const r = await recomputeParentRollup(['lifecycle'], before, before, deps);
    expect(r).toEqual({ skipped: 'parent_missing' });
  });

  test('refuses cross-tenant parent', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('p_xtenant'),
      companyId: asCompanyId('co_other'),
      subtaskIds: [asTaskId('child_xtenant')],
    });
    await ports.taskRepo.save(parent);

    const before = makeTask({
      id: asTaskId('child_xtenant'),
      companyId: asCompanyId('co_self'),
      parentTaskId: parent.id,
    });
    const r = await recomputeParentRollup(['lifecycle'], before, before, deps);
    expect(r).toEqual({ skipped: 'cross_tenant' });
  });

  test('applies patch when rollup differs', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('parent_apply'),
      subtaskIds: [asTaskId('s_a'), asTaskId('s_b')],
    });
    await ports.taskRepo.save(parent);
    const sibling = makeTask({
      id: asTaskId('s_a'),
      parentTaskId: parent.id,
      lifecycle: 'started',
      estimatedDurationMinutes: 60,
    });
    await ports.taskRepo.save(sibling);
    const before = makeTask({
      id: asTaskId('s_b'),
      parentTaskId: parent.id,
      lifecycle: 'started',
      estimatedDurationMinutes: 30,
    });
    await ports.taskRepo.save(before);
    const after: Task = { ...before, lifecycle: 'completed', completedAt: T0 as EpochMs };

    const r = await recomputeParentRollup(['lifecycle', 'completedAt'], before, after, deps);

    expect(r).toMatchObject({
      applied: true,
      parentTaskId: parent.id,
    });
    const refreshed = await ports.taskRepo.findById(parent.id);
    expect(refreshed?.subtaskRollup).toBeDefined();
    expect(refreshed?.subtaskRollup?.totalEstimatedMinutes).toBe(90);
    // s_a started + s_b completed → 1/2 done
    expect(refreshed?.subtaskRollup?.completedFraction).toBeCloseTo(0.5);
  });

  test('rollup reflects the after state of the changed subtask, not stale snapshot', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('parent_after_state'),
      subtaskIds: [asTaskId('s_after_x'), asTaskId('s_after_y')],
    });
    await ports.taskRepo.save(parent);
    // Sibling stays unchanged.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('s_after_y'),
        parentTaskId: parent.id,
        estimatedDurationMinutes: 60,
      }),
    );
    // The changed subtask in the repo still has the OLD value (typical race
    // window between trigger fire and our repo read).
    const beforePersisted = makeTask({
      id: asTaskId('s_after_x'),
      parentTaskId: parent.id,
      estimatedDurationMinutes: 30,
    });
    await ports.taskRepo.save(beforePersisted);
    // After state has the NEW value (90 min).
    const after: Task = { ...beforePersisted, estimatedDurationMinutes: 90 };

    await recomputeParentRollup(
      ['estimatedDurationMinutes'],
      beforePersisted,
      after,
      deps,
    );

    const refreshed = await ports.taskRepo.findById(parent.id);
    // y(60) + x(90) = 150, NOT y(60) + stale_x(30) = 90
    expect(refreshed?.subtaskRollup?.totalEstimatedMinutes).toBe(150);
  });

  test('second call with same after state skips the write (idempotency)', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('parent_idem'),
      subtaskIds: [asTaskId('s_idem')],
    });
    await ports.taskRepo.save(parent);
    const before = makeTask({
      id: asTaskId('s_idem'),
      parentTaskId: parent.id,
      lifecycle: 'started',
      estimatedDurationMinutes: 60,
    });
    await ports.taskRepo.save(before);
    const after: Task = {
      ...before,
      lifecycle: 'completed',
      completedAt: T0 as EpochMs,
    };

    // First call applies.
    const first = await recomputeParentRollup(['lifecycle', 'completedAt'], before, after, deps);
    expect(first).toMatchObject({ applied: true });

    // Persist the after state so the second call sees it as the current snapshot.
    await ports.taskRepo.save(after);

    // Second call with the SAME after state computes the same rollup → skip.
    const second = await recomputeParentRollup(['lifecycle', 'completedAt'], before, after, deps);
    expect(second).toEqual({ skipped: 'unchanged_rollup' });
  });

  test('handles parent with one or more siblings cleanly', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('parent_three_kids'),
      subtaskIds: ['s_x', 's_y', 's_z'].map(asTaskId),
    });
    await ports.taskRepo.save(parent);
    const x = makeTask({
      id: asTaskId('s_x'),
      parentTaskId: parent.id,
      lifecycle: 'completed',
      estimatedDurationMinutes: 30,
    });
    const y = makeTask({
      id: asTaskId('s_y'),
      parentTaskId: parent.id,
      lifecycle: 'started',
      estimatedDurationMinutes: 30,
    });
    const z = makeTask({
      id: asTaskId('s_z'),
      parentTaskId: parent.id,
      lifecycle: 'blocked',
      estimatedDurationMinutes: 30,
    });
    await ports.taskRepo.save(x);
    await ports.taskRepo.save(y);
    await ports.taskRepo.save(z);

    const after: Task = { ...y, lifecycle: 'completed', completedAt: T0 as EpochMs };

    const r = await recomputeParentRollup(['lifecycle', 'completedAt'], y, after, deps);
    expect(r).toMatchObject({ applied: true });

    const refreshed = await ports.taskRepo.findById(parent.id);
    const rollup = refreshed?.subtaskRollup;
    expect(rollup?.totalEstimatedMinutes).toBe(90);
    // 2 of 3 done (x + y), 1 blocked
    expect(rollup?.blockedCount).toBe(1);
    expect(rollup?.completedFraction).toBeCloseTo(2 / 3);
  });
});
