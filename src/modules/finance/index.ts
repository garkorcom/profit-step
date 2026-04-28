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
 * Finance & Payroll module — public surface.
 *
 * Everything outside this module should import from `src/modules/finance`
 * (this barrel), never reach into internal paths. An ESLint
 * `no-restricted-imports` rule enforces that boundary so neighbouring
 * modules (TimeTracking, CRM, etc.) can be refactored without rippling
 * payroll bugs — and vice versa.
 *
 * See `docs/finance-module/ISOLATION_PLAN.md` for the architecture plan
 * and the 50 use-case safety matrix driving the boundary.
 */

// Pure services — no React, no Firebase side effects, 100% unit-testable.
export {
    type PayrollBuckets,
    calculatePayrollBuckets,
} from './services/payroll';

export {
    type EmployeeLite,
    isReportableSession,
    filterReportableSessions,
    defaultFinanceStartDate,
    normalizeEmployeeName,
    buildEmployeeDropdown,
} from './services/financeFilters';

// Data-layer types + (stable) async readers. The functions are exported
// for advanced callers (scripts, tests); the normal UI path uses the
// hooks below.
export {
    type Employee,
    type CostEntry,
    type ClientLite,
    type EmployeeDirectory,
    fetchWorkSessions,
    fetchCosts,
    fetchEmployeeDirectory,
    fetchActiveClientsLite,
    normalizeSessionIdentities,
} from './api/financeApi';

// React hooks — the canonical consumer of the API for UI code.
export { useFinanceLedger } from './hooks/useFinanceLedger';
export { useEmployeesWithRates } from './hooks/useEmployeesWithRates';
export { useActiveClientsLite } from './hooks/useActiveClientsLite';
