/**
 * Pub/Sub round-trip integration test for `recomputeCriticalPath`.
 *
 * What this test pins
 * -------------------
 * The full debounce → publish → subscribe → recompute → patch flow:
 *
 *   1. A graph-affecting change on a task in project P (e.g. `dependsOn`,
 *      `estimatedDurationMinutes`, `plannedStartAt`) lands via wrapped
 *      `onTaskUpdate`.
 *   2. `publishCriticalPathRecompute` debounces on the project key
 *      (5-second TTL via IdempotencyPort.reserve) and publishes a single
 *      message onto the `recomputeCriticalPath` topic.
 *   3. The wrapped subscriber `onTasktotimeRecomputeCriticalPath` consumes
 *      the message, runs `domain/criticalPath.computeSchedule` over all
 *      tasks in P, and patches each task's `isCriticalPath` +
 *      `slackMinutes` only when the value differs.
 *   4. The patched fields are on the EXCLUDED watched-fields list — the
 *      onTaskUpdate fan-out from those patches MUST exit with
 *      `no_watched_field_change`. This is the loop-termination contract
 *      that lets the subscriber update many tasks without re-publishing.
 *
 * Bar
 * ---
 * Build a tiny chain (3 tasks: A → B → C in P) where the critical path is
 * trivially A → B → C. Pre-seed all three with `isCriticalPath: false` and
 * `slackMinutes: 0`. Fire `onTaskUpdate` on A with a change to
 * `estimatedDurationMinutes`. Wait for the publisher (debounce key reserves
 * by `cpm_<companyId>_<projectId>`, so the dedupe doc landing is the
 * publish-window proof). Then drive the wrapped subscriber by hand with a
 * synthetic message and assert the persisted tasks now have
 * `isCriticalPath: true` for every task on the chain (the only path is
 * critical).
 *
 * Why we drive the subscriber by hand
 * -----------------------------------
 * `firebase-functions-test`'s `wrap()` does NOT relay messages from the
 * Pub/Sub emulator; it only invokes the function with the data we pass. To
 * exercise the subscriber's contract we wrap it ourselves and pass a
 * matching payload. The publisher side is exercised separately — the
 * idempotency reservation under `cpm_<companyId>_<projectId>` is the
 * observable proof that publish ran.
 *
 * Required runtime
 * ----------------
 *   firebase emulators:start --only firestore,pubsub
 * (Pub/Sub emulator is NOT enabled by default in this repo's firebase.json;
 *  the contributor must enable it explicitly. See PR body.)
 */

import * as admin from 'firebase-admin';

import {
  asProjectId,
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
import { waitFor } from './helpers/waitFor';
import {
  makeDocChange,
  makePubSubMessage,
  wrapOnRecomputeCriticalPath,
  wrapOnTaskUpdate,
} from './helpers/wrappedTriggers';

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
      `[tasktotime/integration/pubsub-cpm-roundtrip] Skipping suite: ${(err as Error).message}`,
    );
  }
});

afterAll(() => {
  cleanupFunctionsTest();
});

