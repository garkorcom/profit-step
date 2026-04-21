# Аудит вычленяемости 4 модулей (USER / TIME / CLIENT / MONEY)

> **Автор:** Claude (Explore agent)
> **Дата:** 2026-04-20
> **Цель:** оценить насколько модули USER / TIME TRACKING / CLIENT / MONEY можно вычленить в отдельные проекты/микросервисы в будущем. **Не план немедленного действия** — аудит текущего состояния + карта блокеров.
> **Parent:** [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md)

---

## 0. TL;DR

| Модуль | Extract Score | Effort | Рекомендуемая Phase |
|---|---|---|---|
| **MONEY** (Finance) | **4/5** ✅ уже начато | 2 недели | **Phase 1** |
| **CLIENT** | 3/5 | 2-3 недели | Phase 2 |
| **USER** | 3/5 | 2 недели | Phase 3 |
| **TIME TRACKING** | **2/5** ⚠ | 3+ недели | Phase 4 (последний) |

**Главный вывод:** Finance уже имеет [`src/modules/finance/`](../../src/modules/finance/) (PR [#48](https://github.com/garkorcom/profit-step/pull/48)) — используем его как шаблон для остальных трёх. Сначала extract'ить то что уже изолировано, в последнюю очередь самое связанное (TIME TRACKING читает users/clients/tasks напрямую из Firestore).

---

## 1. Inventory: что принадлежит каждому модулю

| | USER | TIME | CLIENT | MONEY |
|---|---|---|---|---|
| **Backend routes** | `users.ts` (1) | `timeTracking.ts` (1) | `clients.ts`, `deals.ts` (2) | `finance.ts`, `costs.ts` (2) |
| **Backend services** | — | `TimeTrackingService.ts` | — | 3 (в `src/modules/finance/`) |
| **Backend schemas** | `userSchemas.ts` | `timeTrackingSchemas.ts` | `clientSchemas`, `dealSchemas` | `financeSchemas`, `costSchemas` |
| **Frontend pages** | 4 | 1 (`TimeTrackingPage`) | 5 | 4 |
| **Frontend components** | `admin/*` (9) | `crm/session*` (5) | `crm/client*` (18+) | `finance/*`, `bank-statements/*` (12+) |
| **Firestore collections owned** | users, employees, teams, companies | work_sessions, time_entries, breaks | clients, projects, deals, contacts | costs, invoices, payments, salaries, advances |

---

## 2. Cross-module dependencies (ключевое)

### Граф прямых Firestore cross-reads

```
TIME TRACKING  ──8x──→  users         (hourlyRate, telegramId resolution)
TIME TRACKING  ──3x──→  clients       (display names)
TIME TRACKING  ──4x──→  gtd_tasks     (hourlyRate cascade, projectId)

MONEY          ──N──→   users         (hourlyRate для payroll)
MONEY          ──N──→   clients       (fuzzy search cost → client)

CLIENT         ──N──→   users         (ownerId для deals)

USER           ──────→  (stand-alone + shared role/scope utils)
```

**TIME TRACKING имеет больше всего cross-reads** — поэтому extract последним.

### Shared utilities / coupling points

| Блокер | Кто использует | Решение |
|---|---|---|
| `admin.firestore.Timestamp` / `FieldValue.serverTimestamp()` | все 4 модуля | extract в `shared/timestamps` package |
| Phone normalization (`normalizePhone`, `looksLikePhone`) | USER + CLIENT + MONEY (cost→client match) | extract в `shared/phone` package |
| `scopesForRole(role)` RBAC | все routes | auth gateway / separate module |
| `fuzzySearchClient()` + `getCachedClients()` | CLIENT owns, MONEY consumes | interface `ClientSearchService` |
| `TELEGRAM_BOT_TOKEN` + Telegram linking | USER + бот (telegram trigger) | webhook gateway service |
| `COST_CATEGORY_LABELS` constants | MONEY + агент routes | move to shared config |
| `req.agentUserId` / `req.effectiveRole` middleware | все routes | shared auth context interface |

---

## 3. Детальный разбор по модулям

### 3.1 USER — Extractability 3/5

- **Endpoints:** 8 в `functions/src/agent/routes/users.ts` (search, list, create, telegram-link, notify, ...)
- **Collections:** `users` (28 refs), `employees`, `teams`, `companies`
- **Inbound deps:** **все 26 routes** читают `users` для auth и permissions
- **Top-3 блокера:**
  1. **RBAC scopes** — `scopesForRole()` раскидан по всем роутам → нужен adapter layer
  2. **Telegram linking** — завязан на WORKER_BOT_TOKEN → нужен gateway для webhook
  3. **Shared auth context** (`req.agentUserId`, `req.effectiveRole`) → interface Provider

### 3.2 TIME TRACKING — Extractability 2/5 ⚠

- **Endpoints:** 4 в `functions/src/agent/routes/timeTracking.ts` (start, active-all, summary, admin-stop)
- **Service:** `TimeTrackingService.ts` (core session logic — хорошо изолирован сам по себе)
- **Trigger:** `workSessionScheduled.ts` (cleanup)
- **Collections owned:** `work_sessions`, `time_entries`, `breaks`
- **Cross-reads (критичное!):** users (8x), clients (3x), gtd_tasks (4x) — **напрямую `db.collection(...)`, не через API**
- **Frontend:** 1 page, 5 components, **41 reference** на `useActiveSession` hook
- **Top-3 блокера:**
  1. Direct Firestore reads на foreign коллекции — **нужны API adapters** для users/clients/tasks
  2. Shared `Timestamp`/`FieldValue` runtime — нужна библиотека общих time-utils
  3. `activeSessionId` хранится в `users` коллекции — нужен внешний StateManager

### 3.3 CLIENT — Extractability 3/5

- **Endpoints:** 6 в clients.ts + 5 в deals.ts
- **Collections owned:** `clients` (21), `deals` (8), `projects` (part), `contacts` (2), `client_portal_tokens`, `client_favorites`
- **Inbound deps:** finance, timeTracking, projects — все читают `clients` для отображения
- **Frontend:** 5 pages + 18+ components + множественные hooks (`useClientDashboard`, `useClientDashboardData`)
- **Top-3 блокера:**
  1. **Phone utils** — `normalizePhone()` used in CLIENT + USER + MONEY → extract в `shared/`
  2. **`getCachedClients()`** — in-memory cache через routeContext → need `ClientCacheService`
  3. **Fuzzy search** — Fuse.js инициализируется в route handler → need `ClientSearchService` class

### 3.4 MONEY (Finance) — Extractability 4/5 ✅

**Уже частично модуляризован!** PR [#48](https://github.com/garkorcom/profit-step/pull/48) + PR [#49](https://github.com/garkorcom/profit-step/pull/49) — структура в [`src/modules/finance/`](../../src/modules/finance/):

```
src/modules/finance/
├── index.ts             (barrel export)
├── api/financeApi.ts    (Firestore readers — pure)
├── services/
│   ├── payroll.ts         (pure calculation)
│   ├── sessionIdentity.ts (unit-testable)
│   └── financeFilters.ts
└── hooks/
    ├── useFinanceLedger.ts
    └── useEmployeesWithRates.ts
```

- **Endpoints:** 5 в finance.ts + 3 в costs.ts
- **Collections owned:** `costs` (15), `invoices`, `payments`, `salaries`, `advances`, `finance_rules`
- **Cross-reads:** `users.hourlyRate` (для payroll) + `work_sessions` + `fuzzySearchClient`
- **Top-3 блокера:**
  1. `users.hourlyRate` — нужен `UserRatesGateway` интерфейс
  2. `finance_rules` в Firestore — перенести в Admin UI / env
  3. Bank statement integrations (Brevo, bank APIs) — abstraction layer

**Этот модуль — шаблон.** Копируем подход на остальные три.

---

## 4. Рекомендуемый порядок extraction

### Phase 1 — MONEY (2 недели) — пилот
- ✅ Фундамент уже есть (`src/modules/finance/`)
- **Что сделать:**
  - Extract `functions/src/agent/routes/finance.ts` + `costs.ts` в отдельный service
  - Создать `UserRatesGateway` interface → USER через адаптер
  - Написать contract tests между MONEY и USER
- **Deliverable:** MONEY работает как отдельный package, USER через interface.

### Phase 2 — CLIENT (2-3 недели)
- Extract `routes/clients.ts` + `deals.ts` + 18 components + 5 pages
- Move phone utils и fuzzy search → `shared/` или `client-sdk` package
- `ClientCacheService`, `ClientSearchService` — отдельные классы
- **Deliverable:** CLIENT как независимый API + SDK для MONEY / TIME consumers

### Phase 3 — USER (2 недели)
- Auth boundary: `scopesForRole()` → adapter
- Telegram linking → webhook gateway (отдельный service)
- `users` API exposed via interface
- **Deliverable:** USER service + shared auth SDK

### Phase 4 — TIME TRACKING (3+ недели, последним)
- Все direct Firestore reads на users/clients/tasks → заменить на API calls к уже extracted сервисам
- `TimeSessions API` adapter
- `activeSessionId` state sync — перенести в отдельный state service или сделать callback из TIME
- Refactor 41 usage `useActiveSession` → через SDK
- **Deliverable:** TIME TRACKING — standalone microservice

---

## 5. Что нужно **до** начала любой extraction

### 5.1 Shared package `@profit-step/common`
- Timestamps / FieldValue helpers
- Phone normalization
- Money types (Decimal, currency)
- Id generators
- Auth context types (no implementation)

### 5.2 Contract / interface layer
- `UserService` interface (read-only первым делом: getUser, getHourlyRate, getEffectiveTeamUids)
- `ClientService` interface (search, getById, listByCompany)
- `TimeSessionService` interface (getActiveSessionForUser, getSessionsForPeriod)
- `FinanceService` interface (createCost, getBalanceForPeriod)

Эти interfaces должны быть в `shared/` и использоваться **уже сейчас** внутри monorepo. Когда модуль extract-нется — implementation переедет в свой service, interface останется.

### 5.3 Feature-flag framework (nice to have)
- Toggle для «использовать внешний USER service vs local» — постепенный rollout

---

## 6. Shared / cross-cutting коллекции

Не принадлежат ни одному модулю — нужна отдельная стратегия:

| Коллекция | Кто читает / пишет | Решение |
|---|---|---|
| `users` | USER owns, все остальные read | USER service + read-only SDK для остальных |
| `projects` | CLIENT + TIME + MONEY | либо CLIENT owns, либо отдельный PROJECT module (Phase 5?) |
| `gtd_tasks` | TIME + CLIENT (assignee) + MONEY (cost linking) | отдельный TASKS module (Phase 5?) |
| `activity_log` | все пишут аудит | events service (Pub/Sub?) |
| `notifications` | все пишут | отдельный notification service |

---

## 7. Метрики текущего состояния (baseline для будущего)

| Метрика | USER | TIME | CLIENT | MONEY |
|---|---|---|---|---|
| LOC routes | ~800 | ~1100 | ~1400 | ~1200 |
| Direct Firestore cross-reads | 0 | **15** ⚠ | 2 | 4 |
| Shared utils used | 5 | 7 | 6 | 3 (уже extracted) |
| Test coverage | mid | good (TimeTrackingService) | mid | **high** (modularized) |
| Extract effort | M | L | M | **S** ✓ |

---

## 8. Когда НЕ начинать extraction

**Сейчас НЕ время для extract**, если хотя бы одно из:
- В бэклоге критичные production bugs (сейчас: bot session flow, warehouse V3 Phase 1 — см. [`PIPELINE_FOLLOWUPS_TZ.md`](./PIPELINE_FOLLOWUPS_TZ.md))
- Команда < 3 инженеров — один monorepo проще поддерживать
- Business roadmap не стабилен (CRM overhaul spec в DRAFT)

Extract имеет смысл когда:
- Готовы инвестировать 8-10 недель без user-facing features
- Есть второй продукт/команда которая реально хочет переиспользовать один из модулей
- Единая кодовая база мешает деплоям / blast radius слишком большой

---

## 9. Последующие шаги (если решим extract'ить)

1. Создать `packages/shared/` в текущем monorepo (timestamps, phone, money, auth types)
2. Переехать все 4 модуля на consuming через interfaces (не напрямую Firestore cross-read) — это **внутри monorepo**, без extract
3. После того как interfaces стабилизировались — начать extract в порядке §4
4. Contract testing между модулями до extract → после extract
5. Feature flag switch на external service per-environment

---

## 10. References

- [`src/modules/finance/`](../../src/modules/finance/) — рабочий пример модуляризации
- PR [#48](https://github.com/garkorcom/profit-step/pull/48) — finance modularize
- PR [#49](https://github.com/garkorcom/profit-step/pull/49) — finance data-layer + hooks
- [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md) — migration на новый сервер
- [`PIPELINE_FOLLOWUPS_TZ.md`](./PIPELINE_FOLLOWUPS_TZ.md) — текущий tech debt
