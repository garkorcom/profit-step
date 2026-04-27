/**
 * Tests for `cascadeBlocksTaskIds` — the reverse-edge denormalisation
 * cascade fired by `onTaskUpdate` when `dependsOn[]` changes.
 *
 * Pins:
 *   - On add: target.blocksTaskIds gets the source id (no duplicate if
 *     already present).
 *   - On remove: target.blocksTaskIds drops the source id (no-op if it
 *     was never there).
 *   - Cross-tenant target is refused (skippedCrossTenant).
 *   - Missing target is reported (skippedNotFound) but doesn't throw.
 *   - Multiple add+remove operations apply atomically per target.
 */

import { cascadeBlocksTaskIds } from '../../../adapters/triggers/cascadeBlocksTaskIds';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asCompanyId,
  asTaskId,
  asUserId,
} from '../../../domain/identifiers';
import type { Task, TaskDependency, EpochMs } from '../../../domain/Task';

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

function buildDeps() {
  const ports = makeAllPorts(T0);
  return {
    ports,
    deps: { taskRepo: ports.taskRepo },
  };
}

describe('cascadeBlocksTaskIds', () => {
  test('add: appends source id to target.blocksTaskIds', async () => {
    const { ports, deps } = buildDeps();
    const target = makeTask({
      id: asTaskId('task_t1'),
      blocksTaskIds: [],
    });
    await ports.taskRepo.save(target);

    const before = makeTask({ id: asTaskId('task_src1'), dependsOn: [] });
    const after: Task = { ...before, dependsOn: [dep('task_t1')] };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.added).toEqual([asTaskId('task_t1')]);
    expect(result.removed).toEqual([]);

    const refreshed = await ports.taskRepo.findById(target.id);
    expect(refreshed?.blocksTaskIds).toEqual([asTaskId('task_src1')]);
  });

  test('add: skips when source already present in blocksTaskIds', async () => {
    const { ports, deps } = buildDeps();
    const target = makeTask({
      id: asTaskId('task_t2'),
      blocksTaskIds: [asTaskId('task_src2')],
    });
    await ports.taskRepo.save(target);

    const before = makeTask({ id: asTaskId('task_src2'), dependsOn: [] });
    const after: Task = { ...before, dependsOn: [dep('task_t2')] };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.added).toEqual([]);
    const refreshed = await ports.taskRepo.findById(target.id);
    expect(refreshed?.blocksTaskIds).toEqual([asTaskId('task_src2')]);
  });

  test('remove: drops source id from target.blocksTaskIds', async () => {
    const { ports, deps } = buildDeps();
    const target = makeTask({
      id: asTaskId('task_t3'),
      blocksTaskIds: [asTaskId('task_src3'), asTaskId('task_other')],
    });
    await ports.taskRepo.save(target);

    const before = makeTask({
      id: asTaskId('task_src3'),
      dependsOn: [dep('task_t3')],
    });
    const after: Task = { ...before, dependsOn: [] };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.removed).toEqual([asTaskId('task_t3')]);
    const refreshed = await ports.taskRepo.findById(target.id);
    expect(refreshed?.blocksTaskIds).toEqual([asTaskId('task_other')]);
  });

  test('remove: no-op when source was never in blocksTaskIds', async () => {
    const { ports, deps } = buildDeps();
    const target = makeTask({
      id: asTaskId('task_t4'),
      blocksTaskIds: [asTaskId('task_unrelated')],
    });
    await ports.taskRepo.save(target);

    const before = makeTask({
      id: asTaskId('task_src4'),
      dependsOn: [dep('task_t4')],
    });
    const after: Task = { ...before, dependsOn: [] };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.removed).toEqual([]);
    const refreshed = await ports.taskRepo.findById(target.id);
    expect(refreshed?.blocksTaskIds).toEqual([asTaskId('task_unrelated')]);
  });

  test('add + remove combined: each target gets a single targeted patch', async () => {
    const { ports, deps } = buildDeps();
    const oldTarget = makeTask({
      id: asTaskId('task_old'),
      blocksTaskIds: [asTaskId('task_src5')],
    });
    const newTarget = makeTask({
      id: asTaskId('task_new'),
      blocksTaskIds: [],
    });
    await ports.taskRepo.save(oldTarget);
    await ports.taskRepo.save(newTarget);

    const before = makeTask({
      id: asTaskId('task_src5'),
      dependsOn: [dep('task_old')],
    });
    const after: Task = { ...before, dependsOn: [dep('task_new')] };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.added).toEqual([asTaskId('task_new')]);
    expect(result.removed).toEqual([asTaskId('task_old')]);

    expect((await ports.taskRepo.findById(oldTarget.id))?.blocksTaskIds).toEqual([]);
    expect((await ports.taskRepo.findById(newTarget.id))?.blocksTaskIds).toEqual([
      asTaskId('task_src5'),
    ]);
  });

  test('cross-tenant target is refused', async () => {
    const { ports, deps } = buildDeps();
    const xtarget = makeTask({
      id: asTaskId('task_xtenant'),
      companyId: asCompanyId('co_other'),
      blocksTaskIds: [],
    });
    await ports.taskRepo.save(xtarget);

    const before = makeTask({
      id: asTaskId('task_src6'),
      companyId: asCompanyId('co_self'),
      dependsOn: [],
    });
    const after: Task = { ...before, dependsOn: [dep('task_xtenant')] };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.skippedCrossTenant).toEqual([asTaskId('task_xtenant')]);
    expect(result.added).toEqual([]);
    const refreshed = await ports.taskRepo.findById(xtarget.id);
    expect(refreshed?.blocksTaskIds).toEqual([]);
  });

  test('missing target is reported but does not throw', async () => {
    const { deps } = buildDeps();
    const before = makeTask({ id: asTaskId('task_src7'), dependsOn: [] });
    const after: Task = {
      ...before,
      dependsOn: [dep('task_does_not_exist')],
    };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.skippedNotFound).toEqual([asTaskId('task_does_not_exist')]);
    expect(result.added).toEqual([]);
  });

  test('handles many targets in one pass', async () => {
    const { ports, deps } = buildDeps();
    const targetIds = ['t_a', 't_b', 't_c', 't_d'].map(asTaskId);
    for (const id of targetIds) {
      await ports.taskRepo.save(makeTask({ id, blocksTaskIds: [] }));
    }
    const before = makeTask({ id: asTaskId('task_src8'), dependsOn: [] });
    const after: Task = {
      ...before,
      dependsOn: targetIds.map((id) => dep(id as string)),
    };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.added).toEqual(targetIds);
    for (const id of targetIds) {
      expect((await ports.taskRepo.findById(id))?.blocksTaskIds).toEqual([
        asTaskId('task_src8'),
      ]);
    }
  });

  test('dedupes when caller passes duplicate dependencies', async () => {
    const { ports, deps } = buildDeps();
    const target = makeTask({
      id: asTaskId('task_dedup'),
      blocksTaskIds: [],
    });
    await ports.taskRepo.save(target);

    const before = makeTask({ id: asTaskId('task_src9'), dependsOn: [] });
    const after: Task = {
      ...before,
      dependsOn: [dep('task_dedup'), dep('task_dedup', false)],
    };

    const result = await cascadeBlocksTaskIds(before, after, deps);

    expect(result.added).toEqual([asTaskId('task_dedup')]);
  });
});
