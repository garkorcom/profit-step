/**
 * Tests for DependencyService — orchestrates cycle detection + cascade.
 */

import { DependencyService } from '../../../domain/services/DependencyService';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { CycleDetected, TaskNotFound } from '../../../domain/errors';
import { graph } from '../../../shared/test-helpers/buildDependencyGraph';
import { asTaskId, asUserId } from '../../../domain/identifiers';

const TEST_USER = {
  id: asUserId('user_test'),
  name: 'Test User',
};

function buildService() {
  const ports = makeAllPorts();
  const service = new DependencyService({
    taskRepo: ports.taskRepo,
    clock: ports.clock,
  });
  return { ports, service };
}

describe('DependencyService.canAddDependency', () => {
  test('returns ok=true for empty graph', async () => {
    const { ports, service } = buildService();
    ports.taskRepo.seed(graph(''));
    const result = await service.canAddDependency(asTaskId('A'), asTaskId('B'));
    expect(result.ok).toBe(true);
  });

  test('returns ok=false for self-dependency', async () => {
    const { service } = buildService();
    const result = await service.canAddDependency(asTaskId('A'), asTaskId('A'));
    expect(result.ok).toBe(false);
  });

  test('returns ok=false when adding edge would close a cycle', async () => {
    const { ports, service } = buildService();
    // In DSL "A->B, B->C": B depends on A, C depends on B (so C transitively
    // depends on A). Adding A.dependsOn += C would close cycle A -> C -> B -> A.
    ports.taskRepo.seed(graph('A->B, B->C'));
    const result = await service.canAddDependency(
      asTaskId('task_A'),
      asTaskId('task_C'),
    );
    expect(result.ok).toBe(false);
  });
});

describe('DependencyService.addDependency', () => {
  test('appends dependency to fromTask.dependsOn', async () => {
    const { ports, service } = buildService();
    ports.taskRepo.seed(graph('A->B, C'));

    await service.addDependency(
      asTaskId('task_C'),
      {
        taskId: asTaskId('task_A'),
        type: 'finish_to_start',
        isHardBlock: true,
        lagMinutes: 0,
      },
      TEST_USER,
    );

    const c = await ports.taskRepo.findById(asTaskId('task_C'));
    expect(c?.dependsOn).toBeDefined();
    expect(c!.dependsOn!.some((d) => d.taskId === asTaskId('task_A'))).toBe(true);
  });

  test('throws CycleDetected when cycle would form', async () => {
    const { ports, service } = buildService();
    ports.taskRepo.seed(graph('A->B, B->C'));

    await expect(
      service.addDependency(
        asTaskId('task_A'),
        {
          taskId: asTaskId('task_C'),
          type: 'finish_to_start',
          isHardBlock: true,
        },
        TEST_USER,
      ),
    ).rejects.toBeInstanceOf(CycleDetected);
  });

  test('throws TaskNotFound when from-task does not exist', async () => {
    const { service } = buildService();
    await expect(
      service.addDependency(
        asTaskId('missing'),
        {
          taskId: asTaskId('also_missing'),
          type: 'finish_to_start',
          isHardBlock: true,
        },
        TEST_USER,
      ),
    ).rejects.toBeInstanceOf(TaskNotFound);
  });
});

describe('DependencyService.removeDependency', () => {
  test('removes dependency by taskId', async () => {
    const { ports, service } = buildService();
    ports.taskRepo.seed(graph('A->B'));

    await service.removeDependency(asTaskId('task_B'), asTaskId('task_A'));

    const b = await ports.taskRepo.findById(asTaskId('task_B'));
    expect(b?.dependsOn ?? []).toHaveLength(0);
  });
});

describe('DependencyService.canSetParent', () => {
  test('disallows when parent is itself a subtask (hierarchy depth)', async () => {
    const { ports, service } = buildService();
    const tasks = graph('A, B');
    const a = tasks.find((t) => t.id === asTaskId('task_A'))!;
    a.isSubtask = true;
    a.parentTaskId = asTaskId('grandparent');
    ports.taskRepo.seed(tasks);

    const result = await service.canSetParent(asTaskId('task_B'), asTaskId('task_A'));
    expect(result.ok).toBe(false);
  });

  test('allows null parent (root task)', async () => {
    const { service } = buildService();
    const result = await service.canSetParent(asTaskId('any'), null);
    expect(result.ok).toBe(true);
  });
});
