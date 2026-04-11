# Finance & Payroll — Roadmap Improvements

**Date:** 2026-04-10
**Context:** Full audit of current system + research of Gusto, Miter, Workyard, BusyBusy, Procore, Modern Treasury, Medici
**Target:** Small construction company, 5-20 hourly workers, Florida, USA

---

## Current System Inventory (what already exists)

| Area | What works | What's missing |
|------|-----------|---------------|
| Time Tracking | Bot start/stop + photo, admin dashboard, CSV export, geo, face verification | Geofence validation against job sites |
| Earnings | Daily payroll generation, session-based calculation, YTD tracking | Overtime, per-project rates, burdened cost |
| Payments | Manual payment recording, payment history dialog, YTD balance | Scheduled payments, check printing |
| Advances (PO) | Issue via CRM, expense via bot with photo, balance tracking | Auto-deduction from payroll at period close |
| Payroll Periods | Monthly open/close/paid lifecycle, aggregates | Period locking, export CSV/PDF, anomaly checks |
| Reports | Print payroll report, costs report, breakdown by project/employee | Pay stubs, year-end W-2/1099, PDF export |
| Invoices | CRUD, auto-generate from time, payment tracking | Recurring invoices, late fee automation |
| Expenses | Bot cost capture + receipt photo, 8 categories, CRM view | Approval workflow, mileage tracking |
| Bank | PDF/CSV upload, AI categorization, 24 tax categories | Reconciliation against payroll, QuickBooks export |
| P&L | Per-client revenue/labor/materials/profit/margin | Burdened labor cost, overhead allocation |
| Tax | Bank transaction categorization only | Withholding, quarterly estimates, 1099/W-2 |
| Bot | Timer, costs, PO, tasks, daily digest, voice transcription | /mybalance, /myhours, /mypay self-service |

---

## Priority 1 — Legal & Accuracy (do first)

### 1.1 FLSA Overtime Auto-Calculation

**Why:** Federal law requires 1.5x for hours >40/week. Current system pays flat rate regardless. Legal liability.

**Spec:**
- Weekly aggregation function: runs Monday 3 AM ET
- For each employee: sum `work_sessions` hours Mon-Sun
- If >40h: create `overtime_adjustment` entry = `(hours_over_40 * rate * 0.5)`
- Store `weeklyHoursSnapshot` on each ledger entry for audit
- Show overtime hours + premium in PayrollReport and FinancePage
- Telegram bot: warn worker when approaching 35h in a week

**Files:** New `functions/src/scheduled/weeklyOvertimeCalc.ts`, modify `PayrollReport.tsx`, `FinancePage.tsx`