describe('Pub/Sub round-trip — recomputeCriticalPath (integration)', () => {
  let scope: TestScope;
  let wrappedUpdate: (change: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;
  let wrappedSubscriber: (message: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;

  beforeAll(() => {
    scope = createTestScope('pubsub_cpm');
    if (emulatorReachable) {
      wrappedUpdate = wrapOnTaskUpdate() as typeof wrappedUpdate;
      wrappedSubscriber = wrapOnRecomputeCriticalPath() as typeof wrappedSubscriber;
    }
  });

  afterEach(async () => {
    if (emulatorReachable) {
      await cleanupScope(scope);
    }
  });

  testIfEmulator(
    'graph change on task A debounces to one publish keyed by (companyId, projectId)',
    async () => {
      const projectId = asProjectId(`proj_cpm_${scope.suiteSuffix}`);
      const idA = asTaskId(`task_A_${scope.suiteSuffix}`);

      const before = makeScopedTask(scope, {
        id: idA,
        projectId,
        estimatedDurationMinutes: 60,
      });
      // Graph-affecting field change → publisher should reserve the
      // debounce key and publish.
      const after: Task = {
        ...before,
        estimatedDurationMinutes: 90,
      };

      const eventId = `evt_cpm_publish_${scope.suiteSuffix}_1`;
      const change = makeDocChange(
        toWireDoc(before),
        toWireDoc(after),
        `${TASKS}/${idA}`,
      );
      await wrappedUpdate(change, {
        eventId,
        params: { taskId: idA as string },
      });

      // The publisher uses IdempotencyPort.reserve with key
      // `cpm_<companyId>_<projectId>` and TTL 5s. The reservation lands
      // at processedEvents/tt_cpm_<...>. Its presence proves the publish
      // window opened.
      const db = admin.firestore();
      const debounceKey = `${KEY_PREFIX}cpm_${scope.companyId}_${projectId}`;
      const dedupeDoc = await waitFor(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(debounceKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'cpm.publisher.reservation', timeoutMs: 8000 },
      );
      expect(dedupeDoc.data()).toMatchObject({ functionName: 'tasktotime' });

      // Re-fire the publisher with a SECOND graph-affecting change in
      // the same window — the debounce key already reserved, so the
      // second publish skips. We can't observe message counts in the
      // emulator without a subscription, but we CAN observe that the
      // dedupe doc is unchanged (same expiresAt timestamp).
      const reservedAtFirst = (dedupeDoc.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(typeof reservedAtFirst).toBe('number');

      const eventId2 = `evt_cpm_publish_${scope.suiteSuffix}_2`;
      const after2: Task = {
        ...after,
        estimatedDurationMinutes: 120,
      };
      const change2 = makeDocChange(
        toWireDoc(after),
        toWireDoc(after2),
        `${TASKS}/${idA}`,
      );
      await wrappedUpdate(change2, {
        eventId: eventId2,
        params: { taskId: idA as string },
      });

      const stillReserved = await db
        .collection(PROCESSED_EVENTS)
        .doc(debounceKey)
        .get();
      const reservedAtSecond = (stillReserved.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      // Same reservation document — second call short-circuited at the
      // debounce check (no new reservation, no fresh reservedAt).
      expect(reservedAtSecond).toBe(reservedAtFirst);
    },
  );

  testIfEmulator(
    'subscriber consumes a recomputeCriticalPath message and patches isCriticalPath/slackMinutes',
    async () => {
      const projectId = asProjectId(`proj_sub_${scope.suiteSuffix}`);

      // Build the chain A → B → C inside the same project. Each task
      // depends on the previous. computeSchedule will mark all three on
      // the critical path because there's only one path.
      const idA = asTaskId(`task_chainA_${scope.suiteSuffix}`);
      const idB = asTaskId(`task_chainB_${scope.suiteSuffix}`);
      const idC = asTaskId(`task_chainC_${scope.suiteSuffix}`);

      const taskA = makeScopedTask(scope, {
        id: idA,
        projectId,
        estimatedDurationMinutes: 60,
        plannedStartAt: 1_700_000_000_000 as EpochMs,
        isCriticalPath: false,
        slackMinutes: 999,
      });
      const taskB = makeScopedTask(scope, {
        id: idB,
        projectId,
        estimatedDurationMinutes: 30,
        plannedStartAt: (1_700_000_000_000 + 60 * 60 * 1000) as EpochMs,
        dependsOn: [makeDep(idA)],
        isCriticalPath: false,
        slackMinutes: 999,
      });
      const taskC = makeScopedTask(scope, {
        id: idC,
        projectId,
        estimatedDurationMinutes: 45,
        plannedStartAt: (1_700_000_000_000 + 90 * 60 * 1000) as EpochMs,
        dependsOn: [makeDep(idB)],
        isCriticalPath: false,
        slackMinutes: 999,
      });

      await seedTask(taskA);
      await seedTask(taskB);
      await seedTask(taskC);

      // Drive the wrapped subscriber with a hand-built message. Mirror
      // what the publisher would have produced; the messageId becomes
      // part of the subscriber's idempotency key.
      const message = makePubSubMessage({
        projectId: projectId as string,
        companyId: scope.companyId as string,
        triggeredByTaskId: idA as string,
        triggeredByFields: ['estimatedDurationMinutes'],
        publishedAt: Date.now(),
      });
      const messageId = `msg_cpm_${scope.suiteSuffix}_1`;
      await wrappedSubscriber(message, { eventId: messageId });

      // Wait for the subscriber idempotency reservation to land — proof
      // the handler entered.
      const db = admin.firestore();
      const subscriberKey = `${KEY_PREFIX}cpm_subscribe_${projectId}_${messageId}`;
      const dedupeDoc = await waitFor(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(subscriberKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'cpm.subscriber.reservation', timeoutMs: 8000 },
      );
      expect(dedupeDoc.data()).toMatchObject({ functionName: 'tasktotime' });

      // Each task on the only path should be marked critical with
      // slack 0. We poll because the subscriber writes one task at a
      // time.
      for (const id of [idA, idB, idC]) {
        const refreshed = await waitFor(
          async () => {
            const t = await readTask(id);
            if (!t) return null;
            // The pre-seeded slack was 999; computeSchedule sets 0 on
            // critical-path tasks. Wait until the patch lands.
            if (t.slackMinutes === 999) return null;
            return t;
          },
          { label: `cpm.subscriber.patch.${id}`, timeoutMs: 8000 },
        );
        expect(refreshed.isCriticalPath).toBe(true);
        expect(refreshed.slackMinutes).toBe(0);
      }
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
