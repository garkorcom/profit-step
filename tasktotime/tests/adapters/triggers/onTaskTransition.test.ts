/**
 * Tests for `onTaskTransition` trigger handler.
 *
 * Pins:
 *   - BigQuery audit row fires on every transition (action included in eventType).
 *   - Per-action notifications:
 *       start    → reviewer
 *       complete → reviewer
 *       accept   → assignee (with bonus/penalty summary)
 *       cancel   → assignee + reviewer
 *       create / ready / block / unblock → audit only, no telegram
 *   - Idempotency guard prevents replays.
 *   - Lookup failures don't crash the trigger; audit still fires.
 */

import { onTaskTransition } from '../../../adapters/triggers/onTaskTransition';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asCompanyId,
  asTaskId,
  asUserId,
} from '../../../domain/identifiers';
import type { TransitionLogEntry } from '../../../ports/repositories';
import type { Task, UserRef } from '../../../domain/Task';

const T0 = 1_700_000_000_000;
const ASSIGNEE: UserRef = { id: asUserId('user_assignee'), name: 'Alice' };
const REVIEWER: UserRef = { id: asUserId('user_reviewer'), name: 'Rev' };
const PM: UserRef = { id: asUserId('user_pm'), name: 'PM' };

function buildDeps() {
  const ports = makeAllPorts(T0);
  const deps = {
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
    telegram: ports.telegram,
    bigQueryAudit: ports.bigQueryAudit,
    clock: ports.clock,
  };
  return { ports, deps };
}

function makeTransition(over: Partial<TransitionLogEntry>): TransitionLogEntry {
  const taskId = (over.taskId as ReturnType<typeof asTaskId>) ?? asTaskId('task_t');
  const companyId = (over.companyId as ReturnType<typeof asCompanyId>) ?? asCompanyId('co_1');
  const at = over.at ?? T0;
  const action = over.action ?? 'start';
  const from = over.from ?? 'ready';
  const to = over.to ?? 'started';
  return {
    id: over.id ?? `${taskId}_${from ?? 'null'}_${to}_${at}`,
    companyId,
    taskId,
    from,
    to,
    action,
    by: over.by ?? PM,
    at,
    reason: over.reason,
    meta: over.meta,
  };
}

async function seedTask(
  ports: ReturnType<typeof makeAllPorts>,
  over: Partial<Task>,
): Promise<Task> {
  const task = makeTask({
    assignedTo: ASSIGNEE,
    reviewedBy: REVIEWER,
    ...over,
  });
  await ports.taskRepo.save(task);
  return task;
}

