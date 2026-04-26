/**
 * FirestorePayroll — `payroll_ledger/{auto-id}` adapter.
 *
 * Implements {@link PayrollPort} on top of Firebase Admin Firestore.
 * Used to append bonus / penalty / manual adjustments triggered by
 * `accept` lifecycle action per `BonusPenaltyPolicy`.
 *
 * See spec/04-storage/adapter-mapping.md §14 PayrollPort.
 *
 * TODO(denis): verify collection name with Denis before deploy. The spec
 *   defaults to `payroll_ledger` (existing in firestore.rules:423) but
 *   notes a pending decision vs `salary_adjustments` — see the §14
 *   "Decision needed" callout. Update `COLLECTION` const in this file
 *   if Denis chooses a different name.
 *
 * Per CLAUDE.md "Canonical payroll balance formula":
 *   salaryBalance = earned + adjustments − payments
 *   (we APPEND adjustment rows here; never subtract expenses — that's a
 *    separate ledger).
 *
 * Anti-double-pay (§14):
 *   `appendAdjustment` runs in a transaction with a precheck on
 *   `(taskId, reason)`. If a row already exists, we skip silently and
 *   return the existing row id.
 *
 * Indexes:
 *   - `payroll_ledger (taskId, reason)`  (NEW PR-A)
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import type {
  PayrollPort,
  PayrollAdjustmentInput,
  PayrollAdjustmentReason,
} from '../../ports/work/PayrollPort';
import type { TaskId } from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger } from './_shared';

// TODO(denis): confirm `payroll_ledger` is the right collection name
// before deploy. See spec/04-storage/adapter-mapping.md §14.
const COLLECTION = 'payroll_ledger';

export class FirestorePayroll implements PayrollPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Append a payroll adjustment row, with anti-double-pay precheck.
   *
   * Adapter mapping (§14 row 1):
   *   `runTransaction`:
   *     1. read `where taskId == X .where reason == Y .limit 1`
   *     2. if not empty → return existing id (idempotent skip)
   *     3. else create new doc, set with serverTimestamp
   *
   * The precheck + write happen in the same transaction so two concurrent
   * trigger retries cannot both succeed. Caller (TaskService) typically
   * also writes `task.payrollProcessedAt = now` in the same outer
   * transaction for cross-collection idempotency.
   */
  async appendAdjustment(input: PayrollAdjustmentInput): Promise<{ id: string }> {
    try {
      return await this.db.runTransaction(async (tx) => {
        const dupQuery = this.db
          .collection(COLLECTION)
          .where('taskId', '==', input.taskId)
          .where('reason', '==', input.reason)
          .limit(1);
        const dupSnap = await tx.get(dupQuery);

        if (!dupSnap.empty) {
          // Idempotent — return existing.
          const existingId = dupSnap.docs[0]?.id ?? '';
          this.logger.info?.('FirestorePayroll.appendAdjustment idempotent skip', {
            taskId: input.taskId,
            reason: input.reason,
            existingId,
          });
          return { id: existingId };
        }

        const ref = this.db.collection(COLLECTION).doc();
        const now = Timestamp.now();
        const payload: Record<string, unknown> = {
          companyId: input.companyId,
          userId: input.userId,
          taskId: input.taskId,
          amount: input.amount.amount,
          currency: input.amount.currency,
          reason: input.reason,
          payrollPeriodId: input.payrollPeriodId,
          createdAt: now,
        };
        if (input.note != null) payload.note = input.note;
        tx.set(ref, payload);
        return { id: ref.id };
      });
    } catch (err) {
      this.logger.error?.('FirestorePayroll.appendAdjustment failed', {
        taskId: input.taskId,
        reason: input.reason,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'Payroll.appendAdjustment',
        taskId: input.taskId,
        reason: input.reason,
      });
    }
  }

  /**
   * Read-only idempotency check — true if any adjustment row exists with
   * the given `(taskId, reason)`.
   *
   * Adapter mapping (§14 row 2):
   *   `where taskId == X .where reason == Y .limit 1` → boolean.
   */
  async hasAdjustmentForTask(
    taskId: TaskId,
    reason: PayrollAdjustmentReason,
  ): Promise<boolean> {
    try {
      const snap = await this.db
        .collection(COLLECTION)
        .where('taskId', '==', taskId)
        .where('reason', '==', reason)
        .limit(1)
        .get();
      return !snap.empty;
    } catch (err) {
      this.logger.error?.('FirestorePayroll.hasAdjustmentForTask failed', {
        taskId,
        reason,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'Payroll.hasAdjustmentForTask',
        taskId,
        reason,
      });
    }
  }
}
