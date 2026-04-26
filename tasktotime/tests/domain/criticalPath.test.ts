/**
 * Tests for domain/criticalPath.ts — CPM forward + backward pass.
 */

import { computeSchedule, applyScheduleToTask } from '../../domain/criticalPath';
import { graph } from '../../shared/test-helpers/buildDependencyGraph';
import { asTaskId } from '../../domain/identifiers';

describe('computeSchedule - linear chain', () => {
  test('A -> B -> C: project duration = sum of durations; all on critical path', () => {
    const tasks = graph('A->B, B->C', { durationMinutes: 60 });
    const schedule = computeSchedule(tasks);
    expect(schedule).not.toBeNull();
    if (!schedule) return;

    expect(schedule.projectDurationMinutes).toBe(180); // 60 * 3
    expect(schedule.criticalPath).toHaveLength(3);

    const a = schedule.byTaskId.get(asTaskId('task_A'))!;
    expect(a.earliestStart).toBe(0);
    expect(a.earliestFinish).toBe(60);
    expect(a.slack).toBe(0);
    expect(a.onCriticalPath).toBe(true);

    const c = schedule.byTaskId.get(asTaskId('task_C'))!;
    expect(c.earliestStart).toBe(120);
    expect(c.earliestFinish).toBe(180);
    expect(c.slack).toBe(0);
  });
});

describe('computeSchedule - diamond shape', () => {
  test('parallel branches: shorter branch has slack', () => {
    // A -> B -> D
    // A -> C -> D, where C is faster
    const tasks = graph('A->B, A->C, B->D, C->D', { durationMinutes: 60 });
    // Make C only 30 minutes (shorter parallel branch)
    const c = tasks.find((t) => t.id === asTaskId('task_C'))!;
    c.estimatedDurationMinutes = 30;

    const schedule = computeSchedule(tasks);
    expect(schedule).not.toBeNull();
    if (!schedule) return;

    // B is the longer branch — on critical path. C has slack.
    const b = schedule.byTaskId.get(asTaskId('task_B'))!;
    const cs = schedule.byTaskId.get(asTaskId('task_C'))!;

    expect(b.onCriticalPath).toBe(true);
    expect(cs.onCriticalPath).toBe(false);
    expect(cs.slack).toBeGreaterThan(0);
  });
});

describe('computeSchedule - 5-task graph from blueprint', () => {
  test('correct critical path identification', () => {
    // A(60) -> B(120) -> D(60); A(60) -> C(60) -> D(60); D -> E(30)
    const tasks = graph('A->B, A->C, B->D, C->D, D->E', { durationMinutes: 60 });
    const b = tasks.find((t) => t.id === asTaskId('task_B'))!;
    b.estimatedDurationMinutes = 120;
    const e = tasks.find((t) => t.id === asTaskId('task_E'))!;
    e.estimatedDurationMinutes = 30;

    const schedule = computeSchedule(tasks);
    expect(schedule).not.toBeNull();
    if (!schedule) return;

    // Critical path: A -> B -> D -> E (longest)
    expect(schedule.criticalPath).toEqual([
      asTaskId('task_A'),
      asTaskId('task_B'),
      asTaskId('task_D'),
      asTaskId('task_E'),
    ]);
    expect(schedule.projectDurationMinutes).toBe(60 + 120 + 60 + 30);
  });
});

describe('computeSchedule - cycle detection', () => {
  test('returns null when graph has a cycle', () => {
    const tasks = graph('A->B');
    // Inject back-edge A.dependsOn += B
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
    expect(computeSchedule(tasks)).toBeNull();
  });
});

describe('applyScheduleToTask', () => {
  test('converts relative-minutes schedule to absolute timestamps', () => {
    const tasks = graph('A->B', { durationMinutes: 60 });
    const schedule = computeSchedule(tasks);
    expect(schedule).not.toBeNull();
    if (!schedule) return;

    const projectStart = 1_700_000_000_000;
    const aTask = tasks.find((t) => t.id === asTaskId('task_A'))!;
    const aEntry = schedule.byTaskId.get(asTaskId('task_A'))!;
    const updated = applyScheduleToTask(aTask, aEntry, projectStart as never);
    expect(updated.plannedStartAt).toBe(projectStart);
    expect(updated.slackMinutes).toBe(0);
    expect(updated.isCriticalPath).toBe(true);
  });
});
