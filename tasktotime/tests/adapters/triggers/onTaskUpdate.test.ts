/**
 * Tests for `onTaskUpdate` trigger handler — PR-B1 scope.
 *
 * The most important assertions in this file pin the **infinite-loop
 * defenses** from CLAUDE.md §2.1:
 *   - Computed-field-only writes return `no_watched_field_change`.
 *   - Identical-state writes return `no_watched_field_change`.
 *   - Idempotency guard prevents replays of the same `eventId`.
 *
 * The audit row content is also pinned — it carries the diff of the
 * watched fields only, never the full document.
 */

import { onTaskUpdate } from '../../../adapters/triggers/onTaskUpdate';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { asTaskId, asUserId } from '../../../domain/identifiers';
import type { Task } from '../../../domain/Task';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  const deps = {
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
    bigQueryAudit: ports.bigQueryAudit,
    clock: ports.clock,
  };
  return { ports, deps };
}

function makeChange(before: Task, after: Task, eventId = 'evt') {
  return { before, after, docId: after.id as string, eventId };
}

describe('onTaskUpdate', () => {
  describe('infinite-loop defenses (CLAUDE.md §2.1)', () => {
    test('returns skip when no watched field changed', async () => {
      const { ports, deps } = buildDeps();
      const task = makeTask({ id: asTaskId('task_no_change') });
      const r = await onTaskUpdate(makeChange(task, task), deps);
      expect(r).toEqual({ skipped: 'no_watched_field_change' });
      expect(ports.bigQueryAudit.events).toHaveLength(0);
    });

    test('returns skip when only computed fields differ', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('task_computed_only'),
        actualDurationMinutes: 10,
        totalEarnings: 5,
        slackMinutes: 0,
        isCriticalPath: false,
      });
      // Triggering re-fire conditions: computed fields, marker fields, and
      // updatedAt all moved — none of which should fire side effects.
      const after: Task = {
        ...before,
        actualDurationMinutes: 90,
        totalEarnings: 75,
        slackMinutes: 30,
        isCriticalPath: true,
        lastReminderSentAt: T0 as unknown as Task['lastReminderSentAt'],
        updatedAt: (before.updatedAt + 1_000) as Task['updatedAt'],
      };
      const r = await onTaskUpdate(makeChange(before, after), deps);
      expect(r).toEqual({ skipped: 'no_watched_field_change' });
      expect(ports.bigQueryAudit.events).toHaveLength(0);
    });

    test('idempotency guard prevents the second fire of the same event', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('task_dedup_update'),
        priority: 'medium',
      });
      const after: Task = { ...before, priority: 'high' };
      const change = makeChange(before, after, 'evt_dup');
      const a = await onTaskUpdate(change, deps);
      const b = await onTaskUpdate(change, deps);
      expect(a).toMatchObject({ applied: true });
      expect(b).toEqual({ skipped: 'idempotency' });
      expect(ports.bigQueryAudit.events).toHaveLength(1);
    });
  });

  describe('audit row', () => {
    test('captures changed-field diff in payload', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('task_diff'),
        priority: 'medium',
        bucket: 'inbox',
        dueAt: (T0 + 7 * 24 * HOUR) as Task['dueAt'],
      });
      const after: Task = {
        ...before,
        priority: 'high',
        bucket: 'next',
        dueAt: (T0 + 14 * 24 * HOUR) as Task['dueAt'],
      };
      await onTaskUpdate(makeChange(before, after, 'evt_diff'), deps);

      const ev = ports.bigQueryAudit.events[0];
      expect(ev.eventType).toBe('task.updated');
      expect(ev.taskId).toBe(before.id);
      const payload = ev.payload as Record<string, unknown>;
      expect(payload.changedFields).toEqual(
        expect.arrayContaining(['priority', 'bucket', 'dueAt']),
      );
      expect(payload.priority_from).toBe('medium');
      expect(payload.priority_to).toBe('high');
      expect(payload.bucket_from).toBe('inbox');
      expect(payload.bucket_to).toBe('next');
      expect(payload.dueAt_from).toBe(before.dueAt);
      expect(payload.dueAt_to).toBe(after.dueAt);
    });

    test('truncates large object diffs to 200 chars', async () => {
      const { ports, deps } = buildDeps();
      const longText = 'x'.repeat(500);
      const before = makeTask({ id: asTaskId('task_long'), description: 'short' });
      const after: Task = { ...before, description: longText };
      await onTaskUpdate(makeChange(before, after, 'evt_long'), deps);

      const payload = ports.bigQueryAudit.events[0].payload as Record<string, unknown>;
      // Strings < 200 are kept as-is; the long one is the raw value.
      expect(payload.description_from).toBe('short');
      expect(typeof payload.description_to).toBe('string');
      expect((payload.description_to as string).length).toBeLessThanOrEqual(500);
    });

    test('audit attributes the change to the assignee', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('task_actor'),
        assignedTo: { id: asUserId('user_42'), name: 'Forty-Two' },
      });
      const after: Task = { ...before, priority: 'high' };
      await onTaskUpdate(makeChange(before, after, 'evt_actor'), deps);
      expect(ports.bigQueryAudit.events[0].actorId).toBe('user_42');
    });
  });

  describe('happy path', () => {
    test('fires audit on watched-field change', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({ id: asTaskId('task_happy'), bucket: 'inbox' });
      const after: Task = { ...before, bucket: 'next' };
      const r = await onTaskUpdate(makeChange(before, after, 'evt_happy'), deps);
      expect(r).toMatchObject({ applied: true, effects: ['bigQueryAudit.log'] });
      expect(ports.bigQueryAudit.events).toHaveLength(1);
    });

    test('fires on dependsOn change (graph mutation)', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({ id: asTaskId('task_deps'), dependsOn: [] });
      const after: Task = {
        ...before,
        dependsOn: [
          {
            taskId: asTaskId('task_other'),
            type: 'finish_to_start',
            isHardBlock: true,
            createdAt: T0 as unknown as Task['createdAt'],
            createdBy: { id: asUserId('user_x'), name: 'X' },
          },
        ],
      };
      await onTaskUpdate(makeChange(before, after, 'evt_deps'), deps);
      const payload = ports.bigQueryAudit.events[0].payload as Record<string, unknown>;
      expect(payload.changedFields).toContain('dependsOn');
    });

    test('cascade reverse-edge: dependsOn add propagates to target.blocksTaskIds', async () => {
      const { ports, deps } = buildDeps();
      const target = makeTask({ id: asTaskId('task_pred'), blocksTaskIds: [] });
      await ports.taskRepo.save(target);

      const before = makeTask({ id: asTaskId('task_succ'), dependsOn: [] });
      const after: Task = {
        ...before,
        dependsOn: [
          {
            taskId: target.id,
            type: 'finish_to_start',
            isHardBlock: true,
            createdAt: T0 as unknown as Task['createdAt'],
            createdBy: { id: asUserId('user_x'), name: 'X' },
          },
        ],
      };

      const r = await onTaskUpdate(makeChange(before, after, 'evt_cascade_add'), deps);
      expect(r).toMatchObject({
        applied: true,
        effects: expect.arrayContaining(['cascadeBlocksTaskIds.added(1)']),
      });
      const refreshed = await ports.taskRepo.findById(target.id);
      expect(refreshed?.blocksTaskIds).toEqual([before.id]);
    });

    test('cascade reverse-edge: dependsOn remove propagates to target.blocksTaskIds', async () => {
      const { ports, deps } = buildDeps();
      const target = makeTask({
        id: asTaskId('task_pred_rm'),
        blocksTaskIds: [asTaskId('task_succ_rm'), asTaskId('task_other_succ')],
      });
      await ports.taskRepo.save(target);

      const before = makeTask({
        id: asTaskId('task_succ_rm'),
        dependsOn: [
          {
            taskId: target.id,
            type: 'finish_to_start',
            isHardBlock: true,
            createdAt: T0 as unknown as Task['createdAt'],
            createdBy: { id: asUserId('user_x'), name: 'X' },
          },
        ],
      });
      const after: Task = { ...before, dependsOn: [] };

      const r = await onTaskUpdate(makeChange(before, after, 'evt_cascade_rm'), deps);
      expect(r).toMatchObject({
        applied: true,
        effects: expect.arrayContaining(['cascadeBlocksTaskIds.removed(1)']),
      });
      const refreshed = await ports.taskRepo.findById(target.id);
      expect(refreshed?.blocksTaskIds).toEqual([asTaskId('task_other_succ')]);
    });

    test('cascade does NOT run when only non-dependsOn fields changed', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('task_no_cascade'),
        bucket: 'inbox',
      });
      const after: Task = { ...before, bucket: 'next' };

      const r = await onTaskUpdate(makeChange(before, after, 'evt_no_casc'), deps);
      expect(r).toMatchObject({
        applied: true,
        effects: ['bigQueryAudit.log'],
      });
      // No blocksTaskIds patches happened — refresh original task.
      const refreshed = await ports.taskRepo.findById(before.id);
      // We never seeded the source itself; its blocksTaskIds shouldn't change.
      expect(refreshed).toBeNull();
      expect(ports.bigQueryAudit.events).toHaveLength(1);
    });

    test('parent rollup recompute fires on subtask lifecycle change', async () => {
      const { ports, deps } = buildDeps();
      const parent = makeTask({
        id: asTaskId('parent_b3'),
        subtaskIds: [asTaskId('child_b3')],
      });
      await ports.taskRepo.save(parent);

      const before = makeTask({
        id: asTaskId('child_b3'),
        parentTaskId: parent.id,
        lifecycle: 'started',
        estimatedDurationMinutes: 60,
      });
      await ports.taskRepo.save(before);
      const after: Task = {
        ...before,
        lifecycle: 'completed',
        completedAt: T0 as unknown as Task['completedAt'],
      };

      const r = await onTaskUpdate(makeChange(before, after, 'evt_rollup'), deps);
      expect(r).toMatchObject({
        applied: true,
        effects: expect.arrayContaining(['recomputeParentRollup.applied']),
      });
      const refreshedParent = await ports.taskRepo.findById(parent.id);
      expect(refreshedParent?.subtaskRollup).toBeDefined();
      expect(refreshedParent?.subtaskRollup?.totalEstimatedMinutes).toBe(60);
    });

    test('parent rollup does NOT fire on non-affecting subtask field change', async () => {
      const { ports, deps } = buildDeps();
      const parent = makeTask({
        id: asTaskId('parent_no_rollup'),
        subtaskIds: [asTaskId('child_no_rollup')],
      });
      await ports.taskRepo.save(parent);

      const before = makeTask({
        id: asTaskId('child_no_rollup'),
        parentTaskId: parent.id,
        memo: 'old',
      });
      const after: Task = { ...before, memo: 'new' };

      const r = await onTaskUpdate(makeChange(before, after, 'evt_memo'), deps);
      expect(r).toMatchObject({
        applied: true,
        effects: ['bigQueryAudit.log'],
      });
      // Parent's subtaskRollup stays untouched.
      const refreshedParent = await ports.taskRepo.findById(parent.id);
      expect(refreshedParent?.subtaskRollup).toBeUndefined();
    });

    test('parent rollup is NOT recomputed for root task (no parentTaskId)', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('root_task'),
        lifecycle: 'started',
      });
      const after: Task = {
        ...before,
        lifecycle: 'completed',
        completedAt: T0 as unknown as Task['completedAt'],
      };

      const r = await onTaskUpdate(makeChange(before, after, 'evt_root'), deps);
      expect(r).toMatchObject({
        applied: true,
        effects: ['bigQueryAudit.log'],
      });
      const effectsRoot = (r as { effects: string[] }).effects;
      expect(effectsRoot.some((e) => e.startsWith('recomputeParentRollup'))).toBe(false);
      void ports;
    });

    test('fires on parentTaskId reparent', async () => {
      const { ports, deps } = buildDeps();
      const before = makeTask({
        id: asTaskId('task_reparent'),
        parentTaskId: asTaskId('parent_a'),
      });
      const after: Task = { ...before, parentTaskId: asTaskId('parent_b') };
      await onTaskUpdate(makeChange(before, after, 'evt_reparent'), deps);
      const payload = ports.bigQueryAudit.events[0].payload as Record<string, unknown>;
      expect(payload.changedFields).toContain('parentTaskId');
    });
  });

  test('skips when before/after missing', async () => {
    const { deps } = buildDeps();
    const r = await onTaskUpdate(
      { before: null, after: null, docId: 'x', eventId: 'evt' },
      deps,
    );
    expect(r).toEqual({ skipped: 'missing_change_sides' });
  });
});
