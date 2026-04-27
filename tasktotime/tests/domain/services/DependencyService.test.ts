/**
 * Tests for DependencyService — orchestrates cycle detection + cascade.
 */

import { DependencyService } from '../../../domain/services/DependencyService';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { CycleDetected, TaskNotFound } from '../../../domain/errors';
import { graph } from '../../../shared/test-helpers/buildDependencyGraph';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import {
  asCompanyId,
  asProjectId,
  asTaskId,
  asUserId,
} from '../../../domain/identifiers';

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

describe('DependencyService.computeCriticalPath cross-tenant scoping', () => {
  // Regression for the cross-tenant bug: previously the service called
  // `findMany({ companyId: '' as unknown as ... })` which returns 0 results
  // in Firestore (no doc has `companyId == ''`), silently breaking CPM for
  // every project. After the fix the caller must pass a real companyId,
  // and only tasks under that companyId participate in the schedule.
  test('only schedules tasks whose companyId matches the requested tenant', async () => {
    const { ports, service } = buildService();
    const co_self = asCompanyId('co_self');
    const co_other = asCompanyId('co_other');
    const projectId = asProjectId('proj_1');

    // Two tasks in the requested project across two tenants.
    const mine = makeTask({
      id: asTaskId('task_mine'),
      companyId: co_self,
      projectId,
      lifecycle: 'ready',
      estimatedDurationMinutes: 60,
    });
    const theirs = makeTask({
      id: asTaskId('task_theirs'),
      companyId: co_other,
      projectId,
      lifecycle: 'ready',
      estimatedDurationMinutes: 60,
    });
    ports.taskRepo.seed([mine, theirs]);

    const summary = await service.computeCriticalPath(co_self, projectId);

    // Schedule must contain only the same-tenant task; the foreign task
    // must not appear in slackByTaskId or critical path.
    expect(Object.keys(summary.slackByTaskId)).toEqual([mine.id]);
    expect(summary.taskIds).not.toContain(theirs.id);
  });

  test('returns no schedule when companyId does not match any task', async () => {
    const { ports, service } = buildService();
    const projectId = asProjectId('proj_2');
    ports.taskRepo.seed([
      makeTask({
        id: asTaskId('task_alpha'),
        companyId: asCompanyId('co_alpha'),
        projectId,
        lifecycle: 'ready',
      }),
    ]);

    const summary = await service.computeCriticalPath(
      asCompanyId('co_beta'),
      projectId,
    );

    // computeSchedule on an empty set still produces a degenerate but valid
    // summary; the important assertion is that the foreign tenant's task
    // did NOT leak into the schedule.
    expect(Object.keys(summary.slackByTaskId)).toHaveLength(0);
  });
});
