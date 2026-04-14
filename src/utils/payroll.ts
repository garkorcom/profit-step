/**
 * Unified Payroll Balance Calculation
 *
 * Single source of truth for the formula:
 *   Balance = Salary - Payments - Expenses
 *
 * Salary  = sessionEarnings from regular/undefined sessions (NOT voided)
 * Payments = abs(sessionEarnings) from type='payment' entries
 * Expenses = from costs collection (passed in separately)
 *
 * Corrections (type='correction') and manual_adjustments are tracked
 * as a separate bucket and included in balance.
 */
import { WorkSession } from '../types/timeTracking.types';

export interface PayrollBuckets {
    /** Accrued salary from regular work sessions (non-voided) */
    salary: number;
    /** Sum of payment records (always positive) */
    payments: number;
    /** Sum of corrections + manual adjustments (can be negative) */
    adjustments: number;
    /** Costs/expenses (from costs collection, passed in) */
    expenses: number;
    /** salary + adjustments - payments - expenses */
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

    const balance = salary + adjustments - payments - expenses;

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
