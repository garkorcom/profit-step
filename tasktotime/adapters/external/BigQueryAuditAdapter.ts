/**
 * BigQueryAuditAdapter — `BigQueryAuditPort` implementation.
 *
 * Streams audit rows into BigQuery for compliance / analytics. Mirrors the
 * existing `functions/src/utils/auditLogger.ts` pattern but speaks the
 * tasktotime port shape (eventType / occurredAt / payload as JSON).
 *
 * Adapter mapping: spec/04-storage/adapter-mapping.md §21.
 *
 * Conventions (per port contract):
 *   - **Fire-and-forget. MUST NEVER throw.** Audit failure cannot block a
 *     domain operation.
 *   - On insert error: log a `warn` and, if a Firestore handle is provided,
 *     write a fallback doc to `systemErrors/{auto-id}` so the failure can be
 *     replayed later. The fallback write is also wrapped in try/catch.
 *   - Default dataset/table align with the existing project DWH:
 *     `profit_step_dwh.tasktotime_audit_events_log`. Override per env if
 *     needed (e.g. emulator/sandbox).
 *   - The `BigQuery` client is injected by composition root — no SDK import
 *     leaks beyond this adapter file.
 */

import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import type {
  BigQueryAuditPort,
  AuditEvent,
} from '../../ports/infra/BigQueryAuditPort';
import { type AdapterLogger, noopLogger } from '../firestore/_shared';

export const DEFAULT_DATASET_ID = 'profit_step_dwh';
export const DEFAULT_TABLE_ID = 'tasktotime_audit_events_log';

/**
 * Structural subset of `@google-cloud/bigquery#BigQuery` that this adapter
 * uses. Declared locally so the tasktotime module compiles without a runtime
 * dependency on `@google-cloud/bigquery` (the package only ships with the
 * `functions/` workspace). The composition root in `functions/` passes a real
 * `BigQuery` instance — its public API is wider but structurally compatible.
 */
export interface BigQueryLike {
  dataset(id: string): {
    table(id: string): {
      insert(rows: unknown[]): Promise<unknown>;
    };
  };
}

export interface BigQueryAuditAdapterDeps {
  bigquery: BigQueryLike;
  datasetId?: string;
  tableId?: string;
  /** Optional Firestore for `systemErrors` fallback writes. */
  db?: Firestore;
  logger?: AdapterLogger;
}

export class BigQueryAuditAdapter implements BigQueryAuditPort {
  private readonly bigquery: BigQueryLike;
  private readonly datasetId: string;
  private readonly tableId: string;
  private readonly db?: Firestore;
  private readonly logger: AdapterLogger;

  constructor(deps: BigQueryAuditAdapterDeps) {
    this.bigquery = deps.bigquery;
    this.datasetId = deps.datasetId ?? DEFAULT_DATASET_ID;
    this.tableId = deps.tableId ?? DEFAULT_TABLE_ID;
    this.db = deps.db;
    this.logger = deps.logger ?? noopLogger;
  }

  async log(event: AuditEvent): Promise<void> {
    const row = {
      event_id: makeEventId(event.occurredAt),
      timestamp: new Date(event.occurredAt).toISOString(),
      event_type: event.eventType,
      company_id: event.companyId,
      actor_id: event.actorId ?? null,
      task_id: event.taskId ?? null,
      payload: event.payload ? JSON.stringify(event.payload) : null,
    };

    try {
      await this.bigquery.dataset(this.datasetId).table(this.tableId).insert([row]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn?.(
        'BigQueryAuditAdapter.log failed (non-blocking)',
        {
          dataset: this.datasetId,
          table: this.tableId,
          eventType: event.eventType,
          companyId: event.companyId,
          err: message,
        },
      );
      await this.writeFallback(event, message);
      // Swallow — audit MUST NEVER throw per port contract.
    }
  }

  /**
   * Best-effort fallback. If even this fails, log to console and give up —
   * never re-throw.
   */
  private async writeFallback(event: AuditEvent, errorMessage: string): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.collection('systemErrors').add({
        source: 'BigQueryAuditAdapter',
        eventType: event.eventType,
        companyId: event.companyId,
        actorId: event.actorId ?? null,
        taskId: event.taskId ?? null,
        payload: event.payload ? JSON.stringify(event.payload) : null,
        occurredAt: event.occurredAt,
        errorMessage,
        at: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // Last-ditch — emit to stderr only. console.* is allowed here because
      // the logger may itself be the failing dependency.
      // eslint-disable-next-line no-console
      console.error(
        '[BigQueryAuditAdapter] systemErrors fallback also failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

function makeEventId(occurredAt: number): string {
  const rand = Math.random().toString(36).substring(2, 11);
  return `evt_${occurredAt}_${rand}`;
}
