/**
 * DeleteTaskCommand — DTO for soft-deleting a task via the REST adapter.
 *
 * "Soft delete" sets `archivedAt` (epoch ms) and denormalises `archivedBy`
 * to the user id; the document is NOT removed from Firestore. Hard delete is
 * intentionally unavailable from the public API surface — the audit trail
 * and historical reporting both need the row to remain queryable.
 *
 * See `spec/05-api/rest-endpoints.md §DELETE /tasks/:id`.
 */

import type { UserRef } from '../../domain/Task';

export interface DeleteTaskCommand {
  /** Idempotency key — replays return the cached `archivedAt`. */
  idempotencyKey: string;
  /** Author derived from auth. */
  by: UserRef;
  /** Target task id. */
  taskId: string;
}

export interface DeleteTaskOutcome {
  /** Epoch ms recorded as `archivedAt`. Same value across idempotent replays. */
  archivedAt: number;
  /** True when the call was an idempotent replay (no mutation occurred). */
  skipped: boolean;
}
