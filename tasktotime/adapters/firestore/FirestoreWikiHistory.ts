/**
 * FirestoreWikiHistory — adapter for the per-task `wiki_history` subcollection.
 *
 * Persists overflowed wiki versions at:
 *
 *   `tasktotime_tasks/{taskId}/wiki_history/{versionId}`
 *
 * `versionId` is `v${entry.version}` — deterministic so a retried trigger
 * write of the same overflow event is idempotent (the second `set` overwrites
 * the same doc with the same payload).
 *
 * Time conversion at the boundary: domain holds `EpochMs` (number); Firestore
 * stores `Timestamp`. Conversion happens here in `toDoc`.
 *
 * Cross-tenant guard: the parent `tasktotime_tasks/{taskId}` rule enforces
 * `resource.data.companyId == getUserCompany()`. The subcollection rule (in
 * `firestore.rules`) reads through to the parent doc to keep wiki_history
 * tenant-scoped on read. Writes are server-side only (admin SDK).
 *
 * See:
 *   - spec/04-storage/collections.md §wiki_history
 *   - spec/08-modules/wiki/storage.md §"Subcollection для старых версий"
 *   - spec/05-api/triggers.md §onWikiUpdate (the overflow caller)
 */

import type {
  Firestore,
  Timestamp as TimestampType,
} from 'firebase-admin/firestore';

import type {
  WikiHistoryPort,
  WikiHistoryEntry,
} from '../../ports/repositories/WikiHistoryPort';
import type { TaskId } from '../../domain/identifiers';
import type { UserRef, WikiAttachment } from '../../domain/Task';

import {
  type AdapterLogger,
  noopLogger,
  stripUndefined,
  toTimestamp,
} from './_shared';
import { AdapterError, mapFirestoreError } from '../errors';

/** Parent collection — single source of truth alongside FirestoreTaskRepository. */
const PARENT_COLLECTION = 'tasktotime_tasks';
/** Subcollection name — must match `firestore.rules` and the spec. */
const SUBCOLLECTION = 'wiki_history';

/**
 * Build the deterministic document id used to make `append` idempotent.
 *
 * Format: `v${version}` — version numbers are monotonically increasing
 * per task and never re-used (the application handler bumps them on every
 * save), so this gives a stable id without leaking timestamps that drift
 * on retry.
 */
export function makeWikiHistoryDocId(version: number): string {
  return `v${version}`;
}

/**
 * Wire-format of a wiki history doc as stored in Firestore. `updatedAt` is
 * a Timestamp on disk; the conversion happens at the boundary.
 */
interface WikiHistoryDoc {
  version: number;
  contentMd: string;
  attachments?: WikiAttachment[];
  updatedAt: TimestampType;
  updatedBy: UserRef;
  changeSummary?: string;
}

function toDoc(entry: WikiHistoryEntry): WikiHistoryDoc {
  const ts = toTimestamp(entry.updatedAt);
  if (ts == null) {
    throw new AdapterError(
      'STORAGE_FAILURE',
      `WikiHistoryEntry.updatedAt must be a valid epoch ms; got ${entry.updatedAt}`,
      { version: entry.version },
    );
  }
  return stripUndefined({
    version: entry.version,
    contentMd: entry.contentMd,
    attachments: entry.attachments,
    updatedAt: ts,
    updatedBy: entry.updatedBy,
    changeSummary: entry.changeSummary,
  }) as WikiHistoryDoc;
}

/**
 * Firestore-backed implementation of {@link WikiHistoryPort}.
 *
 * Hexagonal note: this class lives in the adapter layer. The domain/ports
 * layers must NEVER import it; injection happens at the composition root.
 */
export class FirestoreWikiHistory implements WikiHistoryPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Append a wiki version snapshot to `tasktotime_tasks/{taskId}/wiki_history`.
   *
   * Idempotent on retry — `set` with deterministic id `v${version}`
   * overwrites the same doc with the same payload. No `runTransaction` is
   * needed because the parent task `versionHistory[]` crop and this
   * archive write target different documents; the trigger's idempotency
   * reservation prevents both the crop and the archive from running twice.
   */
  async append(taskId: TaskId, entry: WikiHistoryEntry): Promise<void> {
    const docId = makeWikiHistoryDocId(entry.version);
    const ref = this.db
      .collection(PARENT_COLLECTION)
      .doc(taskId)
      .collection(SUBCOLLECTION)
      .doc(docId);
    const data = toDoc(entry);
    try {
      await ref.set(data);
      this.logger.debug?.('[FirestoreWikiHistory] appended', {
        taskId,
        version: entry.version,
        docId,
      });
    } catch (err) {
      this.logger.error?.('[FirestoreWikiHistory] append failed', {
        taskId,
        version: entry.version,
        error: String(err),
      });
      throw mapFirestoreError(err, {
        op: 'append',
        taskId,
        version: entry.version,
      });
    }
  }
}

// Re-export collection names for downstream consumers (e.g. tests, indexes).
export {
  PARENT_COLLECTION as WIKI_HISTORY_PARENT_COLLECTION,
  SUBCOLLECTION as WIKI_HISTORY_SUBCOLLECTION,
};
