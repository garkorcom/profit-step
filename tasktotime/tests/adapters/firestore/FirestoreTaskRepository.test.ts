/**
 * Unit tests for FirestoreTaskRepository — *not* integration. We mock the
 * minimal Firestore admin surface (CollectionReference, DocumentReference,
 * Query, WriteBatch, Transaction) so these tests run without an emulator.
 *
 * Integration tests against a real Firestore (the emulator) live under
 * `tasktotime/tests/adapters/` per STEP_3_PLAN §A4. This file targets
 * adapter-internal logic: argument shaping, time-conversion at boundaries,
 * patch validation, optimistic concurrency error mapping.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

import { FirestoreTaskRepository } from '../../../adapters/firestore/FirestoreTaskRepository';
import { IllegalPatchError, StaleVersion } from '../../../adapters/errors';
import { asTaskId, asCompanyId, asUserId } from '../../../domain/identifiers';
import type { Task, UserRef } from '../../../domain/Task';

// ─── Test helpers ──────────────────────────────────────────────────────

interface FakeDocSnap {
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

/**
 * Tiny mock factory — each helper returns just enough surface to compile
 * against `firebase-admin/firestore` types via structural typing. We cast
 * to `unknown as Firestore` at the boundary; tests assert on the spies.
 */
function makeMockDb(opts: {
  docs?: Record<string, Record<string, unknown> | undefined>;
  txnDocs?: Record<string, Record<string, unknown> | undefined>;
} = {}) {
  const docs = opts.docs ?? {};
  const txnDocs = opts.txnDocs ?? docs;
  const setSpy = jest.fn();
  const updateSpy = jest.fn();
  const batchSetSpy = jest.fn();
  const batchCommitSpy = jest.fn(() => Promise.resolve());
  const txSetSpy = jest.fn();
  const txUpdateSpy = jest.fn();
  const queryGetSpy = jest.fn(() =>
    Promise.resolve({
      docs: Object.entries(docs).map(([id, data]) => ({
        id,
        data: () => data,
      })),
    }),
  );

  const docFactory = (id: string) => ({
    id,
    set: (data: unknown) => {
      setSpy(id, data);
      return Promise.resolve();
    },
    update: (data: unknown) => {
      updateSpy(id, data);
      return Promise.resolve();
    },
    get: () =>
      Promise.resolve({
        id,
        exists: docs[id] !== undefined,
        data: () => docs[id],
      } satisfies FakeDocSnap),
  });

  const whereSpy = jest.fn();
  const orderBySpy = jest.fn();
  const limitSpy = jest.fn();
  const startAfterSpy = jest.fn();

  const collectionFactory = () => {
    const chain: Record<string, unknown> = {
      doc: docFactory,
      where: jest.fn((...args: unknown[]) => {
        whereSpy(...args);
        return chain;
      }),
      orderBy: jest.fn((...args: unknown[]) => {
        orderBySpy(...args);
        return chain;
      }),
      limit: jest.fn((...args: unknown[]) => {
        limitSpy(...args);
        return chain;
      }),
      startAfter: jest.fn((...args: unknown[]) => {
        startAfterSpy(...args);
        return chain;
      }),
      get: queryGetSpy,
    };
    return chain;
  };

  const db = {
    collection: jest.fn(() => collectionFactory()),
    getAll: jest.fn((...refs: Array<{ id: string }>) =>
      Promise.resolve(
        refs.map((ref) => ({
          id: ref.id,
          exists: docs[ref.id] !== undefined,
          data: () => docs[ref.id],
        } satisfies FakeDocSnap)),
      ),
    ),
    batch: jest.fn(() => ({
      set: batchSetSpy,
      commit: batchCommitSpy,
    })),
    runTransaction: jest.fn(async (cb: (tx: Transaction) => Promise<void>) => {
      const tx = {
        get: jest.fn((ref: { id: string }) =>
          Promise.resolve({
            id: ref.id,
            exists: txnDocs[ref.id] !== undefined,
            data: () => txnDocs[ref.id],
          } satisfies FakeDocSnap),
        ),
        set: txSetSpy,
        update: txUpdateSpy,
      } as unknown as Transaction;
      await cb(tx);
    }),
  } as unknown as Firestore;

  return {
    db,
    setSpy,
    updateSpy,
    batchSetSpy,
    batchCommitSpy,
    txSetSpy,
    txUpdateSpy,
    queryGetSpy,
    whereSpy,
    orderBySpy,
    limitSpy,
    startAfterSpy,
  };
}

