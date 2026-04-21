# EasyTimerCost — Functional Spec

31 функция в 5 суб-доменах + non-functional requirements + 5 canonical workflows.

---

## Bounded contexts

| Суб-домен | Owns | Core question |
|---|---|---|
| **Time** | WorkSession, Shift, TimeApproval | Кто сколько работал и над чем? |
| **Expenses** | Expense, Receipt, Reimbursement | Сколько потратили на проект? |
| **Client Costing** | ClientCostRollup, ProjectP&L | Сколько клиент стоил и сколько заработали? |
| **Workers (Payroll)** | WorkerLedger, Payout, PayPeriod | Сколько должны работнику? |
| **Audit** | AuditEntry | Кто что когда изменил? |

---

## Roles

| Role | Sees | Can |
|---|---|---|
| **Worker** | Own sessions, own expenses, own clients aggregate | Start/stop shift, submit expense, attach receipt |
| **Foreman** | Crew + self | Worker abilities + approve crew expenses + adjust shift times |
| **Project Manager** | Assigned projects | Read workers, full on projects, reconciliation |
| **Admin / CFO** | Everything | All + payouts + policies + audit |
| **Client portal** | Own projects billable only | Read-only |

**Delegation:** Foreman on PTO → Deputy assigned to approvals (with audit trail).

---

## Time Management

**F1. Shift lifecycle** — Start (worker, client, task, geo, photo) · Active (timer, editable description, pause/resume) · Stop (auto-calc earnings) · Types: regular/overtime/night/holiday/travel/standby · Auto-close at 23:59 · Overlap detection

**F2. Time correction** — Correction requests with workflow · Never delete, always correction with preserved original · Audit-tracked

**F3. Approval workflow** — Default auto-approve · Policy: shifts > 10h require approval · Per-worker "always requires approval" flag

**F4. Multi-worker shift (crew)** — Foreman starts crew in one operation · Individual rates, shared `shiftGroupId` · Stop all or individual

**F5. Geo & attendance** — Start/stop location recorded · > 100mi warning (Tampa-detect exists) · Selfie verification (worker bot exists)

---

## Expense Management

**F6. Expense submission** — Web/mobile/Telegram · OCR receipt · Categories (materials/fuel/tools/subcontractor/meals/lodging/permits/equipment_rental/other) · Multi-currency · Mileage sub-flow · Per-diem

**F7. Approval chain** — Draft → Submitted → Approved → Paid OR Rejected · Thresholds: <$50 auto · $50–$500 foreman · >$500 admin · Rejection requires reason · Split expense across clients

**F8. Billable vs non-billable** — Client attached = billable · Rule engine: materials at active job-site → billable to current client · Admin override in reconciliation

**F9. Reimbursement tracking** — `reimbursable: true` → worker payout queue · Company card → cost accounting only · Receipt retention 7 years

**F10. Policy enforcement** — Per-worker daily/monthly caps · Out-of-policy block or soft-warning · Duplicate detection (same amount/vendor/day)

---

## Client / Project Costing

**F11. Real-time cost rollup** — Per client: labor + materials · Breakdown by worker/date/category · Live updates on stop-shift and approved-expense

**F12. Profitability (P&L per project)** — Revenue from contracts/invoices · Cost = labor + materials + subcontractor + overhead · Margin % per project · Variance (estimate vs actual)

**F13. Budget alerts** — Budget per project per category · 80% spend → warning · 100% → alert (email/push/Telegram)

**F14. Billing & invoicing prep** — Generate invoice draft per period · Billable sessions + billable expenses · Client portal preview · QuickBooks integration hook

**F15. Change-order impact** — Extra work bumps budget · Cost rollup recalculates · Margin tracking preserved

---

## Worker Financials

**F16. Earnings accrual** — `salary_accrued = Σ session.earnings (approved)` · Adjustments (bonuses/penalties) · **Canonical:** `salaryBalance = earned + adjustments − payments` · Expenses are SEPARATE ledger

**F17. Reimbursable expenses ledger** — Parallel to salary: `reimbursable_balance = Σ approved reimbursable − Σ reimbursement payments`

**F18. Pay periods** — Weekly/bi-weekly/monthly · Lock after payout · Unlock requires admin + reason → audit

**F19. Payouts** — Admin select workers → generate pay run → record payment · Apply to salary OR reimbursable ledger (explicit) · Export payroll.csv for bank

---

## Reporting & Analytics

**F20. Standard reports** — Weekly labor · Expense by category/period/client · Project P&L · Worker attendance · Client profitability ranking

**F21. Dashboards** — Role-based home · Worker: today's earnings + balance + next payout · Foreman: crew status · PM: project budget variance + pending approvals · CFO: WIP + payables + top/bottom-5 clients

**F22. Export & API** — CSV / Excel / PDF · REST API with tokens for BI · Scheduled delivery

---

## Audit, compliance, governance

**F23. Immutable audit log** — Every change: who/what/when/before/after/reason · Append-only · Admin UI search

**F24. Data retention** — Sessions 7y · Receipts 7y · Audit 10y · Soft-delete + tombstone + permanent purge after retention

**F25. PII & access control** — SSN/bank details CFO-only · Access logging · GDPR: export/delete my data

---

## Integration points

**F26.** Telegram bot (existing) — shift + expense flows
**F27.** QuickBooks / Xero — labor + expenses as journal entries
**F28.** Bank API (Plaid) — company card reconciliation
**F29.** Client portal — read-only billing view
**F30.** Payroll providers (ADP, Gusto) — pay run export
**F31.** Storage (S3 / Firebase Storage) — receipts + selfies

---

## Non-functional requirements

| Characteristic | Requirement |
|---|---|
| Availability | 99.9% uptime |
| Performance | List view 1000 workers < 2s; dashboard P95 < 1s |
| Offline | Worker can submit shift/expense offline, sync on reconnect |
| Mobile | Expense submission mobile-primary |
| Concurrency | Race-safe (dual-device shift start) |
| Idempotency | Retry-safe (Telegram webhook) |
| Auditability | Every financial write → immutable audit entry |
| Accessibility | WCAG 2.1 AA (admin screens) |
| i18n | RU primary, EN/ES ready |

---

## Canonical workflows

1. **Worker's day:** start shift (photo) → work → expense on site (receipt) → stop shift → see balance
2. **Foreman's day:** crew check-in → monitor sessions → approve EOD expenses → EOD summary
3. **PM's week:** project view → labor + materials vs budget → flag overrun → change-order → update budget
4. **CFO's pay period:** close period → review approvals → generate pay run → bank export → record payments → lock
5. **Client billing cycle:** period end → invoice draft → review billable → client portal → approve → mark invoiced → track payment

---

## Release scope

| Release | Features | Weeks |
|---|---|---|
| **R1 (MVP)** | F1, F6, F7 (lite), F11, F16–F19, F21 | 2–3 |
| **R2** | F8, F9, F12, F13, F14, F20, F23 | 6–8 |
| **R3** | F2, F3, F10, F22, F25, F27–F30 | 10–12+ |
