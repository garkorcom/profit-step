/**
 * Tests for `onWorkSessionCompleted` trigger handler.
 *
 * Pins the side-effect contract:
 *   - Triggers only on the `_ → completed` transition.
 *   - Idempotency guard skips replays.
 *   - Patches the task's `actualDurationMinutes` and `totalEarnings`
 *     from the full session history (idempotent recompute).
 *   - Sets `actualStartAt` only when missing.
 *   - Skips silently when the related task is missing or unknown.
 */

import {
  onWorkSessionCompleted,
  type SessionDoc,
} from '../../../adapters/triggers/onWorkSessionCompleted';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { asTaskId, asUserId } from '../../../domain/identifiers';

const T0 = 1_700_000_000_000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  const deps = {
    taskRepo: ports.taskRepo,
    workSession: ports.workSessions,
    idempotency: ports.idempotency,
    bigQueryAudit: ports.bigQueryAudit,
    clock: ports.clock,
  };
  return { ports, deps };
}

function makeChange(
  before: SessionDoc | null,
  after: SessionDoc | null,
  eventId = 'evt_1',
) {
  return {
    before,
    after,
    docId: (after ?? before)?.id ?? 'session_x',
    eventId,
  };
}

describe('onWorkSessionCompleted', () => {
  test('aggregates and patches actuals on first completion', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({
      id: asTaskId('task_actuals'),
      actualDurationMinutes: 0,
      totalEarnings: 0,
    });
    await ports.taskRepo.save(task);
    ports.workSessions.setAggregate(task.id, {
      totalDurationMinutes: 90,
      totalEarnings: 75,
      earliestStartAt: T0,
      latestEndAt: T0 + 90 * 60_000,
    });

    const session: SessionDoc = {
      id: 'session_001',
      relatedTaskId: task.id as string,
      employeeId: asUserId('user_w'),
      status: 'completed',
      durationMinutes: 90,
      startTime: T0,
      endTime: T0 + 90 * 60_000,
    };
    const before: SessionDoc = { ...session, status: 'active' };

    const result = await onWorkSessionCompleted(makeChange(before, session), deps);

    expect(result).toMatchObject({ applied: true });
    const refreshed = await ports.taskRepo.findById(task.id);
    expect(refreshed?.actualDurationMinutes).toBe(90);
    expect(refreshed?.totalEarnings).toBe(75);
    expect(refreshed?.actualStartAt).toBe(T0);
  });

  test('does not overwrite an existing actualStartAt', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({
      id: asTaskId('task_existing_start'),
      actualStartAt: T0 - 10_000,
    });
    await ports.taskRepo.save(task);
    ports.workSessions.setAggregate(task.id, {
      totalDurationMinutes: 60,
      totalEarnings: 50,
      earliestStartAt: T0,
      latestEndAt: T0 + 60 * 60_000,
    });

    await onWorkSessionCompleted(
      makeChange(
        { id: 'session_b', relatedTaskId: task.id as string, status: 'active' },
        { id: 'session_b', relatedTaskId: task.id as string, status: 'completed' },
      ),
      deps,
    );

    const refreshed = await ports.taskRepo.findById(task.id);
    expect(refreshed?.actualStartAt).toBe(T0 - 10_000);
  });

  test('skips when transition is not into completed', async () => {
    const { deps } = buildDeps();
    const r1 = await onWorkSessionCompleted(
      makeChange(
        { id: 's', status: 'completed' },
        { id: 's', status: 'completed' },
      ),
      deps,
    );
    const r2 = await onWorkSessionCompleted(
      makeChange(
        { id: 's', status: 'active' },
        { id: 's', status: 'paused' },
      ),
      deps,
    );
    expect(r1).toEqual({ skipped: 'not_a_completion_transition' });
    expect(r2).toEqual({ skipped: 'not_a_completion_transition' });
  });

  test('skips when no relatedTaskId', async () => {
    const { deps } = buildDeps();
    const r = await onWorkSessionCompleted(
      makeChange(
        { id: 's', status: 'active' },
        { id: 's', status: 'completed' },
      ),
      deps,
    );
    expect(r).toEqual({ skipped: 'no_related_task' });
  });

  test('skips quietly when related task is missing', async () => {
    const { deps } = buildDeps();
    const r = await onWorkSessionCompleted(
      makeChange(
        {
          id: 's_orphan',
          relatedTaskId: 'task_orphan',
          status: 'active',
        },
        {
          id: 's_orphan',
          relatedTaskId: 'task_orphan',
          status: 'completed',
        },
      ),
      deps,
    );
    expect(r).toEqual({ skipped: 'task_not_found' });
  });

  test('idempotency guard prevents double-aggregation', async () => {
    const { ports, deps } = buildDeps();
    const task = makeTask({ id: asTaskId('task_dedup_session') });
    await ports.taskRepo.save(task);
    ports.workSessions.setAggregate(task.id, {
      totalDurationMinutes: 30,
      totalEarnings: 25,
      earliestStartAt: T0,
      latestEndAt: T0 + 30 * 60_000,
    });

    const change = makeChange(
      { id: 's_dedup', relatedTaskId: task.id as string, status: 'active' },
      { id: 's_dedup', relatedTaskId: task.id as string, status: 'completed' },
      'evt_dedup',
    );

    const first = await onWorkSessionCompleted(change, deps);
    const second = await onWorkSessionCompleted(change, deps);

    expect(first).toMatchObject({ applied: true });
    expect(second).toEqual({ skipped: 'idempotency' });
    // Aggregate is idempotent anyway; verify audit fired once.
    expect(ports.bigQueryAudit.events).toHaveLength(1);
  });
});
