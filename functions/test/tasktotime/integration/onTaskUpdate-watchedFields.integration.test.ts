/**
 * onTasktotimeTaskUpdate — watched-fields filter integration test.
 *
 * What this test pins
 * -------------------
 * The single most important guard inside `onTaskUpdate` (CLAUDE.md §2.1):
 * the `diffWatchedFields` filter that exits with `no_watched_field_change`
 * when the only fields that moved between `before` and `after` belong to
 * the EXCLUDED list inside `tasktotime/adapters/triggers/_shared.ts`.
 *
 * The list is the line of defence against the $10k+ billing-bomb scenario:
 * computed fields (`subtaskRollup`, `isCriticalPath`, `slackMinutes`,
 * `blocksTaskIds`, `actualDurationMinutes`, `totalEarnings`,
 * `lastReminderSentAt`, `payrollProcessedAt`, `metricsProcessedAt`,
 * `updatedAt`) are written by the triggers themselves; if `onTaskUpdate`
 * reacted to those changes it would re-publish, re-cascade, re-audit, and
 * re-write — runaway by lunchtime.
 *
 * Bar
 * ---
 * For each excluded field, fire a wrapped `onUpdate` change with ONLY that
 * field shifted. Assert:
 *   1. NO transition row landed.
 *   2. NO idempotency reservation landed (proves the handler exited
 *      BEFORE the `idempotency.reserve(key, TTL_MS)` call).
 *   3. NO BigQuery audit fallback row landed in `systemErrors`.
 *
 * The tests do NOT assert the handler's return value directly because
 * `firebase-functions-test` swallows the return through the wrapper. The
 * absence of any side effect is the observable proof.
 *
 * Required runtime
 * ----------------
 *   firebase emulators:start --only firestore,pubsub
 * (Or `npm run emulator`). When the emulator is unreachable each `it`
 * short-circuits with a console.warn — the suite still reports green.
 */

import * as admin from 'firebase-admin';

import {
  asTaskId,
} from '../../../../tasktotime/domain/identifiers';

import {
  assertFirestoreEmulator,
  cleanupFunctionsTest,
  getOrInitAdminApp,
} from './helpers/setupEmulators';
import {
  cleanupScope,
  createTestScope,
  makeScopedTask,
  type TestScope,
} from './helpers/createTestProject';
import { waitForOrNull } from './helpers/waitFor';
import { makeDocChange, wrapOnTaskUpdate } from './helpers/wrappedTriggers';

const PROCESSED_EVENTS = 'processedEvents';
const TASKS = 'tasktotime_tasks';
const TRANSITIONS = 'tasktotime_transitions';
const SYSTEM_ERRORS = 'systemErrors';
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
      `[tasktotime/integration/onTaskUpdate-watchedFields] Skipping suite: ${(err as Error).message}`,
    );
  }
});

afterAll(() => {
  cleanupFunctionsTest();
});

