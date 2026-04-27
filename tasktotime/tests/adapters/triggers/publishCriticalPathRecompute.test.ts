/**
 * Tests for `publishCriticalPathRecompute` — debounced Pub/Sub publisher.
 *
 * Pins:
 *   - shouldPublish gate behaviour for graph-affecting + non-affecting fields.
 *   - Skip when projectId missing.
 *   - Debounce: the second publish within 5 sec for the same project skips.
 *   - Different projects do NOT debounce each other.
 *   - Published payload contains the right fields.
 */

import {
  publishCriticalPathRecompute,
  shouldPublishCriticalPathRecompute,
  RECOMPUTE_CRITICAL_PATH_TOPIC,
  DEBOUNCE_TTL_MS,
  GRAPH_AFFECTING_FIELDS,
} from '../../../adapters/triggers/publishCriticalPathRecompute';
import { makeTask } from '../../../shared/test-helpers/makeTask';
import { makeAllPorts } from '../../../shared/mocks/StubAllPorts';
import {
  asProjectId,
  asTaskId,
} from '../../../domain/identifiers';
import type { Task } from '../../../domain/Task';

const T0 = 1_700_000_000_000;

function buildDeps() {
  const ports = makeAllPorts(T0);
  return {
    ports,
    deps: {
      pubsub: ports.pubsub,
      idempotency: ports.idempotency,
      clock: ports.clock,
    },
  };
}

describe('shouldPublishCriticalPathRecompute', () => {
  test('false when no projectId', () => {
    const t = makeTask({ id: asTaskId('orphan_proj') });
    expect(shouldPublishCriticalPathRecompute(['plannedStartAt'], t)).toBe(false);
  });

  test('false when changedFields are not graph-affecting', () => {
    const t = makeTask({
      id: asTaskId('with_proj'),
      projectId: asProjectId('proj_x'),
    });
    expect(shouldPublishCriticalPathRecompute(['description'], t)).toBe(false);
    expect(shouldPublishCriticalPathRecompute(['memo'], t)).toBe(false);
    expect(shouldPublishCriticalPathRecompute(['priority'], t)).toBe(false);
  });

  test('true on every GRAPH_AFFECTING_FIELDS value', () => {
    const t = makeTask({
      id: asTaskId('with_proj_graph'),
      projectId: asProjectId('proj_y'),
    });
    for (const f of GRAPH_AFFECTING_FIELDS) {
      expect(shouldPublishCriticalPathRecompute([f], t)).toBe(true);
    }
  });

  // ─── Bug 2 — completedAt + projectId now trigger CPM republish ─────
  // Spec: completion-time advances the project's actual finish; re-parenting
  // a task to another project rebuilds CPM of both. These two were missing
  // from GRAPH_AFFECTING_FIELDS and the trigger silently skipped publishes
  // for those changes.
  test('true when only completedAt changed (advances project actual finish)', () => {
    const t = makeTask({
      id: asTaskId('with_proj_completed'),
      projectId: asProjectId('proj_complete'),
    });
    expect(shouldPublishCriticalPathRecompute(['completedAt'], t)).toBe(true);
  });

  test('true when only projectId changed (re-parent)', () => {
    const t = makeTask({
      id: asTaskId('reparented'),
      projectId: asProjectId('proj_new_home'),
    });
    expect(shouldPublishCriticalPathRecompute(['projectId'], t)).toBe(true);
  });

  // ─── Loop-termination contract — EXCLUDED computed fields ──────────
  // These fields are written by `handleRecomputeCriticalPath` itself; if
  // they were graph-affecting we'd republish on our own writes and burn
  // money in a loop. Pin the contract so a future edit doesn't slip them in.
  test('false for isCriticalPath / slackMinutes / subtaskRollup / blocksTaskIds', () => {
    const t = makeTask({
      id: asTaskId('loop_check'),
      projectId: asProjectId('proj_loop'),
    });
    // We pass the names as raw strings (these aren't in TaskWatchedField); the
    // helper just runs `.includes(...)` which returns false for unknown keys.
    expect(
      shouldPublishCriticalPathRecompute(
        ['isCriticalPath' as never],
        t,
      ),
    ).toBe(false);
    expect(
      shouldPublishCriticalPathRecompute(['slackMinutes' as never], t),
    ).toBe(false);
    expect(
      shouldPublishCriticalPathRecompute(['subtaskRollup' as never], t),
    ).toBe(false);
    expect(
      shouldPublishCriticalPathRecompute(['blocksTaskIds' as never], t),
    ).toBe(false);
  });
});

