/**
 * Integration tests for the `/api/gtd-tasks/*` backwards-compat proxy.
 *
 * Coverage requirements (from the task spec):
 *   - Legacy create payload `{ title, status: 'inProgress' }` → tasktotime
 *     task created (proxy demotes to `'ready'` + bot must transition).
 *   - Legacy GET response includes `status: 'in_progress'` (NOT `lifecycle`).
 *   - Unknown legacy status → 400 with helpful error.
 *   - Cross-tenant guard works as in tasktotime handlers.
 *
 * Approach: mirrors the fake-req / fake-res pattern in `patchTask.test.ts`
 * and `deleteTask.test.ts`. Rather than spin up `supertest` (not in deps),
 * we construct each route handler factory directly and invoke it with the
 * same hand-rolled fakes used everywhere else in tasktotime tests. That
 * keeps the tests pure-unit and the test runtime fast.
 */

import {
  legacyCreateRoute,
  legacyGetRoute,
  legacyListRoute,
  legacyPatchRoute,
  legacyDeleteRoute,
} from '../../../../adapters/http/handlers/legacyGtdProxy';
import { CreateTaskHandler } from '../../../../application/handlers/createTaskHandler';
import { PatchTaskHandler } from '../../../../application/handlers/patchTaskHandler';
import { TransitionTaskHandler } from '../../../../application/handlers/transitionTaskHandler';
import { DeleteTaskHandler } from '../../../../application/handlers/deleteTaskHandler';
import { TaskService } from '../../../../domain/services/TaskService';
import { makeAllPorts } from '../../../../shared/mocks/StubAllPorts';
import { makeTask } from '../../../../shared/test-helpers/makeTask';
import {
  asCompanyId,
  asTaskId,
  asUserId,
} from '../../../../domain/identifiers';
import type { Task } from '../../../../domain/Task';
import type { AuthContext } from '../../../../adapters/http/middleware';

// ─── Fake req / res ─────────────────────────────────────────────────────

interface FakeRequest {
  auth?: AuthContext;
  params: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
  query?: Record<string, unknown>;
  url?: string;
  method?: string;
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

const COMPANY = 'company_acme';
const CALLER_ID = 'user_pm';
const CALLER_NAME = 'PM';
const NOW = 1_700_000_000_000;

function makeAuth(companyId = COMPANY): AuthContext {
  return {
    by: { id: asUserId(CALLER_ID), name: CALLER_NAME },
    companyId,
    tokenType: 'master',
  };
}

function buildHarness(seedTasks: Task[] = []) {
  const ports = makeAllPorts(NOW);
  ports.taskRepo.seed(seedTasks);

  const taskService = new TaskService({
    taskRepo: ports.taskRepo,
    transitionLog: ports.transitionLog,
    workSessions: ports.workSessions,
    payroll: ports.payroll,
    idempotency: ports.idempotency,
    clock: ports.clock,
    idGenerator: ports.idGenerator,
  });

  const createTaskHandler = new CreateTaskHandler({ taskService });
  const transitionTaskHandler = new TransitionTaskHandler({ taskService });
  const patchTaskHandler = new PatchTaskHandler({
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
  });
  const deleteTaskHandler = new DeleteTaskHandler({
    taskRepo: ports.taskRepo,
    idempotency: ports.idempotency,
    clock: ports.clock,
  });

  return {
    ports,
    handlers: {
      createTaskHandler,
      transitionTaskHandler,
      patchTaskHandler,
      deleteTaskHandler,
    },
    routes: {
      create: legacyCreateRoute({ createTaskHandler, now: () => NOW }),
      get: legacyGetRoute({ taskRepo: ports.taskRepo }),
      list: legacyListRoute({ taskRepo: ports.taskRepo }),
      patch: legacyPatchRoute({
        taskRepo: ports.taskRepo,
        patchTaskHandler,
        transitionTaskHandler,
      }),
      del: legacyDeleteRoute({
        taskRepo: ports.taskRepo,
        deleteTaskHandler,
      }),
    },
  };
}

function seededTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: asTaskId('task_t1'),
    companyId: asCompanyId(COMPANY),
    title: 'Original',
    lifecycle: 'ready',
    bucket: 'next',
    priority: 'medium',
    assignedTo: { id: asUserId(CALLER_ID), name: CALLER_NAME },
    ...overrides,
  });
}

// ─── POST /api/gtd-tasks ────────────────────────────────────────────────

