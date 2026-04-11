import { Timestamp } from 'firebase/firestore';

/**
 * Payroll Period represents a monthly billing/payment cycle
 * 
 * Collection: payroll_periods
 * Document ID: YYYY-MM format (e.g., "2026-01")
 */
export interface PayrollPeriod {
    id: string;                     // "2026-01" (YYYY-MM)
    year: number;                   // 2026
    month: number;                  // 1 (January)

    // Period Status
    // open → closed → locked → paid
    // 'locked' prevents ANY changes (sessions, corrections) without explicit admin override
    status: 'open' | 'closed' | 'locked' | 'paid';

    // Date Range
    startDate: Timestamp;           // First day of month (00:00:00)
    endDate: Timestamp;             // Last day of month (23:59:59)

    // Aggregated Totals (updated when closing period)
    totalSessions?: number;         // Number of sessions in period
    totalHours?: number;            // Sum of all hours
    totalAmount?: number;           // Sum of all earnings
    employeeCount?: number;         // Unique employees

    // Audit Trail
    createdAt: Timestamp;
    closedAt?: Timestamp;           // When period was closed
    closedBy?: string;              // Admin UID who closed
    lockedAt?: Timestamp;           // When period was locked (no further changes)
    lockedBy?: string;              // Admin UID who locked
    paidAt?: Timestamp;             // When marked as paid
    paidBy?: string;                // Admin UID who marked as paid

    // Notes
    notes?: string;                 // Admin notes
}

/**
 * Helper to generate period ID from date
 */
export const getPeriodId = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

/**
 * Helper to get period date range
 */
export const getPeriodDateRange = (periodId: string): { start: Date; end: Date } => {
    const [year, month] = periodId.split('-').map(Number);
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month
    return { start, end };
};
