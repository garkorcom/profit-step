/**
 * onTasktotimeTaskUpdate — `dependsOn` reverse-cascade integration test.
 *
 * What this test pins
 * -------------------
 * The PR-B2 reverse-edge denormalisation: when task X's `dependsOn[]` list
 * gets a new target T, the trigger writes T's `blocksTaskIds[]` so it
 * includes X. Symmetric on remove.
 *
 * Crucially, the cascade MUST terminate after one hop. The secondary
 * `onTaskUpdate` invocation that fires when `T.blocksTaskIds` is patched
 * MUST exit with `no_watched_field_change` because `blocksTaskIds` is on
 * the EXCLUDED list inside `tasktotime/adapters/triggers/_shared.ts`.
 * Without that termination the reverse cascade would loop indefinitely
 * across the dependency graph.
 *
 * Bar
 * ---
 *   1. Seed two tasks (source X, target T) with empty cross-references.
 *   2. Fire a wrapped change on X that adds T to `dependsOn[]`.
 *   3. Wait for T.blocksTaskIds to contain X (proves the cascade ran).
 *   4. Assert NO secondary idempotency reservation lands for T (i.e. the
 *      follow-up onTaskUpdate against T's patch exits BEFORE the
 *      idempotency.reserve() call — `blocksTaskIds` filtered out).
 *
 * Note on triggering the secondary fire
 * -------------------------------------
 * The wrapped trigger fires once per `wrapped()` call — Firestore writes
 * the patch to T but the platform-level onUpdate trigger is NOT
 * automatically replayed by `firebase-functions-test`. To exercise the
 * loop-defence we manually wrap the would-be secondary change and
 * confirm it exits with `no_watched_field_change`. This mirrors the
 * production flow: Firestore would re-fire onTaskUpdate on T after the
 * patch lands, and the handler is expected to no-op.
 *
 * Required runtime
 * ----------------
 *   firebase emulators:start --only firestore,pubsub
 */

import * as admin from 'firebase-admin';

import {
  asTaskId,
} from '../../../../tasktotime/domain/identifiers';
import type { Task, TaskDependency, EpochMs } from '../../../../tasktotime/domain/Task';

import {
  assertFirestoreEmulator,
  cleanupFunctionsTest,
  getOrInitAdminApp,
} from './helpers/setupEmulators';
import {
  cleanupScope,
  createTestScope,
  makeScopedTask,
  readTask,
  seedTask,
  type TestScope,
} from './helpers/createTestProject';
import { waitFor, waitForOrNull } from './helpers/waitFor';
import { makeDocChange, wrapOnTaskUpdate } from './helpers/wrappedTriggers';

const PROCESSED_EVENTS = 'processedEvents';
const TASKS = 'tasktotime_tasks';
const KEY_PREFIX = 'tt_';

let emulatorReachable = false;

