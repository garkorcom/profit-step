/**
 * Tests for application/handlers/addDependencyHandler.
 */

import { AddDependencyHandler } from '../../application/handlers/addDependencyHandler';
import { DependencyService } from '../../domain/services/DependencyService';
import { makeAllPorts } from '../../shared/mocks/StubAllPorts';
import { CycleDetected } from '../../domain/errors';
import { graph } from '../../shared/test-helpers/buildDependencyGraph';
import { asTaskId, asUserId } from '../../domain/identifiers';

function buildHandler() {
  const ports = makeAllPorts();
  const dependencyService = new DependencyService({
    taskRepo: ports.taskRepo,
    clock: ports.clock,
  });
  const handler = new AddDependencyHandler({ dependencyService });
  return { ports, handler };
}

describe('AddDependencyHandler', () => {
  test('adds dependency successfully', async () => {
    const { ports, handler } = buildHandler();
    ports.taskRepo.seed(graph('A, B'));

    const result = await handler.execute({
      fromTaskId: 'task_B',
      toTaskId: 'task_A',
      type: 'finish_to_start',
      isHardBlock: true,
      by: { id: asUserId('u'), name: 'U' },
    });

    expect(result.ok).toBe(true);
    const b = await ports.taskRepo.findById(asTaskId('task_B'));
    expect(b?.dependsOn?.some((d) => d.taskId === asTaskId('task_A'))).toBe(true);
  });

  test('throws CycleDetected if cycle would form', async () => {
    const { ports, handler } = buildHandler();
    ports.taskRepo.seed(graph('A->B, B->C'));

    await expect(
      handler.execute({
        fromTaskId: 'task_A',
        toTaskId: 'task_C',
        type: 'finish_to_start',
        isHardBlock: true,
        by: { id: asUserId('u'), name: 'U' },
      }),
    ).rejects.toBeInstanceOf(CycleDetected);
  });
});
