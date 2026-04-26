/**
 * Tests for application/handlers/createTaskHandler — DTO -> service.
 */

import { CreateTaskHandler } from '../../application/handlers/createTaskHandler';
import { TaskService } from '../../domain/services/TaskService';
import { makeAllPorts } from '../../shared/mocks/StubAllPorts';
import { asUserId } from '../../domain/identifiers';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function buildHandler() {
  const ports = makeAllPorts(T0);
  const taskService = new TaskService({
    taskRepo: ports.taskRepo,
    transitionLog: ports.transitionLog,
    workSessions: ports.workSessions,
    payroll: ports.payroll,
    idempotency: ports.idempotency,
    clock: ports.clock,
    idGenerator: ports.idGenerator,
  });
  const handler = new CreateTaskHandler({ taskService });
  return { ports, handler };
}

describe('CreateTaskHandler', () => {
  test('creates a draft task from wire DTO', async () => {
    const { ports, handler } = buildHandler();

    const result = await handler.execute({
      idempotencyKey: 'cmd-1',
      by: { id: asUserId('user_pm'), name: 'PM' },
      companyId: 'company_acme',
      title: 'Install fence',
      dueAt: T0 + 7 * 24 * HOUR,
      estimatedDurationMinutes: 240,
      bucket: 'next',
      priority: 'medium',
      source: 'web',
      assignedTo: { id: asUserId('user_worker'), name: 'Worker' },
      requiredHeadcount: 2,
      costInternal: { amount: 200, currency: 'USD' },
      priceClient: { amount: 500, currency: 'USD' },
    });

    expect(result.lifecycle).toBe('draft');
    expect(result.title).toBe('Install fence');
    expect(result.taskNumber).toMatch(/^T-\d{4}-/);

    // Persisted in repo
    const persisted = await ports.taskRepo.findById(result.id);
    expect(persisted?.title).toBe('Install fence');
  });

  test('initialLifecycle=ready validates pre-conditions and creates ready task', async () => {
    const { handler } = buildHandler();

    const result = await handler.execute({
      idempotencyKey: 'cmd-2',
      initialLifecycle: 'ready',
      by: { id: asUserId('user_pm'), name: 'PM' },
      companyId: 'company_acme',
      title: 'Paint',
      dueAt: T0 + 7 * 24 * HOUR,
      estimatedDurationMinutes: 240,
      bucket: 'next',
      priority: 'high',
      source: 'web',
      assignedTo: { id: asUserId('user_worker'), name: 'Worker' },
      requiredHeadcount: 1,
      costInternal: { amount: 100, currency: 'USD' },
      priceClient: { amount: 300, currency: 'USD' },
    });

    expect(result.lifecycle).toBe('ready');
  });

  test('subtask: parentTaskId sets isSubtask=true and wikiInheritsFromParent=true', async () => {
    const { handler } = buildHandler();

    const result = await handler.execute({
      idempotencyKey: 'cmd-3',
      by: { id: asUserId('u'), name: 'U' },
      companyId: 'company_acme',
      title: 'Paint trim',
      dueAt: T0 + 7 * 24 * HOUR,
      estimatedDurationMinutes: 60,
      bucket: 'next',
      priority: 'medium',
      source: 'web',
      assignedTo: { id: asUserId('w'), name: 'W' },
      requiredHeadcount: 1,
      costInternal: { amount: 50, currency: 'USD' },
      priceClient: { amount: 100, currency: 'USD' },
      parentTaskId: 'parent_remodel',
    });

    expect(result.isSubtask).toBe(true);
    expect(result.wikiInheritsFromParent).toBe(true);
    expect(result.parentTaskId).toBe('parent_remodel');
  });
});
