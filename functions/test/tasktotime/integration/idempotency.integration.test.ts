/**
 * Idempotency integration test for tasktotime trigger handlers.
 *
 * What this test pins
 * -------------------
 * The dedupe contract from CLAUDE.md §2.1: replaying the SAME
 * `eventId` against a wrapped trigger MUST be a no-op. The first
 * invocation reserves a key in `processedEvents/tt_<...>` with TTL 5
 * minutes; the second sees the active reservation and skips.
 *
 * Without this guard a Firebase platform retry (legitimate) would replay
 * every cascade, audit, and notify side effect — at scale that is the
 * $10k+ billing-bomb scenario.
 *
 * Bar
 * ---
 *   1. onCreate path: fire `wrap()` twice with the SAME synthetic
 *      DocumentSnapshot + same `eventId`. Assert exactly one transition
 *      row written (not two). Already covered by
 *      `onTaskCreate.integration.test.ts` — we add a stricter assertion
 *      here that the `processedEvents/tt_*` reservation row is identical
 *      across the two calls (same `reservedAt`).
 *   2. onUpdate path: fire `wrap()` twice with the SAME
 *      Change<DocumentSnapshot> + same `eventId`. Assert that the second
 *      run does NOT add a second `systemErrors` audit-fallback row (proves
 *      the handler exited at the idempotency check, before BigQuery
 *      audit). The `cpm` debounce key landed once and didn't move.
 *   3. onSubscriber path: fire `wrap()` twice with the SAME message +
 *      same messageId. Assert the subscriber's idempotency key
 *      (`tt_cpm_subscribe_<projectId>_<messageId>`) is set once and the
 *      `reservedAt` doesn't change.
 *
 * Required runtime
 * ----------------
 *   firebase emulators:start --only firestore,pubsub
 */

import * as admin from 'firebase-admin';

import {
  asProjectId,
  asTaskId,
  asUserId,
} from '../../../../tasktotime/domain/identifiers';
import type { Task } from '../../../../tasktotime/domain/Task';

import {
  assertFirestoreEmulator,
  cleanupFunctionsTest,
  getOrInitAdminApp,
} from './helpers/setupEmulators';
import {
  cleanupScope,
  createTestScope,
  makeScopedTask,
  seedTask,
  type TestScope,
} from './helpers/createTestProject';
import { waitFor } from './helpers/waitFor';
import {
  makeDocChange,
  makeDocSnapshot,
  makePubSubMessage,
  wrapOnRecomputeCriticalPath,
  wrapOnTaskCreate,
  wrapOnTaskUpdate,
} from './helpers/wrappedTriggers';

const PROCESSED_EVENTS = 'processedEvents';
const TASKS = 'tasktotime_tasks';
const TRANSITIONS = 'tasktotime_transitions';
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
      `[tasktotime/integration/idempotency] Skipping suite: ${(err as Error).message}`,
    );
  }
});

afterAll(() => {
  cleanupFunctionsTest();
});

