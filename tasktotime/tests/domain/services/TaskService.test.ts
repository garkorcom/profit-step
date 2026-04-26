/**
 * Tests for TaskService — orchestration of lifecycle commands.
 */

import { TaskService, isoWeekId } from '../../../domain/services/TaskService';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { TransitionNotAllowed, InvalidDraft } from '../../../domain/errors';
import {
  draftTask,
  readyTask,
  startedTask,
  completedTask,
} from '../../../shared/fixtures/tasks.fixture';
import { asTaskId, asUserId } from '../../../domain/identifiers';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function buildService(initialEpochMs = T0) {
  const ports = makeAllPorts(initialEpochMs);
  const service = new TaskService({
    taskRepo: ports.taskRepo,
    transitionLog: ports.transitionLog,
    workSessions: ports.workSessions,
    payroll: ports.payroll,
    idempotency: ports.idempotency,
    clock: ports.clock,
    idGenerator: ports.idGenerator,
    telegram: ports.telegram,
    audit: ports.bigQueryAudit,
  });
  return { ports, service };
}

const TEST_USER = {
  id: asUserId('user_test'),
  name: 'Test User',
};

describe('TaskService.transition', () => {
  test('valid draft -> ready transition succeeds', async () => {
    const { ports, service } = buildService();
    const task = readyTask();
    task.lifecycle = 'draft';
    ports.taskRepo.seed([task]);

    const result = await service.transition({
      taskId: task.id,
      action: 'ready',
      by: TEST_USER,
      idempotencyKey: 'k1',
    });

    expect(result.task.lifecycle).toBe('ready');
    expect(result.skipped).toBe(false);
    expect(result.events.some((e) => e.type === 'task.transitioned')).toBe(true);

    // Transition log entry was appended
    const logs = await ports.transitionLog.findForTask(task.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('ready');
  });

  test('start sets actualStartAt on first start', async () => {
    const { ports, service } = buildService(T0);
    const task = readyTask();
    ports.taskRepo.seed([task]);

    const result = await service.transition({
      taskId: task.id,
      action: 'start',
      by: TEST_USER,
      idempotencyKey: 'k1',
    });

    expect(result.task.lifecycle).toBe('started');
    expect(result.task.actualStartAt).toBe(T0);
  });

  test('block requires reason >= 5 chars', async () => {
    const { ports, service } = buildService();
    const task = startedTask();
    ports.taskRepo.seed([task]);

    await expect(
      service.transition({
        taskId: task.id,
        action: 'block',
        by: TEST_USER,
        blockedReason: 'no',
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrow();
  });

  test('block with valid reason succeeds and sets blockedReason', async () => {
    const { ports, service } = buildService();
    const task = startedTask();
    ports.taskRepo.seed([task]);

    const result = await service.transition({
      taskId: task.id,
      action: 'block',
      by: TEST_USER,
      blockedReason: 'Waiting for permit approval',
      idempotencyKey: 'k1',
    });

    expect(result.task.lifecycle).toBe('blocked');
    expect(result.task.blockedReason).toBe('Waiting for permit approval');
  });

  test('forbidden draft -> started throws TransitionNotAllowed', async () => {
    const { ports, service } = buildService();
    const task = draftTask();
    ports.taskRepo.seed([task]);

    await expect(
      service.transition({
        taskId: task.id,
        action: 'start',
        by: TEST_USER,
        idempotencyKey: 'k1',
      }),
    ).rejects.toBeInstanceOf(TransitionNotAllowed);
  });

  test('idempotent: same key second time returns skipped=true', async () => {
    const { ports, service } = buildService();
    const task = startedTask();
    ports.taskRepo.seed([task]);

    await service.transition({
      taskId: task.id,
      action: 'block',
      by: TEST_USER,
      blockedReason: 'Waiting permit',
      idempotencyKey: 'unique-key-1',
    });

    const second = await service.transition({
      taskId: task.id,
      action: 'block',
      by: TEST_USER,
      blockedReason: 'Waiting permit',
      idempotencyKey: 'unique-key-1',
    });

    expect(second.skipped).toBe(true);
    expect(second.events).toEqual([]);
  });

  test('complete aggregates work_sessions actuals before transition', async () => {
    const { ports, service } = buildService();
    const task = startedTask();
    ports.taskRepo.seed([task]);

    ports.workSessions.setAggregate(task.id, {
      totalDurationMinutes: 240,
      totalEarnings: 120,
      earliestStartAt: T0 - HOUR,
      latestEndAt: T0,
    });

    const result = await service.transition({
      taskId: task.id,
      action: 'complete',
      by: TEST_USER,
      idempotencyKey: 'kc',
    });

    expect(result.task.lifecycle).toBe('completed');
    expect(result.task.actualDurationMinutes).toBe(240);
    expect(result.task.totalEarnings).toBe(120);
  });

  test('accept appends payroll bonus when on-time and bonusOnTime configured', async () => {
    const { ports, service } = buildService();
    const task = completedTask();
    ports.taskRepo.seed([task]);

    const result = await service.transition({
      taskId: task.id,
      action: 'accept',
      by: TEST_USER,
      acceptance: {
        url: 'https://example/act.pdf',
        signedAt: T0 + 5 * HOUR,
        signedBy: 'client_jim',
        signedByName: 'Jim',
      },
      idempotencyKey: 'ka',
    });

    expect(result.task.lifecycle).toBe('accepted');
    expect(ports.payroll.adjustments).toHaveLength(1);
    expect(ports.payroll.adjustments[0]!.reason).toBe('bonus_on_time');
  });

  test('accept is idempotent for payroll: re-accept does not double-pay', async () => {
    const { ports, service } = buildService();
    const task = completedTask();
    ports.taskRepo.seed([task]);

    await service.transition({
      taskId: task.id,
      action: 'accept',
      by: TEST_USER,
      acceptance: {
        url: 'x',
        signedAt: T0,
        signedBy: 'u',
        signedByName: 'U',
      },
      idempotencyKey: 'k1',
    });

    // Manually clear idempotency to force a second transition attempt
    await ports.idempotency.release(`task.transition:${task.id}:accept:k1`);

    // Second transition with same idempotency key — but task is now `accepted`,
    // re-accepting should fail at the canTransition check anyway.
    await expect(
      service.transition({
        taskId: task.id,
        action: 'accept',
        by: TEST_USER,
        acceptance: {
          url: 'x',
          signedAt: T0,
          signedBy: 'u',
          signedByName: 'U',
        },
        idempotencyKey: 'k2',
      }),
    ).rejects.toBeInstanceOf(TransitionNotAllowed);

    expect(ports.payroll.adjustments).toHaveLength(1);
  });
});

describe('TaskService.createTask', () => {
  test('creates a draft task with generated id and taskNumber', async () => {
    const { ports, service } = buildService();
    const fixture = readyTask();
    // Strip identity fields — service generates them. Cast through `unknown`
    // because `Task` and `TaskDraft` differ on `id`/`taskNumber`/`history`
    // shape only.
    const draftClean = fixture as unknown as Parameters<typeof service.createTask>[0]['draft'];

    const created = await service.createTask({
      companyId: fixture.companyId,
      draft: draftClean,
      initialLifecycle: 'draft',
      by: TEST_USER,
      idempotencyKey: 'create-1',
    });

    expect(created.id).toMatch(/^task_gen_/);
    expect(created.taskNumber).toMatch(/^T-\d{4}-/);
    expect(created.lifecycle).toBe('draft');

    const logs = await ports.transitionLog.findForTask(created.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('create');
  });

  test('initialLifecycle=ready validates pre-conditions and may throw InvalidDraft', async () => {
    const { service } = buildService();
    const fixture = readyTask();
    // remove dueAt to violate ready precondition
    const broken = {
      ...fixture,
      dueAt: 0,
    } as unknown as Parameters<typeof service.createTask>[0]['draft'];

    await expect(
      service.createTask({
        companyId: fixture.companyId,
        draft: broken,
        initialLifecycle: 'ready',
        by: TEST_USER,
        idempotencyKey: 'broken-1',
      }),
    ).rejects.toBeInstanceOf(InvalidDraft);
  });
});

describe('TaskService.canTransition', () => {
  test('delegates to lifecycle table', () => {
    const { service } = buildService();
    expect(service.canTransition('draft', 'ready')).toBe(true);
    expect(service.canTransition('draft', 'start')).toBe(false);
  });
});

describe('isoWeekId', () => {
  test('produces deterministic ISO-8601 week id', () => {
    const id = isoWeekId(Date.UTC(2026, 3, 25)); // April 25 2026
    expect(id).toMatch(/^2026-W\d{2}$/);
  });
});
