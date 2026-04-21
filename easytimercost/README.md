# EasyTimerCost

Enterprise-grade Workforce & Project Costs module для profit-step.

Три связанных bounded context — **Time**, **Expenses**, **Client Costing** — плюс **Workers (Payroll)** и **Audit**. Модули независимы (communicate через `packages/contracts/`), UX единый (shared navigation + cross-module widgets).

---

## 🚀 Начать отсюда (2026-04-21 morning review)

1. **Открой прототип** → `npx http-server easytimercost/prototype -p 5175` и зайди на [http://127.0.0.1:5175/_review.html](http://127.0.0.1:5175/_review.html). Там карта всех 23 страниц + порядок чтения.
2. **Главное на утверждение** → [`MINI_TZ.md`](./MINI_TZ.md). Выбор агент-SDK, 8-недельный MVP, A2A-протокол, pricing, чек-лист A/B/C/D.
3. **Sanity-check рисков** → [`USE_CASES.md`](./USE_CASES.md). 100 юз-кейсов, топ-10 рисков, MVP-скоуп.

Всё остальное — существующая ERP-структура ниже.

---

## Что внутри

| Path | Что |
|---|---|
| `docs/ARCHITECTURE.md` | Bounded contexts, navigation graph, dependency rules |
| `docs/FAB_ANALYSIS.md` | Features → Advantages → Benefits (ROI justification) |
| `docs/SPEC.md` | 31 функция (F1–F31) + роли + workflows |
| `packages/contracts/src/` | Public interfaces: `TimeService`, `ExpenseService`, `ClientService`, `WorkerService`, `AuditService` + shared IDs |
| `packages/shared/src/` | Pure utils (money, date, period) |
| `modules/time/` | Time tracking (owns WorkSession, Shift) |
| `modules/expenses/` | Expense management (owns Expense, Receipt, Reimbursement) |
| `modules/clients/` | Client & Project costing (owns ClientCostRollup, ProjectP&L) |
| `modules/workers/` | Worker payroll (owns earnings ledger, payouts) |
| `modules/audit/` | Immutable audit log |
| `modules/shell/` | Dashboard + navigation shell |
| `shared/ui/` | Pure UI primitives (WorkerChip, ClientChip, MoneyDisplay, PeriodFilter) |

---

## Dependency rules (enforcible)

Каждый модуль может импортировать только из:
1. Самого себя (`./`)
2. `packages/contracts/*` — interfaces
3. `packages/shared/*` — pure utils (phone, date, money)
4. `shared/ui/*` — UI primitives
5. Чужой модуль `<other>/widgets/*` — public widget zone (через barrel `index.ts`)

**Запрещено:** прямой import из `<other>/services/*`, `<other>/hooks/*`, `<other>/pages/*`.

---

## 20 страниц по модулям

### Time (`/time/*`)
- `/time` — live-табло активных смен
- `/time/sessions` — all sessions w/ filters
- `/time/sessions/:sessionId` — session detail (+ linked expenses, worker, client)
- `/time/my` — worker self-service
- `/time/approvals` — pending approval queue

### Expenses (`/expenses/*`)
- `/expenses` — admin feed
- `/expenses/submit` — submission form w/ OCR
- `/expenses/my` — worker's own
- `/expenses/approvals` — approval queue
- `/expenses/:expenseId` — detail + receipt viewer + audit

### Clients (`/clients/*`, `/projects/*`)
- `/clients` — list w/ P&L
- `/clients/:clientId` — overview
- `/clients/:clientId/costs` — labor + materials drill-down
- `/clients/:clientId/billing` — invoice drafts
- `/projects/:projectId` — project P&L + change orders

### Workers (`/workers/*`, `/my-balance`)
- `/workers` — list w/ balances
- `/workers/:workerId` — profile (tabs: Time / Expenses / Clients / Payouts)
- `/workers/:workerId/payouts` — pay history + new pay run
- `/my-balance` — worker self-service

### Shared
- `/dashboard` — role-based home w/ widgets
- `/audit` — immutable log

---

## Phases

| Phase | Scope | Weeks |
|---|---|---|
| P1 | Extract existing pages to module structure | 2 |
| P2 | Publish contracts + cross-module widgets | 2 |
| P3 | Expense module (new) | 3 |
| P4 | Client Costing + rollup | 3 |
| P5 | Audit module | 1 |
| P6 | Dashboard + role-based shell | 1 |

Total ~12 weeks; каждая фаза shippable.

---

## Status

🚧 **Scaffolding** — структура папок создана, контракты и страницы не написаны. См. `docs/ARCHITECTURE.md` для следующих шагов.
