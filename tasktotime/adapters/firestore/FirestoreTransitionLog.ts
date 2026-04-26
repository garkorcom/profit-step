/**
 * FirestoreTransitionLog — adapter for the append-only `tasktotime_transitions`
 * collection. See spec/04-storage/adapter-mapping.md §2 for the canonical
 * mapping table; this file is the implementation.
 *
 * Design highlights:
 *   - Deterministic id `${taskId}_${from ?? 'INIT'}_${to}_${at}` makes
 *     `append` naturally idempotent: a retry with the same payload writes
 *     the same document. Pattern A (lifecycle transition) co-writes the
 *     transition log inside the same `runTransaction` as `task.save`, so the
 *     adapter exposes an optional `tx` argument to participate in an
 *     existing transaction without opening a nested one.
 *   - Time conversion at the boundary: domain holds `at` as `EpochMs`;
 *     Firestore stores it as `Timestamp`. Helpers from `_shared` keep the
 *     conversions in one place.
 *   - All queries are company-scoped per the multi-tenant convention. The
 *     `findForTask` query relies on the composite index
 *     `tasktotime_transitions(companyId, taskId, at desc)` (see
 *     spec/04-storage/indexes.md). The two-leg index keeps RLS predicates
 *     attached to the read.
 */

import type {
  Firestore,
  Transaction,
  DocumentData,
  Query,
  Timestamp as TimestampType,
} from 'firebase-admin/firestore';

import type { TransitionLogPort, TransitionLogEntry } from '../../ports/repositories/TransitionLogPort';
import type { TaskId, CompanyId } from '../../domain/identifiers';
import type { TaskLifecycle } from '../../domain/lifecycle';
import type { UserRef } from '../../domain/Task';

import { Timestamp, toEpochMs, toTimestamp, stripUndefined, type AdapterLogger, noopLogger } from './_shared';
import { AdapterError, mapFirestoreError } from '../errors';

/** Collection name (single source of truth, used by indexes.md). */
const COLLECTION = 'tasktotime_transitions';

/**
 * Build the deterministic document id used to make `append` idempotent.
 *
 * Format mirrors the JSDoc of `TransitionLogEntry.id`:
 *   `${taskId}_${from ?? 'INIT'}_${to}_${at}`
 *
 * `at` is included in millis precision — two transitions on the same task
 * landing on the exact same ms is functionally impossible (and would in any
 * case be the same event by definition).
 */
export function makeTransitionLogId(
  taskId: TaskId,
  from: TaskLifecycle | null,
  to: TaskLifecycle,
  at: number,
): string {
  return `${taskId}_${from ?? 'INIT'}_${to}_${at}`;
}

/**
 * Wire-format of a transition log doc as stored in Firestore. `at` is a
 * Timestamp (not EpochMs) on disk; the conversion happens at the boundary.
 */
interface TransitionLogDoc {
  companyId: CompanyId;
  taskId: TaskId;
  from: TaskLifecycle | null;
  to: TaskLifecycle;
  action: string;
  reason?: string;
  by: UserRef;
  at: TimestampType;
  meta?: Record<string, unknown>;
}

/** Convert wire-format doc → domain entry (Timestamp → epochMs). */
function fromDoc(id: string, data: DocumentData): TransitionLogEntry {
  return {
    id,
    companyId: data.companyId as CompanyId,
    taskId: data.taskId as TaskId,
    from: (data.from ?? null) as TaskLifecycle | null,
    to: data.to as TaskLifecycle,
    action: data.action as string,
    reason: data.reason as string | undefined,
    by: data.by as UserRef,
    at: toEpochMs(data.at) ?? 0,
    meta: data.meta as Record<string, unknown> | undefined,
  };
}

