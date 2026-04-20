# Finance & Payroll — Isolation Plan + Security Test Matrix

**Status:** DRAFT, 2026-04-19 · Author: Claude (Opus 4.7) · Scope: стратегия изоляции модуля + 50 юз-кейсов по безопасности и корректности.

---

## 1. Зависимости Finance ⇄ Time Tracking (вопрос юзера)

**Короткий ответ:** Finance продолжит работать, если страница Time Tracking упадёт. Finance и Time Tracking разделяют только **данные в Firestore** (`work_sessions` collection) и **TypeScript-тип** (`WorkSession` — compile-time), но у них нет runtime-зависимости через импорты хуков или сервисов.

### Граф зависимостей (фактический, проверено)

```
┌──────────────────────┐       ┌──────────────────────┐
│  Time Tracking Page  │       │   Finance Page       │
│  (UI для admin)      │       │   (UI для admin)     │
└──────────┬───────────┘       └──────────┬───────────┘
           │ writes                       │ reads + writes
           ▼                              ▼
┌──────────────────────────────────────────────────────┐
│       Firestore: work_sessions collection            │
└──────┬──────────────────────────────┬────────────────┘
       ▲                              ▲
       │ writes                       │ writes
┌──────┴────────┐              ┌──────┴────────┐
│ Telegram Bot  │              │ onWorkSession │
│ (worker flow) │              │ triggers (fn) │
└───────────────┘              └───────────────┘
```

Finance импортирует из time-tracking **только тип** (`import { WorkSession } from '../../types/timeTracking.types'`). Код — нет. Хуки — нет. Сервисы — нет.

### Что сломает Finance

| Failure | Finance Affected? |
|---|---|
| Time Tracking page crashes | ❌ Нет — Finance открывается независимо |
| Telegram worker bot offline | ❌ Нет — новых сессий нет, но старые отображаются |
| `work_sessions` schema change | ✅ Да — если удалить/переименовать поле |
| Firestore down | ✅ Да (но весь CRM ляжет) |
| `onWorkSessionUpdate`/`onWorkSessionCreate` триггер упал | ⚠️ Частично — ручной ввод Finance не пострадает, но agg-поля на session могут отстать |
| `recomputeClientMetrics` cron упал | ❌ Нет — это другой ledger (client-side) |
| Payroll cron (`generateDailyPayroll`, `closePayrollPeriod`) упал | ⚠️ Payroll snapshots не будут создаваться, но баланс по-формуле считается client-side из work_sessions + work_sessions[type=payment] |

### Runtime-риск при рефакторе соседних модулей

Текущая архитектура — **low coupling**. Единственный гайд при правке соседних модулей:
- Не менять shape `WorkSession` без миграции
- Не удалять collection `work_sessions` / `users` / `costs`
- Не переименовывать поля в `users` которые Finance читает (`hourlyRate`, `displayName`, `telegramId`)

---

## 2. Рекомендованная изоляция

Сейчас Finance размазан по:
```
src/pages/crm/FinancePage.tsx         (1318 строк — бизнес-логика + UI)
src/pages/crm/PayrollReport.tsx
src/pages/crm/PayrollPeriodsPage.tsx
src/components/finance/invoices/*     (уже выделено ✓)
src/components/finance/expenses/*     (уже выделено ✓)
src/components/finance/PnLView.tsx
src/utils/payroll.ts                  (формула balance)
src/utils/financeFilters.ts           (новое, PR #47)
functions/src/agent/routes/timeTracking.ts  (API)
functions/src/triggers/workSessions/*       (triggers)
```

### Целевая структура

