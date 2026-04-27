/**
 * Tests for `removeDependencyRoute` — the HTTP adapter for
 * `DELETE /tasks/:id/dependencies/:depId`.
 *
 * Coverage:
 *   - Successful removal trims the edge from `from.dependsOn[]` and the
 *     reverse `blocksTaskIds[]` cascade (separately driven by the
 *     `cascadeBlocksTaskIds` trigger) clears the source id from the
 *     predecessor's reverse index.
 *   - Idempotent replay returns the current task with `skipped: true` and
 *     does not re-issue the underlying CAS.
 *   - Cross-tenant (either side belongs to another company) returns 404.
 *   - Missing source or target returns 404.
 *   - Missing idempotency key returns 400.
 *
 * Why we manually invoke `cascadeBlocksTaskIds` after the HTTP call:
 *   The cascade is normally driven by the Firestore `onTaskUpdate` trigger
 *   on the source task's `dependsOn[]` change. In a unit-test harness with
 *   the in-memory `TaskRepository`, no trigger fires; the test simulates
 *   the trigger so the end-to-end behaviour can be asserted in one place.
 */

import { removeDependencyRoute } from '../../../adapters/http/handlers/removeDependency';
import { RemoveDependencyHandler } from '../../../application/handlers/removeDependencyHandler';
import { DependencyService } from '../../../domain/services/DependencyService';
import { cascadeBlocksTaskIds } from '../../../adapters/triggers/cascadeBlocksTaskIds';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import {
  asCompanyId,
  asTaskId,
  asUserId,
} from '../../../domain/identifiers';
import type { TaskRepository } from '../../../ports/repositories';
import type { Task, TaskDependency, EpochMs } from '../../../domain/Task';
import type { AuthContext } from '../../../adapters/http/middleware';

interface FakeRequest {
  auth?: AuthContext;
  params: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
}

interface FakeResponse {
  status: jest.Mock;
  json: jest.Mock;
  statusCode: number;
  payload: unknown;
}

function makeRes(): FakeResponse {
  const res: Partial<FakeResponse> = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as FakeResponse;
  });
  res.json = jest.fn((payload: unknown) => {
    res.payload = payload;
    return res as FakeResponse;
  });
  return res as FakeResponse;
}

function makeAuth(companyId = 'company_acme'): AuthContext {
  return {
    by: { id: asUserId('user_pm'), name: 'PM' },
    companyId,
    tokenType: 'master',
  };
}

const T0 = 1_700_000_000_000;
const SRC_USER = { id: asUserId('user_pm'), name: 'PM' };

function dep(taskId: string, isHardBlock = true): TaskDependency {
  return {
    taskId: asTaskId(taskId),
    type: 'finish_to_start',
    isHardBlock,
    createdAt: T0 as EpochMs,
    createdBy: SRC_USER,
  };
}

function buildHarness(seedTasks: Task[]) {
  const ports = makeAllPorts(T0);
  ports.taskRepo.seed(seedTasks);
  const dependencyService = new DependencyService({
    taskRepo: ports.taskRepo,
    clock: ports.clock,
  });
  const handler = new RemoveDependencyHandler({
    dependencyService,
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
  });
  const route = removeDependencyRoute({
    handler,
    taskRepo: ports.taskRepo as unknown as TaskRepository,
  });
  return { ports, dependencyService, handler, route };
}

const COMPANY = 'company_acme';

