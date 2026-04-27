/**
 * Tests for `patchTaskRoute` — the HTTP adapter for `PATCH /tasks/:id`.
 *
 * Coverage:
 *   - Valid patch updates allowed fields and returns 200 with the new task.
 *   - Forbidden key in body returns 400 (handled at the schema layer, before
 *     the idempotency reservation).
 *   - Cross-tenant access (existing task belongs to another company) returns
 *     404 — never 403, to avoid leaking existence.
 *   - Missing task returns 404.
 *   - Idempotent replay: second call with the same key returns the same task
 *     and reports `skipped: true`; no second mutation reaches the repository.
 *   - Missing idempotency key in both header and body returns 400.
 *
 * The route is exercised via fake Express `req` / `res` objects rather than
 * spinning up `supertest` — keeping the test pure-unit means no deps on
 * networking or middleware order.
 */

import { patchTaskRoute } from '../../../adapters/http/handlers/patchTask';
import { PatchTaskHandler } from '../../../application/handlers/patchTaskHandler';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import {
  asCompanyId,
  asTaskId,
  asUserId,
} from '../../../domain/identifiers';
import type { TaskRepository } from '../../../ports/repositories';
import type { Task } from '../../../domain/Task';
import type { AuthContext } from '../../../adapters/http/middleware';

interface FakeRequest {
  auth?: AuthContext;
  params: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
  query?: Record<string, unknown>;
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

function buildHarness(seedTasks: Task[] = []) {
  const ports = makeAllPorts(1_700_000_000_000);
  ports.taskRepo.seed(seedTasks);
  const handler = new PatchTaskHandler({
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
  });
  const route = patchTaskRoute({
    handler,
    taskRepo: ports.taskRepo as unknown as TaskRepository,
  });
  return { ports, handler, route };
}

const TASK_ID = 'task_t1';
const COMPANY = 'company_acme';

function seededTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: asTaskId(TASK_ID),
    companyId: asCompanyId(COMPANY),
    title: 'Original title',
    priority: 'medium',
    bucket: 'next',
    ...overrides,
  });
}

describe('patchTaskRoute', () => {
  test('valid patch returns 200 and updates task', async () => {
    const { ports, route } = buildHarness([seededTask()]);

    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-1' },
      body: { title: 'New title', priority: 'high' },
    };
    const res = makeRes();

    await route(req as never, res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.payload).toMatchObject({
      ok: true,
      skipped: false,
      task: expect.objectContaining({
        id: asTaskId(TASK_ID),
        title: 'New title',
        priority: 'high',
      }),
    });
    const persisted = await ports.taskRepo.findById(asTaskId(TASK_ID));
    expect(persisted?.title).toBe('New title');
    expect(persisted?.priority).toBe('high');
  });

  test('forbidden key returns 400 without mutating', async () => {
    const { ports, route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-2' },
      body: { lifecycle: 'started' },
    };
    const res = makeRes();

    await route(req as never, res as never, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.payload).toMatchObject({
      ok: false,
      error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    });
    const persisted = await ports.taskRepo.findById(asTaskId(TASK_ID));
    expect(persisted?.lifecycle).toBe('draft'); // unchanged
  });

  test('forbidden key `taskNumber` is rejected at the HTTP boundary', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-3' },
      body: { taskNumber: 'T-9999-9999' },
    };
    const res = makeRes();

    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('forbidden key `source` is rejected at the HTTP boundary', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-source' },
      body: { source: 'ai' },
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('cross-tenant request returns 404 (no info leak)', async () => {
    const { route } = buildHarness([
      seededTask({ companyId: asCompanyId('company_other') }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-4' },
      body: { title: 'attacker' },
    };
    const res = makeRes();

    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('missing task returns 404', async () => {
    const { route } = buildHarness([]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_nonexistent' },
      headers: { 'idempotency-key': 'idem-5' },
      body: { title: 'never persists' },
    };
    const res = makeRes();

    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('idempotent replay returns same task with skipped=true', async () => {
    const { ports, route } = buildHarness([seededTask()]);
    const idemKey = 'idem-replay';
    const req1: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': idemKey },
      body: { title: 'first patch' },
    };
    const res1 = makeRes();
    await route(req1 as never, res1 as never, jest.fn());
    expect(res1.statusCode).toBe(200);
    expect((res1.payload as { skipped: boolean }).skipped).toBe(false);
    const after1 = await ports.taskRepo.findById(asTaskId(TASK_ID));
    expect(after1?.title).toBe('first patch');

    // Spy: the second call must NOT mutate the repository.
    const patchSpy = jest.spyOn(ports.taskRepo, 'patch');
    patchSpy.mockClear();

    const req2: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': idemKey },
      body: { title: 'attempted second patch' },
    };
    const res2 = makeRes();
    await route(req2 as never, res2 as never, jest.fn());
    expect(res2.statusCode).toBe(200);
    expect((res2.payload as { skipped: boolean }).skipped).toBe(true);
    expect(patchSpy).not.toHaveBeenCalled();
    const after2 = await ports.taskRepo.findById(asTaskId(TASK_ID));
    expect(after2?.title).toBe('first patch'); // unchanged
  });

  test('missing idempotency key returns 400', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: {},
      body: { title: 'oops' },
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('idempotency key from body is also accepted', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: {},
      body: { idempotencyKey: 'idem-body', title: 'via body' },
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('empty patch body returns 400', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-empty' },
      body: {},
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('unknown field returns 400', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-unknown' },
      body: { whatever: 'unsupported' },
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('priority accepts both integer and string forms', async () => {
    const { ports, route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-prio' },
      body: { priority: 3 },
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    const persisted = await ports.taskRepo.findById(asTaskId(TASK_ID));
    expect(persisted?.priority).toBe('critical');
  });
});