```
src/modules/finance/
├── api/
│   ├── financeApi.ts          # все Firestore queries (getEntries, getCosts, getRates)
│   └── financeApi.test.ts
├── hooks/
│   ├── useFinanceLedger.ts    # {entries, loading, error, refresh}
│   ├── useEmployeesWithRates.ts
│   └── useFinanceFilters.ts
├── services/
│   ├── payrollCalculator.ts   # calculatePayrollBuckets (pure)
│   ├── financeFilters.ts      # isReportableSession, buildEmployeeDropdown (pure)
│   └── __tests__/
├── components/
│   ├── FinanceHeader.tsx
│   ├── KPICards.tsx
│   ├── FilterBar.tsx
│   ├── LedgerTable.tsx
│   ├── BreakdownTable.tsx
│   ├── AdjustmentDialog.tsx
│   ├── PaymentDialog.tsx
│   ├── VoidDialog.tsx
│   └── RatesDialog.tsx
├── pages/
│   ├── FinancePage.tsx        # ~200 строк, только composition
│   ├── PayrollReport.tsx
│   └── PayrollPeriodsPage.tsx
├── types/
│   └── finance.types.ts        # PayrollBucket, LedgerEntry, Adjustment, Payment
└── index.ts                   # barrel export: только компоненты / типы наружу

src/types/timeTracking.types.ts  # SHARED — не трогать, это контракт с TimeTracking
```

### Правила, гарантирующие изоляцию

1. **Единственный публичный вход** — `src/modules/finance/index.ts` (barrel). Всё остальное в модуле — internal.
2. **Импорты наружу** — только из `src/types/`, `src/api/` (common), `src/auth/`, `src/firebase/`, `@mui/*`.
3. **Нет импортов** из `src/pages/crm/TimeTrackingPage.tsx` или его хуков. Общение — только через `work_sessions` collection + `WorkSession` тип.
4. **ESLint boundary rule** (`eslint-plugin-boundaries` или простой `no-restricted-imports`) — запрет импортов из `modules/timeTracking/**` в `modules/finance/**` и наоборот.
5. **Backend** — аналогично: `functions/src/modules/finance/` — payroll periods, reconciliation, reports. Не вызывать из других модулей.

### Миграционные шаги (поэтапно, без breaking changes)

| Шаг | Действие | Риск | Тест |
|---|---|---|---|
| 1 | Создать `src/modules/finance/` + `index.ts` barrel с текущими ре-экспортами | ✅ Zero | `tsc --noEmit` |
| 2 | Переместить `src/utils/financeFilters.ts` + `src/utils/payroll.ts` в `modules/finance/services/` с совместимыми ре-экспортами | 🟡 Low | Существующие тесты проходят |
| 3 | Вытащить data-layer в `financeApi.ts` (пока обёртка над inline queries) | 🟡 Low | Новые unit-тесты на API |
| 4 | Вытащить hooks `useFinanceLedger`, `useEmployeesWithRates` | 🟡 Low | Изолированные React-hook тесты |
| 5 | Разбить `FinancePage.tsx` на компоненты | 🟢 Medium | Снапшоты / визуальная проверка |
| 6 | Добавить ESLint boundary rule | ✅ Zero | Линтер красный если нарушение |
| 7 | Удалить старые пути (`src/pages/crm/FinancePage.tsx` → thin re-export) | 🟢 Medium | Smoke test в браузере |

**Оценка:** 2-3 дня × 1 разработчик, по одному шагу за PR, без прод-деплоев до конца. Итерация тестируется на preview channel.

---

## 3. 50 юз-кейсов по безопасности и корректности

Покрывает: auth, финрасчёты, timezone, concurrency, failure modes, data integrity. Каждый — кандидат в юнит/интегр/E2E тест. Отмечены текущим статусом: ✅ покрыто, ⚠️ частично, ❌ дыра.

### A. Authentication / Authorization (5)

| # | Use case | Expected | Status |
|---|---|---|---|
| 1 | Неавторизованный юзер открывает `/crm/finance` | Redirect на `/login` | ✅ (AuthContext guard) |
| 2 | Авторизованный юзер из другой company видит Finance | Должен видеть ТОЛЬКО свою company (RLS через companyId) | ⚠️ Firestore rules проверяют, но FinancePage не фильтрует `work_sessions` по companyId — **ДЫРА** |
| 3 | Worker (роль `user`) открывает `/crm/finance` | Блок / redirect — финансы только для admin/manager | ❌ Не проверяется |
| 4 | Admin запрашивает Employee Rates — видит ставки других юзеров | Только своих подчинённых / своей компании | ⚠️ Unified users collection — нет фильтра по company при чтении |
| 5 | Session истёк посреди операции (Add Payment) | Re-login prompt + сохранение draft | ❌ Не реализовано |

