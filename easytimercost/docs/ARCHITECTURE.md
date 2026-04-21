# EasyTimerCost — Architecture

## Bounded contexts

```
┌─────────────────────────────────────────────────────────────┐
│                      Shell (router + nav)                    │
└─────────────────────────────────────────────────────────────┘
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
  ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌─────┐
  │Time │   │Exp. │   │Cli. │   │Work.│   │Audit│
  │     │   │     │   │     │   │     │   │     │
  └──┬──┘   └──┬──┘   └──┬──┘   └──┬──┘   └─────┘
     │         │         │         │
     └─── Shared Contracts ────────┘
```

Каждый модуль:
- **Owns** свои данные (Firestore collections)
- **Publishes** read-contract через `packages/contracts/*Service.ts`
- **Consumes** чужие контракты через DI
- **Exposes** widgets для использования в чужих страницах

---

## Navigation graph

```
┌─────────────┐
│  Dashboard  │ ── widgets from every module
└──────┬──────┘
       │
       ├──► /time ──────► /time/sessions/:id
       │                       ├──► /workers/:workerId
       │                       ├──► /clients/:clientId
       │                       └──► /expenses?sessionId=
       │
       ├──► /expenses ──► /expenses/:id
       │                       ├──► /workers/:workerId
       │                       ├──► /clients/:clientId
       │                       └──► /time/sessions/:id
       │
       ├──► /clients ───► /clients/:id ──► /clients/:id/costs
       │                       └──► /clients/:id/billing
       │
       └──► /workers ───► /workers/:id
                               ├──► Tab "Время"   (TimeService)
                               ├──► Tab "Затраты" (ExpenseService)
                               ├──► Tab "Клиенты" (ClientService)
                               └──► Tab "Выплаты" (own)
```

---

## Dependency rules

Модуль `A` может импортировать только из:
1. `./` (собственные файлы)
2. `packages/contracts/*` — interfaces, DTOs, branded IDs
3. `packages/shared/*` — pure utils
4. `shared/ui/*` — UI primitives
5. `modules/B/widgets/*` — через public barrel `index.ts`

**Запрещено:**
- `modules/B/services/*` (internal)
- `modules/B/hooks/*` (internal)
- `modules/B/pages/*` (ownership нарушается)

Enforcement — через oxlint `no-restricted-imports` rule.

---

## Shared IDs (branded types)

```typescript
// packages/contracts/src/shared-ids.ts
export type WorkerId  = string & { readonly __brand: 'WorkerId' };
export type ClientId  = string & { readonly __brand: 'ClientId' };
export type SessionId = string & { readonly __brand: 'SessionId' };
export type ExpenseId = string & { readonly __brand: 'ExpenseId' };
export type ProjectId = string & { readonly __brand: 'ProjectId' };
```

Нельзя случайно передать `WorkerId` туда где ожидается `ClientId` — tsc ловит.

---

## Public contracts (skeleton)

### TimeService
```typescript
getSession(id: SessionId): Promise<Session | null>
listByWorker(workerId: WorkerId, period: Period): Promise<Session[]>
listByClient(clientId: ClientId, period: Period): Promise<Session[]>
sumHoursByWorker(workerId: WorkerId, period: Period): Promise<number>
sumLaborCostByClient(clientId: ClientId, period: Period): Promise<number>
```

### ExpenseService
```typescript
getExpense(id: ExpenseId): Promise<Expense | null>
listByWorker(workerId: WorkerId, period: Period): Promise<Expense[]>
listByClient(clientId: ClientId, period: Period): Promise<Expense[]>
listBySession(sessionId: SessionId): Promise<Expense[]>
sumMaterialsCostByClient(clientId: ClientId, period: Period): Promise<number>
submit(input: ExpenseInput): Promise<ExpenseId>
approve(id: ExpenseId, approver: WorkerId): Promise<void>
```

### ClientService
```typescript
getClient(id: ClientId): Promise<Client | null>
list(filter?: ClientFilter): Promise<Client[]>
getPnL(id: ClientId, period: Period): Promise<ProjectPnL>
```

### WorkerService
```typescript
getWorker(id: WorkerId): Promise<Worker | null>
list(filter?: WorkerFilter): Promise<Worker[]>
getBalance(id: WorkerId, period: Period): Promise<WorkerBalance>
```

### AuditService
```typescript
log(entry: AuditEntry): Promise<void>
queryByEntity(type: string, id: string): Promise<AuditEntry[]>
queryByActor(workerId: WorkerId, period: Period): Promise<AuditEntry[]>
```

---

## Cross-module widgets

Widget = reusable component published by one module, consumed by others.

| Widget | Published by | Used on |
|---|---|---|
| `<ActiveSessionsTable/>` | Time | Dashboard, ClientOverview, WorkerProfile |
| `<SessionsHistoryTable/>` | Time | WorkerProfile, ClientCosts |
| `<ExpenseSubmitButton/>` | Expenses | SessionDetail, WorkerProfile |
| `<ExpenseFeed/>` | Expenses | WorkerProfile, ClientCosts, Dashboard |
| `<ClientPnLCard/>` | Clients | ProjectDetail, Dashboard |
| `<ClientChip/>` | Clients | Everywhere references a client |
| `<WorkerChip/>` | Workers | Everywhere references a worker |
| `<WorkerBalanceCard/>` | Workers | Dashboard, MyBalance |
| `<AuditFeed/>` | Audit | Every detail page |

Widget сам загружает свои данные через свой контракт. Host-страница просто монтирует `<Widget id={foo}/>`.

---

## File structure

```
easytimercost/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── FAB_ANALYSIS.md
│   └── SPEC.md
├── packages/
│   ├── contracts/src/
│   │   ├── shared-ids.ts
│   │   ├── period.ts
│   │   ├── TimeService.ts
│   │   ├── ExpenseService.ts
│   │   ├── ClientService.ts
│   │   ├── WorkerService.ts
│   │   ├── AuditService.ts
│   │   └── routes.ts
│   └── shared/src/
│       ├── money.ts
│       ├── date.ts
│       └── period.ts
├── modules/
│   ├── time/
│   │   ├── pages/
│   │   ├── widgets/
│   │   ├── hooks/
│   │   ├── services/         ← TimeFirestoreAdapter
│   │   └── index.ts          ← public barrel
│   ├── expenses/
│   ├── clients/
│   ├── workers/
│   ├── audit/
│   └── shell/
└── shared/ui/
    ├── MoneyDisplay.tsx
    ├── PeriodFilter.tsx
    └── StatusBadge.tsx
```

---

## Next steps

1. Populate `packages/contracts/` with skeleton interfaces
2. Write `modules/*/index.ts` barrels
3. Set up oxlint boundary rule
4. Write `docs/SPEC.md` (all 31 functions)
5. Start P1: extract existing pages
