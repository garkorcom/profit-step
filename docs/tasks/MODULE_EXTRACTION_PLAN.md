# План extraction 4 модулей

> **Статус:** PLAN (не начат)
> **Дата:** 2026-04-20
> **Audit (состояние):** [`MODULE_EXTRACTABILITY_AUDIT.md`](./MODULE_EXTRACTABILITY_AUDIT.md)
> **Итоговый результат:** 4 независимых service/package, shared contracts, monorepo остаётся thin shell.

---

## 0. Общая структура: Phase 0 → 1 → 2 → 3 → 4

```
┌─────────────────────────────────────────────┐
│  Phase 0 — Pre-work (shared + interfaces)   │ ← 2-3 недели. Внутри monorepo.
│  Блокирует все последующие phase'ы.          │
└─────────────────────────────────────────────┘
              ↓
┌──────────────┐
│  Phase 1     │ ← MONEY (пилот). Тестируем pattern extraction.
│  2 недели    │
└──────────────┘
              ↓
┌──────────────┐ ┌──────────────┐
│  Phase 2     │ │  Phase 3     │ ← CLIENT и USER можно параллельно
│  CLIENT 2-3w │ │  USER 2w     │    после Phase 1 (если есть два исполнителя)
└──────────────┘ └──────────────┘
              ↓
┌──────────────┐
│  Phase 4     │ ← TIME TRACKING (последний, самый связанный)
│  3+ недели   │
└──────────────┘

Итого: 9-12 недель чистой работы, или 2-3 квартала при 30% занятости команды.
```

**Важно:** на всех фазах монорепо **продолжает работать** в проде. Extraction — поэтапный, с feature flags. Никакого big-bang rewrite.

---

## 1. Phase 0 — Pre-work (внутри monorepo)

> **Без этого phase'а остальные не имеют смысла.** Сейчас модули читают `db.collection('users')` напрямую друг у друга — при extraction это сразу сломается.

### 1.1 Задачи

#### Task 0.1 — Shared package setup
- **Что:** создать `packages/shared/` (или `@profit-step/common` если npm workspaces)
- **Содержимое:**
  ```
  packages/shared/
  ├── src/
  │   ├── types/
  │   │   ├── auth.ts          (AuthContext, Role, Scope — только types)
  │   │   ├── money.ts         (Decimal, Currency, Money helpers)
  │   │   ├── identity.ts      (UserId, ClientId, ProjectId — branded types)
  │   │   └── timestamps.ts    (FirestoreTimestamp, ISODate helpers)
  │   ├── utils/
  │   │   ├── phone.ts         ← переезд из src/utils/phone.ts + functions/src/agent/utils/phone.ts
  │   │   ├── ids.ts           (slug, generateId)
  │   │   └── dates.ts         (timezone helpers, period math)
  │   └── index.ts
  ├── package.json
  └── tsconfig.json
  ```
- **Конфигурация:** npm workspaces в корневом `package.json` → `"workspaces": ["packages/*", "functions", "sdk/python"]`
- **Acceptance:** `import { normalizePhone } from '@profit-step/shared/utils'` работает в `src/` и `functions/src/`
- **Effort:** S (0.5 дня)

#### Task 0.2 — Contract interfaces
- **Что:** создать `packages/contracts/` с read-only interfaces для 4 модулей
- **Содержимое:**
  ```typescript
  // packages/contracts/src/UserService.ts
  export interface UserService {
    getUser(id: UserId): Promise<User | null>;
    getHourlyRate(id: UserId): Promise<number | null>;
    getEffectiveTeamMemberIds(foremanId: UserId): Promise<UserId[]>;
  }

  // packages/contracts/src/ClientService.ts
  export interface ClientService {
    getClient(id: ClientId): Promise<Client | null>;
    searchClients(query: string, limit?: number): Promise<Client[]>;
    listByCompany(companyId: string): Promise<Client[]>;
  }

  // packages/contracts/src/TimeSessionService.ts
  export interface TimeSessionService {
    getActiveSessionFor(userId: UserId): Promise<WorkSession | null>;
    getSessionsInPeriod(userId: UserId, from: Date, to: Date): Promise<WorkSession[]>;
  }

  // packages/contracts/src/FinanceService.ts
  export interface FinanceService {
    createCost(cost: CreateCostInput): Promise<Cost>;
    getBalance(employeeId: UserId, period: Period): Promise<Balance>;
  }
  ```
- **Acceptance:** каждый interface типизирован, есть Zod-схема для input/output validation в shared
- **Effort:** M (1-2 дня)

