/**
 * FirestoreTaskRepository — Firestore-backed implementation of
 * {@link TaskRepository}. See spec/04-storage/adapter-mapping.md §1 for the
 * canonical port → Firestore mapping table; this file is the implementation.
 *
 * Design highlights:
 *   - Time conversion at the boundary: domain holds `EpochMs` numbers;
 *     Firestore stores `Timestamp`. `epochsToTimestamps` /
 *     `timestampsToEpochs` from `_shared` keep the conversion in one place
 *     so the domain layer never imports `firebase-admin`.
 *   - `save` uses `set(..., { merge: false })` — the domain owns the full
 *     document. `patch` is a strictly whitelisted partial update intended
 *     for cascade triggers and denormalisation sync; it refuses keys that
 *     belong to the lifecycle/transition machine.
 *   - `saveIfUnchanged` uses `runTransaction` with a CAS (`updatedAt`)
 *     check — see existing CAS pattern at
 *     `functions/src/triggers/firestore/clientJourneyTriggers.ts:407-421`.
 *   - All non-`findById` queries are company-scoped per the multi-tenant
 *     RLS convention. `findByDependsOn(taskId, companyId)` accepts a
 *     companyId because the underlying composite index requires it.
 *   - Composite indexes used are catalogued in
 *     spec/04-storage/adapter-mapping.md §1 and tracked in
 *     `firestore.indexes.json`.
 */

import type {
  Firestore,
  Query,
  WriteBatch,
  DocumentData,
} from 'firebase-admin/firestore';

import type {
  TaskRepository,
  TaskFilter,
  ListOptions,
  PageResult,
  PartialTaskUpdate,
} from '../../ports/repositories/TaskRepository';
import type { Task, UserRef } from '../../domain/Task';
import type { TaskId, CompanyId, UserId } from '../../domain/identifiers';

import {
  Timestamp,
  FieldValue,
  toEpochMs,
  toTimestamp,
  epochsToTimestamps,
  timestampsToEpochs,
  chunk,
  stripUndefined,
  encodeCursor,
  decodeCursor,
  FIRESTORE_IN_LIMIT,
  FIRESTORE_BATCH_LIMIT,
  type AdapterLogger,
  noopLogger,
} from './_shared';
import {
  AdapterError,
  IllegalPatchError,
  StaleVersion,
  mapFirestoreError,
} from '../errors';

/** Single source of truth for the collection name. */
const COLLECTION = 'tasktotime_tasks';

/**
 * Fields that must NEVER be mutated through `patch`. These belong to the
 * lifecycle/transition machine (or are immutable identity / audit fields)
 * and must flow through `TaskService.transition` / `save` to keep history
 * + transition log atomically consistent.
 *
 * See adapter-mapping.md §"Notes / gotchas → save vs patch".
 */
const PATCH_FORBIDDEN_KEYS: readonly string[] = [
  'lifecycle',
  'history',
  'transitions',
  'id',
  'companyId',
  'createdAt',
  'createdBy',
];

/**
 * Map a Firestore document to a domain Task. Recursively converts every
 * Timestamp leaf to epoch ms so the domain layer never sees Firestore types.
 */
function fromDoc(id: string, data: DocumentData): Task {
  const converted = timestampsToEpochs({ ...data });
  // ensure id is the doc id, not a stale field
  return { ...converted, id } as unknown as Task;
}

/**
 * Convert a domain Task to wire-format. The recursive helper handles every
 * `*At` epoch leaf (top-level + nested arrays); we additionally set
 * `updatedAt = serverTimestamp()` to give Firestore the authoritative wall
 * clock on the write path.
 *
 * Note: `id` is dropped from the body because it's the document id, not a
 * field. `companyId` MUST stay — RLS depends on it.
 */
function toDoc(task: Task, opts: { stampUpdatedAt: boolean }): DocumentData {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, ...rest } = task as unknown as Record<string, unknown>;
  const converted = epochsToTimestamps(rest as Record<string, unknown>);
  const out = stripUndefined(converted);
  if (opts.stampUpdatedAt) {
    // Server-side wall clock — overrides whatever the domain set.
    (out as Record<string, unknown>).updatedAt = FieldValue.serverTimestamp();
  }
  return out as DocumentData;
}

/**
 * Validate `patch` keys against the forbidden allow-list. Throws
 * {@link IllegalPatchError} on violation. Pure function — no I/O.
 */
function assertPatchKeys(taskId: TaskId, partial: PartialTaskUpdate): void {
  const keys = Object.keys(partial);
  const forbidden = keys.filter((k) => PATCH_FORBIDDEN_KEYS.includes(k));
  if (forbidden.length > 0) {
    throw new IllegalPatchError(taskId, forbidden);
  }
}