describe('removeDependencyRoute', () => {
  test('pulls dep from `from.dependsOn` and reverse from target `blocksTaskIds`', async () => {
    const target = makeTask({
      id: asTaskId('task_target'),
      companyId: asCompanyId(COMPANY),
      blocksTaskIds: [asTaskId('task_source')],
    });
    const source = makeTask({
      id: asTaskId('task_source'),
      companyId: asCompanyId(COMPANY),
      dependsOn: [dep('task_target')],
    });
    const { ports, route } = buildHarness([source, target]);

    const before = await ports.taskRepo.findById(asTaskId('task_source'));
    expect(before?.dependsOn).toHaveLength(1);

    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_source', depId: 'task_target' },
      headers: { 'idempotency-key': 'idem-rem-1' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.payload).toMatchObject({
      ok: true,
      skipped: false,
      task: expect.objectContaining({
        id: asTaskId('task_source'),
      }),
    });
    const sourceAfter = await ports.taskRepo.findById(asTaskId('task_source'));
    expect(sourceAfter?.dependsOn).toEqual([]);

    // Simulate the cascade trigger that fires on the source's dependsOn
    // change. In production this is `onTaskUpdate -> cascadeBlocksTaskIds`.
    const cascadeResult = await cascadeBlocksTaskIds(before!, sourceAfter!, {
      taskRepo: ports.taskRepo,
    });
    expect(cascadeResult.removed).toEqual([asTaskId('task_target')]);
    const targetAfter = await ports.taskRepo.findById(asTaskId('task_target'));
    expect(targetAfter?.blocksTaskIds).toEqual([]);
  });

  test('idempotent replay returns same task with skipped=true', async () => {
    const target = makeTask({
      id: asTaskId('task_target_b'),
      companyId: asCompanyId(COMPANY),
    });
    const source = makeTask({
      id: asTaskId('task_source_b'),
      companyId: asCompanyId(COMPANY),
      dependsOn: [dep('task_target_b')],
    });
    const { ports, route } = buildHarness([source, target]);

    const idemKey = 'idem-rem-replay';
    const req1: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_source_b', depId: 'task_target_b' },
      headers: { 'idempotency-key': idemKey },
      body: undefined,
    };
    const res1 = makeRes();
    await route(req1 as never, res1 as never, jest.fn());
    expect((res1.payload as { skipped: boolean }).skipped).toBe(false);

    // Spy: a second call with the same idempotency key must not invoke
    // saveIfUnchanged (which is the underlying CAS for removeDependency).
    const saveIfUnchangedSpy = jest.spyOn(ports.taskRepo, 'saveIfUnchanged');
    saveIfUnchangedSpy.mockClear();

    const req2: FakeRequest = { ...req1 };
    const res2 = makeRes();
    await route(req2 as never, res2 as never, jest.fn());
    expect((res2.payload as { skipped: boolean }).skipped).toBe(true);
    expect(saveIfUnchangedSpy).not.toHaveBeenCalled();
  });

  test('cross-tenant source returns 404', async () => {
    const source = makeTask({
      id: asTaskId('task_x_src'),
      companyId: asCompanyId('company_other'),
    });
    const target = makeTask({
      id: asTaskId('task_x_tgt'),
      companyId: asCompanyId(COMPANY),
    });
    const { route } = buildHarness([source, target]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_x_src', depId: 'task_x_tgt' },
      headers: { 'idempotency-key': 'idem-rem-cross' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('cross-tenant target returns 404', async () => {
    const source = makeTask({
      id: asTaskId('task_y_src'),
      companyId: asCompanyId(COMPANY),
    });
    const target = makeTask({
      id: asTaskId('task_y_tgt'),
      companyId: asCompanyId('company_other'),
    });
    const { route } = buildHarness([source, target]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_y_src', depId: 'task_y_tgt' },
      headers: { 'idempotency-key': 'idem-rem-cross-2' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('missing source returns 404', async () => {
    const target = makeTask({
      id: asTaskId('task_only_tgt'),
      companyId: asCompanyId(COMPANY),
    });
    const { route } = buildHarness([target]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_missing_src', depId: 'task_only_tgt' },
      headers: { 'idempotency-key': 'idem-rem-miss-src' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('missing idempotency key returns 400', async () => {
    const source = makeTask({
      id: asTaskId('task_src_z'),
      companyId: asCompanyId(COMPANY),
    });
    const target = makeTask({
      id: asTaskId('task_tgt_z'),
      companyId: asCompanyId(COMPANY),
    });
    const { route } = buildHarness([source, target]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_src_z', depId: 'task_tgt_z' },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('removing an absent edge is still a successful 200 (idempotent at domain layer)', async () => {
    const source = makeTask({
      id: asTaskId('task_no_edge_src'),
      companyId: asCompanyId(COMPANY),
      dependsOn: [],
    });
    const target = makeTask({
      id: asTaskId('task_no_edge_tgt'),
      companyId: asCompanyId(COMPANY),
    });
    const { route } = buildHarness([source, target]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_no_edge_src', depId: 'task_no_edge_tgt' },
      headers: { 'idempotency-key': 'idem-rem-noop' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