### B. Data Integrity — Ledger (10)

| # | Use case | Expected | Status |
|---|---|---|---|
| 6 | Создать payment на отрицательную сумму | Блокировать | ❌ Нет валидации |
| 7 | Создать adjustment > $100k без подтверждения | Требовать confirm | ❌ |
| 8 | Создать payment без employeeId | Блокировать | ⚠️ Required в форме, но не на бэке |
| 9 | Void session дважды (idempotency) | Второй void = no-op | ⚠️ Есть `isVoided` флаг, но UI не предотвращает клик |
| 10 | Delete payment — что с balance? | Пересчёт mгновенный | ✅ |
| 11 | Сессия с `durationMinutes: 0` попадает в breakdown | Фильтровать | ❌ |
| 12 | Сессия без `hourlyRate` — начисления = 0 | ✅ Defensive | ✅ payroll.ts корректно |
| 13 | Сессия с отрицательным `durationMinutes` (clock skew) | Skip + alert | ❌ |
| 14 | Дублирующиеся work_sessions с одним `id` | Firestore гарантирует уникальность | ✅ |
| 15 | Amount в adjustment изменён после создания | Audit trail кто/когда | ❌ Нет edit log для adjustments |

### C. Timing / Timezone (5)

| # | Use case | Expected | Status |
|---|---|---|---|
| 16 | Session на границе полуночи ET vs UTC | Попадает в один день в UI и bot'е | ⚠️ UI не знает таймзоны; bot использует America/New_York — **mismatch** |
| 17 | Session в 23:58-00:02 ET — LocaleDate может выдать разный день | Нормализовать к компанейной tz (из settings) | ❌ Не реализовано |
| 18 | DST переход: session 2h в 01:30-04:30 — фактически 3h или 4h? | По workLocation timezone | ❌ |
| 19 | `finalizationStatus='finalized'` через 48h — что если клиент в другой tz? | Cron с tz-aware 48h | ⚠️ Cron `finalizeExpiredSessions` есть, но tz-логика не проверена |
| 20 | Year boundary — session 31.12 23:59 в 2025, баланс считается в 2026 | Попадает в 2025 YTD | ✅ startOfYear работает корректно |

### D. Financial Calculations (10)

| # | Use case | Expected | Status |
|---|---|---|---|
| 21 | Balance formula: `earned + adj - payments` (canonical) | Для anton: 16881 − 16067 = 814 (но показывает 796 — adj -18) | ✅ `calculatePayrollBuckets` |
| 22 | Expenses НЕ вычитаются из salaryBalance | Отдельный ledger | ✅ |
| 23 | Web UI vs Telegram bot balance для Алексея | Совпадает | ❌ Не совпадает — разные фильтры (известно из audit) |
| 24 | `hourlyRate: 0` для админа — начислений 0 | 0 hours × 0 rate | ✅ |
| 25 | `totalBreakMinutes` > `durationMinutes` | Валидация, заработок >= 0 | ❌ Не проверяется |
| 26 | Rate changed mid-period — старые сессии по старой ставке | На момент создания session | ⚠️ Используется `hourlyRate` на сессии если есть, иначе из users — **race** |
| 27 | Currency — всё в USD, что если клиент в EUR? | Convert или warn | ❌ Single-currency assumption |
| 28 | Payment через Zelle vs Cash — комиссии учитываются? | Gross / net split | ❌ |
| 29 | Correction с `relatedSessionId` указывает на несуществующую | Soft-fail + warning | ❌ |
| 30 | Manual adjustment дубликат (admin кликнул 2 раза) | Idempotency key / debounce | ❌ |

### E. Telegram Bot Sync (5)

| # | Use case | Expected | Status |
|---|---|---|---|
| 31 | Bot пишет сессию в `work_sessions` с `employeeId = telegramId`, UI — с `uid` | Normalize mapping (существует в FinancePage) | ✅ |
| 32 | Bot показывает "Баланс ЗП" — совпадает с Finance page | Одна формула, один фильтр | ❌ bug from audit |
| 33 | Bot считает "За сегодня" с tz `America/New_York`, UI — browser tz | Синхронизировать | ❌ |
| 34 | Bot показывает "Начислено с начала года" — включает ли выплаты? | Нет, только earnings | ✅ `sessionManager.ts:295` |
| 35 | Bot не может найти юзера (новый telegramId) | Fallback to email lookup | ⚠️ Только telegramId match |

