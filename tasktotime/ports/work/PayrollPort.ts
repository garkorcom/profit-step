/**
 * PayrollPort — write access to payroll adjustment ledger.
 *
 * Triggered on `accept` transition to apply bonus/penalty per
 * `BonusPenaltyPolicy`. Idempotency check (`hasAdjustmentForTask`) is
 * critical — double-firing the trigger MUST NOT double-pay.
 *
 * Per CLAUDE.md §"Canonical payroll balance formula":
 *   salaryBalance = earned + adjustments - payments
 * (We append adjustment rows; we do NOT subtract expenses here — that's
 * a separate ledger.)
 */

import type {
  CompanyId,
  TaskId,
  UserId,
  PayrollPeriodId,
} from '../../domain/identifiers';
import type { Money } from '../../domain/Task';

export type PayrollAdjustmentReason =
  | 'bonus_on_time'
  | 'penalty_overdue'
  | 'manual_adjustment';

export interface PayrollAdjustmentInput {
  companyId: CompanyId;
  userId: UserId;
  taskId: TaskId;
  amount: Money;
  reason: PayrollAdjustmentReason;
  payrollPeriodId: PayrollPeriodId;
  note?: string;
}

export interface PayrollPort {
  appendAdjustment(input: PayrollAdjustmentInput): Promise<{ id: string }>;
  /**
   * Idempotency check — returns true if an adjustment of `reason` already
   * exists for `taskId`. Caller skips the append in that case.
   */
  hasAdjustmentForTask(
    taskId: TaskId,
    reason: PayrollAdjustmentReason,
  ): Promise<boolean>;
}
