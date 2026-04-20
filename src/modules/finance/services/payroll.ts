/**
 * Unified Payroll Balance Calculation
 *
 * Salary balance formula (2026-04-17):
 *   Balance = Salary + Adjustments − Payments
 *
 * Business expenses (from `costs` collection) are a SEPARATE ledger and
 * intentionally NOT subtracted from the salary balance — mixing them
 * produced nonsense negative balances for admins/owners who log their
 * own business spend under their userId (see scripts/verify-balance-formula.ts).
 *
 * `expenses` is still surfaced in the `PayrollBuckets` result so the UI
 * can show it as a separate info card, but it is not deducted from `balance`.
 *
 * Salary      = sessionEarnings from regular/undefined sessions (NOT voided)
 * Payments    = abs(sessionEarnings) from type='payment' entries
 * Adjustments = sessionEarnings from type='correction' OR 'manual_adjustment'
 * Expenses    = from costs collection (passed in separately, informational)
 *
 * Moved here from `src/utils/payroll.ts` as part of the Finance module
 * isolation (see docs/finance-module/ISOLATION_PLAN.md). The legacy path
 * re-exports from here for one release so external callers don't break.
 */
import { WorkSession } from '../../../types/timeTracking.types';

export interface PayrollBuckets {
    /** Accrued salary from regular work sessions (non-voided) */
    salary: number;
    /** Sum of payment records (always positive) */
    payments: number;
    /** Sum of corrections + manual adjustments (can be negative) */
    adjustments: number;
    /** Costs/expenses (from costs collection, passed in) */
    expenses: number;
    /** salary + adjustments − payments  (expenses NOT subtracted, see file doc) */
    balance: number;
    /** Total work minutes (regular sessions only, excludes payments/adjustments) */
    totalMinutes: number;
    /** totalMinutes / 60 */
    totalHours: number;
}

/**
 * Calculate payroll buckets from a list of work_session entries.
 *
 * @param entries - Filtered work sessions (already filtered by date, employee, etc.)
 * @param expenses - Total expenses amount (from costs collection)
 */
export function calculatePayrollBuckets(
    entries: WorkSession[],
    expenses: number = 0
): PayrollBuckets {
    let salary = 0;
    let payments = 0;
    let adjustments = 0;
    let totalMinutes = 0;

    entries.forEach(entry => {
        const earnings = entry.sessionEarnings || 0;
        const type = entry.type || 'regular';

        if (type === 'payment') {
            // Payment records have negative sessionEarnings; we store as positive
            payments += Math.abs(earnings);
        } else if (type === 'correction' || type === 'manual_adjustment') {
            // Corrections (void offsets) and manual adjustments
            adjustments += earnings;
        } else {
            // Regular work sessions — only count if not voided
            if (!entry.isVoided) {
                salary += earnings;
                totalMinutes += (entry.durationMinutes || 0);
            }
        }
    });

    const balance = salary + adjustments - payments;

    return {
        salary,
        payments,
        adjustments,
        expenses,
        balance,
        totalMinutes,
        totalHours: totalMinutes / 60
    };
}
