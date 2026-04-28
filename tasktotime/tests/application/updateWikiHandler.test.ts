/**
 * UpdateWikiHandler — version conflict path test.
 *
 * Pin the QA 2026-04-27 P1-3 fix: a stale `expectedVersion` must throw
 * `WikiStaleVersion` (HTTP 409) instead of `PreconditionFailed` (HTTP 400).
 * The wrong status broke frontend retry-on-409 logic for concurrent wiki
 * edits.
 */

import { UpdateWikiHandler } from '../../application/handlers/updateWikiHandler';
import { TaskNotFound, WikiStaleVersion } from '../../domain/errors';
import { InMemoryTaskRepository } from '../../shared/mocks/InMemoryTaskRepository';
import { FakeClock } from '../../shared/mocks/FakeClock';
import { asTaskId, asUserId, asCompanyId } from '../../domain/identifiers';
import type { Task, EpochMs } from '../../domain/Task';

const T0 = 1_700_000_000_000;

function buildHandler(seed?: Task) {
  const taskRepo = new InMemoryTaskRepository();
  const clock = new FakeClock(T0 as EpochMs);
  if (seed) taskRepo.seed([seed]);
  return {
    handler: new UpdateWikiHandler({ taskRepo, clock }),
    taskRepo,
  };
}

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: asTaskId('task_1'),
  taskNumber: 'T-2026-0001',
  companyId: asCompanyId('company_acme'),
  title: 'Wiki test',
  bucket: 'next',
  priority: 'medium',
  lifecycle: 'draft',
  source: 'web',
  createdBy: { id: asUserId('user_pm'), name: 'PM' },
  createdAt: T0 as EpochMs,
  updatedAt: T0 as EpochMs,
  history: [],
  transitions: [],
  ...overrides,
});

describe('UpdateWikiHandler', () => {
  test('first edit (currentVersion=0, expectedVersion=0) succeeds and bumps to 1', async () => {
    const { handler, taskRepo } = buildHandler(baseTask());

    const result = await handler.execute({
      taskId: 'task_1',
      contentMd: '# v1',
      expectedVersion: 0,
      by: { id: asUserId('user_pm'), name: 'PM' },
    });

    expect(result.wiki?.version).toBe(1);
    expect(result.wiki?.contentMd).toBe('# v1');
    const persisted = await taskRepo.findById(asTaskId('task_1'));
    expect(persisted?.wiki?.version).toBe(1);
  });

  test('stale expectedVersion throws WikiStaleVersion (HTTP 409 — QA 2026-04-27 P1-3)', async () => {
    const seed = baseTask({
      wiki: {
        contentMd: '# at v3',
        version: 3,
        updatedAt: T0 as EpochMs,
        updatedBy: { id: asUserId('user_pm'), name: 'PM' },
        versionHistory: [],
      },
    });
    const { handler } = buildHandler(seed);

    await expect(
      handler.execute({
        taskId: 'task_1',
        contentMd: '# trying to write at v1',
        expectedVersion: 1,
        by: { id: asUserId('user_pm'), name: 'PM' },
      }),
    ).rejects.toThrow(WikiStaleVersion);
  });

  test('WikiStaleVersion has name="StaleVersion" so HTTP middleware maps it to 409', async () => {
    const seed = baseTask({
      wiki: {
        contentMd: '# at v2',
        version: 2,
        updatedAt: T0 as EpochMs,
        updatedBy: { id: asUserId('user_pm'), name: 'PM' },
        versionHistory: [],
      },
    });
    const { handler } = buildHandler(seed);

    let caught: unknown;
    try {
      await handler.execute({
        taskId: 'task_1',
        contentMd: '# stale write',
        expectedVersion: 1,
        by: { id: asUserId('user_pm'), name: 'PM' },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WikiStaleVersion);
    expect((caught as Error).name).toBe('StaleVersion');
    const meta = (caught as WikiStaleVersion);
    expect(meta.expectedVersion).toBe(1);
    expect(meta.currentVersion).toBe(2);
  });

  test('TaskNotFound when task does not exist', async () => {
    const { handler } = buildHandler();

    await expect(
      handler.execute({
        taskId: 'nonexistent',
        contentMd: '# x',
        expectedVersion: 0,
        by: { id: asUserId('user_pm'), name: 'PM' },
      }),
    ).rejects.toThrow(TaskNotFound);
  });
});
