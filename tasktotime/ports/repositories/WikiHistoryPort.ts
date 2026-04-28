/**
 * WikiHistoryPort — append-only archive of overflowed wiki versions.
 *
 * The current `TaskWiki` keeps the **last 10** versions inline as
 * `wiki.versionHistory[]` on the parent `tasktotime_tasks/{taskId}` doc
 * (see spec/08-modules/wiki/storage.md and the `UpdateWikiHandler`'s
 * `slice(-9) + new` cap). Once the inline buffer would exceed 10 entries
 * the **oldest** entry is moved to the per-task subcollection
 * `tasktotime_tasks/{taskId}/wiki_history/{versionId}` so the parent doc
 * stays well within Firestore's 1MB document limit.
 *
 * This port is the contract for that archive write. The current call site
 * is `adapters/triggers/onWikiUpdate.ts`, which fires on every wiki edit;
 * the trigger's idempotency guard makes it safe for a retry to re-attempt
 * the same archive write (the deterministic `versionId` document path means
 * a re-run overwrites the same doc with the same payload).
 *
 * Hexagonal note: the port lives in `ports/repositories/` next to
 * {@link TaskRepository} and {@link TransitionLogPort}; concrete adapters
 * live in `adapters/firestore/FirestoreWikiHistory.ts`. Domain + application
 * layers MUST NOT import the adapter directly — wire via the composition
 * root.
 *
 * See:
 *   - spec/08-modules/wiki/storage.md §"Subcollection для старых версий"
 *   - spec/04-storage/collections.md (wiki_history doc shape)
 *   - spec/05-api/triggers.md §onWikiUpdate (overflow archive step)
 */

import type { TaskId } from '../../domain/identifiers';
import type { UserRef, WikiAttachment } from '../../domain/Task';

/**
 * Wire shape of a single archived wiki version.
 *
 * Mirrors `WikiVersion` from `domain/Task.ts` plus `attachments` (kept on
 * the version snapshot so the archive is fully self-describing — the
 * caller doesn't need to merge with the parent doc to render an old
 * version's attachments). `EpochMs` (number) is used for `updatedAt`; the
 * adapter converts to Firestore Timestamp at the boundary.
 */
export interface WikiHistoryEntry {
  version: number;
  contentMd: string;
  attachments?: WikiAttachment[];
  /** Epoch ms — adapter converts to Firestore Timestamp on write. */
  updatedAt: number;
  updatedBy: UserRef;
  /** Optional 1-line change summary captured at edit time. */
  changeSummary?: string;
}

/**
 * Append a wiki version snapshot to a task's `wiki_history/` subcollection.
 *
 * Conventions:
 *   - Document id is derived from `entry.version` (`v${version}`) so a
 *     retry of the same overflow write is idempotent — the deterministic
 *     id makes the second `set` a no-op overwrite of the same payload.
 *   - The adapter is responsible for `EpochMs → Timestamp` conversion at
 *     the boundary.
 *   - Cross-tenant scoping is enforced by Firestore security rules on the
 *     subcollection (see `firestore.rules` §`wiki_history/{versionId}`):
 *     the read predicate verifies the parent task's `companyId` matches
 *     the caller. Server writes are admin-SDK only.
 */
export interface WikiHistoryPort {
  append(taskId: TaskId, entry: WikiHistoryEntry): Promise<void>;
}