describe('legacyCreateRoute', () => {
  test("legacy `{ title, status: 'inProgress' }` creates tasktotime task", async () => {
    const { ports, routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: { 'idempotency-key': 'idem-create-1' },
      body: { title: 'Frame the wall', status: 'inProgress' },
    };
    const res = makeRes();

    await routes.create(req as never, res as never, jest.fn());

    expect(res.statusCode).toBe(201);
    const payload = res.payload as { ok: boolean; taskId: string; task: Record<string, unknown> };
    expect(payload.ok).toBe(true);
    expect(payload.taskId).toBeDefined();
    expect(payload.task.title).toBe('Frame the wall');
    // Initial lifecycle forced to `ready` (legacy `inProgress` → started
    // is not a valid initial state). Outbound legacy form for `ready` is
    // `pending`.
    expect(payload.task.status).toBe('pending');
    expect((payload.task._canonical as Record<string, string>).lifecycle).toBe('ready');

    // Verify it actually persisted in the tasktotime repo.
    const created = await ports.taskRepo.findById(asTaskId(payload.taskId));
    expect(created).toBeDefined();
    expect(created!.companyId).toBe(COMPANY);
    expect(created!.lifecycle).toBe('ready');
    expect(created!.title).toBe('Frame the wall');
  });

  test("legacy `{ status: 'todo' }` → tasktotime lifecycle 'ready'", async () => {
    const { ports, routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: { 'idempotency-key': 'idem-todo' },
      body: { title: 'T', status: 'todo' },
    };
    const res = makeRes();
    await routes.create(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(201);
    const payload = res.payload as { taskId: string };
    const created = await ports.taskRepo.findById(asTaskId(payload.taskId));
    expect(created!.lifecycle).toBe('ready');
  });

  test('unknown legacy status → 400 with helpful error', async () => {
    const { routes, ports } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: { 'idempotency-key': 'idem-bad' },
      body: { title: 'T', status: 'totally_invented' },
    };
    const res = makeRes();
    await routes.create(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
    const payload = res.payload as {
      ok: boolean;
      error: { code: string; message: string; field: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe('INVALID_LEGACY_STATUS');
    expect(payload.error.field).toBe('status');
    expect(payload.error.message).toContain('totally_invented');
    // Nothing was created.
    expect(ports.taskRepo.size()).toBe(0);
  });

  test('missing idempotency key → 400', async () => {
    const { routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: {},
      body: { title: 'T', status: 'todo' },
    };
    const res = makeRes();
    await routes.create(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
  });

  test('idempotency key in body works as fallback', async () => {
    const { routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: {},
      body: { title: 'T', status: 'todo', idempotencyKey: 'idem-body' },
    };
    const res = makeRes();
    await routes.create(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(201);
  });

  test('default dueAt is 7 days out when no dueDate provided', async () => {
    const { ports, routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: { 'idempotency-key': 'idem-default-due' },
      body: { title: 'T' },
    };
    const res = makeRes();
    await routes.create(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(201);
    const payload = res.payload as { taskId: string };
    const created = await ports.taskRepo.findById(asTaskId(payload.taskId));
    expect(created!.dueAt).toBe(NOW + 7 * 24 * 60 * 60 * 1000);
  });

  test('missing auth → bubbles via next', async () => {
    const { routes } = buildHarness();
    const next = jest.fn();
    const req: FakeRequest = {
      params: {},
      headers: { 'idempotency-key': 'idem' },
      body: { title: 'T' },
    };
    const res = makeRes();
    await routes.create(req as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── GET /api/gtd-tasks/:id ─────────────────────────────────────────────

describe('legacyGetRoute', () => {
  test("response includes `status` (NOT `lifecycle`)", async () => {
    const { routes } = buildHarness([seededTask({ lifecycle: 'started' })]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await routes.get(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { ok: boolean; task: Record<string, unknown> };
    expect(payload.ok).toBe(true);
    expect(payload.task.status).toBe('in_progress');
    expect(payload.task.lifecycle).toBeUndefined();
    expect(payload.task.taskHistory).toBeDefined();
    expect(payload.task.history).toBeUndefined();
  });

  test('cross-tenant returns 404 (no info leak)', async () => {
    const { routes } = buildHarness([
      seededTask({ companyId: asCompanyId('company_other') }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await routes.get(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(404);
    const payload = res.payload as { error: { code: string } };
    expect(payload.error.code).toBe('NOT_FOUND');
  });

  test('non-existent task returns 404', async () => {
    const { routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_does_not_exist' },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await routes.get(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(404);
  });

  test('outbound shape excludes computed fields', async () => {
    const { routes } = buildHarness([
      seededTask({ isCriticalPath: true, slackMinutes: 120 }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await routes.get(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { task: Record<string, unknown> };
    expect(payload.task.isCriticalPath).toBeUndefined();
    expect(payload.task.slackMinutes).toBeUndefined();
    expect(payload.task.subtaskRollup).toBeUndefined();
  });

  test('missing :id returns 400', async () => {
    const { routes } = buildHarness();
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await routes.get(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
  });
});

// ─── PATCH /api/gtd-tasks/:id ───────────────────────────────────────────

describe('legacyPatchRoute', () => {
  test('legacy PATCH with title-only updates the title', async () => {
    const { ports, routes } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-title' },
      body: { title: 'Renamed' },
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { task: Record<string, unknown> };
    expect(payload.task.title).toBe('Renamed');
    const persisted = await ports.taskRepo.findById(asTaskId('task_t1'));
    expect(persisted!.title).toBe('Renamed');
  });

  test('legacy PATCH with status drives the transition state machine', async () => {
    const { ports, routes } = buildHarness([seededTask({ lifecycle: 'ready' })]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-status' },
      body: { status: 'in_progress' },
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { task: Record<string, unknown> };
    expect(payload.task.status).toBe('in_progress');
    const persisted = await ports.taskRepo.findById(asTaskId('task_t1'));
    expect(persisted!.lifecycle).toBe('started');
  });

  test('legacy PATCH with mixed fields applies patch + transition', async () => {
    const { ports, routes } = buildHarness([seededTask({ lifecycle: 'ready' })]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-mixed' },
      body: { title: 'Doing it', status: 'in_progress' },
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const persisted = await ports.taskRepo.findById(asTaskId('task_t1'));
    expect(persisted!.title).toBe('Doing it');
    expect(persisted!.lifecycle).toBe('started');
  });

  test('cross-tenant PATCH returns 404', async () => {
    const { routes } = buildHarness([
      seededTask({ companyId: asCompanyId('company_other') }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-cross' },
      body: { title: 'attacker' },
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(404);
  });

  test('PATCH with unknown status returns 400 (no mutation)', async () => {
    const { ports, routes } = buildHarness([seededTask({ lifecycle: 'ready' })]);
    const before = await ports.taskRepo.findById(asTaskId('task_t1'));
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-unknown' },
      body: { status: 'gibberish' },
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
    const payload = res.payload as { error: { code: string } };
    expect(payload.error.code).toBe('INVALID_LEGACY_STATUS');
    const after = await ports.taskRepo.findById(asTaskId('task_t1'));
    expect(after!.lifecycle).toBe(before!.lifecycle);
    expect(after!.title).toBe(before!.title);
  });

  test('PATCH with status equal to current lifecycle is a no-op', async () => {
    const { ports, routes } = buildHarness([seededTask({ lifecycle: 'started' })]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-noop-trans' },
      body: { status: 'in_progress' }, // already started
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const persisted = await ports.taskRepo.findById(asTaskId('task_t1'));
    expect(persisted!.lifecycle).toBe('started');
  });

  test('missing idempotency key → 400', async () => {
    const { routes } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: {},
      body: { title: 'oops' },
    };
    const res = makeRes();
    await routes.patch(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
  });
});

// ─── DELETE /api/gtd-tasks/:id ──────────────────────────────────────────

describe('legacyDeleteRoute', () => {
  test('legacy DELETE soft-deletes via tasktotime archive flow', async () => {
    const { ports, routes } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-delete' },
      body: undefined,
    };
    const res = makeRes();
    await routes.del(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { ok: boolean; archived: boolean };
    expect(payload.ok).toBe(true);
    expect(payload.archived).toBe(true);
    const persisted = await ports.taskRepo.findById(asTaskId('task_t1'));
    expect(persisted!.archivedAt).toBeDefined();
  });

  test('cross-tenant DELETE returns 404', async () => {
    const { routes } = buildHarness([
      seededTask({ companyId: asCompanyId('company_other') }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: { 'idempotency-key': 'idem-cross-del' },
      body: undefined,
    };
    const res = makeRes();
    await routes.del(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(404);
  });

  test('missing idempotency key → 400', async () => {
    const { routes } = buildHarness([seededTask()]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: { id: 'task_t1' },
      headers: {},
      body: undefined,
    };
    const res = makeRes();
    await routes.del(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /api/gtd-tasks (list) ──────────────────────────────────────────

describe('legacyListRoute', () => {
  test('lists tasks in legacy shape', async () => {
    const { routes } = buildHarness([
      seededTask({
        id: asTaskId('task_a'),
        title: 'A',
        lifecycle: 'ready',
      }),
      seededTask({
        id: asTaskId('task_b'),
        title: 'B',
        lifecycle: 'started',
      }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: {},
      body: undefined,
      query: {},
    };
    const res = makeRes();
    await routes.list(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { ok: boolean; tasks: Array<Record<string, unknown>> };
    expect(payload.ok).toBe(true);
    expect(payload.tasks.length).toBe(2);
    for (const t of payload.tasks) {
      expect(typeof t.status).toBe('string');
      expect(t.lifecycle).toBeUndefined();
    }
  });

  test('legacy status query maps to lifecycle filter', async () => {
    const { routes } = buildHarness([
      seededTask({ id: asTaskId('task_a'), lifecycle: 'ready' }),
      seededTask({ id: asTaskId('task_b'), lifecycle: 'started' }),
    ]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: {},
      body: undefined,
      query: { status: 'in_progress' },
    };
    const res = makeRes();
    await routes.list(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(200);
    const payload = res.payload as { tasks: Array<{ id: string; status: string }> };
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].id).toBe('task_b');
    expect(payload.tasks[0].status).toBe('in_progress');
  });

  test('unknown legacy status in list query returns 400', async () => {
    const { routes } = buildHarness([]);
    const req: FakeRequest = {
      auth: makeAuth(),
      params: {},
      headers: {},
      body: undefined,
      query: { status: 'gibberish' },
    };
    const res = makeRes();
    await routes.list(req as never, res as never, jest.fn());
    expect(res.statusCode).toBe(400);
  });
});
