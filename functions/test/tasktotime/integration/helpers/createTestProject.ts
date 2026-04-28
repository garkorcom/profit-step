/**
 * Per-suite Firestore seed helpers.
 *
 * Every integration test gets a unique companyId / projectId suffix so
 * concurrent suites running against the same emulator never see each
 * other's writes. The companyId is also the RLS scope inside every
 * tasktotime trigger handler — colliding ids would cause cross-tenant
 * checks to fail in surprising ways.
 *
 * Convention
 * ----------
 *   - Suffix is `<suiteSlug>_<process.hrtime.bigint()>` so two parallel
 *     suites within the same process still differ.
 *   - Helpers return strongly-typed `CompanyId` / `ProjectId` / `TaskId`
 *     branded strings so domain types stay correct without manual casts
 *     in tests.
 */

import * as admin from 'firebase-admin';

import {
  asCompanyId,
  asProjectId,
  asTaskId,
  asUserId,
  type CompanyId,
  type ProjectId,
  type TaskId,
} from '../../../../../tasktotime/domain/identifiers';
import type { Task } from '../../../../../tasktotime/domain/Task';
import { makeTask } from '../../../../../tasktotime/shared/test-helpers/makeTask';
import { epochsToTimestamps } from '../../../../../tasktotime/adapters/firestore/_shared';

const TASKS_COLLECTION = 'tasktotime_tasks';
const TRANSITIONS_COLLECTION = 'tasktotime_transitions';
const PROCESSED_EVENTS_COLLECTION = 'processedEvents';

export interface TestScope {
  /** Branded `CompanyId` used by every doc inside this suite. */
  companyId: CompanyId;
  /** Branded `ProjectId` used by every task in this suite. */
  projectId: ProjectId;
  /** Bare suffix used in any non-id field that needs uniqueness. */
  suiteSuffix: string;
}

/**
 * Build a fresh scope. Call once per `describe`-level test scope (or
 * per-test if isolation matters).
 */
export function createTestScope(slug: string): TestScope {
  // hrtime.bigint() gives nanosecond precision — distinct across rapid calls.
  const ns = process.hrtime.bigint().toString();
  const suiteSuffix = `${slug}_${ns}`;
  return {
    companyId: asCompanyId(`co_${suiteSuffix}`),
    projectId: asProjectId(`proj_${suiteSuffix}`),
    suiteSuffix,
  };
}

/**
 * Create a fully-formed `Task` object with sane defaults bound to the scope.
 * Pass overrides to specialise — `id`, `lifecycle`, `dependsOn`, etc.
 */
export function makeScopedTask(
  scope: TestScope,
  overrides: Partial<Task> = {},
): Task {
  const id = (overrides.id ?? asTaskId(`task_${scope.suiteSuffix}_${Math.random().toString(36).slice(2, 8)}`)) as TaskId;
  return makeTask({
    id,
    companyId: scope.companyId,
    projectId: scope.projectId,
    assignedTo: { id: asUserId(`user_${scope.suiteSuffix}`), name: 'Tester' },
    createdBy: { id: asUserId(`user_${scope.suiteSuffix}`), name: 'Tester' },
    ...overrides,
  });
}

/**
 * Persist a Task into the emulator-backed `tasktotime_tasks` collection.
 * Wires the same epoch→Timestamp conversion as `FirestoreTaskRepository.save`
 * so the on-disk shape matches production exactly.
 */
export async function seedTask(task: Task): Promise<void> {
  const db = admin.firestore();
  // Strip `id` (collection-doc id) to avoid storing it as a field.
  const { id: _id, ...rest } = task as unknown as Record<string, unknown>;
  const doc = epochsToTimestamps(rest as Record<string, unknown>);
  await db.collection(TASKS_COLLECTION).doc(task.id as string).set(doc);
}

/**
 * Convenience — seed several tasks at once.
 */
export async function seedTasks(tasks: Task[]): Promise<void> {
  for (const t of tasks) {
    await seedTask(t);
  }
}

/**
 * Read a Task back from Firestore and convert Timestamps to epoch ms so the
 * caller can `toMatchObject` against the domain type.
 */
export async function readTask(taskId: TaskId): Promise<Task | null> {
  const db = admin.firestore();
  const snap = await db.collection(TASKS_COLLECTION).doc(taskId as string).get();
  if (!snap.exists) return null;
  const raw = snap.data() ?? {};
  const converted = walkTimestampsToMs(raw);
  return { ...converted, id: taskId } as Task;
}

/**
 * Best-effort cleanup — delete every doc inside a scope's range. Used in
 * `afterEach` / `afterAll` to avoid filling the emulator's in-memory store.
 *
 * Note: queries by `companyId == scope.companyId` so cross-tenant pollution
 * is not possible. The PROCESSED_EVENTS collection is keyed by
 * `tt_<eventType>_<docId>_<eventId>` — we delete by docId prefix match
 * (which the emulator tolerates as a `>=` / `<` range query on doc id).
 */
export async function cleanupScope(scope: TestScope): Promise<void> {
  const db = admin.firestore();
  const ops: Promise<unknown>[] = [];

  // Tasks for this company
  ops.push(deleteWhere(db.collection(TASKS_COLLECTION), 'companyId', scope.companyId as string));

  // Transition log for this company
  ops.push(deleteWhere(db.collection(TRANSITIONS_COLLECTION), 'companyId', scope.companyId as string));

  // ProcessedEvents — narrow by `functionName == 'tasktotime'` then check
  // that the doc id was made for our scope. Cheaper than a range query.
  ops.push(
    db
      .collection(PROCESSED_EVENTS_COLLECTION)
      .where('functionName', '==', 'tasktotime')
      .get()
      .then(async (snap) => {
        const batch = db.batch();
        let count = 0;
        for (const doc of snap.docs) {
          if (doc.id.includes(scope.suiteSuffix)) {
            batch.delete(doc.ref);
            count += 1;
          }
        }
        if (count > 0) await batch.commit();
      }),
  );

  await Promise.all(ops);
}

async function deleteWhere(
  ref: FirebaseFirestore.CollectionReference,
  field: string,
  value: string,
): Promise<void> {
  const db = admin.firestore();
  const snap = await ref.where(field, '==', value).get();
  if (snap.empty) return;
  // Firestore batch caps at 500 ops; suites stay well under that.
  const batch = db.batch();
  for (const doc of snap.docs) batch.delete(doc.ref);
  await batch.commit();
}

/**
 * Recursively map Firestore Timestamps to epoch ms. Public mapper from
 * `tasktotime/adapters/firestore/_shared` would do the same, but importing
 * it pulls in the Timestamp class — fine for tests, but we keep this helper
 * local so reading-back-after-write tests don't depend on the adapter.
 */
function walkTimestampsToMs(input: unknown): Record<string, unknown> {
  if (input == null || typeof input !== 'object') return input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    // Duck-type Timestamp by `toMillis()`.
    const maybe = v as { toMillis?: () => number };
    if (typeof maybe.toMillis === 'function') {
      out[k] = maybe.toMillis();
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === 'object' ? walkTimestampsToMs(item) : item,
      );
    } else if (typeof v === 'object') {
      out[k] = walkTimestampsToMs(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
