/**
 * DEPRECATED — this path is now a compat re-export.
 *
 * The real implementation lives at
 * `src/modules/finance/services/payroll.ts` as part of the Finance module
 * isolation (see `docs/finance-module/ISOLATION_PLAN.md`).
 *
 * Delete this file once all callers import from the module directly.
 */

export {
    type PayrollBuckets,
    calculatePayrollBuckets,
} from '../modules/finance';