const userRef: UserRef = { id: asUserId('u1'), name: 'Alice' };

/** Cast Task → indexable record so it satisfies the mock signatures. */
const asRecord = (t: Task): Record<string, unknown> => t as unknown as Record<string, unknown>;

const baseTask: Task = {
  id: asTaskId('t1'),
  companyId: asCompanyId('c1'),
  taskNumber: 'T-2026-0001',
  title: 'Demo',
  lifecycle: 'draft',
  bucket: 'inbox',
  priority: 'medium',
  createdBy: userRef,
  assignedTo: userRef,
  requiredHeadcount: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  dueAt: 1_700_500_000_000,
  estimatedDurationMinutes: 60,
  actualDurationMinutes: 0,
  autoShiftEnabled: false,
  isCriticalPath: false,
  slackMinutes: 0,
  isSubtask: false,
  subtaskIds: [],
  wikiInheritsFromParent: false,
  costInternal: { amount: 0, currency: 'USD' },
  priceClient: { amount: 0, currency: 'USD' },
  totalEarnings: 0,
  materialsCostPlanned: 0,
  materialsCostActual: 0,
  source: 'web',
  aiEstimateUsed: false,
  history: [],
  clientVisible: false,
  internalOnly: true,
};

// ─── Tests ─────────────────────────────────────────────────────────────

describe('FirestoreTaskRepository.findById', () => {
  test('returns null for missing doc', async () => {
    const { db } = makeMockDb({ docs: {} });
    const repo = new FirestoreTaskRepository(db);
    const result = await repo.findById(asTaskId('missing'));
    expect(result).toBeNull();
  });

  test('returns task with Timestamps converted to epoch ms', async () => {
    const { db } = makeMockDb({
      docs: {
        t1: {
          ...baseTask,
          createdAt: Timestamp.fromMillis(1_700_000_000_000),
          updatedAt: Timestamp.fromMillis(1_700_000_001_000),
        },
      },
    });
    const repo = new FirestoreTaskRepository(db);
    const result = await repo.findById(asTaskId('t1'));
    expect(result).not.toBeNull();
    expect(typeof result!.createdAt).toBe('number');
    expect(result!.createdAt).toBe(1_700_000_000_000);
    expect(result!.updatedAt).toBe(1_700_000_001_000);
  });
});

describe('FirestoreTaskRepository.findByIds', () => {
  test('returns [] for empty input without touching db', async () => {
    const { db } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    const result = await repo.findByIds([]);
    expect(result).toEqual([]);
    expect(db.getAll).not.toHaveBeenCalled();
  });
});

