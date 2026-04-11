# Finance & Payroll — Full Audit, Bug Report & Architecture Spec

**Date:** 2026-04-10
**Status:** TODO
**Priority:** CRITICAL (affects payroll accuracy — real money)
**Scope:** Frontend (`FinancePage.tsx`) + Backend (`generateDailyPayroll`, `closePayrollPeriod`, `finalizeExpiredSessions`)

---

## 1. Executive Summary

Full audit of the Finance & Payroll system revealed **15 bugs** across frontend and backend:
- **5 CRITICAL** — wrong balance shown, duplicate payroll entries, timezone mismatch
- **5 HIGH** — voided entries counted, client filter hides payments, auto-closed sessions with $0
- **5 MEDIUM** — rounding inconsistency, missing idempotency key, PayrollReport includes payments

Research of industry best practices (Modern Treasury, Medici, Martin Fowler patterns, construction payroll guides) identified **architectural gaps** vs. standard ledger patterns.

### Observed Data (3 employees):

| Employee | Salary card | Payments card | Dialog sum | Balance card | Correct balance |
|----------|-------------|---------------|------------|-------------|-----------------|
| Алексей | $2,701.80 | $1,000 | $2,000 | -$836 | $701.80 |
| Anton | $15,097.20 | $8,666 | $11,827 | -$3,018 | $3,270.20 |
| Nikolai | $3,247.20 | $3,248 | $3,248 | -$3,248 | -$0.80 |

---

## 2. Current Architecture & Data Flow

### 2.1 Data model (current)

Everything lives in **one** `work_sessions` collection, differentiated by `type`:

```
work_sessions/{id}
  type: 'regular' | 'correction' | 'manual_adjustment' | 'payment'
  sessionEarnings: number   (positive for work, NEGATIVE for payments)
  employeeId: string|number (Firebase UID or Telegram ID)
  startTime: Timestamp      (used for date queries)
  isVoided: boolean         (soft delete)
  clientName: string        (for payments = 'Payment')
  durationMinutes: number
  hourlyRate: number
  finalizationStatus: 'pending' | 'finalized' | 'processed'
```

### 2.2 Frontend data flow (FinancePage.tsx)

```
Firestore (work_sessions)
  |
  +-fetchLedger()-------> entries[] (date-range filtered: startDate..endDate)
  |                        |
  |                        +-filteredEntries[] (+ employee/client/voided filters)
  |                        |   |
  |                        |   +- stats.salary   --> Salary Card (PERIOD)
  |                        |   +- stats.payments --> Payments Card (PERIOD)
  |                        |   +- stats.balance  --> (fallback only)
  |                        |
  |                        +-Dialog: entries.filter(by clicked employee)
  |                             +- totalEarned   --> "Earned" (PERIOD, ONE employee)
  |                             +- totalPaid     --> "Paid"   (PERIOD, ONE employee)
  |                             +- balance       --> "Balance" (global ytdBalance!)
  |
  +-fetchYtdBalance()---> ytdBalance {earned, payments, balance} (Jan1..now)
                           |
                           +-> Balance Card (YTD, overrides stats.balance)
                           +-> Dialog Balance (YTD, possibly ALL employees!)
```

### 2.3 Backend scheduled/callable functions

| Function | Schedule | Timezone | What it does |
|----------|----------|----------|-------------|
| `generateDailyPayroll` | 4:00 AM daily | **UTC** | Creates payroll_ledger entries from yesterday's completed sessions |
| `finalizeExpiredSessions` | 1:00 AM daily | **ET** | Auto-closes sessions older than 48h, marks finalized |
| `closePayrollPeriod` | On-demand (callable) | N/A | Closes monthly period, aggregates totals |

---

## 3. All Bugs Found

### CRITICAL (5)

#### B1: Balance card = YTD, Salary/Payments cards = period
- **File:** `FinancePage.tsx` lines 551-578, 682, 690, 709
- **Issue:** User sees 3 numbers side by side from different time ranges. Salary = last 30 days, Payments = last 30 days, Balance = Jan 1 → now.
- **Impact:** Balance appears random. User expects Balance = Salary - Payments.