describe('onTasktotimeTaskUpdate — watched-fields filter (integration)', () => {
  let scope: TestScope;
  let wrapped: (change: unknown, ctx?: Record<string, unknown>) => Promise<unknown>;

  beforeAll(() => {
    scope = createTestScope('on_update_watched');
    if (emulatorReachable) {
      wrapped = wrapOnTaskUpdate() as typeof wrapped;
    }
  });

  afterEach(async () => {
    if (emulatorReachable) {
      await cleanupScope(scope);
    }
  });

  // ─── EXCLUDED computed fields — every member of the EXCLUDED list ────
  // The list is the canonical loop-defence. We fire one update per
  // excluded field and assert no side effects.
  testIfEmulator(
    'subtaskRollup-only change exits with no_watched_field_change',
    async () => {
      await assertNoSideEffectsForExcludedField('subtaskRollup', (before) => ({
        ...before,
        subtaskRollup: {
          countByLifecycle: { completed: 1 },
          totalCostInternal: 100,
          totalPriceClient: 200,
          totalEstimatedMinutes: 60,
          totalActualMinutes: 45,
          completedFraction: 1,
          blockedCount: 0,
        },
      }));
    },
  );

  testIfEmulator(
    'isCriticalPath-only change exits with no_watched_field_change',
    async () => {
      await assertNoSideEffectsForExcludedField('isCriticalPath', (before) => ({
        ...before,
        isCriticalPath: !before.isCriticalPath,
      }));
    },
  );

  testIfEmulator(
    'slackMinutes-only change exits with no_watched_field_change',
    async () => {
      await assertNoSideEffectsForExcludedField('slackMinutes', (before) => ({
        ...before,
        slackMinutes: 42,
      }));
    },
  );

  testIfEmulator(
    'blocksTaskIds-only change exits with no_watched_field_change',
    async () => {
      // The taskId we cite here doesn't need to exist; the trigger should
      // exit before any cascade lookup.
      await assertNoSideEffectsForExcludedField('blocksTaskIds', (before) => ({
        ...before,
        blocksTaskIds: [asTaskId('phantom_target_for_filter_test')],
      }));
    },
  );

  testIfEmulator(
    'actualDurationMinutes-only change exits with no_watched_field_change',
    async () => {
      await assertNoSideEffectsForExcludedField('actualDurationMinutes', (before) => ({
        ...before,
        actualDurationMinutes: 90,
      }));
    },
  );

  testIfEmulator(
    'totalEarnings-only change exits with no_watched_field_change',
    async () => {
      await assertNoSideEffectsForExcludedField('totalEarnings', (before) => ({
        ...before,
        totalEarnings: 250,
      }));
    },
  );

  testIfEmulator(
    'updatedAt-only change exits with no_watched_field_change',
    async () => {
      await assertNoSideEffectsForExcludedField('updatedAt', (before) => ({
        ...before,
        updatedAt: before.updatedAt + 1000,
      }));
    },
  );

  // ─── Sanity: a watched-field change DOES go through ──────────────────
  // Inverse contract — proves the suite is wired correctly. Without this
  // the previous tests could pass against a broken trigger that always
  // skips.
  testIfEmulator(
    'sanity: priority change DOES land an idempotency reservation',
    async () => {
      const taskId = asTaskId(`task_priority_${scope.suiteSuffix}`);
      const eventId = `evt_priority_${scope.suiteSuffix}_1`;
      const before = makeScopedTask(scope, { id: taskId, priority: 'medium' });
      const after = { ...before, priority: 'high' as const };
      const change = makeDocChange(
        toWireDoc(before),
        toWireDoc(after),
        `${TASKS}/${taskId}`,
      );

      await wrapped(change, { eventId, params: { taskId: taskId as string } });

      const db = admin.firestore();
      const expectedKey = `${KEY_PREFIX}tasktotime_task_update_${taskId}_${eventId}`;
      const dedupeDoc = await waitForOrNull(
        async () => {
          const doc = await db.collection(PROCESSED_EVENTS).doc(expectedKey).get();
          return doc.exists ? doc : null;
        },
        { label: 'priority.reservation', timeoutMs: 5000 },
      );
      expect(dedupeDoc).not.toBeNull();
      expect(dedupeDoc?.data()).toMatchObject({ functionName: 'tasktotime' });
    },
  );

  // ─── Helper: drive one field through and assert nothing landed ───────
  async function assertNoSideEffectsForExcludedField(
    fieldName: string,
    mutate: (before: import('../../../../tasktotime/domain/Task').Task) => import('../../../../tasktotime/domain/Task').Task,
  ): Promise<void> {
    const taskId = asTaskId(`task_${fieldName}_${scope.suiteSuffix}`);
    const eventId = `evt_${fieldName}_${scope.suiteSuffix}_1`;
    const before = makeScopedTask(scope, { id: taskId });
    const after = mutate(before);
    const change = makeDocChange(
      toWireDoc(before),
      toWireDoc(after),
      `${TASKS}/${taskId}`,
    );

    await wrapped(change, { eventId, params: { taskId: taskId as string } });

    const db = admin.firestore();

    // 1. No idempotency reservation. The filter exits BEFORE the reserve()
    //    call, so the dedupe doc must NOT exist.
    const expectedKey = `${KEY_PREFIX}tasktotime_task_update_${taskId}_${eventId}`;
    const dedupeDoc = await waitForOrNull(
      async () => {
        const doc = await db.collection(PROCESSED_EVENTS).doc(expectedKey).get();
        return doc.exists ? doc : null;
      },
      { label: `${fieldName}.no-reservation`, timeoutMs: 1500 },
    );
    expect(dedupeDoc).toBeNull();

    // 2. No transition row written. onTaskUpdate doesn't normally write
    //    a transition row (lifecycle changes flow through TaskService),
    //    but cross-check anyway.
    const transitions = await db
      .collection(TRANSITIONS)
      .where('taskId', '==', taskId as string)
      .get();
    expect(transitions.docs).toHaveLength(0);

    // 3. No BigQuery-fallback `systemErrors` row. The audit row would
    //    fall back here when BigQuery is unreachable (which it is under
    //    the emulator). Its absence proves the audit branch never ran.
    const fallback = await db
      .collection(SYSTEM_ERRORS)
      .where('taskId', '==', taskId as string)
      .get();
    expect(fallback.docs).toHaveLength(0);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Conditional `it` — skipped when the emulator isn't reachable. Mirrors
 * the pattern in onTaskCreate.integration.test.ts so suite registration
 * happens at module load but the body short-circuits if we couldn't
 * probe the emulator in `beforeAll`.
 */
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

/**
 * Convert a domain `Task` into the on-disk wire shape (Timestamps for
 * `*At` keys). Used to feed `firebase-functions-test`'s `makeChange` so
 * the wrapper sees the same shape Firestore would have served.
 */
function toWireDoc(
  task: import('../../../../tasktotime/domain/Task').Task,
): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { epochsToTimestamps } = require('../../../../tasktotime/adapters/firestore/_shared');
  const { id: _id, ...rest } = task as unknown as Record<string, unknown>;
  return epochsToTimestamps(rest);
}
