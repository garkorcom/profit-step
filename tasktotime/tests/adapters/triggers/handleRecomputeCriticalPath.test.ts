/**
 * Tests for `handleRecomputeCriticalPath` — Pub/Sub subscriber that runs
 * the CPM forward + backward pass over a project's tasks.
 *
 * Pins:
 *   - Skip on missing projectId / companyId.
 *   - Idempotency by (projectId, messageId) — replay skips.
 *   - Skip when no tasks in project.
 *   - On a healthy graph: per-task patches for slackMinutes + isCriticalPath
 *     only when value differs.
 *   - On a graph cycle: log warn + audit row, no patches.
 *   - Cross-tenant filter: tasks under a different company are not touched.
 */

import {
  handleRecomputeCriticalPath,
  MAX_TASKS_PER_PROJECT,
} from '../../../adapters/triggers/handleRecomputeCriticalPath';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asCompanyId,
  asProjectId,
  asTaskId,
  asUserId,
} from '../../../domain/identifiers';
import type { Task, TaskDependency, EpochMs } from '../../../domain/Task';

const T0 = 1_700_000_000_000;
const SRC_USER = { id: asUserId('user_pm'), name: 'PM' };

function dep(targetId: string, isHardBlock = true): TaskDependency {
  return {
    taskId: asTaskId(targetId),
    type: 'finish_to_start',
    isHardBlock,
    createdAt: T0 as EpochMs,
    createdBy: SRC_USER,
  };
}

function buildDeps() {
  const ports = makeAllPorts(T0);
  return {
    ports,
    deps: {
      taskRepo: ports.taskRepo,
      idempotency: ports.idempotency,
      bigQueryAudit: ports.bigQueryAudit,
      clock: ports.clock,
    },
  };
}

