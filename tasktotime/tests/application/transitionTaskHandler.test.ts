/**
 * Tests for application/handlers/transitionTaskHandler.
 */

import { TransitionTaskHandler } from '../../application/handlers/transitionTaskHandler';
import { TaskService } from '../../domain/services/TaskService';
import { makeAllPorts } from '../../shared/mocks/StubAllPorts';
import { readyTask, startedTask } from '../../shared/fixtures/tasks.fixture';
import { asUserId } from '../../domain/identifiers';

function buildHandler() {
  const ports = makeAllPorts();
  const taskService = new TaskService({
    taskRepo: ports.taskRepo,
    transitionLog: ports.transitionLog,
    workSessions: ports.workSessions,
    payroll: ports.payroll,
    idempotency: ports.idempotency,
    clock: ports.clock,
    idGenerator: ports.idGenerator,
  });
  const handler = new TransitionTaskHandler({ taskService });
  return { ports, handler };
}

describe('TransitionTaskHandler', () => {
  test('transitions ready -> started via wire DTO with string taskId', async () => {
    const { ports, handler } = buildHandler();
    const task = readyTask();
    ports.taskRepo.seed([task]);

    const result = await handler.execute({
      taskId: task.id, // branded string is still a string
      action: 'start',
      by: { id: asUserId('u'), name: 'U' },
      idempotencyKey: 'k1',
    });

    expect(result.task.lifecycle).toBe('started');
    expect(result.skipped).toBe(false);
  });

  test('idempotent retry returns skipped=true', async () => {
    const { ports, handler } = buildHandler();
    const task = startedTask();
    ports.taskRepo.seed([task]);

    await handler.execute({
      taskId: task.id,
      action: 'block',
      by: { id: asUserId('u'), name: 'U' },
      blockedReason: 'Waiting permit approval',
      idempotencyKey: 'k1',
    });

    const second = await handler.execute({
      taskId: task.id,
      action: 'block',
      by: { id: asUserId('u'), name: 'U' },
      blockedReason: 'Waiting permit approval',
      idempotencyKey: 'k1',
    });
    expect(second.skipped).toBe(true);
  });
});
