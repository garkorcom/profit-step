/**
 * Unit tests for the server-side payroll helpers — mirror of the web tests
 * at `src/modules/finance/services/__tests__/financeFilters.test.ts` so
 * drift between bot and UI surfaces as a failing test.
 */

import {
    calculatePayrollBuckets,
    isReportableSession,
} from '../src/modules/finance';

describe('calculatePayrollBuckets (functions)', () => {
    test('regular session counted into salary', () => {
        const buckets = calculatePayrollBuckets([
            { sessionEarnings: 100, type: 'regular', durationMinutes: 240 },
        ]);
        expect(buckets.salary).toBe(100);
        expect(buckets.balance).toBe(100);
        expect(buckets.totalHours).toBe(4);
    });

    test('voided regular session ignored', () => {
        const buckets = calculatePayrollBuckets([
            { sessionEarnings: 100, type: 'regular', isVoided: true },
        ]);
        expect(buckets.salary).toBe(0);
        expect(buckets.balance).toBe(0);
    });

    test('payment subtracts from balance, always positive in payments bucket', () => {
        const buckets = calculatePayrollBuckets([
            { sessionEarnings: 100, type: 'regular', durationMinutes: 240 },
            { sessionEarnings: -50, type: 'payment' },
        ]);
        expect(buckets.payments).toBe(50);
        expect(buckets.balance).toBe(50);
    });

    test('correction adds to adjustments (can be negative)', () => {
        const buckets = calculatePayrollBuckets([
            { sessionEarnings: 100, type: 'regular', durationMinutes: 240 },
            { sessionEarnings: -20, type: 'correction' },
        ]);
        expect(buckets.adjustments).toBe(-20);
        expect(buckets.balance).toBe(80);
    });

    test('expenses do NOT subtract from balance — business ledger only', () => {
        // The web formula deliberately ignores expenses; this server copy
        // deliberately doesn't even accept an expenses arg. Regression guard
        // against someone "fixing" the perceived mismatch by subtracting.
        const buckets = calculatePayrollBuckets([
            { sessionEarnings: 100, type: 'regular' },
        ]);
        expect(buckets.balance).toBe(100);
    });

    test('multiple entries: canonical Алексей example', () => {
        // Per user's screenshot: earned 2859.40, paid 2200, balance 659.40
        const buckets = calculatePayrollBuckets([
            { sessionEarnings: 2859.40, type: 'regular', durationMinutes: 1200 },
            { sessionEarnings: -1200, type: 'payment' },
            { sessionEarnings: -500, type: 'payment' },
            { sessionEarnings: -500, type: 'payment' },
        ]);
        expect(buckets.salary).toBeCloseTo(2859.40, 2);
        expect(buckets.payments).toBe(2200);
        expect(buckets.balance).toBeCloseTo(659.40, 2);
    });
});

describe('isReportableSession (functions)', () => {
    test('completed regular session is reportable', () => {
        expect(isReportableSession({ type: 'regular', status: 'completed' })).toBe(true);
    });
    test('auto_closed session is reportable (previously missed by bot query)', () => {
        expect(isReportableSession({ type: 'regular', status: 'auto_closed' })).toBe(true);
    });
    test('active session is NOT reportable', () => {
        expect(isReportableSession({ type: 'regular', status: 'active' })).toBe(false);
    });
    test('correction always reportable regardless of status', () => {
        expect(isReportableSession({ type: 'correction', status: 'active' })).toBe(true);
    });
    test('manual_adjustment always reportable', () => {
        expect(isReportableSession({ type: 'manual_adjustment' })).toBe(true);
    });
    test('payment always reportable', () => {
        expect(isReportableSession({ type: 'payment' })).toBe(true);
    });
});