**Reference:** [DOL FLSA Fact Sheet #23](https://www.dol.gov/agencies/whd/fact-sheets/23-flsa-overtime-pay)

### 1.2 Per-Employee Cached Running Balance

**Why:** Current system recomputes balance via full Firestore scan on every page load — slow, inconsistent, caused B1/B2 bugs. Industry standard (Modern Treasury, Medici): cached balance + periodic reconciliation.

**Spec:**
- Add `runningBalance: number` field to `users` collection
- On every earning/payment creation: `FieldValue.increment(amount)` in same batch
- New weekly `reconcileBalances` Cloud Function:
  - Recompute balance from all `work_sessions` since Jan 1
  - Compare vs `runningBalance` on user doc
  - If drift > $1: log alert, optionally send Telegram to admin
- FinancePage reads `runningBalance` for instant display (no full scan)
- Keep `fetchYtdBalance` as fallback / reconciliation tool

**Files:** Modify `generateDailyPayroll.ts`, `FinancePage.tsx` payment handler, new `functions/src/scheduled/reconcileBalances.ts`

### 1.3 Period Locking

**Why:** Closed periods can currently get backdated sessions. Aggregates become stale (bug B14).

**Spec:**
- Add `status: 'locked'` to `PayrollPeriod` type
- New Firestore trigger `onWorkSessionCreate`: if session `endTime` falls in closed/locked period -> reject or flag
- `PayrollPeriodsPage`: add "Lock" button (separate from "Close")
- Once locked, no changes except explicit admin override

**Files:** New trigger, modify `src/types/payroll.types.ts`, `PayrollPeriodsPage.tsx`

---

## Priority 2 — High Business Value (saves admin hours)

### 2.1 Worker Self-Service Bot Commands

**Why:** Workers constantly ask admin "how much have I worked?" and "how much am I owed?". Every construction payroll app (Workyard, BusyBusy) has this.

**Commands:**
| Command | What it shows |
|---------|--------------|
| `/mybalance` | YTD earned, YTD paid, current balance, last payment date, outstanding PO balance |
| `/myhours` | This week's hours by day and project, running weekly total, overtime warning at 35h+ |
| `/mypay` | Last period summary: gross, deductions (advances), net. Simple text "pay stub" |

**Files:** New `functions/src/triggers/telegram/handlers/selfServiceHandler.ts`

### 2.2 Advance Auto-Deduction from Payroll

**Why:** PO system exists but deductions are manual. Admin must reconcile by hand each period.

**Spec:**
- At `closePayrollPeriod`: for each employee with open advances:
  - Calculate max deductible = `gross - (hours * $12.00 FL minimum wage)`
  - Create `advance_deduction` ledger entry (type = `manual_adjustment`, negative)
  - Update `advance_accounts` balance
  - Show in PayrollReport: Gross -> Advance Deduction -> Net
- FLSA compliance: never deduct below minimum wage threshold

**Files:** Modify `closePayrollPeriod.ts`, `PayrollReport.tsx`

**Reference:** [NOLO advance deduction rules](https://www.nolo.com/legal-encyclopedia/can-deduct-employees-paycheck-pay-back-advance.html)

### 2.3 Payroll Export CSV/PDF

**Why:** Accountant needs data every month. No export exists. QuickBooks CSV is standard.

**Spec:**
- "Export Period" button on `PayrollPeriodsPage`
- CSV: Employee Name, ID, Period, Regular Hours, OT Hours, Rate, Gross, Deductions, Net, Projects
- PDF: Render existing `PayrollReport.tsx` via jsPDF (already in dependencies)

**Files:** Modify `PayrollPeriodsPage.tsx`, new `src/utils/payrollExport.ts`

### 2.4 Burdened Labor Cost (True Job Cost)

**Why:** Raw `rate * hours` understates real cost by 30-50%. Leads to underbidding.

**Spec:**
- Add `burdenMultiplier: number` to company settings (default 1.35)
- Components: FICA employer 7.65% + FL SUTA ~2.7% + Workers Comp ~8% + benefits ~5%
- Display: `$35/h raw → $47.25/h burdened` in project P&L and FinancePage
- Calculate: `burdenedCost = hours * hourlyRate * burdenMultiplier` per project

**Files:** Modify `PnLView.tsx`, `FinancePage.tsx` breakdown tables

---

## Priority 3 — Operational Excellence

### 3.1 Pre-Disbursement Anomaly Detection

**Spec:** `validatePayrollPeriod` callable function, run before "Close Period":
- Weekly hours >60 or <10 (when norm is 40) -> flag
- Session >12h without break -> flag
- Rate changed in last 7 days -> highlight
- Earnings but zero hours (or vice versa) -> flag
- Employee not active but has sessions -> flag
- Duplicate sessionId in ledger -> block
- Show anomaly report in confirmation dialog before close

**Files:** New `functions/src/callable/payroll/validatePayrollPeriod.ts`, modify `PayrollPeriodsPage.tsx`

### 3.2 Per-Project Hourly Rates

**Why:** Workers earn different rates on different jobs (commercial vs residential, prevailing wage).

**Spec:**
- New mapping: `employee_project_rates/{empId}_{clientId}` or subcollection
- TimeTracking session start: look up project-specific rate, fall back to default
- Store rate on session at creation time (already done — no historical data loss)

**Files:** New collection, modify `onWorkerBotMessage.ts` session start logic

### 3.3 Weekly Admin Payroll Summary (Telegram)

**Why:** Catch problems weekly, not at month-end.

**Spec:**
- Every Monday 8 AM ET: send to admin Telegram
- Content: total hours, total earnings, per-employee breakdown, overtime flags, unsigned sessions, advance balance changes
- Pattern: like existing `shiftHandoff.ts`

**Files:** New `functions/src/scheduled/weeklyPayrollSummary.ts`

### 3.4 Integer Cents Storage

**Why:** 4+ different rounding methods in codebase cause ~$1/month drift per employee.

**Spec:**
- Helper: `toCents(dollars: number): number`, `toDollars(cents: number): number`
- New entries store `amountCents`. Keep `amount` for backward compat.
- Display layer converts to dollars.
- Migration: not needed for old data (read both fields, prefer `amountCents`)

---

## Priority 4 — Compliance & Future

### 4.1 Year-End W-2/1099 Data Export

- Sum all earnings per employee for calendar year
- Flag contractors paid >$600 for 1099-NEC
- Export CSV matching W-2 box format
- Due: January 31 each year

### 4.2 Workers Comp Cost Tracking

- FL formula: `(payroll / 100) * rate * experience_modifier`
- Construction rates: $5-15 per $100 payroll
- Auto-calculate per project for job costing

### 4.3 Pay Stub Generation

- Per-employee per-period: gross, hours by project, OT premium, deductions, net
- Text format for Telegram (`/mypay`), PDF for CRM
- FL doesn't legally require stubs but reduces disputes

### 4.4 Bank Reconciliation Against Payroll

- Match bank statement payments against payroll_ledger disbursements
- Flag unmatched payments (paid but no record)
- Flag unmatched records (record but no bank match)
- Connect existing `BankStatementsPage` with `PayrollPeriodsPage`

### 4.5 Multi-Rate Overtime (Weighted Average)

- FLSA: when employee works at 2+ rates in one week, OT rate = weighted average
- Formula: `regular_rate = total_weekly_earnings / total_weekly_hours`
- OT premium: `(hours_over_40) * regular_rate * 0.5`
- Needed only if per-project rates (3.2) are implemented

### 4.6 Geofence Clock-In Validation

- Bot already receives photos with EXIF GPS
- Compare against `clients/{id}.address` geocoded coordinates
- Flag if >500m from job site
- Already partially implemented (`locationMismatch`, `locationDistanceMeters` fields exist on WorkSession)

---

## Implementation Order (suggested)

| Phase | Items | Effort | Timeline |
|-------|-------|--------|----------|
| Phase A | 1.1 Overtime, 1.2 Running Balance, 1.3 Period Lock | 3-4 days | Week 1 |
| Phase B | 2.1 Bot Self-Service, 2.3 CSV/PDF Export | 2 days | Week 1-2 |
| Phase C | 2.2 Advance Deduction, 2.4 Burdened Cost | 2 days | Week 2 |
| Phase D | 3.1 Anomaly Detection, 3.3 Weekly Summary | 2 days | Week 2-3 |
| Phase E | 3.2 Per-Project Rates, 3.4 Integer Cents | 3 days | Week 3 |
| Phase F | 4.1-4.6 Compliance & Future | Ongoing | Month 2+ |