describe('publishCriticalPathRecompute', () => {
  test('publishes a message with the right shape on graph change', async () => {
    const { ports, deps } = buildDeps();
    const t = makeTask({
      id: asTaskId('t_graph'),
      projectId: asProjectId('proj_a'),
      estimatedDurationMinutes: 60,
    });

    const r = await publishCriticalPathRecompute(
      ['estimatedDurationMinutes'],
      t,
      deps,
    );

    expect(r).toMatchObject({ published: true, projectId: 'proj_a' });
    expect(ports.pubsub.published).toHaveLength(1);
    const sent = ports.pubsub.published[0];
    expect(sent.topic).toBe(RECOMPUTE_CRITICAL_PATH_TOPIC);
    expect(sent.message.data).toMatchObject({
      projectId: 'proj_a',
      companyId: t.companyId,
      triggeredByTaskId: t.id,
      triggeredByFields: ['estimatedDurationMinutes'],
    });
    expect(sent.message.attributes?.projectId).toBe('proj_a');
    expect(sent.message.orderingKey).toBe('proj_a');
  });

  test('skips when changedFields are not graph-affecting', async () => {
    const { ports, deps } = buildDeps();
    const t = makeTask({
      id: asTaskId('t_no_graph'),
      projectId: asProjectId('proj_b'),
    });
    const r = await publishCriticalPathRecompute(['memo'], t, deps);
    expect(r).toEqual({ skipped: 'no_graph_affecting_change' });
    expect(ports.pubsub.published).toHaveLength(0);
  });

  test('skips when no projectId', async () => {
    const { ports, deps } = buildDeps();
    const t = makeTask({ id: asTaskId('t_no_proj') });
    const r = await publishCriticalPathRecompute(['plannedStartAt'], t, deps);
    expect(r).toEqual({ skipped: 'no_project' });
    expect(ports.pubsub.published).toHaveLength(0);
  });

  test('debounces second publish within 5 seconds for the same project', async () => {
    const { ports, deps } = buildDeps();
    const t1 = makeTask({
      id: asTaskId('t_dup_1'),
      projectId: asProjectId('proj_dbnc'),
    });
    const t2 = makeTask({
      id: asTaskId('t_dup_2'),
      projectId: asProjectId('proj_dbnc'),
    });

    const a = await publishCriticalPathRecompute(['dependsOn'], t1, deps);
    const b = await publishCriticalPathRecompute(['plannedStartAt'], t2, deps);

    expect(a).toMatchObject({ published: true });
    expect(b).toEqual({ skipped: 'debounced' });
    expect(ports.pubsub.published).toHaveLength(1);
  });

  test('different projects do NOT debounce each other', async () => {
    const { ports, deps } = buildDeps();
    const t_a = makeTask({
      id: asTaskId('t_proj_a'),
      projectId: asProjectId('proj_aaa'),
    });
    const t_b = makeTask({
      id: asTaskId('t_proj_b'),
      projectId: asProjectId('proj_bbb'),
    });

    await publishCriticalPathRecompute(['dependsOn'], t_a, deps);
    await publishCriticalPathRecompute(['dependsOn'], t_b, deps);

    expect(ports.pubsub.published).toHaveLength(2);
  });

  test('exposes the topic + debounce TTL constants', () => {
    expect(RECOMPUTE_CRITICAL_PATH_TOPIC).toBe('recomputeCriticalPath');
    expect(DEBOUNCE_TTL_MS).toBe(5_000);
  });
});
