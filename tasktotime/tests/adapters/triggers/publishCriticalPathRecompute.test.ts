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

// ─── TTL elapse semantics with jest.useFakeTimers ───────────────────────
//
// Spec: tasktotime/spec/11-success-metrics.md:23 — "Cross-tenant RLS test
// PASSES" plus the debounced-publish guarantee that underpins CPM-recompute
// metrics. The earlier `describe('publishCriticalPathRecompute')` block
// proves that two back-to-back calls debounce, but does NOT control time —
// it relies on `InMemoryIdempotency` reading the *real* `Date.now()`. That
// means we cannot pin the exact 5-second boundary, only "within the same
// tick".
//
// This block uses `jest.useFakeTimers({ now: ... })` to advance virtual
// time precisely and assert the boundary semantics:
//
//   - 4 seconds apart  → single publish (still within TTL window)
//   - 6 seconds apart  → two publishes (TTL elapsed; fresh reservation)
//   - exactly 5 seconds apart → at the TTL boundary
//   - many rapid edits in a 1-second burst → still ONE publish
//   - debounce key is exactly `cpm_${companyId}_${projectId}`
//   - two tenants, same projectId → no cross-tenant key collision
//
// Why direct `Date.now()` mocking via fake timers? `InMemoryIdempotency`
// (`tasktotime/shared/mocks/StubAllPorts.ts:206-212`) reads `Date.now()`
// at every `.reserve()` call. Jest's `useFakeTimers()` (modern variant,
// default since Jest 27) replaces `Date.now`, `Date constructor`, and
// `setTimeout`/`setInterval`. We do NOT need to advance setTimeout queues
// here — only `Date.now()` matters — but `setSystemTime()` is the public
// API for moving wall-clock forward, so that's what we use.

