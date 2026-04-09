/**
 * Advance Account types — employee PO (podotchet) tracking.
 *
 * Two Firestore collections:
 *   advance_accounts    — one doc per advance (issuance of money)
 *   advance_transactions — operations against advances (expenses, returns, etc.)
 *
 * Balance formula:
 *   advance_balance = amount - SUM(transactions.amount)
 *   employee_po_balance = SUM(open advance balances)
 */

import { Timestamp } from 'firebase/firestore';

// ── Advance Account (one issuance of money) ─────────────────────────────────

export type AdvanceStatus = 'open' | 'settled' | 'cancelled';

export interface AdvanceAccount {
  id: string;
  employeeId: string;
  employeeName: string;
  projectId?: string;
  projectName?: string;
  amount: number;
  status: AdvanceStatus;
  description: string;
  issuedAt: Timestamp;
  settledAt?: Timestamp;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}

// ── Advance Transaction ─────────────────────────────────────────────────────

export type AdvanceTransactionType =
  | 'expense_report'
  | 'return'
  | 'payroll_deduction'
  | 'write_off';

export interface AdvanceTransaction {
  id: string;
  advanceId: string;
  employeeId: string;
  employeeName: string;
  type: AdvanceTransactionType;
  amount: number;
  projectId?: string;
  projectName?: string;
  category?: string;
  description: string;
  receiptUrl?: string;
  hasReceipt: boolean;
  createdBy: string;
  createdAt: Timestamp;
  status: 'active' | 'voided';
  voidReason?: string;
}

// ── Display config per transaction type ─────────────────────────────────────

export const ADVANCE_TX_CONFIG: Record<
  AdvanceTransactionType,
  { label: string; icon: string; color: string }
> = {
  expense_report:    { label: 'Expense Report',    icon: 'receipt',    color: '#ff9800' },
  return:            { label: 'Return',             icon: 'undo',       color: '#4caf50' },
  payroll_deduction: { label: 'Payroll Deduction',  icon: 'payment',    color: '#9c27b0' },
  write_off:         { label: 'Write-off',          icon: 'delete',     color: '#f44336' },
};

// ── Balance helpers (pure functions) ────────────────────────────────────────

/** Balance of a single advance = issued amount - sum of active transactions */
export function computeAdvanceBalance(
  advance: AdvanceAccount,
  transactions: AdvanceTransaction[],
): number {
  const spent = transactions
    .filter(tx => tx.advanceId === advance.id && tx.status === 'active')
    .reduce((sum, tx) => sum + tx.amount, 0);
  return Math.round((advance.amount - spent) * 100) / 100;
}

/** Total PO balance for an employee across all open advances */
export function computeEmployeePOBalance(
  advances: AdvanceAccount[],
  transactions: AdvanceTransaction[],
): { totalIssued: number; totalSpent: number; balance: number } {
  const openAdvances = advances.filter(a => a.status === 'open');
  const totalIssued = openAdvances.reduce((sum, a) => sum + a.amount, 0);
  const totalSpent = transactions
    .filter(tx => tx.status === 'active' && openAdvances.some(a => a.id === tx.advanceId))
    .reduce((sum, tx) => sum + tx.amount, 0);
  return {
    totalIssued: Math.round(totalIssued * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100,
    balance: Math.round((totalIssued - totalSpent) * 100) / 100,
  };
}

/** Summary for display in cards/reports */
export interface AdvanceSummary {
  totalIssued: number;
  totalSpent: number;
  totalReturned: number;
  totalDeducted: number;
  totalWrittenOff: number;
  balance: number;
  openCount: number;
}

/** Compute full summary from advances + transactions */
export function computeAdvanceSummary(
  advances: AdvanceAccount[],
  transactions: AdvanceTransaction[],
): AdvanceSummary {
  const active = transactions.filter(tx => tx.status === 'active');
  const openAdvances = advances.filter(a => a.status === 'open');

  const totalIssued = openAdvances.reduce((s, a) => s + a.amount, 0);
  const totalSpent = active.filter(tx => tx.type === 'expense_report').reduce((s, tx) => s + tx.amount, 0);
  const totalReturned = active.filter(tx => tx.type === 'return').reduce((s, tx) => s + tx.amount, 0);
  const totalDeducted = active.filter(tx => tx.type === 'payroll_deduction').reduce((s, tx) => s + tx.amount, 0);
  const totalWrittenOff = active.filter(tx => tx.type === 'write_off').reduce((s, tx) => s + tx.amount, 0);

  return {
    totalIssued: Math.round(totalIssued * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalReturned: Math.round(totalReturned * 100) / 100,
    totalDeducted: Math.round(totalDeducted * 100) / 100,
    totalWrittenOff: Math.round(totalWrittenOff * 100) / 100,
    balance: Math.round((totalIssued - totalSpent - totalReturned - totalDeducted - totalWrittenOff) * 100) / 100,
    openCount: openAdvances.length,
  };
}
