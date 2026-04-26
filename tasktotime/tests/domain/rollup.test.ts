/**
 * Tests for domain/rollup.ts — pure subtask rollup math.
 */

import { computeSubtaskRollup, allSubtasksDone } from '../../domain/rollup';
import { parentWithFiveSubtasks } from '../../shared/fixtures/subtasks.fixture';
import { makeTask } from '../../shared/test-helpers/makeTask';
import { asTaskId } from '../../domain/identifiers';

describe('computeSubtaskRollup', () => {
  test('empty subtask list yields zero counters', () => {
    const r = computeSubtaskRollup([]);
    expect(r.totalCostInternal).toBe(0);
    expect(r.totalPriceClient).toBe(0);
    expect(r.totalEstimatedMinutes).toBe(0);
    expect(r.totalActualMinutes).toBe(0);
    expect(r.completedFraction).toBe(0);
    expect(r.blockedCount).toBe(0);
    expect(r.earliestDueAt).toBeUndefined();
    expect(r.latestCompletedAt).toBeUndefined();
  });

  test('5-subtask fixture produces expected aggregate', () => {
    const { subtasks } = parentWithFiveSubtasks();
    const r = computeSubtaskRollup(subtasks);

    // Sum of costInternal: 100 + 300 + 200 + 250 + 150 = 1000
    expect(r.totalCostInternal).toBe(1000);
    // Sum of priceClient: 250 + 700 + 500 + 600 + 450 = 2500
    expect(r.totalPriceClient).toBe(2500);

    // Estimated: 240 + 480 + 360 + 480 + 240 = 1800
    expect(r.totalEstimatedMinutes).toBe(1800);
    // Actual: 220 + 510 + 380 + 200 + 0 (blocked has no actual) = 1310
    expect(r.totalActualMinutes).toBe(1310);

    // 2 accepted + 1 completed = 3 done; 5 active total (none cancelled)
    expect(r.completedFraction).toBeCloseTo(3 / 5);

    expect(r.blockedCount).toBe(1);

    // Lifecycle counts
    expect(r.countByLifecycle.accepted).toBe(2);
    expect(r.countByLifecycle.completed).toBe(1);
    expect(r.countByLifecycle.started).toBe(1);
    expect(r.countByLifecycle.blocked).toBe(1);
  });

  test('cancelled subtasks excluded from completedFraction denominator', () => {
    const subtasks = [
      makeTask({ id: asTaskId('s1'), lifecycle: 'completed' }),
      makeTask({ id: asTaskId('s2'), lifecycle: 'cancelled' }),
      makeTask({ id: asTaskId('s3'), lifecycle: 'cancelled' }),
    ];
    const r = computeSubtaskRollup(subtasks);
    // 1 completed / 1 active = 1.0 (cancelled excluded)
    expect(r.completedFraction).toBe(1);
  });

  test('all-cancelled subtasks yield zero completedFraction (no division by zero)', () => {
    const subtasks = [
      makeTask({ id: asTaskId('s1'), lifecycle: 'cancelled' }),
      makeTask({ id: asTaskId('s2'), lifecycle: 'cancelled' }),
    ];
    const r = computeSubtaskRollup(subtasks);
    expect(r.completedFraction).toBe(0);
  });

  test('earliestDueAt is min over subtasks', () => {
    const subtasks = [
      makeTask({ id: asTaskId('s1'), dueAt: 1000 as never }),
      makeTask({ id: asTaskId('s2'), dueAt: 2000 as never }),
      makeTask({ id: asTaskId('s3'), dueAt: 500 as never }),
    ];
    const r = computeSubtaskRollup(subtasks);
    expect(r.earliestDueAt).toBe(500);
  });

  test('latestCompletedAt is max over subtasks', () => {
    const subtasks = [
      makeTask({
        id: asTaskId('s1'),
        lifecycle: 'completed',
        completedAt: 1000 as never,
      }),
      makeTask({
        id: asTaskId('s2'),
        lifecycle: 'completed',
        completedAt: 3000 as never,
      }),
      makeTask({ id: asTaskId('s3'), lifecycle: 'started' }),
    ];
    const r = computeSubtaskRollup(subtasks);
    expect(r.latestCompletedAt).toBe(3000);
  });

  test('all-blocked subtasks: blockedCount equals total, completedFraction is 0', () => {
    const subtasks = [
      makeTask({ id: asTaskId('s1'), lifecycle: 'blocked' }),
      makeTask({ id: asTaskId('s2'), lifecycle: 'blocked' }),
    ];
    const r = computeSubtaskRollup(subtasks);
    expect(r.blockedCount).toBe(2);
    expect(r.completedFraction).toBe(0);
  });
});

describe('allSubtasksDone', () => {
  test('false when no subtasks', () => {
    expect(allSubtasksDone([])).toBe(false);
  });

  test('true when every non-cancelled subtask is completed/accepted', () => {
    const subs = [
      makeTask({ id: asTaskId('s1'), lifecycle: 'completed' }),
      makeTask({ id: asTaskId('s2'), lifecycle: 'accepted' }),
      makeTask({ id: asTaskId('s3'), lifecycle: 'cancelled' }),
    ];
    expect(allSubtasksDone(subs)).toBe(true);
  });

  test('false when at least one is still active', () => {
    const subs = [
      makeTask({ id: asTaskId('s1'), lifecycle: 'completed' }),
      makeTask({ id: asTaskId('s2'), lifecycle: 'started' }),
    ];
    expect(allSubtasksDone(subs)).toBe(false);
  });
});
