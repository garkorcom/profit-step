/**
 * Tests for `deleteTaskRoute` — the HTTP adapter for `DELETE /tasks/:id`.
 *
 * Coverage:
 *   - First call sets `archivedAt` and returns 200 with the timestamp.
 *   - Second call (same idempotency key) is a no-op replay.
 *   - Second call with a NEW idempotency key on an already-archived task is
 *     also a no-op (monotonic state change) — `skipped: true`.
 *   - Cross-tenant returns 404; never 403.
 *   - Missing task returns 404.
 *   - Missing idempotency key in both header and body returns 400.
 *
 * The handler relies on `TaskRepository.softDelete` which the in-memory
 * stub implements with the same semantic surface as the Firestore adapter
 * (sets `archivedAt` + `archivedBy`). Production also writes `isArchived:
 * true` and `bucket: 'archive'`; that's verified at the FirestoreTaskRepo
 * adapter test layer, not here.
 */

import { deleteTaskRoute } from '../../../adapters/http/handlers/deleteTask';
import { DeleteTaskHandler } from '../../../application/handlers/deleteTaskHandler';
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

const TASK_ID = 'task_d1';
const COMPANY = 'company_acme';

function seededTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: asTaskId(TASK_ID),
    companyId: asCompanyId(COMPANY),
    ...overrides,
  });
}

function buildHarness(seedTasks: Task[] = []) {
  const ports = makeAllPorts(1_700_000_000_000);
  ports.taskRepo.seed(seedTasks);
  const handler = new DeleteTaskHandler({
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
    clock: ports.clock,
  });
  const route = deleteTaskRoute({
    handler,
    taskRepo: ports.taskRepo as unknown as TaskRepository,
  });
  return { ports, handler, route };
}

describe('deleteTaskRoute', () => {
  test('first call sets archivedAt and returns 200', async () => {
    const { ports, route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-del-1' },
      body: undefined,
    };
    const res = makeRes();

    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.payload).toMatchObject({
      ok: true,
      skipped: false,
      archivedAt: expect.any(Number),
    });
    const persisted = await ports.taskRepo.findById(asTaskId(TASK_ID));
    expect(persisted?.archivedAt).toBeDefined();
    expect(persisted?.archivedBy).toBe(asUserId('user_pm'));
  });

  test('second call with same idempotency key is a no-op replay', async () => {
    const { ports, route } = buildHarness([seededTask()]);
    const idemKey = 'idem-del-replay';
    const req1: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': idemKey },
      body: undefined,
    };
    const res1 = makeRes();
    await route(req1 as never, res1 as never, jest.fn());
    expect((res1.payload as { skipped: boolean }).skipped).toBe(false);
    const archivedAtFirst = (res1.payload as { archivedAt: number }).archivedAt;

    // Spy on softDelete — second call must not mutate.
    const softDeleteSpy = jest.spyOn(ports.taskRepo, 'softDelete');
    softDeleteSpy.mockClear();

    const req2: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': idemKey },
      body: undefined,
    };
    const res2 = makeRes();
    await route(req2 as never, res2 as never, jest.fn());
    expect((res2.payload as { skipped: boolean }).skipped).toBe(true);
    expect(softDeleteSpy).not.toHaveBeenCalled();
    expect((res2.payload as { archivedAt: number }).archivedAt).toBe(
      archivedAtFirst,
    );
  });

  test('second call with new idempotency key on archived task is also a no-op', async () => {
    const { ports, route } = buildHarness([seededTask()]);
    const req1: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-del-A' },
      body: undefined,
    };
    await route(req1 as never, makeRes() as never, jest.fn());

    const softDeleteSpy = jest.spyOn(ports.taskRepo, 'softDelete');
    softDeleteSpy.mockClear();

    const req2: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-del-B' }, // different key
      body: undefined,
    };
    const res2 = makeRes();
    await route(req2 as never, res2 as never, jest.fn());
    expect((res2.payload as { skipped: boolean }).skipped).toBe(true);
    expect(softDeleteSpy).not.toHaveBeenCalled();
  });

  test('cross-tenant returns 404', async () => {
    const { route } = buildHarness([
      seededTask({ companyId: asCompanyId('company_other') }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: { 'idempotency-key': 'idem-del-cross' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('missing task returns 404', async () => {
    const { route } = buildHarness([]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: 'task_nope' },
      headers: { 'idempotency-key': 'idem-del-miss' },
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('missing idempotency key returns 400', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('idempotency key from body is accepted (DELETE clients with body)', async () => {
    const { route } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(COMPANY),
      params: { id: TASK_ID },
      headers: {},
      body: { idempotencyKey: 'idem-del-body' },
    };
    const res = makeRes();
    await route(req as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