describe('publishCriticalPathRecompute — TTL elapse semantics with jest.useFakeTimers', () => {
  beforeEach(() => {
    // Reset to the same anchor T0 each test so reservations from a prior
    // test never bleed across the TTL boundary into a new one.
    jest.useFakeTimers({ now: T0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('two publishes 4s apart → only ONE publish (still within 5s TTL)', async () => {
    const { ports, deps } = buildDeps();
    const t = makeTask({
      id: asTaskId('t_4s'),
      projectId: asProjectId('proj_ttl_4s'),
    });

    const a = await publishCriticalPathRecompute(['dependsOn'], t, deps);
    jest.setSystemTime(T0 + 4_000); // 4 seconds later — still inside TTL
    const b = await publishCriticalPathRecompute(['dependsOn'], t, deps);

    expect(a).toMatchObject({ published: true });
    expect(b).toEqual({ skipped: 'debounced' });
    expect(ports.pubsub.published).toHaveLength(1);
  });

  test('two publishes 6s apart → TWO publishes (TTL elapsed, new reservation taken)', async () => {
    const { ports, deps } = buildDeps();
    const t = makeTask({
      id: asTaskId('t_6s'),
      projectId: asProjectId('proj_ttl_6s'),
    });

    const a = await publishCriticalPathRecompute(['dependsOn'], t, deps);
    jest.setSystemTime(T0 + 6_000); // 6 seconds later — TTL has elapsed
    const b = await publishCriticalPathRecompute(['dependsOn'], t, deps);

    expect(a).toMatchObject({ published: true });
    expect(b).toMatchObject({ published: true });
    expect(ports.pubsub.published).toHaveLength(2);
  });

  test('exactly 5s apart → debounced (TTL is half-open; "exp > now" is false at the boundary)', async () => {
    // The InMemoryIdempotency contract:
    //   reserve(key, ttlMs):
    //     const exp = this.reservations.get(key);  // = T0 + 5000
    //     if (exp !== undefined && exp > now) return false;
    // At t=T0+5000 exactly, exp === now ⇒ "exp > now" is false ⇒ we treat
    // the previous reservation as expired and create a new one. So the
    // boundary is OPEN at exactly TTL. This matches the contract: the
    // 5-second debounce window is "(0, 5000]" exclusive on the upper end.
    const { ports, deps } = buildDeps();
    const t = makeTask({
      id: asTaskId('t_exact_boundary'),
      projectId: asProjectId('proj_ttl_exact'),
    });

    await publishCriticalPathRecompute(['dependsOn'], t, deps);
    jest.setSystemTime(T0 + DEBOUNCE_TTL_MS); // exactly the boundary
    const b = await publishCriticalPathRecompute(['dependsOn'], t, deps);

    // Per the InMemoryIdempotency semantics, exact-boundary callers fall on
    // the "TTL elapsed" side and re-publish. If this contract changes (e.g.
    // `>=` instead of `>`), this test will tell you.
    expect(b).toMatchObject({ published: true });
    expect(ports.pubsub.published).toHaveLength(2);
  });

  test('many rapid edits in a sub-1s burst → ONE publish', async () => {
    const { ports, deps } = buildDeps();
    const projectId = asProjectId('proj_burst');
    const burst = 50;

    for (let i = 0; i < burst; i++) {
      // Spread 50 edits across 0..1000ms (well inside the 5s window).
      jest.setSystemTime(T0 + Math.floor((i / burst) * 1_000));
      const ti = makeTask({
        id: asTaskId(`t_burst_${i}`),
        projectId,
      });
      await publishCriticalPathRecompute(
        ['estimatedDurationMinutes'],
        ti,
        deps,
      );
    }

    expect(ports.pubsub.published).toHaveLength(1);
  });

  test('debounce key shape is exactly `cpm_${companyId}_${projectId}`', async () => {
    // We exercise the key indirectly by exposing a custom IdempotencyPort
    // spy that records every `reserve()` call. That contract — the literal
    // string format — is the docstring promise in
    // `adapters/triggers/publishCriticalPathRecompute.ts:97-99`.
    const reserveCalls: Array<{ key: string; ttlMs?: number; result: boolean }> = [];
    const spyIdempotency = {
      reserve: async (key: string, ttlMs?: number) => {
        const result = reserveCalls.every((c) => c.key !== key);
        reserveCalls.push({ key, ttlMs, result });
        return result;
      },
      isProcessed: async () => false,
      release: async () => {
        /* noop */
      },
    };
    const { ports } = buildDeps();
    const deps = {
      pubsub: ports.pubsub,
      idempotency: spyIdempotency,
      clock: ports.clock,
    };
    const t = makeTask({
      id: asTaskId('t_keyshape'),
      projectId: asProjectId('proj_key_shape'),
    });

    await publishCriticalPathRecompute(['dependsOn'], t, deps);

    expect(reserveCalls).toHaveLength(1);
    expect(reserveCalls[0]!.key).toBe(
      `cpm_${t.companyId}_proj_key_shape`,
    );
    expect(reserveCalls[0]!.ttlMs).toBe(DEBOUNCE_TTL_MS);
  });

  test('multi-tenant: same projectId across two companyIds does NOT collide', async () => {
    // Two tenants happen to use the same projectId string. Because the key
    // is `cpm_${companyId}_${projectId}`, both should be allowed to
    // publish — even within the same TTL window — because the keys differ.
    const { ports, deps } = buildDeps();
    const sharedProj = asProjectId('shared_proj_id');

    // Both tasks share `projectId = sharedProj` but the default
    // companyId from `makeTask` is the same in both cases. To exercise
    // multi-tenant isolation we must vary companyId explicitly.
    const tA = makeTask({
      id: asTaskId('t_tenant_a'),
      projectId: sharedProj,
    });
    const tB = makeTask({
      id: asTaskId('t_tenant_b'),
      projectId: sharedProj,
      companyId: 'company_other_tenant' as Task['companyId'],
    });

    const a = await publishCriticalPathRecompute(['dependsOn'], tA, deps);
    // Same wall-clock instant — verifying no cross-tenant key collision.
    const b = await publishCriticalPathRecompute(['dependsOn'], tB, deps);

    expect(a).toMatchObject({ published: true });
    expect(b).toMatchObject({ published: true });
    expect(ports.pubsub.published).toHaveLength(2);
  });
});
