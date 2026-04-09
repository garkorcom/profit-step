# Advance Accounts (PO / Podotchet) — V1 Specification

**Created:** 2026-04-09
**Author:** Denis + Claude Code
**Status:** In Development

---

## Overview

Employee advance accounts track money given to employees for project material purchases.
Each advance is a separate "mini-account" — the company issues funds, the employee reports
expenses with receipts, returns unused funds, or has the remainder deducted from payroll.

### Accounting Basis

Based on Account 71 "Settlements with Accountable Persons" (RSBU) / "Employee Advances"
(US GAAP Other Current Asset / Other Receivable).

An advance is NOT an expense — it is an asset transfer (Cash -> Receivable from employee).
The expense is recognized only when the employee submits a receipt.

| Event                        | Debit                    | Credit                   |
|------------------------------|--------------------------|--------------------------|
| Issue $500 to employee       | 71 (Advance: Employee)   | 50 (Cash)                |
| Employee buys materials $300 | 10 (Materials -> Project) | 71 (Advance: Employee)  |
| Employee returns $200        | 50 (Cash)                | 71 (Advance: Employee)   |
| Loss $50 -> payroll deduct   | 70 (Wages Payable)       | 71 (Advance: Employee)   |
| Loss $50 -> write-off        | 91 (Other Expenses)      | 71 (Advance: Employee)   |

---

## Data Model

### Collection: `advance_accounts`

One document per advance (one issuance of money).

```typescript
interface AdvanceAccount {
  id: string;
  employeeId: string;
  employeeName: string;
  projectId?: string;
  projectName?: string;
  amount: number;                    // how much was issued
  status: 'open' | 'settled' | 'cancelled';
  description: string;
  issuedAt: Timestamp;
  settledAt?: Timestamp;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
}
```

### Collection: `advance_transactions`

All operations against advances: expenses, returns, deductions, write-offs.

```typescript
interface AdvanceTransaction {
  id: string;
  advanceId: string;                 // FK -> advance_accounts
  employeeId: string;
  employeeName: string;
  type: 'expense_report' | 'return' | 'payroll_deduction' | 'write_off';
  amount: number;                    // always > 0
  projectId?: string;                // may differ from advance (cross-project)
  projectName?: string;
  category?: string;                 // from COST_CATEGORIES
  description: string;
  receiptUrl?: string;               // Firebase Storage URL
  hasReceipt: boolean;
  createdBy: string;
  createdAt: Timestamp;
  status: 'active' | 'voided';
  voidReason?: string;
}
```

### Balance Formulas

```
Advance balance = amount - SUM(expense_report + return + payroll_deduction + write_off)
Employee PO balance = SUM(balances of all 'open' advances)
Total employee balance = YTD salary balance + PO balance
```

Balance > 0 = employee holds company money
Balance = 0 = fully reconciled
Balance < 0 = employee overspent, company owes reimbursement

---

## Transaction Types

| Type               | Direction | When                                    | Required fields            |
|--------------------|-----------|----------------------------------------|----------------------------|
| expense_report     | decrease  | Employee bought materials, has receipt  | amount, project, receipt   |
| return             | decrease  | Employee returns unused cash            | amount                     |
| payroll_deduction  | decrease  | Deduct from salary (unreturned funds)   | amount                     |
| write_off          | decrease  | Write off as company loss               | amount, reason             |

---

## UI Components

1. **AdvancesOverview** — main screen with table + summary cards + filters
2. **IssueAdvanceDialog** — issue new advance to employee
3. **RecordExpenseDialog** — record expense with receipt upload
4. **AdvanceDetailDialog** — drill-down into single advance with transactions
5. **QuickActionDialogs** — return / payroll deduction / write-off

Integration: ToggleButton ZP/PO in Finance page Overview tab.

---

## 60 Use Cases (Summary)

### A. Happy Path (15)
A1-A15: Issue advance, record expenses, submit receipts, return unused funds,
approve/reject, close advance.

### B. Multi-Project (10)
B1-B10: Cross-project expenses, split receipts, project reassignment,
project cancellation with open advances.

### C. Edge Cases (10)
C1-C10: Wrong amounts, duplicates, missing receipts, overspend, stale advances,
employee limits.

### D. Reconciliation (8)
D1-D8: Weekly review, bank statement matching, audit trails, monthly reports.

### E. Payroll Integration (7)
E1-E7: Deduction from salary, installment deductions, write-offs,
employee termination, bonus offset.

### F. Receipt Handling (5)
F1-F5: Blurry photos, multi-receipt, non-English receipts, screenshots, bulk upload.

### G. Reporting (5)
G1-G5: Daily digest, threshold alerts, overdue reminders, project cost reports,
reliability scoring.

### V1 Coverage: 32/60 cases
### V1.5 + V2: remaining 28 (approval workflow, split receipt, auto-reminders,
Telegram bot, OCR, scoring)

---

## Firestore Rules

```
match /advance_accounts/{docId} {
  allow read: if isSignedIn();
  allow create, update: if isAdmin();
  allow delete: if false;
}
match /advance_transactions/{docId} {
  allow read: if isSignedIn();
  allow create, update: if isAdmin();
  allow delete: if false;
}
```

## Indexes

- advance_accounts: employeeId ASC + issuedAt DESC
- advance_transactions: advanceId ASC + createdAt DESC
- advance_transactions: employeeId ASC + createdAt DESC