describe('onTaskTransition', () => {
  test('audits every transition with action-specific eventType', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, { id: asTaskId('task_audit_x') });
    const t = makeTransition({
      taskId: task.id,
      companyId: task.companyId,
      action: 'ready',
      from: 'draft',
      to: 'ready',
    });

    await onTaskTransition(
      { before: null, after: t, docId: t.id, eventId: 'evt_audit' },
      deps,
    );

    expect(ports.bigQueryAudit.events).toHaveLength(1);
    expect(ports.bigQueryAudit.events[0]).toMatchObject({
      eventType: 'task.transition.ready',
      taskId: task.id,
      payload: { from: 'draft', to: 'ready' },
    });
  });

  test('start notifies reviewer (not the actor)', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, { id: asTaskId('task_start') });

    await onTaskTransition(
      {
        before: null,
        after: makeTransition({
          taskId: task.id,
          companyId: task.companyId,
          action: 'start',
          from: 'ready',
          to: 'started',
          by: ASSIGNEE,
        }),
        docId: 'tr_start',
        eventId: 'evt_start',
      },
      deps,
    );

    expect(ports.telegram.calls).toHaveLength(1);
    expect(ports.telegram.calls[0].recipientUserId).toBe(REVIEWER.id);
    expect(ports.telegram.calls[0].text).toContain('Started');
  });

  test('complete notifies reviewer', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, { id: asTaskId('task_done') });

    await onTaskTransition(
      {
        before: null,
        after: makeTransition({
          taskId: task.id,
          companyId: task.companyId,
          action: 'complete',
          from: 'started',
          to: 'completed',
          by: ASSIGNEE,
        }),
        docId: 'tr_done',
        eventId: 'evt_done',
      },
      deps,
    );

    expect(ports.telegram.calls).toHaveLength(1);
    expect(ports.telegram.calls[0].recipientUserId).toBe(REVIEWER.id);
    expect(ports.telegram.calls[0].text).toContain('Completed');
  });

  test('accept notifies assignee with bonus/penalty summary', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, {
      id: asTaskId('task_accept'),
      bonusOnTime: { amount: 25, currency: 'USD' },
    });

    await onTaskTransition(
      {
        before: null,
        after: makeTransition({
          taskId: task.id,
          companyId: task.companyId,
          action: 'accept',
          from: 'completed',
          to: 'accepted',
          by: PM,
        }),
        docId: 'tr_accept',
        eventId: 'evt_accept',
      },
      deps,
    );

    expect(ports.telegram.calls).toHaveLength(1);
    expect(ports.telegram.calls[0].recipientUserId).toBe(ASSIGNEE.id);
    const text = ports.telegram.calls[0].text;
    expect(text).toContain('Accepted');
    expect(text).toContain('Bonus: 25.00 USD');
  });

  test('cancel notifies both assignee and reviewer', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, { id: asTaskId('task_cancel') });

    await onTaskTransition(
      {
        before: null,
        after: makeTransition({
          taskId: task.id,
          companyId: task.companyId,
          action: 'cancel',
          from: 'started',
          to: 'cancelled',
          by: PM,
          reason: 'client withdrew',
        }),
        docId: 'tr_cancel',
        eventId: 'evt_cancel',
      },
      deps,
    );

    expect(ports.telegram.calls).toHaveLength(2);
    const recipients = ports.telegram.calls.map((c) => c.recipientUserId);
    expect(recipients).toEqual(
      expect.arrayContaining([ASSIGNEE.id, REVIEWER.id]),
    );
    ports.telegram.calls.forEach((c) => {
      expect(c.text).toContain('Cancelled');
      expect(c.text).toContain('client withdrew');
    });
  });

  test('observer-only actions (create/ready/block/unblock) do not notify', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, { id: asTaskId('task_silent') });

    for (const action of ['create', 'ready', 'block', 'unblock'] as const) {
      ports.telegram.reset();
      await onTaskTransition(
        {
          before: null,
          after: makeTransition({
            taskId: task.id,
            companyId: task.companyId,
            action,
            id: `tr_${action}`,
          }),
          docId: `tr_${action}`,
          eventId: `evt_${action}`,
        },
        deps,
      );
      expect(ports.telegram.calls).toHaveLength(0);
    }
  });

  test('idempotency guard blocks the second fire', async () => {
    const { ports, deps } = buildDeps();
    const task = await seedTask(ports, { id: asTaskId('task_dup_t') });
    const change = {
      before: null,
      after: makeTransition({
        taskId: task.id,
        companyId: task.companyId,
        action: 'start',
        from: 'ready',
        to: 'started',
        by: ASSIGNEE,
      }),
      docId: 'tr_dup',
      eventId: 'evt_dup',
    };

    const a = await onTaskTransition(change, deps);
    const b = await onTaskTransition(change, deps);

    expect(a).toMatchObject({ applied: true });
    expect(b).toEqual({ skipped: 'idempotency' });
    expect(ports.bigQueryAudit.events).toHaveLength(1);
    expect(ports.telegram.calls).toHaveLength(1);
  });

  test('still audits when the task lookup fails', async () => {
    const { ports, deps } = buildDeps();
    // Task not seeded — findById returns null; audit still fires; no notify.
    await onTaskTransition(
      {
        before: null,
        after: makeTransition({
          taskId: asTaskId('task_missing'),
          companyId: asCompanyId('co_1'),
          action: 'start',
          from: 'ready',
          to: 'started',
        }),
        docId: 'tr_missing',
        eventId: 'evt_missing',
      },
      deps,
    );

    expect(ports.bigQueryAudit.events).toHaveLength(1);
    expect(ports.telegram.calls).toHaveLength(0);
  });
});
