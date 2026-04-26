/**
 * Tests for domain/autoShift.ts — cascade shift.
 */

import { cascadeShift } from '../../domain/autoShift';
import { graph } from '../../shared/test-helpers/buildDependencyGraph';
import { asTaskId } from '../../domain/identifiers';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const MINUTE_MS = 60_000;

describe('cascadeShift', () => {
  test('no shifts when trigger has no successors with autoShiftEnabled', () => {
    const tasks = graph('A->B, B->C', { durationMinutes: 60 });
    const shifts = cascadeShift(tasks, asTaskId('task_A'));
    expect(shifts).toEqual([]);
  });

  test('shifts successor when predecessor finishes later than planned', () => {
    const tasks = graph('A->B', {
      durationMinutes: 60,
      startTime: T0 as never,
      autoShiftEnabled: true,
    });
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    // A actually finishes 2 hours after planned -> B should shift
    a.completedAt = (T0 + 3 * HOUR) as never;

    const shifts = cascadeShift(tasks, asTaskId('task_A'));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.taskId).toBe(asTaskId('task_B'));
    expect(shifts[0]!.newPlannedStartAt).toBe(T0 + 3 * HOUR);
    expect(shifts[0]!.cascadeDepth).toBe(1);
  });

  test('cascades through chain A -> B -> C', () => {
    const tasks = graph('A->B, B->C', {
      durationMinutes: 60,
      startTime: T0 as never,
      autoShiftEnabled: true,
    });
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    a.completedAt = (T0 + 5 * HOUR) as never; // 4 hours late

    const shifts = cascadeShift(tasks, asTaskId('task_A'));
    expect(shifts).toHaveLength(2); // B and C both shift
    const shiftIds = shifts.map((s) => s.taskId);
    expect(shiftIds).toContain(asTaskId('task_B'));
    expect(shiftIds).toContain(asTaskId('task_C'));

    // Cascade depth: B = 1, C = 2
    const cShift = shifts.find((s) => s.taskId === asTaskId('task_C'))!;
    expect(cShift.cascadeDepth).toBe(2);
  });

  test('autoShiftEnabled=false on a task short-circuits the cascade for that task', () => {
    const tasks = graph('A->B, B->C', {
      durationMinutes: 60,
      startTime: T0 as never,
      autoShiftEnabled: true,
    });
    const b = tasks.find((t) => t.id === asTaskId('task_B'))!;
    b.autoShiftEnabled = false;
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    a.completedAt = (T0 + 5 * HOUR) as never;

    const shifts = cascadeShift(tasks, asTaskId('task_A'));
    // B is skipped (no shift entry); but C still re-evaluates against B's
    // (un-shifted) effective finish — which equals B's plannedStart + duration.
    // Since B did NOT shift, its effective finish remains as-planned.
    // C may still shift if A's late completion + zero lag pushes it. In this
    // model B's effective finish is (T0 + 60min) + 60min = T0 + 120min,
    // which is BEFORE A's actual completion influences C transitively.
    // We just assert B is NOT shifted (the documented behavior).
    expect(shifts.find((s) => s.taskId === asTaskId('task_B'))).toBeUndefined();
  });

  test('does not pull tasks earlier than originally planned', () => {
    const tasks = graph('A->B', {
      durationMinutes: 60,
      startTime: T0 as never,
      autoShiftEnabled: true,
    });
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    // A finishes EARLIER than planned. B should not be pulled in.
    a.completedAt = (T0 - 30 * MINUTE_MS) as never;

    const shifts = cascadeShift(tasks, asTaskId('task_A'));
    expect(shifts).toEqual([]);
  });

  test('respects lagMinutes', () => {
    const tasks = graph('A->B', {
      durationMinutes: 60,
      startTime: T0 as never,
      autoShiftEnabled: true,
    });
    const b = tasks.find((t) => t.id === asTaskId('task_B'))!;
    b.dependsOn = [
      {
        taskId: asTaskId('task_A'),
        type: 'finish_to_start',
        lagMinutes: 30, // require 30min buffer after A completes
        isHardBlock: true,
        createdAt: T0,
        createdBy: { id: 'u', name: 'u' } as never,
      },
    ];

    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    a.completedAt = (T0 + 2 * HOUR) as never;

    const shifts = cascadeShift(tasks, asTaskId('task_A'));
    expect(shifts).toHaveLength(1);
    // Expected: A done at T0+2h, +30min lag = T0+2h30m
    expect(shifts[0]!.newPlannedStartAt).toBe(T0 + 2 * HOUR + 30 * MINUTE_MS);
  });
});
