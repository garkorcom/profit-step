/**
 * Unit tests for FirestoreWikiHistory — pin the subcollection write path
 * and EpochMs → Timestamp conversion at the boundary.
 *
 * The path under test:
 *   `tasktotime_tasks/{taskId}/wiki_history/v${version}` → `set(payload)`
 *
 * Pins:
 *   - Doc id is `v${version}` (deterministic / idempotent on retry).
 *   - Payload has `updatedAt` as a Firestore Timestamp (not raw number).
 *   - Subcollection chain: `collection(tasktotime_tasks).doc(taskId)
 *     .collection(wiki_history).doc(versionId)`.
 *   - `undefined` keys are stripped before the `set` call.
 */

import type {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp as TimestampType,
} from 'firebase-admin/firestore';

import {
  FirestoreWikiHistory,
  WIKI_HISTORY_PARENT_COLLECTION,
  WIKI_HISTORY_SUBCOLLECTION,
  makeWikiHistoryDocId,
} from '../../../adapters/firestore/FirestoreWikiHistory';
import type { WikiHistoryEntry } from '../../../ports/repositories/WikiHistoryPort';
import { asTaskId, asUserId } from '../../../domain/identifiers';

interface RecordedSet {
  /** Path `tasktotime_tasks/{taskId}/wiki_history/{versionId}` we ended up on. */
  path: string;
  payload: Record<string, unknown>;
}

/**
 * Build a structural mock that records the chain
 * `db.collection(parent).doc(taskId).collection(sub).doc(versionId).set(...)`
 * and exposes the resulting `path` + `payload` for assertion. We don't pull
 * in the real Firebase SDK — the contract under test is the chain shape +
 * doc id + payload conversion.
 */
function makeMockDb(): {
  db: Firestore;
  setCalls: RecordedSet[];
  setRejection: (err: unknown) => void;
} {
  const setCalls: RecordedSet[] = [];
  let setRejectionErr: unknown = null;

  const buildSubDoc = (path: string): DocumentReference => {
    return {
      set: jest.fn((payload: Record<string, unknown>) => {
        if (setRejectionErr != null) {
          return Promise.reject(setRejectionErr);
        }
        setCalls.push({ path, payload });
        return Promise.resolve();
      }),
    } as unknown as DocumentReference;
  };

  const buildSubCollection = (path: string): CollectionReference => {
    return {
      doc: jest.fn((id: string) => buildSubDoc(`${path}/${id}`)),
    } as unknown as CollectionReference;
  };

  const buildParentDoc = (path: string): DocumentReference => {
    return {
      collection: jest.fn((name: string) =>
        buildSubCollection(`${path}/${name}`),
      ),
    } as unknown as DocumentReference;
  };

  const buildParentCollection = (name: string): CollectionReference => {
    return {
      doc: jest.fn((id: string) => buildParentDoc(`${name}/${id}`)),
    } as unknown as CollectionReference;
  };

  const db = {
    collection: jest.fn((name: string) => buildParentCollection(name)),
  } as unknown as Firestore;

  return {
    db,
    setCalls,
    setRejection: (err: unknown) => {
      setRejectionErr = err;
    },
  };
}

const T0 = 1_700_000_000_000;

function makeEntry(overrides: Partial<WikiHistoryEntry> = {}): WikiHistoryEntry {
  return {
    version: 3,
    contentMd: '# v3',
    updatedAt: T0,
    updatedBy: { id: asUserId('user_h'), name: 'Historian' },
    changeSummary: 'added permits section',
    ...overrides,
  };
}

describe('FirestoreWikiHistory', () => {
  test('writes to tasktotime_tasks/{taskId}/wiki_history/v{version}', async () => {
    const { db, setCalls } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    await adapter.append(asTaskId('task_xyz'), makeEntry({ version: 7 }));

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].path).toBe(
      `${WIKI_HISTORY_PARENT_COLLECTION}/task_xyz/${WIKI_HISTORY_SUBCOLLECTION}/v7`,
    );
  });

  test('makeWikiHistoryDocId derives v${version}', () => {
    expect(makeWikiHistoryDocId(1)).toBe('v1');
    expect(makeWikiHistoryDocId(42)).toBe('v42');
  });

  test('payload has Firestore Timestamp for updatedAt (not raw number)', async () => {
    const { db, setCalls } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    await adapter.append(asTaskId('task_t1'), makeEntry({ updatedAt: T0 }));

    const ts = setCalls[0].payload.updatedAt as TimestampType;
    // We don't import the real Timestamp class; the check is structural —
    // `toMillis()` exists and round-trips back to the same epoch.
    expect(typeof ts).toBe('object');
    expect((ts as { toMillis?: () => number }).toMillis).toBeInstanceOf(
      Function,
    );
    expect((ts as { toMillis: () => number }).toMillis()).toBe(T0);
  });

  test('payload preserves contentMd, version, updatedBy, changeSummary', async () => {
    const { db, setCalls } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    const entry = makeEntry({
      version: 5,
      contentMd: '# old content',
      updatedBy: { id: asUserId('user_w'), name: 'Writer' },
      changeSummary: 'rev 5',
    });
    await adapter.append(asTaskId('task_payload'), entry);

    expect(setCalls[0].payload).toMatchObject({
      version: 5,
      contentMd: '# old content',
      updatedBy: { id: 'user_w', name: 'Writer' },
      changeSummary: 'rev 5',
    });
  });

  test('strips undefined fields (e.g. omitted changeSummary)', async () => {
    const { db, setCalls } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    await adapter.append(
      asTaskId('task_undef'),
      makeEntry({ changeSummary: undefined, attachments: undefined }),
    );

    expect(setCalls[0].payload).not.toHaveProperty('changeSummary');
    expect(setCalls[0].payload).not.toHaveProperty('attachments');
    // Required fields still present.
    expect(setCalls[0].payload).toHaveProperty('version');
    expect(setCalls[0].payload).toHaveProperty('contentMd');
    expect(setCalls[0].payload).toHaveProperty('updatedAt');
    expect(setCalls[0].payload).toHaveProperty('updatedBy');
  });

  test('persists optional attachments[]', async () => {
    const { db, setCalls } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    const attachments = [
      {
        id: 'a1',
        url: 'gs://bucket/a',
        type: 'photo' as const,
        uploadedAt: T0,
        uploadedBy: { id: asUserId('user_w'), name: 'Writer' },
      },
    ];
    await adapter.append(asTaskId('task_with_attach'), makeEntry({ attachments }));

    expect(setCalls[0].payload).toHaveProperty('attachments');
    expect(
      (setCalls[0].payload.attachments as unknown[]).length,
    ).toBe(1);
  });

  test('throws AdapterError when updatedAt is null', async () => {
    const { db } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    // `toTimestamp(null)` returns null → adapter throws AdapterError
    // (STORAGE_FAILURE) with a descriptive message. The cast bypasses the
    // domain type-guard the same way a corrupted on-disk entry would.
    await expect(
      adapter.append(
        asTaskId('task_bad_ts'),
        makeEntry({ updatedAt: null as unknown as number }),
      ),
    ).rejects.toThrow(/updatedAt must be a valid epoch ms/);
  });

  test('rethrows mapped error on Firestore set failure', async () => {
    const { db, setRejection } = makeMockDb();
    const adapter = new FirestoreWikiHistory(db);

    setRejection(new Error('PERMISSION_DENIED'));

    await expect(
      adapter.append(asTaskId('task_perm_fail'), makeEntry()),
    ).rejects.toThrow();
  });
});