#### Task 0.3 — Firestore adapters (internal implementations)
- **Что:** в каждом модуле создать `<module>/adapters/firestoreAdapter.ts` который реализует контракт и читает из Firestore
- **Пример для USER:**
  ```typescript
  // functions/src/agent/services/userFirestoreAdapter.ts
  import type { UserService } from '@profit-step/contracts';
  export class UserFirestoreAdapter implements UserService {
    async getUser(id: UserId): Promise<User | null> { ... }
    async getHourlyRate(id: UserId): Promise<number | null> { ... }
    // ...
  }
  ```
- **Acceptance:** каждый из 4 Firestore adapters проходит contract test (см. 0.4)
- **Effort:** M (2 дня — по 4 часа на модуль)

#### Task 0.4 — Contract tests
- **Что:** для каждого interface написать test suite которому должен удовлетворять любой implementation
- **Пример:** `packages/contracts/tests/UserService.contract.ts` — abstract test suite который запускается с Firestore adapter (сейчас) И с HTTP adapter (после extract)
- **Acceptance:** Firestore adapters проходят все contract tests. После extract HTTP adapters должны проходить те же tests.
- **Effort:** M (1-2 дня)

#### Task 0.5 — Replace direct cross-reads с контрактами
- **Что:** пройти по coduase и заменить `db.collection('users').doc(...).get()` в **чужих** модулях на `userService.getUser(...)`
- **Scope (главное — TIME TRACKING):**
  - `functions/src/agent/routes/timeTracking.ts` — 15 cross-reads → заменить на `userService.*`, `clientService.*`, `taskService.*`
  - `functions/src/agent/routes/finance.ts` — ~4 cross-reads на users/clients → заменить
  - `functions/src/agent/routes/clients.ts` — 2 cross-reads на users → заменить
- **Acceptance:** `grep -rn "db.collection('users')" functions/src/agent/routes/` возвращает только `users.ts` (owner) — остальные через adapter
- **Effort:** L (3-5 дней — это ключевая часть)

### 1.2 Deliverables Phase 0
- [ ] `packages/shared/` с phone/money/types — package published локально через workspaces
- [ ] `packages/contracts/` с 4 интерфейсами + contract tests
- [ ] 4 Firestore adapters реализующих contracts
- [ ] Все cross-module direct Firestore reads заменены на adapter calls
- [ ] `grep "db.collection\('(users|clients|work_sessions|costs)'\)" functions/src/agent/routes/` — только owner routes

### 1.3 Effort Phase 0
- **Total:** 2-3 недели (8-15 дней работы)
- **Risk:** LOW — всё внутри monorepo, никаких deploy, никаких breaking changes для пользователей
- **Rollback:** просто не мержить PR если что-то не работает

---

## 2. Phase 1 — MONEY extract (пилот)

> **Цель:** перевезти Finance в отдельный service/package. Проверить что pattern работает. Использовать как шаблон для Phase 2-4.

### 2.1 Задачи

#### Task 1.1 — MONEY как отдельный package внутри monorepo
- **Что:** переместить `functions/src/agent/routes/{finance,costs}.ts` + services + schemas в `packages/money/`
- **Структура:**
  ```
  packages/money/
  ├── src/
  │   ├── api/
  │   │   ├── financeRoutes.ts     ← был routes/finance.ts
  │   │   └── costsRoutes.ts       ← был routes/costs.ts
  │   ├── services/
  │   │   ├── payrollCalculator.ts ← был src/modules/finance/services/payroll.ts
  │   │   └── ledger.ts
  │   ├── adapters/
  │   │   └── firestoreAdapter.ts  ← был financeApi.ts
  │   ├── schemas/
  │   └── index.ts (barrel)
  └── package.json
  ```
- **Что использует:** `@profit-step/shared`, `@profit-step/contracts` (UserService — через DI)
- **Acceptance:** MONEY не импортирует ничего из `functions/src/agent/routes/users.ts` или `clients.ts` напрямую
- **Effort:** M (2-3 дня)

#### Task 1.2 — Standalone deployable
- **Что:** `packages/money/` может деплоиться как отдельная Cloud Function (через runtime config), либо как Cloud Run service
- **Конфигурация:**
  ```typescript
  // packages/money/src/standalone.ts
  import express from 'express';
  import { financeRoutes, costsRoutes } from './api';
  const app = express();
  app.use(financeRoutes);
  app.use(costsRoutes);
  export const moneyApi = functions.onRequest(app);
  ```
- **Deploy:** `firebase deploy --only functions:moneyApi`
- **Acceptance:** `/api/money/*` endpoints работают из отдельной функции
- **Effort:** M (1-2 дня — включая Secret Manager bindings + auth middleware)

#### Task 1.3 — Feature flag routing
- **Что:** на `agentApi` (главный gateway) добавить toggle:
  ```typescript
  if (process.env.USE_EXTERNAL_MONEY === 'true') {
    app.use('/api/finance', proxy('https://moneyApi.cloudfunctions.net/api/finance'));
    app.use('/api/costs', proxy('https://moneyApi.cloudfunctions.net/api/costs'));
  } else {
    app.use(financeRoutes);
    app.use(costsRoutes);
  }
  ```