/**
 * Apply orderBy + cursor pagination to a query. Returns the modified query
 * plus the resolved sort spec used to build the next-page cursor.
 */
function applyOrderAndCursor(
  q: Query,
  options: ListOptions | undefined,
): { query: Query; orderBy: string; direction: 'asc' | 'desc' } {
  const orderBy = options?.orderBy ?? 'createdAt';
  const direction = options?.direction ?? 'desc';
  let out = q.orderBy(orderBy, direction);

  if (options?.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      // The cursor encodes the sort-key value of the last item on the
      // previous page. Firestore `startAfter` is a *value*, not a doc id,
      // when used after `orderBy(<field>)`. If the sort-key happens to be a
      // timestamp epoch we re-hydrate it back to a Firestore Timestamp.
      const value = decoded.lastSortValue;
      const startAfter =
        typeof value === 'number' &&
        /At$/.test(orderBy)
          ? toTimestamp(value)
          : value;
      out = out.startAfter(startAfter as unknown);
    }
  }
  return { query: out, orderBy, direction };
}

/**
 * Apply the {@link TaskFilter} to a query. Mirrors the filter chain in
 * adapter-mapping.md §1 row 3.
 */
function applyFilter(
  base: Query,
  filter: TaskFilter,
): Query {
  let q: Query = base.where('companyId', '==', filter.companyId);

  if (filter.lifecycle && filter.lifecycle.length > 0) {
    // Firestore `in` cap is 30. Domain rarely passes >5 lifecycle states.
    if (filter.lifecycle.length > FIRESTORE_IN_LIMIT) {
      throw new AdapterError(
        'STORAGE_FAILURE',
        `lifecycle filter exceeds Firestore in-limit (${FIRESTORE_IN_LIMIT})`,
        { count: filter.lifecycle.length },
      );
    }
    q = q.where('lifecycle', 'in', filter.lifecycle);
  }
  if (filter.bucket && filter.bucket.length > 0) {
    if (filter.bucket.length > FIRESTORE_IN_LIMIT) {
      throw new AdapterError(
        'STORAGE_FAILURE',
        `bucket filter exceeds Firestore in-limit (${FIRESTORE_IN_LIMIT})`,
        { count: filter.bucket.length },
      );
    }
    q = q.where('bucket', 'in', filter.bucket);
  }
  if (filter.assigneeId !== undefined) {
    q = q.where('assignedTo.id', '==', filter.assigneeId);
  }
  if (filter.parentTaskId === null) {
    // Root tasks only — Firestore stores absence as `null` here.
    q = q.where('parentTaskId', '==', null);
  } else if (filter.parentTaskId !== undefined) {
    q = q.where('parentTaskId', '==', filter.parentTaskId);
  }
  if (filter.projectId !== undefined) {
    q = q.where('projectId', '==', filter.projectId);
  }
  if (filter.clientId !== undefined) {
    q = q.where('clientId', '==', filter.clientId);
  }
  if (filter.isSubtask !== undefined) {
    q = q.where('isSubtask', '==', filter.isSubtask);
  }
  if (filter.archivedOnly !== undefined) {
    // archivedOnly === true → only archived; false → only active.
    q = q.where('isArchived', '==', filter.archivedOnly);
  }
  if (filter.dueBefore !== undefined) {
    const ts = toTimestamp(filter.dueBefore);
    if (ts != null) q = q.where('dueAt', '<', ts);
  }
  // `filter.search` is delegated — Firestore has no full-text. Domain code
  // is expected to fall back to a search service or to in-memory filter on
  // a small result set. We accept the parameter but do not enforce it here.
  return q;
}

/**
 * Firestore-backed implementation of {@link TaskRepository}.
 *
 * Hexagonal note: this class is the only place where Firestore primitives
 * meet domain types. The domain/ports layers must NEVER import this file.
 */
export class FirestoreTaskRepository implements TaskRepository {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Adapter mapping §1 row 1. Returns `null` if the document does not exist.
   * Timestamps in the data are converted to epoch ms by `fromDoc`.
   */
  async findById(id: TaskId): Promise<Task | null> {
    try {
      const snap = await this.db.collection(COLLECTION).doc(id).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return fromDoc(snap.id, data);
    } catch (err) {
      throw mapFirestoreError(err, { op: 'findById', id });
    }
  }