beforeAll(async () => {
  getOrInitAdminApp();
  try {
    await assertFirestoreEmulator();
    emulatorReachable = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[tasktotime/integration/onTaskUpdate-cascadeBlocks] Skipping suite: ${(err as Error).message}`,
    );
  }
});

afterAll(() => {
  cleanupFunctionsTest();
});

describe('onTasktotimeTaskUpdate — dependsOn reverse cascade (integration)', () => {
  let scope: TestScope;
  let wrapped: (change: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;

  beforeAll(() => {
    scope = createTestScope('on_update_cascade');
    if (emulatorReachable) {
      wrapped = wrapOnTaskUpdate() as typeof wrapped;
    }
  });

  afterEach(async () => {
    if (emulatorReachable) {
      await cleanupScope(scope);
    }
  });

  testIfEmulator(
    'adding dependsOn fans out: target.blocksTaskIds gets the source id',
    async () => {
      const sourceId = asTaskId(`task_src_${scope.suiteSuffix}`);
      const targetId = asTaskId(`task_tgt_${scope.suiteSuffix}`);
      const eventId = `evt_cascade_add_${scope.suiteSuffix}_1`;

      // Seed both tasks. The target starts with no blocks; the source
      // starts with no dependencies. After the trigger fires the target
      // should have blocksTaskIds = [sourceId].
      const target = makeScopedTask(scope, {
        id: targetId,
        blocksTaskIds: [],
      });
      await seedTask(target);

      const before = makeScopedTask(scope, {
        id: sourceId,
        dependsOn: [],
      });
      const after: Task = { ...before, dependsOn: [makeDep(targetId)] };

      const change = makeDocChange(
        toWireDoc(before),
        toWireDoc(after),
        `${TASKS}/${sourceId}`,
      );
      await wrapped(change, { eventId, params: { taskId: sourceId as string } });

      // Cascade applied → target now blocksTaskIds includes sourceId.
      const refreshed = await waitFor(
        async () => {
          const t = await readTask(targetId);
          if (!t) return null;
          if (!t.blocksTaskIds || t.blocksTaskIds.length === 0) return null;
          return t;
        },
        { label: 'cascadeBlocks.add.applied', timeoutMs: 8000 },
      );
      expect(refreshed.blocksTaskIds).toEqual([sourceId]);

      // The source's idempotency reservation MUST exist (handler ran).
      const db = admin.firestore();
      const expectedSourceKey = `${KEY_PREFIX}tasktotime_task_update_${sourceId}_${eventId}`;
      const sourceDedupe = await db
        .collection(PROCESSED_EVENTS)
        .doc(expectedSourceKey)
        .get();
      expect(sourceDedupe.exists).toBe(true);
    },
  );

  testIfEmulator(
    'removing dependsOn drops the source id from target.blocksTaskIds',
    async () => {
      const sourceId = asTaskId(`task_src_remove_${scope.suiteSuffix}`);
      const targetId = asTaskId(`task_tgt_remove_${scope.suiteSuffix}`);
      const eventId = `evt_cascade_remove_${scope.suiteSuffix}_1`;

      // Seed: target already has the source id; source already lists the
      // target as a dependency. The change removes the dependency.
      const target = makeScopedTask(scope, {
        id: targetId,
        blocksTaskIds: [sourceId],
      });
      await seedTask(target);

      const before = makeScopedTask(scope, {
        id: sourceId,
        dependsOn: [makeDep(targetId)],
      });
      const after: Task = { ...before, dependsOn: [] };

      const change = makeDocChange(
        toWireDoc(before),
        toWireDoc(after),
        `${TASKS}/${sourceId}`,
      );
      await wrapped(change, { eventId, params: { taskId: sourceId as string } });

      const refreshed = await waitFor(
        async () => {
          const t = await readTask(targetId);
          if (!t) return null;
          // Wait until the cascade has emptied the array (or the field is
          // missing). [] is the intended end state.
          if (t.blocksTaskIds && t.blocksTaskIds.length > 0) return null;
          return t;
        },
        { label: 'cascadeBlocks.remove.applied', timeoutMs: 8000 },
      );
      expect(refreshed.blocksTaskIds ?? []).toEqual([]);
    },
  );

  // ─── Loop-termination contract — single-hop proof ────────────────────
  // The cascade patches `T.blocksTaskIds`. In production Firestore would
  // re-fire onTaskUpdate on T. We simulate that secondary fire by hand
  // and assert it exits BEFORE the idempotency reservation, proving the
  // EXCLUDED-fields filter terminates the cascade after one hop.
  testIfEmulator(
    'secondary onTaskUpdate on the cascaded target exits with no_watched_field_change',
    async () => {
      const targetId = asTaskId(`task_loop_tgt_${scope.suiteSuffix}`);
      const sourceId = asTaskId(`task_loop_src_${scope.suiteSuffix}`);
      const secondaryEventId = `evt_loop_secondary_${scope.suiteSuffix}_1`;

      // Build a synthetic before/after on the TARGET that reflects what
      // production sees right after the cascade patch lands: only
      // `blocksTaskIds` moved, everything else identical.
      const targetBefore = makeScopedTask(scope, {
        id: targetId,
        blocksTaskIds: [],
      });
      const targetAfter: Task = {
        ...targetBefore,
        blocksTaskIds: [sourceId],
      };

      const change = makeDocChange(
        toWireDoc(targetBefore),
        toWireDoc(targetAfter),
        `${TASKS}/${targetId}`,
      );
      await wrapped(change, {
        eventId: secondaryEventId,
        params: { taskId: targetId as string },
      });

      // The secondary fire MUST NOT reserve an idempotency key. The
      // EXCLUDED-fields filter exits before reserve() is reached.
      const db = admin.firestore();
      const expectedKey = `${KEY_PREFIX}tasktotime_task_update_${targetId}_${secondaryEventId}`;
      const dedupeDoc = await waitForOrNull(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(expectedKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'cascadeBlocks.secondary.no-reservation', timeoutMs: 1500 },
      );
      expect(dedupeDoc).toBeNull();
    },
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function testIfEmulator(
  name: string,
  fn: () => Promise<void> | void,
): void {
  it(name, async () => {
    if (!emulatorReachable) {
      // eslint-disable-next-line no-console
      console.warn(`[skip] ${name}: emulator not reachable`);
      return;
    }
    await fn();
  });
}

function makeDep(targetId: import('../../../../tasktotime/domain/identifiers').TaskId): TaskDependency {
  return {
    taskId: targetId,
    type: 'finish_to_start',
    isHardBlock: true,
    createdAt: 1_700_000_000_000 as EpochMs,
    createdBy: { id: 'pm' as unknown as import('../../../../tasktotime/domain/identifiers').UserId, name: 'PM' },
  };
}

function toWireDoc(task: Task): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { epochsToTimestamps } = require('../../../../tasktotime/adapters/firestore/_shared');
  const { id: _id, ...rest } = task as unknown as Record<string, unknown>;
  return epochsToTimestamps(rest);
}
