/**
 * UpdateWikiCommand — DTO for editing task wiki markdown.
 */

import type { UserRef } from '../../domain/Task';

export interface UpdateWikiCommand {
  taskId: string;
  contentMd: string;
  /** Expected current version for optimistic concurrency. */
  expectedVersion: number;
  by: UserRef;
  changeSummary?: string;
}
