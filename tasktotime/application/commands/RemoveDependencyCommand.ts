/**
 * RemoveDependencyCommand — DTO for unlinking a dependency edge between two
 * tasks via the REST adapter.
 *
 * The edge is identified by `(fromTaskId, toTaskId)` — the path id is the
 * `from` task (the one carrying the `dependsOn[]` entry) and `depId` is the
 * `to` task referenced by the edge. The reverse `blocksTaskIds[]`
 * denormalisation on the target is maintained by the `cascadeBlocksTaskIds`
 * trigger that fires when `from.dependsOn` is rewritten — the application
 * layer does NOT touch the reverse index directly.
 *
 * See `spec/05-api/rest-endpoints.md §DELETE /tasks/:id/dependencies/:depId`
 * and `tasktotime/domain/services/DependencyService.ts:removeDependency`.
 */

import type { UserRef } from '../../domain/Task';

export interface RemoveDependencyCommand {
  /** Idempotency key — replays return the cached state. */
  idempotencyKey: string;
  /** Author derived from auth. */
  by: UserRef;
  /** Source task — the one whose `dependsOn[]` is being trimmed. */
  fromTaskId: string;
  /** Target task — the predecessor being unlinked from `from.dependsOn[]`. */
  toTaskId: string;
}
