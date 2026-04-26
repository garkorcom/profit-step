/**
 * IdGeneratorPort — generates new TaskIds and human-readable taskNumber
 * sequences (e.g. "T-2026-0042").
 *
 * Adapter implements via Firestore atomic counter or NanoID. Domain just
 * receives the next id when creating a task.
 */

import type { CompanyId, TaskId } from '../../domain/identifiers';

export interface IdGeneratorPort {
  newTaskId(): TaskId;
  /** Returns next "T-{year}-{seq}" for the company. */
  nextTaskNumber(companyId: CompanyId, year: number): Promise<string>;
}