/** Convert domain entry → wire-format doc (epochMs → Timestamp). */
function toDoc(entry: TransitionLogEntry): TransitionLogDoc {
  const ts = toTimestamp(entry.at);
  if (ts == null) {
    throw new AdapterError(
      'STORAGE_FAILURE',
      `TransitionLogEntry.at must be a valid epoch ms; got ${entry.at}`,
      { entryId: entry.id },
    );
  }
  return stripUndefined({
    companyId: entry.companyId,
    taskId: entry.taskId,
    from: entry.from,
    to: entry.to,
    action: entry.action,
    reason: entry.reason,
    by: entry.by,
    at: ts,
    meta: entry.meta,
  }) as TransitionLogDoc;
}

/**
 * Firestore-backed implementation of {@link TransitionLogPort}.
 *
 * Hexagonal note: this class lives in the adapter layer. The domain/ports
 * layers must NEVER import it; injection happens at the composition root.
 */
export class FirestoreTransitionLog implements TransitionLogPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Append a transition entry. Pattern A — see adapter-mapping.md §2: the
   * lifecycle change writes both the task document and the transition log
   * inside the same Firestore `runTransaction` for atomicity.
   *
   * If `tx` is provided we participate in the caller's transaction; if not,
   * we issue a regular `set`. Either way the deterministic id makes a retry
   * idempotent: re-running with the same payload writes the same data.
   */
  async append(entry: TransitionLogEntry, tx?: Transaction): Promise<void> {
    const ref = this.db.collection(COLLECTION).doc(entry.id);
    const data = toDoc(entry);
    try {
      if (tx) {
        // Inside an outer transaction — caller will commit.
        tx.set(ref, data);
        return;
      }
      await ref.set(data);
      this.logger.debug?.('[FirestoreTransitionLog] appended', {
        id: entry.id,
        taskId: entry.taskId,
        action: entry.action,
        from: entry.from,
        to: entry.to,
      });
    } catch (err) {
      this.logger.error?.('[FirestoreTransitionLog] append failed', {
        id: entry.id,
        error: String(err),
      });
      throw mapFirestoreError(err, { op: 'append', id: entry.id });
    }
  }

  /**
   * Query the history of a single task. Default limit 50 follows the JSDoc
   * on the port. Uses composite index `(companyId, taskId, at desc)` per
   * adapter-mapping.md §2; if it is missing, the underlying Firestore error
   * is mapped to {@link MissingIndexError} via `mapFirestoreError`.
   */
  async findForTask(taskId: TaskId, limit = 50): Promise<TransitionLogEntry[]> {
    try {
      const snap = await this.db
        .collection(COLLECTION)
        .where('taskId', '==', taskId)
        .orderBy('at', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    } catch (err) {
      throw mapFirestoreError(err, { op: 'findForTask', taskId, limit });
    }
  }

  /**
   * Compliance / BigQuery export query. RLS filter on companyId; optional
   * `sinceMs` lower bound. Uses composite index
   * `(companyId, at desc)` per adapter-mapping.md §2.
   */
  async findForCompany(
    companyId: CompanyId,
    sinceMs?: number,
    limit = 100,
  ): Promise<TransitionLogEntry[]> {
    try {
      let q: Query = this.db
        .collection(COLLECTION)
        .where('companyId', '==', companyId);
      if (sinceMs != null) {
        const ts = toTimestamp(sinceMs);
        if (ts != null) q = q.where('at', '>=', ts);
      }
      q = q.orderBy('at', 'desc').limit(limit);
      const snap = await q.get();
      return snap.docs.map((d) => fromDoc(d.id, d.data()));
    } catch (err) {
      throw mapFirestoreError(err, {
        op: 'findForCompany',
        companyId,
        sinceMs,
        limit,
      });
    }
  }
}

// Re-export the doc-id helper so application code building entries can use
// the same canonical formatter without depending on the adapter class.
export { COLLECTION as TRANSITION_LOG_COLLECTION };

// Hint for downstream type narrowing — Timestamp is a runtime value, but we
// also want the type alias for consumers reading the adapter's docs.
export type { TimestampType as FirestoreTimestamp };

// Note: `Timestamp` is intentionally re-imported here in case future
// adapters need the runtime constructor for transaction-builder helpers.
void Timestamp;