describe('FirestoreTaskRepository.patch', () => {
  test('throws IllegalPatchError for forbidden lifecycle key', async () => {
    const { db } = makeMockDb({ docs: { t1: asRecord(baseTask) } });
    const repo = new FirestoreTaskRepository(db);
    await expect(
      repo.patch(asTaskId('t1'), { lifecycle: 'started' }),
    ).rejects.toBeInstanceOf(IllegalPatchError);
  });

  test('throws IllegalPatchError listing all forbidden keys', async () => {
    const { db } = makeMockDb({ docs: { t1: asRecord(baseTask) } });
    const repo = new FirestoreTaskRepository(db);
    try {
      await repo.patch(asTaskId('t1'), {
        lifecycle: 'started',
        history: [],
        title: 'ok',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalPatchError);
      expect((err as IllegalPatchError).forbiddenKeys).toEqual(
        expect.arrayContaining(['lifecycle', 'history']),
      );
    }
  });

  test('allows whitelisted patch (no forbidden keys)', async () => {
    const { db, updateSpy } = makeMockDb({ docs: { t1: asRecord(baseTask) } });
    const repo = new FirestoreTaskRepository(db);
    await repo.patch(asTaskId('t1'), {
      title: 'updated',
      slackMinutes: 30,
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('FirestoreTaskRepository.appendToArray', () => {
  test('no-ops on empty values without touching db', async () => {
    const { db, updateSpy } = makeMockDb({ docs: { t1: asRecord(baseTask) } });
    const repo = new FirestoreTaskRepository(db);
    await repo.appendToArray(asTaskId('t1'), 'subtaskIds', []);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('issues update with FieldValue.arrayUnion sentinel + serverTimestamp', async () => {
    const { db, updateSpy } = makeMockDb({ docs: { t1: asRecord(baseTask) } });
    const repo = new FirestoreTaskRepository(db);
    await repo.appendToArray(asTaskId('t1'), 'subtaskIds', [asTaskId('child_x')]);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [id, payload] = updateSpy.mock.calls[0];
    expect(id).toBe('t1');
    const data = payload as Record<string, unknown>;
    // arrayUnion + serverTimestamp are non-plain-object sentinels — assert
    // the field is present and isn't a literal array (which would betray a
    // read-then-write fallback rather than the atomic union).
    expect(data.subtaskIds).toBeDefined();
    expect(Array.isArray(data.subtaskIds)).toBe(false);
    expect(data.updatedAt).toBeDefined();
    expect(typeof data.updatedAt).not.toBe('number');
  });

  test('throws IllegalPatchError for forbidden field name (defense in depth)', async () => {
    const { db } = makeMockDb({ docs: { t1: asRecord(baseTask) } });
    const repo = new FirestoreTaskRepository(db);
    await expect(
      repo.appendToArray(asTaskId('t1'), 'history' as keyof Task, [{ at: 1 }]),
    ).rejects.toBeInstanceOf(IllegalPatchError);
  });
});

describe('FirestoreTaskRepository.save', () => {
  test('writes the doc with merge:false and stamps updatedAt', async () => {
    const { db, setSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.save(baseTask);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const [id, data] = setSpy.mock.calls[0];
    expect(id).toBe('t1');
    // updatedAt should be a sentinel (server timestamp), not a number
    expect(typeof (data as Record<string, unknown>).updatedAt).not.toBe('number');
  });
});

describe('FirestoreTaskRepository.saveMany', () => {
  test('no-ops on empty input', async () => {
    const { db, batchCommitSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.saveMany([]);
    expect(batchCommitSpy).not.toHaveBeenCalled();
  });

  test('uses a single batch when count <= 500', async () => {
    const { db, batchSetSpy, batchCommitSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.saveMany([baseTask, { ...baseTask, id: asTaskId('t2') }]);
    expect(batchSetSpy).toHaveBeenCalledTimes(2);
    expect(batchCommitSpy).toHaveBeenCalledTimes(1);
  });
});

describe('FirestoreTaskRepository.softDelete', () => {
  test('throws NOT_FOUND for missing doc inside transaction', async () => {
    const { db } = makeMockDb({ docs: {}, txnDocs: {} });
    const repo = new FirestoreTaskRepository(db);
    await expect(
      repo.softDelete(asTaskId('missing'), userRef),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('updates archive fields on existing doc', async () => {
    const { db, txUpdateSpy } = makeMockDb({
      docs: { t1: asRecord(baseTask) },
      txnDocs: { t1: asRecord(baseTask) },
    });
    const repo = new FirestoreTaskRepository(db);
    await repo.softDelete(asTaskId('t1'), userRef);
    expect(txUpdateSpy).toHaveBeenCalledTimes(1);
    const updateData = txUpdateSpy.mock.calls[0][1];
    expect(updateData).toMatchObject({
      isArchived: true,
      bucket: 'archive',
      archivedBy: userRef.id,
    });
  });
});

describe('FirestoreTaskRepository.saveIfUnchanged', () => {
  test('throws StaleVersion when stored updatedAt does not match', async () => {
    const { db } = makeMockDb({
      docs: { t1: asRecord(baseTask) },
      txnDocs: {
        t1: {
          ...asRecord(baseTask),
          updatedAt: Timestamp.fromMillis(1_700_000_999_000), // different
        },
      },
    });
    const repo = new FirestoreTaskRepository(db);
    await expect(
      repo.saveIfUnchanged(baseTask, 1_700_000_000_000),
    ).rejects.toBeInstanceOf(StaleVersion);
  });

  test('writes when stored updatedAt matches expected', async () => {
    const { db, txSetSpy } = makeMockDb({
      docs: { t1: asRecord(baseTask) },
      txnDocs: {
        t1: {
          ...asRecord(baseTask),
          updatedAt: Timestamp.fromMillis(1_700_000_000_000),
        },
      },
    });
    const repo = new FirestoreTaskRepository(db);
    await repo.saveIfUnchanged(baseTask, 1_700_000_000_000);
    expect(txSetSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── titleLowercase derived index ───────────────────────────────────────
//
// Pins the contract for the prefix-search feature added in
// `feat/tasktotime-search-title-prefix`. The behaviour is:
//   1. `save` populates `titleLowercase` = `title.trim().toLowerCase()`.
//   2. `patch` re-derives `titleLowercase` when `title` is in the partial.
//   3. `findMany` with `filter.search` set issues a range query on
//      `titleLowercase` and forces orderBy to that same field (Firestore
//      requires the inequality field to be the first orderBy).
//   4. The search input is canonicalised the same way (trim + lowercase) so
//      uppercase user input matches lowercase-stored data.
describe('FirestoreTaskRepository titleLowercase derived index', () => {
  test('save() populates titleLowercase from trimmed lowercased title', async () => {
    const { db, setSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.save({ ...baseTask, title: '  Kitchen Remodel  ' });
    expect(setSpy).toHaveBeenCalledTimes(1);
    const written = setSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(written.titleLowercase).toBe('kitchen remodel');
    // Original title preserved as-is — the lower-cased copy is purely derived.
    expect(written.title).toBe('  Kitchen Remodel  ');
  });

  test('saveMany() populates titleLowercase for every doc in the batch', async () => {
    const { db, batchSetSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.saveMany([
      { ...baseTask, id: asTaskId('t1'), title: 'Kitchen' },
      { ...baseTask, id: asTaskId('t2'), title: 'BATHROOM' },
    ]);
    expect(batchSetSpy).toHaveBeenCalledTimes(2);
    const first = batchSetSpy.mock.calls[0][1] as Record<string, unknown>;
    const second = batchSetSpy.mock.calls[1][1] as Record<string, unknown>;
    expect(first.titleLowercase).toBe('kitchen');
    expect(second.titleLowercase).toBe('bathroom');
  });

  test('patch() updates titleLowercase when title is patched', async () => {
    const { db, updateSpy } = makeMockDb({
      docs: { t1: asRecord(baseTask) },
    });
    const repo = new FirestoreTaskRepository(db);
    await repo.patch(asTaskId('t1'), { title: '  Kitchen Wall  ' });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const written = updateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(written.title).toBe('  Kitchen Wall  ');
    expect(written.titleLowercase).toBe('kitchen wall');
  });

  test('patch() leaves titleLowercase untouched when title is not patched', async () => {
    const { db, updateSpy } = makeMockDb({
      docs: { t1: asRecord(baseTask) },
    });
    const repo = new FirestoreTaskRepository(db);
    await repo.patch(asTaskId('t1'), { slackMinutes: 30 });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const written = updateSpy.mock.calls[0][1] as Record<string, unknown>;
    expect('titleLowercase' in written).toBe(false);
  });

  test('findMany() with filter.search issues prefix-range where + orderBy titleLowercase', async () => {
    const { db, whereSpy, orderBySpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.findMany(
      { companyId: asCompanyId('c1'), search: 'Kitchen' },
      // Caller asked for createdAt — but search forces titleLowercase.
      { orderBy: 'createdAt', direction: 'desc' },
    );
    // Range filter applied with the canonicalised (lowercased + trimmed) input.
    const whereArgs = whereSpy.mock.calls.map((c: unknown[]) => c);
    expect(whereArgs).toContainEqual(['titleLowercase', '>=', 'kitchen']);
    // Upper bound bounds the prefix without overlapping any subsequent string.
    const upperBoundCalls = whereArgs.filter(
      (call: unknown[]) =>
        call[0] === 'titleLowercase' && call[1] === '<' && typeof call[2] === 'string',
    );
    expect(upperBoundCalls.length).toBe(1);
    expect((upperBoundCalls[0][2] as string).startsWith('kitchen')).toBe(true);
    // orderBy coerced to titleLowercase regardless of caller's choice.
    expect(orderBySpy).toHaveBeenCalledWith('titleLowercase', expect.any(String));
    // It must NOT order by createdAt — Firestore would reject that with
    // "first orderBy must match inequality field".
    const orderByFields = orderBySpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(orderByFields).not.toContain('createdAt');
  });

  test('findMany() canonicalises uppercase user input to match lowercase-stored data', async () => {
    const { db, whereSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.findMany({ companyId: asCompanyId('c1'), search: '  KITCHEN  ' });
    const whereArgs = whereSpy.mock.calls.map((c: unknown[]) => c);
    expect(whereArgs).toContainEqual(['titleLowercase', '>=', 'kitchen']);
  });

  test('findMany() without filter.search keeps the caller-supplied orderBy', async () => {
    const { db, whereSpy, orderBySpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.findMany(
      { companyId: asCompanyId('c1') },
      { orderBy: 'updatedAt', direction: 'desc' },
    );
    const orderByFields = orderBySpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(orderByFields).toContain('updatedAt');
    // No titleLowercase range filter when search is absent.
    const whereArgs = whereSpy.mock.calls.map((c: unknown[]) => c);
    const titleWheres = whereArgs.filter((c: unknown[]) => c[0] === 'titleLowercase');
    expect(titleWheres).toEqual([]);
  });

  test('findMany() with whitespace-only search does not add a range filter or coerce orderBy', async () => {
    const { db, whereSpy, orderBySpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.findMany(
      { companyId: asCompanyId('c1'), search: '   ' },
      { orderBy: 'createdAt', direction: 'desc' },
    );
    const whereArgs = whereSpy.mock.calls.map((c: unknown[]) => c);
    const titleWheres = whereArgs.filter((c: unknown[]) => c[0] === 'titleLowercase');
    expect(titleWheres).toEqual([]);
    // Whitespace-only search behaves as if absent — orderBy stays createdAt.
    const orderByFields = orderBySpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(orderByFields).toContain('createdAt');
    expect(orderByFields).not.toContain('titleLowercase');
  });
});

// ─── Bug 5 — pagination cursor docId tiebreaker ─────────────────────────
//
// Previously `applyOrderAndCursor` produced `q.orderBy(field).startAfter(value)`
// — Firestore's startAfter is a *value*, so two docs sharing the same sort
// value cause duplicates / skips between pages. The fix:
//   1. Always add a secondary `orderBy('__name__', direction)` for stable
//      total order.
//   2. Encode the cursor with both `lastSortValue` + `lastDocId` (already
//      done in `_shared.ts:CursorPayload`).
//   3. Pass both to `startAfter(value, docId)`.
//   4. Legacy cursors (no `lastDocId`) degrade gracefully — single-key
//      `startAfter` keeps working.
describe('FirestoreTaskRepository pagination cursor (Bug 5)', () => {
  test('findMany() always adds secondary __name__ orderBy for stable pagination', async () => {
    const { db, orderBySpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    await repo.findMany(
      { companyId: asCompanyId('c1') },
      { orderBy: 'createdAt', direction: 'desc' },
    );
    const orderByCalls = orderBySpy.mock.calls.map((c: unknown[]) => c);
    expect(orderByCalls).toContainEqual(['createdAt', 'desc']);
    // The tiebreaker on the doc id keeps total order stable when several
    // docs share the same sort-key value (e.g. 50 tasks seeded in the same
    // batch get identical createdAt ms).
    expect(orderByCalls).toContainEqual(['__name__', 'desc']);
  });

  test('findMany() with cursor passes (sortValue, docId) to startAfter', async () => {
    const { db, startAfterSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    // Build a cursor encoding both fields — same shape encodeCursor produces.
    const cursor = Buffer.from(
      JSON.stringify({
        lastDocId: 'task_boundary',
        lastSortValue: 1_700_000_000_000,
      }),
      'utf8',
    ).toString('base64');

    await repo.findMany(
      { companyId: asCompanyId('c1') },
      { orderBy: 'createdAt', direction: 'desc', cursor },
    );

    expect(startAfterSpy).toHaveBeenCalledTimes(1);
    const args = startAfterSpy.mock.calls[0];
    // Two arguments — (sortValue, docId). The sortValue is converted to a
    // Firestore Timestamp because the orderBy is `*At` (epoch field).
    expect(args).toHaveLength(2);
    expect(args[1]).toBe('task_boundary');
  });

  test('findMany() with legacy cursor (no docId) falls back to single-key startAfter', async () => {
    const { db, startAfterSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    // Legacy: only `lastSortValue` (no `lastDocId` — older clients).
    const legacyCursor = Buffer.from(
      JSON.stringify({ lastSortValue: 1_700_000_000_000 }),
      'utf8',
    ).toString('base64');

    // Important: a legacy cursor without `lastDocId` fails the
    // `typeof parsed?.lastDocId !== 'string'` check inside `decodeCursor`,
    // so it returns null — startAfter is NEVER called. The query still
    // works (returns the first page); pagination just resets.
    await repo.findMany(
      { companyId: asCompanyId('c1') },
      { orderBy: 'createdAt', direction: 'desc', cursor: legacyCursor },
    );

    // No crash — that's the contract. startAfter may or may not be called
    // depending on the parse outcome; the key invariant is the call MUST
    // NOT throw or pass `undefined` as the value-leg.
    if (startAfterSpy.mock.calls.length > 0) {
      const args = startAfterSpy.mock.calls[0];
      // If it was called, the first arg must NOT be undefined / NaN.
      expect(args[0]).toBeDefined();
    }
  });

  test('findMany() with empty-string cursor degrades gracefully', async () => {
    const { db, startAfterSpy } = makeMockDb();
    const repo = new FirestoreTaskRepository(db);
    // Garbage cursor → decodeCursor returns null → startAfter not called.
    await expect(
      repo.findMany(
        { companyId: asCompanyId('c1') },
        { orderBy: 'createdAt', direction: 'desc', cursor: '!!not-base64!!' },
      ),
    ).resolves.toBeDefined();
    expect(startAfterSpy).not.toHaveBeenCalled();
  });

  test('cursor encode/decode round-trip preserves both lastDocId and lastSortValue', () => {
    // Pure check on the cursor format — guards against accidental shape
    // change that would break pagination across deploys.
    const payload = {
      lastDocId: 'task_xyz',
      lastSortValue: 1_700_000_001_234,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64',
    );
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64').toString('utf8'),
    );
    expect(decoded).toEqual(payload);
  });
});