#### B2: Dialog balance = global ytdBalance (wrong employee)
- **File:** `FinancePage.tsx` line 1225
- **Issue:** When `filterEmployee='all'`, dialog opens for one employee but `ytdBalance` contains ALL employees' combined YTD balance.
- **Code:** `const balance = ytdBalance?.balance ?? (totalEarned + totalAdj - totalPaid);`
- **Impact:** Clicking on Алексей shows his earnings but everyone's combined balance.

#### B3: generateDailyPayroll — no idempotency guard
- **File:** `functions/src/scheduled/generateDailyPayroll.ts` line 90
- **Issue:** Creates `payroll_ledger` entries with auto-generated doc IDs. No check for existing entries with same `sessionId`. If function retries or runs twice, creates duplicate entries.
- **Code:** `const ledgerRef = db.collection('payroll_ledger').doc();` — random ID, no dedup.
- **Impact:** Double/triple billing in payroll_ledger on Cloud Function retry.

#### B4: generateDailyPayroll — UTC timezone, rest of system uses ET
- **File:** `generateDailyPayroll.ts` line 6-7 vs `finalizeExpiredSessions.ts` line 30
- **Issue:** Payroll runs at `.timeZone('UTC')`, calculates "yesterday" in UTC. Workers are in Florida (ET). Sessions completed at 11pm ET on Day 1 may be assigned to wrong payroll day.
- **Compare:** `finalizeExpiredSessions` correctly uses `.timeZone('America/New_York')` with `toZonedTime/fromZonedTime` conversions.
- **Impact:** Sessions near midnight ET boundary assigned to wrong day.

#### B5: generateDailyPayroll recalculates earnings from rate, ignoring session's own sessionEarnings
- **File:** `generateDailyPayroll.ts` lines 82-87
- **Issue:** Uses `employeeRates[employeeId]` (current user rate) * `durationMinutes` instead of the session's own `sessionEarnings` which was calculated at close time.
- **Code:** `const rate = employeeRates[employeeId] || 0;` ... `const totalAmount = parseFloat((paidHours * rate).toFixed(2));`
- **Impact:** If hourly rate changed between session close and payroll run, payroll_ledger gets different amount than work_sessions shows. Two sources of truth diverge.

---

### HIGH (5)

#### B6: Payments card vs dialog payment sum mismatch
- **File:** `FinancePage.tsx` lines 551-578 vs 1214-1222
- **Sub-issues:**
  - **(a)** Card uses `filteredEntries`, dialog uses `entries` — different filter sets
  - **(b)** Client filter excludes payments: payment records have `clientName='Payment'`, so selecting client = "Jim" hides ALL payments from stats
  - **(c)** Dialog doesn't respect `isVoided` flag
- **Impact:** Card and dialog show different payment totals for same employee.

#### B7: closePayrollPeriod — no isVoided check
- **File:** `closePayrollPeriod.ts` lines 93-124
- **Issue:** Skips corrections/adjustments but does NOT filter `isVoided: true` entries. Voided sessions counted in `totalAmount`, `totalHours`, `totalSessions`.
- **Impact:** Closed period aggregates are inflated.

#### B8: closePayrollPeriod vs generateDailyPayroll — different date field
- **File:** `closePayrollPeriod.ts` line 78 vs `generateDailyPayroll.ts` line 30
- **Issue:** Period close queries by `startTime`, payroll generation queries by `endTime`. A session starting at 11pm Day 1 and ending 7am Day 2 is in different periods.
- **Impact:** Period aggregates don't match payroll_ledger totals.

#### B9: Auto-closed sessions have no earnings, but included in payroll
- **File:** `finalizeExpiredSessions.ts` lines 93-102, `generateDailyPayroll.ts` line 29
- **Issue:** `finalizeExpiredSessions` explicitly does NOT calculate earnings for auto-closed sessions (comment: "Don't auto-calculate! Requires admin review"). But `generateDailyPayroll` includes `status: 'auto_closed'` in its query. With `hourlyRate: 0` or `durationMinutes: 0`, creates $0 ledger entries.
- **Impact:** Meaningless $0 payroll entries. If admin later confirms actual duration, no mechanism to update the already-created ledger entry.

#### B10: PayrollReport includes payment entries as negative "projects"
- **File:** `PayrollReport.tsx` lines 44-96
- **Issue:** Iterates ALL entries including `type='payment'`. Payments appear as project "Payment" with negative `money`. Employee's `totalMoney` = earned - payments (net), but labeled "Начисления" (earnings).
- **Impact:** Confusing payroll printout. A worker who earned $5000 and was paid $3000 shows total $2000 labeled as "earnings".