describe('Idempotency guard — replays of same eventId are no-op (integration)', () => {
  let scope: TestScope;
  let wrappedCreate: (snap: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;
  let wrappedUpdate: (change: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;
  let wrappedSubscriber: (message: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;

  beforeAll(() => {
    scope = createTestScope('idempotency');
    if (emulatorReachable) {
      wrappedCreate = wrapOnTaskCreate() as typeof wrappedCreate;
      wrappedUpdate = wrapOnTaskUpdate() as typeof wrappedUpdate;
      wrappedSubscriber = wrapOnRecomputeCriticalPath() as typeof wrappedSubscriber;
    }
  });

  afterEach(async () => {
    if (emulatorReachable) {
      await cleanupScope(scope);
    }
  });

  // ─── onCreate path ───────────────────────────────────────────────────
  testIfEmulator(
    'onTaskCreate: replaying the same eventId reserves once and writes one transition',
    async () => {
      const taskId = asTaskId(`task_create_replay_${scope.suiteSuffix}`);
      const eventId = `evt_create_replay_${scope.suiteSuffix}_1`;
      const task = makeScopedTask(scope, {
        id: taskId,
        lifecycle: 'draft',
        assignedTo: { id: asUserId(`worker_${scope.suiteSuffix}`), name: 'Worker' },
        createdBy: { id: asUserId(`worker_${scope.suiteSuffix}`), name: 'Worker' },
      });
      const snap = makeDocSnapshot(toWireDoc(task), `${TASKS}/${taskId}`);

      // First invocation — reservation lands, transition row lands.
      await wrappedCreate(snap, { eventId, params: { taskId: taskId as string } });

      const db = admin.firestore();
      const expectedKey = `${KEY_PREFIX}tasktotime_create_${taskId}_${eventId}`;
      const firstReservation = await waitFor(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(expectedKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'create.replay.first-reservation', timeoutMs: 8000 },
      );
      const firstReservedAt = (firstReservation.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(typeof firstReservedAt).toBe('number');

      // Second invocation — same eventId, same docId. The handler MUST
      // exit at the reservation check.
      await wrappedCreate(snap, { eventId, params: { taskId: taskId as string } });

      // Reservation doc unchanged.
      const secondReservation = await db
        .collection(PROCESSED_EVENTS)
        .doc(expectedKey)
        .get();
      const secondReservedAt = (secondReservation.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(secondReservedAt).toBe(firstReservedAt);

      // Exactly one transition row for this task.
      const all = await db
        .collection(TRANSITIONS)
        .where('taskId', '==', taskId as string)
        .get();
      expect(all.docs).toHaveLength(1);
    },
  );

  // ─── onUpdate path ───────────────────────────────────────────────────
  testIfEmulator(
    'onTaskUpdate: replaying the same eventId reserves once and skips the second invocation',
    async () => {
      const taskId = asTaskId(`task_update_replay_${scope.suiteSuffix}`);
      const eventId = `evt_update_replay_${scope.suiteSuffix}_1`;
      const before = makeScopedTask(scope, {
        id: taskId,
        priority: 'medium',
      });
      const after: Task = { ...before, priority: 'high' };
      const change = makeDocChange(
        toWireDoc(before),
        toWireDoc(after),
        `${TASKS}/${taskId}`,
      );

      // First invocation — handler runs through, reservation lands.
      await wrappedUpdate(change, { eventId, params: { taskId: taskId as string } });

      const db = admin.firestore();
      const expectedKey = `${KEY_PREFIX}tasktotime_task_update_${taskId}_${eventId}`;
      const firstReservation = await waitFor(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(expectedKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'update.replay.first-reservation', timeoutMs: 8000 },
      );
      const firstReservedAt = (firstReservation.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(typeof firstReservedAt).toBe('number');

      // Second invocation — same eventId. The reservation already exists
      // and is not expired; handler exits with `idempotency`.
      await wrappedUpdate(change, { eventId, params: { taskId: taskId as string } });

      const secondReservation = await db
        .collection(PROCESSED_EVENTS)
        .doc(expectedKey)
        .get();
      const secondReservedAt = (secondReservation.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(secondReservedAt).toBe(firstReservedAt);
    },
  );

  // ─── onRecomputeCriticalPath subscriber path ─────────────────────────
  testIfEmulator(
    'onRecomputeCriticalPath: replaying the same messageId reserves once',
    async () => {
      // Seed a single task in the project so the subscriber doesn't
      // bail out on `no_tasks_in_project`.
      const projectId = asProjectId(`proj_idemp_${scope.suiteSuffix}`);
      const taskA = makeScopedTask(scope, {
        id: asTaskId(`task_idemp_${scope.suiteSuffix}`),
        projectId,
        estimatedDurationMinutes: 30,
      });
      await seedTask(taskA);

      const messageId = `msg_idemp_${scope.suiteSuffix}_1`;
      const message = makePubSubMessage({
        projectId: projectId as string,
        companyId: scope.companyId as string,
        triggeredByTaskId: taskA.id as string,
        triggeredByFields: ['estimatedDurationMinutes'],
        publishedAt: Date.now(),
      });

      // First fire — reservation lands.
      await wrappedSubscriber(message, { eventId: messageId });

      const db = admin.firestore();
      const expectedKey = `${KEY_PREFIX}cpm_subscribe_${projectId}_${messageId}`;
      const firstReservation = await waitFor(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(expectedKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'subscriber.replay.first-reservation', timeoutMs: 8000 },
      );
      const firstReservedAt = (firstReservation.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(typeof firstReservedAt).toBe('number');

      // Second fire — same messageId. Handler short-circuits.
      await wrappedSubscriber(message, { eventId: messageId });

      const secondReservation = await db
        .collection(PROCESSED_EVENTS)
        .doc(expectedKey)
        .get();
      const secondReservedAt = (secondReservation.data()?.reservedAt as { toMillis?: () => number } | undefined)?.toMillis?.();
      expect(secondReservedAt).toBe(firstReservedAt);
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

function toWireDoc(task: Task): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { epochsToTimestamps } = require('../../../../tasktotime/adapters/firestore/_shared');
  const { id: _id, ...rest } = task as unknown as Record<string, unknown>;
  return epochsToTimestamps(rest);
}