- **Зачем:** можно переключать туда-обратно без deploy фронта
- **Acceptance:** toggle через admin/env change — оба варианта работают, UI ничего не замечает
- **Effort:** S (0.5 дня)

#### Task 1.4 — Migration testing
- **Что:** прогнать все smoke-tests (50 use cases из `public/bot-docs/use-cases.md`) в двух режимах (monolith vs external)
- **Acceptance:** response bodies идентичны в обоих режимах (кроме timing)
- **Effort:** S (0.5 дня автоматизации + 0.5 дня дебаг если что-то разойдётся)

### 2.2 Deliverables Phase 1
- [ ] `packages/money/` — independent package, depends только на shared + contracts
- [ ] `moneyApi` Cloud Function задеплоена
- [ ] Feature flag `USE_EXTERNAL_MONEY` работает в обе стороны
- [ ] Все use cases smoke-tests pass в режиме `USE_EXTERNAL_MONEY=true`
- [ ] Documentation: `packages/money/README.md` описывает deploy / config / rollback

### 2.3 Acceptance критерий Phase 1
- MONEY можно **полностью отключить** от main `agentApi` и он всё ещё работает
- Payroll считается одинаково в обоих режимах (diff = 0 за тестовый период)
- Никаких `db.collection('users')` внутри `packages/money/src/` (только через UserService interface)

### 2.4 Rollback Phase 1
- Set `USE_EXTERNAL_MONEY=false` в env
- Redeploy `agentApi` — финансы снова внутри monolith
- `moneyApi` можно оставить depoyed — ждать проблем и recook

---

## 3. Phase 2 — CLIENT extract

Тот же паттерн что Phase 1, scope: `clients.ts` + `deals.ts` + 18+ frontend components.

### 3.1 Отличие от Phase 1
- **Frontend тоже надо модуляризовать.** Создаём `src/modules/client/` по образцу `src/modules/finance/`.
- `ClientCacheService` — отдельный класс, интерфейсом через shared
- `ClientSearchService` с Fuse.js — тоже отдельный класс
- Phone utils уже в shared после Phase 0

### 3.2 Scope
- Backend: `packages/client/` с 2 routes + services
- Frontend: `src/modules/client/` + migration 5 pages + 18+ components
- Standalone deploy: `clientApi` Cloud Function + feature flag

### 3.3 Effort
- **Total:** 2-3 недели

### 3.4 Special considerations
- `deals` pipeline пересекается с MONEY (deal → invoice). После extraction — через FinanceService interface.
- Client portal `/portal/*` — может остаться в monorepo (public auth, сложно выносить) ИЛИ extract отдельно как client-portal service

---

## 4. Phase 3 — USER extract

> Можно параллельно с Phase 2 если есть 2-й разработчик.

### 4.1 Scope
- Backend: `packages/user/` с users + teams + companies routes
- Frontend: admin pages (у тебя их всего 4)
- Auth gateway: **отдельный critical component** — `packages/auth-gateway/` либо внутри user

### 4.2 Телеграм linking
- Надо вынести webhook handler в отдельный `telegram-gateway` service
- Это — separate mini-project, часть USER extraction
- Effort: +1 неделя поверх базового USER extract

### 4.3 Effort
- **Total:** 2 недели USER + 1 неделя telegram gateway = 3 недели

### 4.4 Риск
- Auth breakage = все сервисы упадут. Тестировать обязательно с feature flag на каждое окружение.

---

## 5. Phase 4 — TIME TRACKING extract

> Последним. 2/5 по extractability — самый связанный.

### 5.1 Pre-requisite
Phase 0 Task 0.5 **обязательно** должен быть сделан. Если в `timeTracking.ts` остались direct `db.collection('users')` reads — TIME TRACKING нельзя extract'нуть.

### 5.2 Scope
- Backend: `packages/time-tracking/` с routes + TimeTrackingService + scheduled
- Frontend: `src/modules/time-tracking/` + migration TimeTrackingPage + 5 components + 41 usage `useActiveSession`
- State sync: `activeSessionId` в users → нужен event-driven update (Pub/Sub или webhook)

### 5.3 Special considerations
- Telegram bot handlers (`onWorkerBotMessage`) напрямую работают с work_sessions — после extract они должны идти через TimeSessionService API
- Это затрагивает handlers в `functions/src/triggers/telegram/handlers/sessionManager.ts` — пересмотреть

### 5.4 Effort
- **Total:** 3-4 недели (самый большой phase)

---

## 6. Post-extraction: что остаётся в monorepo

После Phase 1-4 главный репозиторий содержит:

