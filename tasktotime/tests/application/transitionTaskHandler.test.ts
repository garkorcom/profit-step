/**
 * Tests for application/handlers/transitionTaskHandler.
 */

import { TransitionTaskHandler } from '../../application/handlers/transitionTaskHandler';
import { TaskService } from '../../domain/services/TaskService';
import { makeAllPorts } from '../../shared/mocks/StubAllPorts';
import { draftTask, readyTask, startedTask } from '../../shared/fixtures/tasks.fixture';
import { asUserId } from '../../domain/identifiers';
import { InvalidDraft } from '../../domain/errors';

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

  // ─── Bug 1 — `ready` precondition validation ──────────────────────────
  // Spec: tasktotime/spec/03-state-machine/transitions.md §"ready()" — the
  // transition requires `assignedTo`, `dueAt`, `estimatedDurationMinutes`
  // filled, else 400. The pure `applyTransition` runs `validateTaskDraft`
  // which throws `InvalidDraft` on missing fields; the HTTP middleware
  // maps that to 400 (see `domainStatus` in adapters/http/middleware.ts).

  test('ready transition without assignedTo throws InvalidDraft', async () => {
    const { ports, handler } = buildHandler();
    const task = draftTask();
    delete (task as unknown as { assignedTo?: unknown }).assignedTo;
    ports.taskRepo.seed([task]);

    await expect(
      handler.execute({
        taskId: task.id,
        action: 'ready',
        by: { id: asUserId('u'), name: 'U' },
        idempotencyKey: 'kr1',
      }),
    ).rejects.toBeInstanceOf(InvalidDraft);
  });

  test('ready transition without dueAt throws InvalidDraft naming the field', async () => {
    const { ports, handler } = buildHandler();
    const task = draftTask();
    (task as unknown as { dueAt: number }).dueAt = 0;
    ports.taskRepo.seed([task]);

    try {
      await handler.execute({
        taskId: task.id,
        action: 'ready',
        by: { id: asUserId('u'), name: 'U' },
        idempotencyKey: 'kr2',
      });
      throw new Error('expected InvalidDraft to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDraft);
      expect((err as InvalidDraft).missingFields).toEqual(
        expect.arrayContaining(['dueAt']),
      );
    }
  });

  test('ready transition with non-positive estimatedDurationMinutes throws InvalidDraft', async () => {
    const { ports, handler } = buildHandler();
    const task = draftTask();
    (task as unknown as { estimatedDurationMinutes: number }).estimatedDurationMinutes = 0;
    ports.taskRepo.seed([task]);

    try {
      await handler.execute({
        taskId: task.id,
        action: 'ready',
        by: { id: asUserId('u'), name: 'U' },
        idempotencyKey: 'kr3',
      });
      throw new Error('expected InvalidDraft to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDraft);
      expect((err as InvalidDraft).missingFields).toEqual(
        expect.arrayContaining(['estimatedDurationMinutes']),
      );
    }
  });

  test('ready transition with all preconditions present succeeds', async () => {
    const { ports, handler } = buildHandler();
    const task = draftTask();
    // draftTask() already supplies assignedTo + dueAt + estimatedDurationMinutes.
    ports.taskRepo.seed([task]);

    const result = await handler.execute({
      taskId: task.id,
      action: 'ready',
      by: { id: asUserId('u'), name: 'U' },
      idempotencyKey: 'kr4',
    });
    expect(result.task.lifecycle).toBe('ready');
  });
});
