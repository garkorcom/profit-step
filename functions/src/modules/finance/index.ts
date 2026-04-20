/**
 * Finance services — server-side barrel.
 * See `docs/finance-module/ISOLATION_PLAN.md` for the web-side counterpart.
 * Both sides MUST stay in lockstep — kept duplicated (not a shared package)
 * because functions + web have separate tsconfigs / bundlers.
 */

export {
    type PayrollBucketSource,
    type PayrollBuckets,
    calculatePayrollBuckets,
    isReportableSession,
} from './services/payroll';