describe('handleRecomputeCriticalPath', () => {
  test('skips on missing projectId / companyId', async () => {
    const { deps } = buildDeps();
    expect(
      await handleRecomputeCriticalPath(
        { projectId: '', companyId: 'co_1' },
        { messageId: 'msg' },
        deps,
      ),
    ).toEqual({ skipped: 'missing_project_or_company' });
    expect(
      await handleRecomputeCriticalPath(
        { projectId: 'p_1', companyId: '' },
        { messageId: 'msg' },
        deps,
      ),
    ).toEqual({ skipped: 'missing_project_or_company' });
  });

  test('idempotency: replay of the same messageId skips', async () => {
    const { ports, deps } = buildDeps();
    const proj = asProjectId('proj_idem');
    const company = asCompanyId('co_idem');
    // Seed two tasks so the recompute does work the first time.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('A'),
        companyId: company,
        projectId: proj,
        estimatedDurationMinutes: 60,
      }),
    );
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('B'),
        companyId: company,
        projectId: proj,
        estimatedDurationMinutes: 30,
        dependsOn: [dep('A')],
      }),
    );
    const message = { projectId: proj as string, companyId: company as string };
    const first = await handleRecomputeCriticalPath(message, { messageId: 'msg_1' }, deps);
    const second = await handleRecomputeCriticalPath(message, { messageId: 'msg_1' }, deps);
    expect(first).toMatchObject({ applied: true });
    expect(second).toEqual({ skipped: 'idempotency' });
  });

  test('skip when no tasks in project', async () => {
    const { deps } = buildDeps();
    const r = await handleRecomputeCriticalPath(
      { projectId: 'p_empty', companyId: 'co_1' },
      { messageId: 'msg_empty' },
      deps,
    );
    expect(r).toEqual({ skipped: 'no_tasks_in_project' });
  });

  test('on a linear chain: patches slackMinutes + isCriticalPath where they differ', async () => {
    const { ports, deps } = buildDeps();
    const proj = asProjectId('proj_cpm');
    const company = asCompanyId('co_cpm');
    const A = makeTask({
      id: asTaskId('A'),
      companyId: company,
      projectId: proj,
      estimatedDurationMinutes: 60,
      slackMinutes: 999, // wrong existing value
      isCriticalPath: false,
    });
    const B = makeTask({
      id: asTaskId('B'),
      companyId: company,
      projectId: proj,
      estimatedDurationMinutes: 30,
      slackMinutes: 999,
      isCriticalPath: false,
      dependsOn: [dep('A')],
    });
    await ports.taskRepo.save(A);
    await ports.taskRepo.save(B);

    const r = await handleRecomputeCriticalPath(
      { projectId: proj as string, companyId: company as string },
      { messageId: 'msg_cpm' },
      deps,
    );

    expect(r).toMatchObject({ applied: true });
    const aRefreshed = await ports.taskRepo.findById(A.id);
    const bRefreshed = await ports.taskRepo.findById(B.id);
    // Linear A → B: both on critical path with slack 0.
    expect(aRefreshed?.isCriticalPath).toBe(true);
    expect(aRefreshed?.slackMinutes).toBe(0);
    expect(bRefreshed?.isCriticalPath).toBe(true);
    expect(bRefreshed?.slackMinutes).toBe(0);
  });

  test('on a graph cycle: no patches, audit row emitted', async () => {
    const { ports, deps } = buildDeps();
    const proj = asProjectId('proj_cycle');
    const company = asCompanyId('co_cycle');
    // A → B → A (cycle). cascadeShift / topologicalSort will return null.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('A'),
        companyId: company,
        projectId: proj,
        estimatedDurationMinutes: 60,
        dependsOn: [dep('B')],
      }),
    );
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('B'),
        companyId: company,
        projectId: proj,
        estimatedDurationMinutes: 30,
        dependsOn: [dep('A')],
      }),
    );

    const r = await handleRecomputeCriticalPath(
      { projectId: proj as string, companyId: company as string },
      { messageId: 'msg_cycle' },
      deps,
    );

    expect(r).toEqual({ skipped: 'cycle_detected' });
    // Audit row exists (eventType: project.cpm.cycle_detected).
    expect(ports.bigQueryAudit.events).toHaveLength(1);
    expect(ports.bigQueryAudit.events[0].eventType).toBe('project.cpm.cycle_detected');
  });

  test('cross-tenant filter: tasks in other companies are not loaded', async () => {
    const { ports, deps } = buildDeps();
    const proj = asProjectId('proj_xtenant');
    // Task A in our company, no dependencies.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('A'),
        companyId: asCompanyId('co_us'),
        projectId: proj,
        estimatedDurationMinutes: 60,
      }),
    );
    // Same projectId but other company — should be filtered out.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('A_other'),
        companyId: asCompanyId('co_them'),
        projectId: proj,
        estimatedDurationMinutes: 999,
      }),
    );

    const r = await handleRecomputeCriticalPath(
      { projectId: proj as string, companyId: 'co_us' },
      { messageId: 'msg_xt' },
      deps,
    );

    expect(r).toMatchObject({ applied: true });
    // A_other untouched.
    const aOther = await ports.taskRepo.findById(asTaskId('A_other'));
    expect(aOther?.isCriticalPath).toBe(false); // default makeTask value
    expect(aOther?.slackMinutes).toBe(0);       // default makeTask value
  });

  test('audit row reports patched + unchanged counts', async () => {
    const { ports, deps } = buildDeps();
    const proj = asProjectId('proj_counts');
    const company = asCompanyId('co_counts');
    // A already has the values CPM will produce → unchanged.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('A'),
        companyId: company,
        projectId: proj,
        estimatedDurationMinutes: 60,
        slackMinutes: 0,
        isCriticalPath: true,
      }),
    );
    // B is a parallel task with slack > 0 and existing value wrong.
    await ports.taskRepo.save(
      makeTask({
        id: asTaskId('B'),
        companyId: company,
        projectId: proj,
        estimatedDurationMinutes: 10,
        slackMinutes: -1,
        isCriticalPath: false,
      }),
    );

    await handleRecomputeCriticalPath(
      { projectId: proj as string, companyId: company as string },
      { messageId: 'msg_counts' },
      deps,
    );

    const auditRow = ports.bigQueryAudit.events.find(
      (e) => e.eventType === 'project.cpm.recomputed',
    );
    expect(auditRow).toBeDefined();
    const payload = auditRow!.payload as Record<string, unknown>;
    expect(typeof payload.patched).toBe('number');
    expect(typeof payload.unchanged).toBe('number');
    expect((payload.patched as number) + (payload.unchanged as number)).toBeGreaterThanOrEqual(2);
  });

  test('exposes MAX_TASKS_PER_PROJECT', () => {
    expect(MAX_TASKS_PER_PROJECT).toBe(500);
  });
});
