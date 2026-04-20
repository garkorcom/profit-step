/**
 * DEPRECATED — this path is now a compat re-export.
 *
 * The real implementation lives at
 * `src/modules/finance/services/financeFilters.ts` as part of the Finance
 * module isolation (see `docs/finance-module/ISOLATION_PLAN.md`).
 *
 * Delete this file once all callers import from the module directly.
 * Existing imports (`import ... from '../../utils/financeFilters'`) keep
 * working through these re-exports so this shim can ship with zero
 * breakage.
 */

export {
    type EmployeeLite,
    isReportableSession,
    filterReportableSessions,
    defaultFinanceStartDate,
    normalizeEmployeeName,
    buildEmployeeDropdown,
} from '../modules/finance';
