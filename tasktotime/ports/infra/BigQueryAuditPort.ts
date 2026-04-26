/**
 * BigQueryAuditPort — fire-and-forget audit log to BigQuery.
 *
 * Implementations MUST swallow errors. Audit failure must NEVER block a
 * domain operation.
 */

import type { CompanyId } from '../../domain/identifiers';

export interface AuditEvent {
  /** e.g. 'task.created', 'task.transitioned'. */
  eventType: string;
  companyId: CompanyId;
  actorId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
  occurredAt: number;
}

export interface BigQueryAuditPort {
  /** Fire-and-forget. Implementations MUST NOT throw — they swallow errors. */
  log(event: AuditEvent): Promise<void>;
}