---

### MEDIUM (5)

#### B11: Rounding inconsistency across files
- **Files:** Multiple
- **Variants found:**
  - `parseFloat(x.toFixed(2))` — `generateDailyPayroll.ts:87`, `TimeTrackingPage.tsx:179`
  - `Math.round(x * 100) / 100` — `onWorkSessionUpdate.ts:146`, `advanceAccount.types.ts:82`
  - Direct `.toFixed(2)` on display — `FinancePage.tsx` (many lines)
- **Impact:** Tiny rounding differences accumulate. Over 100 sessions/month per employee, could drift ~$1.

#### B12: `sessionEarnings || 0` vs `sessionEarnings ?? 0`
- **Files:** All financial calculations
- **Issue:** `0 || 0 = 0` works correctly for this field, but `sessionEarnings` could theoretically be `NaN` from a failed calculation. `NaN || 0` returns `0` (silently losing the error), while `NaN ?? NaN` would preserve the error.
- **Impact:** Corrupted earnings silently become $0 instead of flagging an error.

#### B13: generateDailyPayroll — no idempotency key on ledger doc
- **File:** `generateDailyPayroll.ts` line 90
- **Issue:** Uses auto-generated doc ID instead of deterministic `sessionId`-based ID. Can't upsert or check existence.
- **Fix pattern:** Use `db.collection('payroll_ledger').doc(sessionId)` as natural key.

#### B14: closePayrollPeriod — sessions added after close not blocked
- **File:** `closePayrollPeriod.ts`
- **Issue:** No Firestore rule or trigger prevents backdating a session into a closed period. Period aggregates become stale.
- **Best practice:** Lock periods by checking period status in write triggers.

#### B15: Employee ID normalization differs across backend functions
- **Files:** `generateDailyPayroll.ts` line 81, `closePayrollPeriod.ts` line 122
- **Issue:** `generateDailyPayroll` maps both Telegram ID and UID for rate lookup, but `closePayrollPeriod` uses raw `employeeId` as-is. Same employee could be counted as 2 unique employees in `employeeSet`.
- **Impact:** `employeeCount` in period aggregates may be inflated.

---

## 4. Industry Best Practices (from research)

### 4.1 Recommended data model (vs current)

**Current (anti-pattern):** Single `work_sessions` collection for everything — earnings, payments, corrections, adjustments. Mixes operational data (work sessions) with financial data (payments).

**Industry standard (Modern Treasury, Medici, Martin Fowler):** Separate **immutable ledger** from operational data:

```
employees/{id}
  runningBalance: number (cached, updated atomically)

employees/{id}/ledger/{entryId}        <-- APPEND-ONLY
  type: 'earning' | 'payment' | 'adjustment' | 'void'
  amount: number (positive = increase balance, negative = decrease)
  date: Timestamp
  sourceSessionId?: string
  linkedEntryId?: string (for voids)
  createdAt: Timestamp
  createdBy: string
  IMMUTABLE — never update, only append

payroll_periods/{id}
  status: 'open' | 'processing' | 'closed' | 'locked'
  ytdEarned, ytdPayments (snapshot at close)
```

**Key principles:**
- **Immutability:** Ledger entries never modified. Firestore rules: `allow update: if false;`
- **Corrections via reversal:** Void = add opposite entry, not modify original
- **Running balance:** Cached on employee doc, updated via Firestore transaction. Periodically reconciled against ledger sum.
- **Amounts in cents (integer):** Avoid floating-point. Store `250080` not `2500.80`.

### 4.2 Balance calculation: Hybrid approach (recommended)

Per Modern Treasury pattern:

1. **Fast path (reads):** `employee.runningBalance` — instant, always up to date
2. **Source of truth (audit):** `SUM(ledger.amount)` — recomputed for reconciliation
3. **Reconciliation cloud function:** Weekly job compares running balance vs ledger sum, flags discrepancies

**Current system:** Recomputes balance on every page load via full Firestore scan. No cached balance. No reconciliation.

### 4.3 Period management

**Industry standard:** Period lifecycle with explicit locks:
```
OPEN -> PROCESSING -> CLOSED -> LOCKED
```
- **OPEN:** Time entries collected
- **PROCESSING:** Payroll being calculated, no more session changes
- **CLOSED:** Paid, entries finalized
- **LOCKED:** Archived, no changes ever

