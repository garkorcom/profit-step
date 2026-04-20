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
