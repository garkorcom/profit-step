/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 🚨 PROD-CRITICAL — time-tracking / finance module                        ║
 * ║                                                                          ║
 * ║ DO NOT MODIFY without explicit approval from Denis in chat.              ║
 * ║                                                                          ║
 * ║ This file participates in real workers' hours and money calculation.   ║
 * ║ A one-line firestore.rules tightening without code/index/backfill        ║
 * ║ companions caused the 6-hour outage of incident 2026-04-28.              ║
 * ║                                                                          ║
 * ║ Before touching this file:                                               ║
 * ║   1. Read ~/.claude/projects/-Users-denysharbuzov-Projects-profit-step/  ║
 * ║      memory/feedback_no_touch_time_finance.md                            ║
 * ║   2. Get explicit "ok" from Denis IN THE CURRENT SESSION.                ║
 * ║   3. If RLS-related: plan backfill + code-audit + indexes + deploy order ║
 * ║      together (see feedback_rls_three_part_change.md).                   ║
 * ║   4. Run functions/scripts/backup-finance-and-time.js BEFORE any write.  ║
 * ║                                                                          ║
 * ║ "Just refactoring / cleaning up / adding types" is NOT a reason to       ║
 * ║ skip step 2. Stop and ask first.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
/**
 * Unified Payroll Balance Calculation — server-side copy.
 *
 * Mirrors `src/modules/finance/services/payroll.ts` so the Telegram bot
 * and the admin-api endpoints compute the salary balance with the
 * exact same formula and bucket definitions as the Web UI.
 *
 * Canonical formula (2026-04-17):
 *   Balance = Salary + Adjustments − Payments
 *
 * Business expenses (`costs` collection) are a SEPARATE ledger and
 * intentionally NOT subtracted from salary balance.
 *
 * Why duplicated (and not a shared package): the web and functions
 * TypeScript projects have different tsconfig targets (ES2017 for
 * functions, modern for Vite), different module systems, different
 * build chains. Copying 80 lines of pure logic is cheaper than adding
 * a workspace monorepo. Keep this file and the web counterpart in
 * lockstep — the unit tests below (`functions/test/payroll.test.ts`)
 * mirror the ones in `src/modules/finance/services/__tests__/` exactly.
 */

export interface PayrollBucketSource {
    sessionEarnings?: number;
    type?: string;
    isVoided?: boolean;
    durationMinutes?: number;
}

export interface PayrollBuckets {
    salary: number;
    payments: number;
    adjustments: number;
    balance: number;
    totalMinutes: number;
    totalHours: number;
}

export function calculatePayrollBuckets(
    entries: PayrollBucketSource[]
): PayrollBuckets {
    let salary = 0;
    let payments = 0;
    let adjustments = 0;
    let totalMinutes = 0;

    entries.forEach(entry => {
        const earnings = entry.sessionEarnings || 0;
        const type = entry.type || 'regular';

        if (type === 'payment') {
            payments += Math.abs(earnings);
        } else if (type === 'correction' || type === 'manual_adjustment') {
            adjustments += earnings;
        } else if (!entry.isVoided) {
            salary += earnings;
            totalMinutes += entry.durationMinutes || 0;
        }
    });

    return {
        salary,
        payments,
        adjustments,
        balance: salary + adjustments - payments,
        totalMinutes,
        totalHours: totalMinutes / 60,
    };
}

/**
 * Should this session land in the Finance / Payroll report?
 *
 * Mirrors `isReportableSession` in
 * `src/modules/finance/services/financeFilters.ts`. If this logic
 * drifts from the web version, the bot and UI show different numbers
 * for the same worker (see safety matrix #23/32/33).
 */
export function isReportableSession(session: {
    type?: string;
    status?: string;
}): boolean {
    if (
        session.type === 'correction' ||
        session.type === 'manual_adjustment' ||
        session.type === 'payment'
    ) {
        return true;
    }
    if (session.status === 'completed' || session.status === 'auto_closed') {
        return true;
    }
    return false;
}