### F. Failure Modes / Resilience (5)

| # | Use case | Expected | Status |
|---|---|---|---|
| 36 | Firestore timeout при загрузке ledger | Error boundary + retry | ⚠️ Глобальный ErrorBoundary (PR #65d40ef), но в Finance нет retry |
| 37 | `work_sessions` query > 10k документов | Pagination / limit | ❌ Нет limit — load всё |
| 38 | Потеря сети посреди Add Payment | Revert optimistic UI + notify | ❌ |
| 39 | Concurrent edit: admin A меняет rate, admin B создаёт payment — race | Transaction / Optimistic locking | ❌ |
| 40 | Firebase billing превышен | Graceful degradation | ❌ |

### G. Concurrency / Races (5)

| # | Use case | Expected | Status |
|---|---|---|---|
| 41 | 2 admin одновременно void одной сессии | Второй void = no-op + warning | ⚠️ isVoided флаг — last-write-wins, нет warning |
| 42 | User bot завершает смену + admin корректирует в это же время | Transaction на session doc | ❌ Last-write-wins |
| 43 | Cron `finalizeExpiredSessions` пересекается с ручной корректировкой | Skip finalize если `isManuallyEdited` в последние N минут | ⚠️ isManuallyEdited есть, но cron не проверяет |
| 44 | 50 rapid updates на user.lastSeen → 50 triggers → loginCount bomb | Idempotency guard | ✅ incrementLoginCount имеет guard (тест C6) |
| 45 | Bulk action на 100 сессий — частичный успех | All-or-nothing batch | ❌ Нет bulk actions пока |

### H. Edge Cases (5)

| # | Use case | Expected | Status |
|---|---|---|---|
| 46 | Employee переименован — старые сессии показывают старое имя | Показывать актуальное из users | ✅ FinancePage normalizes by UID |
| 47 | Employee удалён — его сессии остаются в отчёте | Показывать placeholder "[удалённый]" | ❌ Показывает cached name |
| 48 | Client удалён — его сессии остаются | Placeholder | ❌ |
| 49 | Session с будущей датой (clock manipulation) | Reject / flag for review | ❌ |
| 50 | Session длиннее 24h — реалистична ли? | Flag for admin review | ❌ |

### Итого

- ✅ Покрыто: **11/50** (22%)
- ⚠️ Частично: **9/50** (18%)
- ❌ Дыра: **30/50** (60%)

**Top-10 priority to fix** (high impact × low effort):

1. **#2, #3, #4** — RLS check на companyId в Firestore rules + роли (admin-only для Finance)
2. **#6, #7, #8, #11, #13** — базовая валидация amount/duration (zod schema на дне форм)
3. **#23, #32, #33** — унификация формулы и фильтра между bot и UI
4. **#16, #17** — tz-awareness: хранить tz в company settings, применять в UI + bot
5. **#36, #37** — pagination + retry на load

---

## 4. Что сделать в следующем PR (рекомендация)

Не смешивать с PR #47. Создать **`refactor(finance): modularize`**:

1. Создать `src/modules/finance/` с текущими импортами ре-экспортами (step 1-2 из миграции)
2. Перенести `payroll.ts` + `financeFilters.ts` в `modules/finance/services/`
3. Обернуть queries в `financeApi.ts`
4. Добавить zod-валидацию на amount/duration (use cases #6, #8, #11, #13)
5. Добавить ESLint boundary rule
6. Ничего не удалять из старых путей — оставить re-export shim на 1 релиз

Security — отдельным PR (`security(finance): RLS + role gates`):
- Firestore rules: `work_sessions` писать/читать только свой `companyId`
- Route guard для /crm/finance — `admin` | `manager` only
- Zod на callable functions

Expected: **2 PR, ~1 неделя работы, zero breaking changes**.