  /**
   * Adapter mapping §1 row 2. Multi-doc batch read via `db.getAll(...refs)`.
   * Chunks the input ids to stay within the 30-doc `in`/`getAll` limit.
   * Result order is NOT guaranteed; missing docs are silently skipped.
   */
  async findByIds(ids: TaskId[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    try {
      const chunks = chunk(ids, FIRESTORE_IN_LIMIT);
      const results: Task[] = [];
      for (const ch of chunks) {
        const refs = ch.map((id) => this.db.collection(COLLECTION).doc(id));
        const snaps = await this.db.getAll(...refs);
        for (const snap of snaps) {
          if (snap.exists) {
            const data = snap.data();
            if (data) results.push(fromDoc(snap.id, data));
          }
        }
      }
      return results;
    } catch (err) {
      throw mapFirestoreError(err, { op: 'findByIds', count: ids.length });
    }
  }

  /**
   * Adapter mapping §1 row 3. Composite-indexed query with cursor pagination.
   * The combination of filters dictates which composite index is needed —
   * see adapter-mapping.md §1 "Composite indexes used".
   *
   * Default `orderBy` is `createdAt desc`; default `limit` is 50, capped at
   * 500 per the JSDoc on {@link ListOptions}.
   */
  async findMany(
    filter: TaskFilter,
    options: ListOptions = {},
  ): Promise<PageResult<Task>> {
    const limit = Math.min(options.limit ?? 50, 500);
    try {
      const filtered = applyFilter(this.db.collection(COLLECTION), filter);
      const { query, orderBy } = applyOrderAndCursor(filtered, options);
      const snap = await query.limit(limit).get();
      const items = snap.docs.map((d) => fromDoc(d.id, d.data()));

      let nextCursor: string | null = null;
      if (snap.docs.length === limit) {
        const last = snap.docs[snap.docs.length - 1];
        const lastData = last.data();
        const lastSortValue =
          /At$/.test(orderBy)
            ? toEpochMs(lastData[orderBy])
            : lastData[orderBy];
        nextCursor = encodeCursor({
          lastDocId: last.id,
          lastSortValue,
        });
      }
      return { items, nextCursor };
    } catch (err) {
      throw mapFirestoreError(err, { op: 'findMany', filter });
    }
  }

  /**
   * Adapter mapping §1 row 4. Returns subtasks ordered by createdAt asc —
   * matches `parentTaskId + createdAt(asc)` composite index.
   */
  async findSubtasks(parentId: TaskId): Promise<Task[]> {
    try {
      const snap = await this.db
        .collection(COLLECTION)
        .where('parentTaskId', '==', parentId)
        .orderBy('createdAt', 'asc')
        .get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    } catch (err) {
      throw mapFirestoreError(err, { op: 'findSubtasks', parentId });
    }
  }

  /**
   * Adapter mapping §1 row 5. Reverse query for cycle detection / cascade.
   * Uses the composite index `(companyId, blocksTaskIds array-contains)`.
   *
   * Port signature accepts only `taskId`; we accept an optional `companyId`
   * to bind the query to a tenant. If callers omit it the query falls back
   * to a single-field query — that path is intended only for tests; production
   * callers SHOULD pass a companyId.
   */
  async findByDependsOn(taskId: TaskId, companyId?: CompanyId): Promise<Task[]> {
    try {
      let q: Query = this.db
        .collection(COLLECTION)
        .where('blocksTaskIds', 'array-contains', taskId);
      if (companyId) q = q.where('companyId', '==', companyId);
      const snap = await q.get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    } catch (err) {
      throw mapFirestoreError(err, { op: 'findByDependsOn', taskId });
    }
  }

  /**
   * Adapter mapping §1 row 6. Full document replace. Domain owns the full
   * object — no merge. `updatedAt` is overwritten with serverTimestamp().
   */
  async save(task: Task): Promise<void> {
    try {
      const ref = this.db.collection(COLLECTION).doc(task.id);
      await ref.set(toDoc(task, { stampUpdatedAt: true }), { merge: false });
      this.logger.debug?.('[FirestoreTaskRepository] saved', {
        id: task.id,
        lifecycle: task.lifecycle,
      });
    } catch (err) {
      throw mapFirestoreError(err, { op: 'save', id: task.id });
    }
  }

  /**
   * Adapter mapping §1 row 7. WriteBatch up to 500 ops. If `tasks.length >
   * 500` we chunk; chunks are NOT atomic across the boundary, but each
   * individual chunk is.
   */
  async saveMany(tasks: Task[]): Promise<void> {
    if (tasks.length === 0) return;
    try {
      const chunks = chunk(tasks, FIRESTORE_BATCH_LIMIT);
      for (const ch of chunks) {
        const batch: WriteBatch = this.db.batch();
        for (const t of ch) {
          const ref = this.db.collection(COLLECTION).doc(t.id);
          batch.set(ref, toDoc(t, { stampUpdatedAt: true }), { merge: false });
        }
        await batch.commit();
      }
      this.logger.debug?.('[FirestoreTaskRepository] saveMany', {
        count: tasks.length,
        chunks: chunks.length,
      });
    } catch (err) {
      throw mapFirestoreError(err, { op: 'saveMany', count: tasks.length });
    }
  }

  /**
   * Adapter mapping §1 row 8. Whitelisted partial update.
   *
   * Throws {@link IllegalPatchError} for any forbidden key
   * ({@link PATCH_FORBIDDEN_KEYS}).
   *
   * Time-typed keys (`*At`) inside `partial` are converted to Timestamp
   * before write. `updatedAt` is always stamped server-side.
   */
  async patch(id: TaskId, partial: PartialTaskUpdate): Promise<void> {
    assertPatchKeys(id, partial);
    try {
      const converted = epochsToTimestamps(partial as Record<string, unknown>);
      const out = stripUndefined(converted);
      (out as Record<string, unknown>).updatedAt = FieldValue.serverTimestamp();
      await this.db.collection(COLLECTION).doc(id).update(out);
      this.logger.debug?.('[FirestoreTaskRepository] patched', {
        id,
        keys: Object.keys(partial),
      });
    } catch (err) {
      // If the upstream threw IllegalPatchError it already has a stable code
      // — re-throw verbatim so callers can `instanceof IllegalPatchError`.
      if (err instanceof AdapterError) throw err;
      throw mapFirestoreError(err, {
        op: 'patch',
        id,
        keys: Object.keys(partial),
      });
    }
  }

  /**
   * Adapter mapping §1 row 9. Soft delete via read-then-write transaction.
   * Verifies the doc exists, then sets archive fields. Never hard-delete.
   *
   * `archivedBy` is denormalised to `archivedBy.id` for storage so it can be
   * indexed/queried without expanding the full UserRef.
   */
  async softDelete(id: TaskId, archivedBy: UserRef): Promise<void> {
    try {
      await this.db.runTransaction(async (tx) => {
        const ref = this.db.collection(COLLECTION).doc(id);
        const snap = await tx.get(ref);
        if (!snap.exists) {
          throw new AdapterError(
            'NOT_FOUND',
            `Task ${id} not found for soft-delete`,
            { taskId: id },
          );
        }
        tx.update(ref, {
          isArchived: true,
          bucket: 'archive',
          archivedAt: FieldValue.serverTimestamp(),
          archivedBy: archivedBy.id,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      this.logger.info?.('[FirestoreTaskRepository] softDelete', {
        id,
        archivedById: archivedBy.id,
      });
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw mapFirestoreError(err, { op: 'softDelete', id });
    }
  }

  /**
   * Adapter mapping §1 row 10. Optimistic concurrency: throw
   * {@link StaleVersion} if `expectedUpdatedAt` does not match the value in
   * storage. Pattern mirrors the existing `clientJourneyTriggers.ts:407-421`
   * read-modify-write transaction.
   *
   * On success `updatedAt` is overwritten with serverTimestamp() — there is
   * no way to atomically "compare-and-set with the same value", which is
   * fine because every successful save advances the wall clock.
   */
  async saveIfUnchanged(task: Task, expectedUpdatedAt: number): Promise<void> {
    try {
      await this.db.runTransaction(async (tx) => {
        const ref = this.db.collection(COLLECTION).doc(task.id);
        const snap = await tx.get(ref);
        if (!snap.exists) {
          throw new AdapterError(
            'NOT_FOUND',
            `Task ${task.id} not found for saveIfUnchanged`,
            { taskId: task.id },
          );
        }
        const stored = snap.data() ?? {};
        const storedMs = toEpochMs(stored.updatedAt) ?? 0;
        if (storedMs !== expectedUpdatedAt) {
          throw new StaleVersion(task.id, expectedUpdatedAt);
        }
        tx.set(ref, toDoc(task, { stampUpdatedAt: true }), { merge: false });
      });
      this.logger.debug?.('[FirestoreTaskRepository] saveIfUnchanged ok', {
        id: task.id,
      });
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw mapFirestoreError(err, {
        op: 'saveIfUnchanged',
        id: task.id,
        expectedUpdatedAt,
      });
    }
  }
}

// --- internal exports for sibling adapters / tests ---
export { COLLECTION as TASKTOTIME_TASKS_COLLECTION, PATCH_FORBIDDEN_KEYS };

// `Timestamp` is imported here for completeness — adapters that compose
// transactions across multiple ports may need the runtime constructor.
void Timestamp;

// Type-only consumer of UserId to keep the import meaningful for downstream
// readers grep-ing for who touches users in this adapter.
export type FirestoreTaskRepositoryArchivedBy = UserId;
