/**
 * Tests for `onTaskCreate` trigger handler.
 *
 * Black-box tests against the in-memory port stubs in `shared/mocks`. The
 * goal is to pin the side-effect contract:
 *   - Initial transition entry written.
 *   - Telegram notification fired for assignee (and reviewer if distinct).
 *   - Parent `subtaskIds[]` back-fill happens when `parentTaskId` is set.
 *   - Idempotency guard skips double-fires.
 *   - BigQuery audit row emitted.
 */

import { onTaskCreate } from '../../../adapters/triggers/onTaskCreate';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asCompanyId,
  asTaskId,
  asUserId,
  type TaskId,
} from '../../../domain/identifiers';
import type { Task } from '../../../domain/Task';

const T0 = 1_700_000_000_000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  const deps = {
    taskRepo: ports.taskRepo,
    transitionLog: ports.transitionLog,
    idempotency: ports.idempotency,
    telegram: ports.telegram,
    bigQueryAudit: ports.bigQueryAudit,
    clock: ports.clock,
  };
  return { ports, deps };
}

function makeChange(after: Task, eventId = 'evt_1') {
  return { before: null, after, docId: after.id as string, eventId };
}

describe('onTaskCreate', () => {
  test('appends initial transition log entry on create', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({
      id: asTaskId('task_create_log'),
      companyId: asCompanyId('co_1'),
      lifecycle: 'draft',
    });

    const result = await onTaskCreate(makeChange(task), deps);

    expect(result).toEqual({
      applied: true,
      effects: expect.arrayContaining(['transitionLog.append(create)']),
    });
    const entries = await ports.transitionLog.findForTask(task.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      from: null,
      to: 'draft',
      action: 'create',
      taskId: task.id,
      companyId: task.companyId,
    });
  });

  test('notifies assignee via Telegram', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({
      id: asTaskId('task_notify'),
      assignedTo: { id: asUserId('user_assignee'), name: 'Assignee' },
    });

    await onTaskCreate(makeChange(task), deps);

    expect(ports.telegram.calls).toHaveLength(1);
    expect(ports.telegram.calls[0]).toMatchObject({
      recipientUserId: asUserId('user_assignee'),
      taskId: task.id,
    });
    expect(ports.telegram.calls[0].text).toContain('assigned to you');
  });

  test('notifies reviewer in addition to assignee when distinct', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({
      id: asTaskId('task_reviewer'),
      assignedTo: { id: asUserId('user_a'), name: 'A' },
      reviewedBy: { id: asUserId('user_r'), name: 'Reviewer' },
    });

    await onTaskCreate(makeChange(task), deps);

    expect(ports.telegram.calls).toHaveLength(2);
    const recipients = ports.telegram.calls.map((c) => c.recipientUserId);
    expect(recipients).toContain(asUserId('user_a'));
    expect(recipients).toContain(asUserId('user_r'));
    const reviewerCall = ports.telegram.calls.find(
      (c) => c.recipientUserId === asUserId('user_r'),
    );
    expect(reviewerCall?.text).toContain('your review');
  });

  test('does not double-notify when assignee === reviewer', async () => {
    const { ports, deps } = buildDeps();
    const same = { id: asUserId('user_solo'), name: 'Solo' };
    const task = makeTask({
      id: asTaskId('task_self_review'),
      assignedTo: same,
      reviewedBy: same,
    });

    await onTaskCreate(makeChange(task), deps);

    expect(ports.telegram.calls).toHaveLength(1);
  });

  test('idempotency guard blocks the second fire of the same event', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({ id: asTaskId('task_dedup') });
    const change = makeChange(task, 'evt_dedup');

    const first = await onTaskCreate(change, deps);
    const second = await onTaskCreate(change, deps);

    expect(first).toMatchObject({ applied: true });
    expect(second).toEqual({ skipped: 'idempotency' });
    // Side effects only fired once.
    const entries = await ports.transitionLog.findForTask(task.id);
    expect(entries).toHaveLength(1);
    expect(ports.telegram.calls).toHaveLength(1);
    expect(ports.bigQueryAudit.events).toHaveLength(1);
  });

  test('attaches new task id to parent.subtaskIds when parentTaskId set', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('task_parent'),
      companyId: asCompanyId('co_1'),
      subtaskIds: [],
    });
    await ports.taskRepo.save(parent);

    const child = makeTask({
      id: asTaskId('task_child'),
      companyId: asCompanyId('co_1'),
      parentTaskId: parent.id,
      isSubtask: false,
    });
    await ports.taskRepo.save(child);

    await onTaskCreate(makeChange(child, 'evt_attach'), deps);

    const refreshedParent = await ports.taskRepo.findById(parent.id);
    expect(refreshedParent?.subtaskIds).toContain(child.id);

    const refreshedChild = await ports.taskRepo.findById(child.id);
    expect(refreshedChild?.isSubtask).toBe(true);
  });

  test('attach is race-safe: two children created in parallel both end up in parent.subtaskIds', async () => {
    // Regression for the safeAttachToParent race. Pre-fix the trigger did
    // `[...parent.subtaskIds, child.id]` outside a transaction, so two
    // concurrent invocations could each read the parent before either had
    // written, dropping one of the two child ids. After the fix the patch
    // uses `appendToArray` (FieldValue.arrayUnion) — atomic + idempotent —
    // so both ids land regardless of interleaving.
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('task_parent_race'),
      companyId: asCompanyId('co_1'),
      subtaskIds: [],
    });
    await ports.taskRepo.save(parent);

    const childA = makeTask({
      id: asTaskId('task_child_a'),
      companyId: asCompanyId('co_1'),
      parentTaskId: parent.id,
    });
    const childB = makeTask({
      id: asTaskId('task_child_b'),
      companyId: asCompanyId('co_1'),
      parentTaskId: parent.id,
    });
    await ports.taskRepo.save(childA);
    await ports.taskRepo.save(childB);

    await Promise.all([
      onTaskCreate(makeChange(childA, 'evt_a'), deps),
      onTaskCreate(makeChange(childB, 'evt_b'), deps),
    ]);

    const refreshedParent = await ports.taskRepo.findById(parent.id);
    expect(refreshedParent?.subtaskIds).toEqual(
      expect.arrayContaining([childA.id, childB.id]),
    );
    expect(refreshedParent?.subtaskIds).toHaveLength(2);
  });

  test('attach is idempotent on retry: same child id is not duplicated in parent.subtaskIds', async () => {
    // Pre-fix: a retried fire that lost its idempotency reservation could
    // re-append the child id and produce a duplicate. arrayUnion semantics
    // dedup-on-set, so even with a forced second invocation under a fresh
    // event id (bypassing the dedupe table) the parent's subtaskIds stays
    // a set.
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('task_parent_retry'),
      companyId: asCompanyId('co_1'),
      subtaskIds: [],
    });
    await ports.taskRepo.save(parent);

    const child = makeTask({
      id: asTaskId('task_child_retry'),
      companyId: asCompanyId('co_1'),
      parentTaskId: parent.id,
    });
    await ports.taskRepo.save(child);

    // Two distinct event ids — both pass the idempotency guard, both attempt
    // to attach. The append must remain a set, no duplicates.
    await onTaskCreate(makeChange(child, 'evt_retry_1'), deps);
    await onTaskCreate(makeChange(child, 'evt_retry_2'), deps);

    const refreshedParent = await ports.taskRepo.findById(parent.id);
    expect(refreshedParent?.subtaskIds).toEqual([child.id]);
  });

  test('refuses to back-fill cross-tenant parent', async () => {
    const { ports, deps } = buildDeps();
    const parent = makeTask({
      id: asTaskId('task_xtenant_parent'),
      companyId: asCompanyId('co_other'),
      subtaskIds: [],
    });
    await ports.taskRepo.save(parent);

    const child = makeTask({
      id: asTaskId('task_xtenant_child'),
      companyId: asCompanyId('co_self'),
      parentTaskId: parent.id,
    });
    await ports.taskRepo.save(child);

    await onTaskCreate(makeChange(child, 'evt_xtenant'), deps);

    const refreshedParent = await ports.taskRepo.findById(parent.id);
    expect(refreshedParent?.subtaskIds).toEqual([]);
  });

  test('logs an event row to BigQuery audit', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({
      id: asTaskId('task_audit'),
      companyId: asCompanyId('co_audit'),
      lifecycle: 'ready',
      bucket: 'inbox',
      source: 'voice',
    });

    await onTaskCreate(makeChange(task, 'evt_audit'), deps);

    expect(ports.bigQueryAudit.events).toHaveLength(1);
    const event = ports.bigQueryAudit.events[0];
    expect(event).toMatchObject({
      eventType: 'task.created',
      companyId: task.companyId,
      taskId: task.id,
      payload: {
        lifecycle: 'ready',
        bucket: 'inbox',
        source: 'voice',
        hasParent: false,
      },
    });
  });

  test('returns skip when after is null (defensive guard)', async () => {
    const { deps } = buildDeps();
    const result = await onTaskCreate(
      { before: null, after: null, docId: 'task_x', eventId: 'evt_x' },
      deps,
    );
    expect(result).toEqual({ skipped: 'no_after_data' });
  });
});