**Current system:** Periods can be closed but nothing prevents backdating sessions into closed periods.

### 4.4 Construction-specific considerations

- **Job costing:** Every hour tagged to project — current system does this via `clientId`
- **Multiple rates:** Workers may have different rates per project — NOT supported currently (single `hourlyRate` per user)
- **Overtime:** FLSA requires 1.5x for 40+ hours/week — NOT calculated currently
- **Labor burden:** True cost = wage + taxes + workers comp (20-40% on top) — NOT tracked

### 4.5 Key GitHub references

| Repo | Pattern |
|------|---------|
| [flash-oss/medici](https://github.com/flash-oss/medici) | Double-entry accounting for Node.js + MongoDB. Immutable journal pattern. |
| [Payroll-Engine/PayrollEngine](https://github.com/Payroll-Engine/PayrollEngine) | Multi-tenant payroll framework. Period lifecycle. |
| Modern Treasury blog | [Ledger scaling](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v), [Immutability](https://www.moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger), [Optimistic locking](https://www.moderntreasury.com/journal/designing-ledgers-with-optimistic-locking) |
| Martin Fowler | [Accounting Entry pattern](https://martinfowler.com/eaaDev/AccountingEntry.html), [Accounting Narrative](https://martinfowler.com/eaaDev/AccountingNarrative.html) |

---

## 5. Proposed Fix Plan

### Phase 1: Critical frontend fixes (B1, B2, B6) — immediate

**Goal:** Make all cards and dialog show consistent, correct numbers.

#### 1a. Summary cards: all YTD

`ytdBalance` already has `{ earned, payments, balance }`. Use all three:

```typescript
// Salary card (line 682):
<Typography variant="h4">${(ytdBalance?.earned ?? stats.salary).toFixed(2)}</Typography>
// Label: "Salary (YTD)"

// Payments card (line 690):
<Typography variant="h4">${(ytdBalance?.payments ?? stats.payments).toFixed(2)}</Typography>
// Label: "Payments (YTD)"

// Balance card (line 709) — unchanged:
<Typography variant="h4">${(ytdBalance?.balance ?? stats.balance).toFixed(2)}</Typography>
```

Add small period subtitle under each card: "Period: $X" from `stats`.

#### 1b. Dialog: employee-specific YTD query

Replace `ytdBalance?.balance` with a dedicated query:

```typescript
const [dialogYtd, setDialogYtd] = useState<{earned: number, payments: number, balance: number} | null>(null);

useEffect(() => {
    if (!historyEmployee) { setDialogYtd(null); return; }

    const fetchEmployeeYtd = async () => {
        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const groupIds = employeeIdGroups.get(historyEmployee.id);
        const allIds = groupIds ? Array.from(groupIds) : [historyEmployee.id];

        // Query for each ID in the group
        let earned = 0, payments = 0;
        for (const empId of allIds) {
            const q = query(
                collection(db, 'work_sessions'),
                where('employeeId', '==', empId),
                where('startTime', '>=', Timestamp.fromDate(yearStart)),
                where('startTime', '<=', Timestamp.fromDate(endOfDay(new Date()))),
            );
            const snap = await getDocs(q);
            snap.docs.forEach(d => {
                const data = d.data();
                if (data.isVoided) return;
                if (data.type === 'payment') {
                    payments += Math.abs(data.sessionEarnings || 0);
                } else if (data.type !== 'correction' || !data.description?.startsWith('VOID REF:')) {
                    earned += (data.sessionEarnings || 0);
                }
            });
        }
        setDialogYtd({ earned, payments, balance: earned - payments });
    };
    fetchEmployeeYtd();
}, [historyEmployee, employeeIdGroups]);
```

Use `dialogYtd` for all 3 summary cards in dialog.

#### 1c. Fix client filter excluding payments

```typescript
// In filteredEntries (line 528):
const matchesClient = filterClient === 'all'
    || entry.clientName === filterClient
    || entry.type === 'payment'
    || entry.type === 'manual_adjustment';
```

#### 1d. Fix dialog missing isVoided check

```typescript
// In dialog (line 1214):
const employeeEntries = entries.filter(e =>
    !e.isVoided &&
    (groupIds?.has(String(e.employeeId)) ?? String(e.employeeId) === historyEmployee.id)
);
```

---

### Phase 2: Critical backend fixes (B3, B4, B5) — high priority

#### 2a. generateDailyPayroll: idempotency

Use `sessionId` as the ledger doc ID:

```typescript
// Instead of: const ledgerRef = db.collection('payroll_ledger').doc();
const ledgerRef = db.collection('payroll_ledger').doc(`session_${doc.id}`);
// batch.set() with merge means re-runs are safe
batch.set(ledgerRef, { ... }, { merge: true });
```

#### 2b. generateDailyPayroll: timezone fix

```typescript
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { subDays, startOfDay, endOfDay } from 'date-fns';

const TIME_ZONE = 'America/New_York';

// Change schedule timezone:
.timeZone(TIME_ZONE)

// Calculate "yesterday" in Florida time:
const nowUtc = new Date();
const nowFlorida = toZonedTime(nowUtc, TIME_ZONE);
const yesterdayFlorida = subDays(nowFlorida, 1);
const startFlorida = startOfDay(yesterdayFlorida);
const endFlorida = endOfDay(yesterdayFlorida);

const startTimestamp = admin.firestore.Timestamp.fromDate(fromZonedTime(startFlorida, TIME_ZONE));
const endTimestamp = admin.firestore.Timestamp.fromDate(fromZonedTime(endFlorida, TIME_ZONE));
```

#### 2c. generateDailyPayroll: use session's own earnings

```typescript
// Instead of recalculating from rate:
const totalAmount = session.sessionEarnings ?? parseFloat((paidHours * rate).toFixed(2));
// Use session's own earnings if available, fallback to calculation
```

#### 2d. Skip auto_closed sessions without admin review

```typescript
// Add after status check:
if (session.status === 'auto_closed' && session.requiresAdminReview) {
    console.log(`Skipping auto-closed session ${doc.id} — awaiting admin review`);
    continue;
}
```

---

### Phase 3: Backend hardening (B7, B8, B9, B14, B15) — planned

#### 3a. closePayrollPeriod: filter voided

```typescript
// Add after line 97:
if (session.isVoided) continue;
if (session.type === 'payment') continue; // payments are separate
```

#### 3b. Consistent date field

Standardize on `endTime` for "which day does this work belong to" everywhere:
- `generateDailyPayroll` already uses `endTime` ✓
- `closePayrollPeriod` needs to switch from `startTime` to `endTime`

#### 3c. Period locking via Firestore trigger

```typescript
// New trigger: onWorkSessionCreate
// If session.startTime falls in a closed/locked period, reject the write
```

#### 3d. Employee ID normalization in closePayrollPeriod

Apply same telegramId-to-UID mapping as `generateDailyPayroll`.

---

### Phase 4: Architecture improvements (future)

| Improvement | Effort | Value |
|-------------|--------|-------|
| Separate ledger subcollection per employee | Large | Clean separation of concerns, immutable entries |
| Store amounts as integer cents | Medium | Eliminate floating-point drift |
| Running balance on employee doc (Firestore transaction) | Medium | Instant balance reads, no full scan |
| Weekly reconciliation cloud function | Small | Detect balance drift early |
| Period locking in Firestore rules | Small | Prevent backdating into closed periods |
| Overtime calculation (FLSA 40h/week) | Medium | Legal compliance for US construction |
| Per-project hourly rates | Medium | More accurate job costing |

---

## 6. Use Cases

### UC-1: Admin views all employees' YTD summary
1. Open `/crm/finance`
2. Employee filter = "All"
3. **Expected:** Salary card = total YTD earned (all employees), Payments card = total YTD paid, Balance = earned - paid
4. **Table:** Shows only entries in selected date range
5. Balance card value MUST equal Salary card minus Payments card

### UC-2: Admin views specific employee's YTD
1. Set Employee filter = "Алексей"
2. **Expected:** All 3 cards = Алексей's YTD data
3. Click on Алексей's name in table
4. **Dialog:** Earned = Алексей YTD, Paid = Алексей YTD, Balance = earned - paid
5. Balance in dialog MUST equal Earned minus Paid shown in same dialog

### UC-3: Client filter does not hide payments
1. Set Employee = "Алексей", Client = "Jim Dvorkin"
2. **Table:** Shows only Jim Dvorkin sessions
3. **Cards:** Still show full YTD (not affected by client filter)
4. **Even if cards showed period:** Payments card still includes all payments

### UC-4: Dialog shows correct per-employee balance
1. Employee filter = "All Employees"
2. Click on "Алексей"
3. **Dialog shows:** Алексей's individual YTD (NOT all employees combined)

### UC-5: Voided entries excluded everywhere
1. Add payment for Алексей ($500)
2. Void that payment (creates correction, marks original as voided)
3. **Card:** Payment no longer counted
4. **Dialog:** Voided payment not shown
5. **PayrollReport:** Voided sessions excluded
6. **closePayrollPeriod:** Voided sessions not in aggregates

### UC-6: generateDailyPayroll is idempotent
1. Function runs at 4:00 AM
2. Timeout → automatic retry at 4:01 AM
3. **Expected:** Same ledger entries (upserted), NOT duplicated

### UC-7: Timezone correctness
1. Worker finishes session at 11:30 PM ET on Monday
2. `generateDailyPayroll` runs at 4:00 AM ET Tuesday
3. **Expected:** Session counted in Monday's payroll (Monday date)

### UC-8: Auto-closed session handling
1. Worker starts session but doesn't stop it
2. `finalizeExpiredSessions` auto-closes after 48h with `requiresAdminReview: true`
3. **Expected:** NOT included in payroll_ledger until admin confirms actual hours
4. Admin reviews, sets actual duration/earnings
5. Next `generateDailyPayroll` run picks it up

### UC-9: Period close accuracy
1. Admin closes period "2026-03" (March)
2. **Expected:** Only non-voided, non-payment regular sessions counted
3. A session ending 7am April 1 but starting March 31 → counted in March (by endTime)
4. After close, backdating a session to March is blocked or creates alert

### UC-10: Payment recording
1. Admin adds payment $1000 for Алексей on April 5
2. Created as: `{ type: 'payment', sessionEarnings: -1000, clientName: 'Payment' }`
3. **YTD balance** decreases by $1000
4. **Payments card** increases by $1000
5. **Dialog** shows the payment in payment list
6. Math: new Balance = old Balance - 1000

---

## 7. Files to Modify

### Phase 1 (Frontend)
| File | Changes |
|------|---------|
| `src/pages/crm/FinancePage.tsx` | Cards use ytdBalance for all 3; dialog queries employee-specific YTD; client filter fix; dialog isVoided check |

### Phase 2 (Backend)
| File | Changes |
|------|---------|
| `functions/src/scheduled/generateDailyPayroll.ts` | Timezone → ET; idempotency key; use session earnings; skip auto_closed awaiting review |
| `functions/src/callable/payroll/closePayrollPeriod.ts` | Filter isVoided; filter payments; switch to endTime; normalize employee IDs |

### Phase 3 (Hardening)
| File | Changes |
|------|---------|
| `src/pages/crm/PayrollReport.tsx` | Exclude payment entries from project breakdown |
| New trigger | Period locking on session write |

---

## 8. Testing Plan

### Manual testing
1. Finance page: verify 3 top cards are consistent (Balance = Salary - Payments)
2. Click each employee: dialog values consistent
3. Filter by client: payments still visible
4. Add payment: cards update immediately
5. Void payment: disappears from everywhere
6. Run emulator: trigger `generateDailyPayroll` twice, check no duplicates
7. Check sessions near midnight ET boundary

### Unit tests needed
- `generateDailyPayroll`: idempotency (run twice, count ledger entries)
- `generateDailyPayroll`: timezone boundary (11pm ET session → correct day)
- `closePayrollPeriod`: voided sessions excluded from aggregates
- `closePayrollPeriod`: payment entries not counted as sessions
- Balance calculation: earned - payments = balance for various data sets

---

## 9. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large YTD Firestore reads | Performance | Already exists in `fetchYtdBalance`. One extra query per dialog open. |
| Breaking PayrollReport | Display | PayrollReport uses `filteredEntries` — separate from card logic |
| Timezone change in prod | Payroll dates shift | Deploy on Monday, verify Tuesday's payroll |
| Idempotency key change | Existing ledger unaffected | New key format only applies to new entries |
| Cached running balance drift | Wrong balance shown | Weekly reconciliation function catches it |