```
profit-step/
├── packages/
│   ├── shared/         ← Phase 0
│   ├── contracts/      ← Phase 0
│   ├── money/          ← Phase 1
│   ├── client/         ← Phase 2
│   ├── user/           ← Phase 3
│   ├── auth-gateway/   ← Phase 3
│   ├── telegram-gateway/ ← Phase 3
│   └── time-tracking/  ← Phase 4
├── functions/
│   └── src/
│       ├── agentApi.ts         (thin gateway / router)
│       ├── triggers/           (Firebase-specific, не module-able)
│       └── scheduled/          (crons, если не перенесены в модули)
├── src/ (frontend)
│   └── pages/                  (composes modules)
└── sdk/
    └── python/
```

Получается:
- **`packages/` — бизнес-логика** (4 модуля + shared + contracts)
- **`functions/` — Firebase-specific** (thin gateway, triggers, scheduled jobs)
- **`src/` — frontend UI** (composes packages через hooks/SDK)
- **`sdk/` — внешние интеграции**

Каждый `packages/<module>/` можно вытащить в отдельный git-репо финальным шагом (после stabilization 3-6 месяцев).

---

## 7. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Contract interfaces подрезают важные use cases (не покрывают edge case) | High | Medium | Итерировать interface через usage в Phase 0; добавлять методы по мере необходимости |
| После extract latency растёт (network hops) | Medium | Medium | Batch reads, caching layer (Redis?), monitor p95 |
| Auth breakage в Phase 3 | Medium | **High** | Feature flag per-environment, canary deploy (1% → 10% → 100%), rollback < 1 min |
| Telegram bot требует TIME TRACKING data напрямую | High | High | Phase 4 должен закончиться до любых новых bot features; или добавить events Pub/Sub |
| Команда теряет контекст за долгий проект | Medium | Medium | Каждую фазу завершать рабочим деплоем, docs/runbook, pair programming на Phase 1 |

---

## 8. Когда НЕ начинать

- Есть production-critical bugs в backlog (сейчас: bot session flow, warehouse V3 Phase 1)
- CRM overhaul spec всё ещё DRAFT — бизнес-модель модулей может поменяться
- Команда < 2 инженеров постоянно
- Нет второго продукта / команды которая реально хочет использовать один из extracted модулей

**Зелёный свет условия:**
- MVP фичи стабильны 1-2 месяца без критичных багов
- Решение о втором продукте / white-label / partnership
- Команда ≥ 3 инженеров (один на extraction full-time, остальные на feature work)

---

## 9. Timeline summary

| Phase | Сценарий 1 (full-time 1 инженер) | Сценарий 2 (30% от двух) |
|---|---|---|
| Phase 0 | 3 недели | 9 недель |
| Phase 1 (MONEY) | 2 недели | 6 недель |
| Phase 2 (CLIENT) + Phase 3 (USER) параллельно | 3 недели | 9 недель |
| Phase 4 (TIME TRACKING) | 4 недели | 12 недель |
| **Total** | **12 недель = 3 мес** | **36 недель = 9 мес** |

Между phase'ами можно делать паузы по 1-2 недели на stability / feature work. В реальности timeline расползётся на 20-30% из-за интеграционных сюрпризов.

---

## 10. Next steps (для принятия решения)

### Перед стартом
1. [ ] Business decision: **зачем** extract? (white-label? partnership? multi-tenant? perf?)
2. [ ] Team decision: кто driver? Full-time или part-time?
3. [ ] Dependency decision: ждём ли pipeline follow-ups (warehouse V3 Phase 1, bot-session-flow) до старта?
4. [ ] Infra decision: Cloud Functions остаётся как runtime, или переезд на Cloud Run / Kubernetes?

### Первые 2 дня (если решили стартовать)
1. Создать `packages/shared/` с минимальным содержимым (`types/auth.ts`, `utils/phone.ts`) — Task 0.1
2. Настроить npm workspaces
3. Написать и смерджить первый contract interface (`UserService`) — Task 0.2
4. Создать Firestore adapter для UserService — Task 0.3
5. Заменить **один** direct Firestore read в `timeTracking.ts` на UserService call — pilot для Task 0.5

Если за 2 дня не получилось даже это — extraction не готов технически, нужен другой подход (возможно просто модуляризовать в `src/modules/` без отдельных packages).

---

## 11. References

- Audit: [`MODULE_EXTRACTABILITY_AUDIT.md`](./MODULE_EXTRACTABILITY_AUDIT.md) (блокеры + scores)
- Precedent (Finance modularized): [`src/modules/finance/`](../../src/modules/finance/), PR [#48](https://github.com/garkorcom/profit-step/pull/48), PR [#49](https://github.com/garkorcom/profit-step/pull/49)
- Parent: [`MASTER_PLAN_2026-04-19.md`](./MASTER_PLAN_2026-04-19.md)
