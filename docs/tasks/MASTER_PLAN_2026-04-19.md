# Мастер-план доработок и фиксов — 2026-04-19

## Metadata

- **PM:** Denis
- **Автор:** Claude Code Opus 4.7 (1M context)
- **Дата:** 2026-04-19
- **Горизонт:** 3 месяца (P0 сегодня → P3 квартал)
- **Источники:**
  - [`UX_AUDIT_2026-04-19.md`](./UX_AUDIT_2026-04-19.md) — boots-on-the-ground обход прода
  - [`CRM_OVERHAUL_SPEC_V1.md`](./CRM_OVERHAUL_SPEC_V1.md) — 11 модулей (DRAFT, §13-18 не дописаны)
  - [`WAREHOUSE_V3_PHASE1_FOLLOWUPS.md`](./WAREHOUSE_V3_PHASE1_FOLLOWUPS.md) — остатки по складу
  - [`AGENT_REFACTOR_FOLLOWUPS.md`](./AGENT_REFACTOR_FOLLOWUPS.md) — техдолг триггеров
  - [`NERVOUS_TORVALDS_SALVAGE.md`](./NERVOUS_TORVALDS_SALVAGE.md) — timezone payroll bug
  - CLAUDE.md §4 «Живые риски после деплоев 13-16 апреля»
  - Открытые PR: #29, #30, #31, #32

---

## Принципы очерёдности

1. **Блокеры — сейчас.** Если кто-то кроме Дениса на проде → глухое «Failed to fetch» / 404. Это прямая потеря доверия.
2. **Видимые шумы — сразу после.** 30 спиннеров в Reconciliation = «система висит». Технически всё работает, но пользователь не верит.
3. **Деньги-чувствительные риски — не забывать.** Balance formula, RLS, payroll timezone — каждый может превратиться в инцидент.
4. **Новое — после фиксов.** CRM overhaul модули требуют, чтобы основание было прочным. Иначе новые фичи лягут на багованный фундамент.

---

## Текущие открытые PR (не забыть)

| PR | Название | Статус | Действие |
|---|---|---|---|
| [#29](https://github.com/garkorcom/profit-step/pull/29) | Warehouse V3 Phase 1 follow-ups TZ | DRAFT (docs-only) | Merge или закрыть после перестройки плана |
| [#30](https://github.com/garkorcom/profit-step/pull/30) | CRM overhaul spec v1 | DRAFT (ждёт хвост §12.4-18) | Допушить хвост → merge |
| [#31](https://github.com/garkorcom/profit-step/pull/31) | Meetings entity (§5.3-5.4) | Tests pass локально, CI red (pre-existing) | Merge в main после P0.1 (починка CI) |
| [#32](https://github.com/garkorcom/profit-step/pull/32) | UX audit 2026-04-19 | Docs-only | Merge сразу |

---

## ⚡ P-1 — Миграция на новый сервер (добавлено 2026-04-19, новый контекст от Дениса)

**Контекст:** Денис планирует переезд на новый сервер. Проект нужно привести в порядок так, чтобы:
1. Любой человек (или сам Денис на новой машине) мог поднять среду с нуля по runbook
2. Нет захардкоженных IP, localhost, личных путей
3. Все credentials / секреты вынесены из кода в env / Secret Manager
4. Firebase-проект `profit-step` и всё что к нему привязано — задокументировано
5. БД/Storage можно экспортировать и залить на новую инстанцию

Это превращает весь P0 в **подготовку к переезду**, а не просто в «починку для пользователей».

### P-1.1 — Инвентаризация всего что захардкожено (~1-2ч)

Grep'ом пройти по всему репо и собрать список:
- `localhost:` / `127.0.0.1` / `192.168.` (мы уже знаем: `/admin/infra-map` + «Server Dashboard» nav)
- `profit-step.web.app` / `profit-step.firebaseapp.com` / `us-central1-profit-step.cloudfunctions.net`
- `garkor.com` / `sitemiami.com` / любые личные email/домены
- `VITE_FIREBASE_*` дефолты которые указывают на prod
- Service-account-key.json пути
- API ключи (Anthropic, Google, OpenAI, Stripe, Telegram) — должны быть ТОЛЬКО в `functions/.env` или Secret Manager

**Результат:** список в `docs/migration/HARDCODED_INVENTORY.md` с категориями «safe / need-env / need-secret». Ничего не правим, только каталогизируем.

**Effort:** 1-2ч (в основном grep + чтение результатов).

### P-1.2 — Environment vars consolidation (~3-4ч)

На основе P-1.1:
1. Все frontend-переменные через `VITE_*` в `.env.production` / `.env.local` / `.env.example`
2. Все backend-секреты — `functions/.env` (переход с legacy `functions.config()` уже начат, добить — CLAUDE.md Memory «functions.config() shutdown» March 2026)
3. Обновить `.env.example` — должен быть полным списком всех переменных с комментариями
4. `README.md` секция «Local setup» с явными шагами

**Acceptance:**
- [ ] `grep -R "localhost:" src/` и `grep -R "192.168\." src/` возвращают только комментарии/тесты
- [ ] `firebase deploy` на новом проекте работает по env-файлу без правки кода
- [ ] `.env.example` покрывает 100% нужных для запуска переменных

**Effort:** 3-4ч.

### P-1.3 — Secrets inventory (~1ч)

Документировать в `docs/migration/SECRETS.md` (gitignore'нуть этот файл если содержит что-то кроме названий):

Для каждого секрета указать:
- Название переменной
- Где используется (какой файл / роут)
- Где хранится (functions/.env / Secret Manager / Firebase config)
- Кто владелец (кому идти за новым ключом при переезде)
- Критичность (prod-breaking / convenience / dev-only)

Известные секреты:
- Firebase Admin SDK → service-account-key.json (gitignored)
- Anthropic API key, Google Gemini key, OpenAI key
- Telegram Bot tokens (worker + costs + crmapiprofit)
- Brevo / email SMTP
- Stripe (если подключен — пока не видел)
- Чешиал другие

**Acceptance:**
- [ ] Документ содержит все секреты в одном месте
- [ ] Каждый имеет четкое «откуда взять на новом сервере» или «где выдаётся»

**Effort:** 1ч.

### P-1.4 — Firebase project dependency map (~1ч)

Документировать текущую Firebase-конфигурацию:
- Project ID: `profit-step`
- Firestore: коллекции (есть список — ~40+)
- Storage: buckets
- Functions: список (`agentApi`, `onWorkerBotMessage`, `onCostsBotMessage`, триггеры, scheduled)
- Hosting: домены (profit-step.web.app)
- Auth: провайдеры (Google, Email/Pass)
- Firestore Rules: file location
- Firestore Indexes: firestore.indexes.json (есть 50+ indexes)

**Файл:** `docs/migration/FIREBASE_TOPOLOGY.md`.

**Effort:** 1ч (в основном из `firebase.json` и `firebase functions:list`).

### P-1.5 — Data export / import runbook (~2-3ч)

1. Написать скрипт `scripts/migration/export-firestore.ts` — вытаскивает все collections в локальные JSON-файлы с bucketized chunking
2. Написать скрипт `scripts/migration/import-firestore.ts` — заливает обратно в новый Firebase-проект
3. Для Storage: `gsutil -m cp -r gs://profit-step.appspot.com gs://new-project.appspot.com` (просто команда в runbook, не скрипт)
4. Для Auth: `firebase auth:export users.json` + `firebase auth:import` на новом проекте
5. Runbook `docs/migration/DATA_MIGRATION_RUNBOOK.md` — шаг за шагом

**Acceptance:**
- [ ] Dry-run экспорта отработал на проде без ошибок
- [ ] Размер экспорта измерен и задокументирован
- [ ] Runbook проверен на тестовом project-clone

**Effort:** 2-3ч.

### P-1.6 — CI/CD adaptation (~1-2ч)

Текущий CI уже сломан (см. P0.1). После починки:
- Workflow должен параметризоваться через GitHub Secrets (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, etc.)
- Deploy target не хардкодить в yml'ах
- Документировать `docs/migration/CI_SETUP.md` — какие secrets нужны в GitHub Actions на новом проекте

**Effort:** 1-2ч.

### P-1.7 — DNS + domain handover plan (~30 мин, бумажная работа)

Документ `docs/migration/DNS_DOMAINS.md`:
- Текущий hosting domain `profit-step.web.app` (Firebase default — остаётся)
- Custom domain (если есть — проверить: `profit-step.com`?)
- Кто владеет DNS-записями
- TTL / switchover strategy (cutover vs gradual)

**Effort:** 30 мин.

**Итого P-1:** 10-15ч на подготовку переезда. Не блокирует переезд начать — можно работать параллельно.

---

## P0 — Сегодня / эти сутки (блокеры + CI)

### P0.1 — Починить CI (~30 мин, разблокирует ВСЁ)

**Проблема:** main-ветка красная 4+ дня подряд. Все PR падают ДО запуска тестов:
- `npm ERESOLVE`: `@firebase/rules-unit-testing@3.0.4` требует `firebase@^10`, корень проекта `firebase@12.4.0`
- `actions/upload-artifact@v3` deprecated GitHub'ом с апреля 2026

**Файлы:** `.github/workflows/*.yml`.

**Правки:**
- В job'ах где `npm ci` → `npm ci --legacy-peer-deps`
- Везде `actions/upload-artifact@v3` → `@v4`
- Опционально: обновить `@firebase/rules-unit-testing` до v4 (поддерживает firebase@12) — более долгосрочное решение

**Acceptance:**
- [ ] PR #32 (docs-only) проходит CI зелёным после rebase
- [ ] Последующие PR'ы не падают на install шаге

**Effort:** 30 мин (patch) или 1ч (с апгрейдом rules-unit-testing до v4 + запуск локально для проверки).

---

### P0.2 — Скрыть/отфиксить `/admin/infra-map` + «Server Dashboard ↗» (~30 мин)

**Проблема:** оба ведут на локалхост / LAN IP. Любой пользователь (даже Денис с другого ноута) видит «Failed to fetch» или сетевой таймаут.

**Правки:**
1. `/admin/infra-map` — добавить env-флаг `VITE_INFRA_DASHBOARD_URL`. Если не задан → показывать пустой state «Инфра-дашборд не настроен» вместо попытки fetch'ить localhost. Если задан → fetch на него.
2. Убрать пункт «Server Dashboard ↗» (`http://192.168.86.32:8001`) из Admin-меню ИЛИ обернуть тем же env-флагом.
3. Grep по `localhost:` и `192.168.` в `src/` — вычистить все хардкоды, которые могли остаться.

**Файлы:** `src/pages/admin/InfraMapPage.tsx` (или аналог), `src/components/layout/*` (где nav определён).

**Acceptance:**
- [ ] `/admin/infra-map` без env показывает корректный empty-state без fetch-ошибок
- [ ] В navbar нет ссылок с private IP или localhost
- [ ] `grep -R "localhost:" src/` возвращает только допустимые случаи (тесты, комментарии)

**Effort:** 30 мин.

---

### P0.3 — Вечные спиннеры в Reconciliation / Expenses / TimeTracking (~2ч)

**Проблема:** 30 / 13 / 5 persistent spinners. Данные корректны, но UI выглядит «вечно думающим». Вероятно общий per-row bug.

**План debug:**
1. Открыть DevTools → Components → найти `<CircularProgress>` на `/crm/reconciliation`.
2. Понять что за useEffect / useState держит `loading=true`. Кандидаты:
   - AI-подсказка на строку, которая не сняла loading после успеха/фейла
   - Firestore `onSnapshot` без cleanup-функции
   - Promise, чей .finally() не вызывается
3. Закрыть фикс для одного, проверить что Expenses и TimeTracking тоже вылечились (общий паттерн).
4. Если паттерн разный — фиксить индивидуально.

**Файлы:**
- `src/pages/crm/ReconciliationPage.tsx` (после рефакторинга 15 апр — `src/features/reconciliation/*`)
- `src/pages/crm/ExpensesBoardPage.tsx`
- `src/pages/crm/TimeTrackingPage.tsx`

**Acceptance:**
- [ ] `/crm/reconciliation` после 3 сек загрузки — 0 persistent CircularProgress
- [ ] `/crm/finance?tab=2` — 0 persistent
- [ ] `/crm/time-tracking` — 0 persistent
- [ ] Функциональность страниц не сломалась

**Effort:** 1-2ч debug + фикс.

---

### P0.4 — Merge PR #31 (Meetings) и #32 (UX audit) после P0.1 (~10 мин)

После того как CI позеленеет — merge оба в main. Meetings уже задеплоены на прод (из worktree-деплоя 19 апр), в main ещё не попали.

---

## P1 — Эта неделя (живые риски + видимая ценность)

### P1.1 — Верификация payroll balance formula (~2-3ч)

**Из CLAUDE.md §4 live risks:** unified `Salary − Payments − Expenses` от 16 апр (PR #17, #24) — **не верифицирована на реальных сотрудниках**. Риск: балансы могли «прыгнуть».

**План:**
1. Прогнать `scripts/verify-balance-formula.ts` (если не написан — написать) против 9 сотрудников.
2. Сравнить с known-good балансами из прошлых периодов (до unification).
3. Если расхождения — разобрать 1-2 кейса вручную, решить: фикс формулы или фикс данных.

**Effort:** 2-3ч.

---

### P1.2 — RLS cross-tenant bypass тест (~1ч)

**Из CLAUDE.md §4:** `functions/test/rlsCrossTenant.test.ts` не прогнан с добавленным RLS на dashboard/finance/inventory/activity/feedback.

**Effort:** 1ч (запустить existing + починить если что-то упало).

---

### P1.3 — Timezone payroll bug (~1ч)

**Из `NERVOUS_TORVALDS_SALVAGE.md`:** admin вне ET видит локальное время в datetime-local input → сохраняет сессии со смещением. Реальный payroll-баг.

**Effort:** 1ч (cherry-pick из архивного tarball).

---

### P1.4 — Client card Header v2 minimal (~4-6ч, §4 спеки)

Не весь overhaul карточки — минимальный слой для «видимой ценности»:
1. Добавить поля в Client: `lifecycle_stage` (enum: Lead / Prospect / Active / Repeat / Churned / VIP), `segment` (A/B/C/VIP).
2. Sticky header: имя + бейдж lifecycle + бейдж segment + 4 KPI-плашки (Баланс, Активных проектов, Последний контакт в днях, Ближайшая встреча).
3. Миграционный скрипт `--dry-run` для mapping existing `status` → `lifecycle_stage`.

**Effort:** 4-6ч. Закрывает §4.1 частично, даёт наглядную ценность.

---

### P1.5 — Top-bar навигация: убрать дубли (~2ч)

Сейчас все 6 дропдаунов содержат 90% одинаковых пунктов. Свернуть до:
- **Работа:** GTD Board / Calendar / Time Tracking / Shopping
- **Финансы:** Payroll / Invoices / Expenses / P&L / Bank / Reconciliation
- **CRM:** Clients / Contacts / Deals / Estimates / Landings
- **Склад:** Inventory (+ AI Reports когда заполнится)
- **Админ:** Team / Companies / Infra-map (feature-flag)

**Файл:** `src/components/layout/*` (где nav определён).

**Effort:** 2ч.

---

## P2 — Этот месяц (структурные пробелы)

### P2.1 — Deal → Project auto-creation (~4-6ч, §3 + §5.1 спеки)

При переводе Deal в stage='won':
1. Автосоздание Project (`POST /api/deals/:id/convert-to-project`)
2. Snapshot всех реквизитов из Client в Project (§6.1 спеки)
3. Копирование permitted Estimate как `estimates.approved` в новый Project
4. Кнопка «Created project ↗» в карточке выигранной сделки

Это закрывает ключевой gap из §1.1: «Задачи и сметы не связаны — после выигрыша работы переносятся вручную».

---

### P2.2 — ChangeOrder entity (~6-8ч, §10.6 спеки)

Самая запрошенная сущность из missing set. Создаётся в процессе проекта, одобряется клиентом → пересчёт project value + internal estimate + margins.

**Scope:**
- Firestore `change_orders` collection
- API: 5 эндпоинтов (create / list / approve / reject / get)
- UI: tab в Project details + кнопка «+ Change Order»
- Integration: триггер пересчёта P&L после approve

---

### P2.3 — Act of Completion (~6-8ч, §10.3 спеки)

Генерируется при закрытии всех ProductionItems этапа → клиент подписывает → триггер следующего invoice.

**Scope:**
- Firestore `acts` collection
- API: 4 эндпоинта (generate / get / sign / void)
- UI: кнопка «Создать акт» на завершённом этапе в Project
- PDF шаблон + публичная ссылка на подпись (как share-token)

---

### P2.4 — Task billable / production flags (~2-3ч, §6.2 спеки)

Минимальная правка `gtd_tasks`: добавить boolean'ы `billable`, `production` + поля `estimated_price_client`, `estimated_cost_internal`. Это подготовка почвы для будущего «Create Estimate from tasks» flow (§7.1).

**Без UI-изменений в этом PR** — только schema + API accept + default values для существующих задач.

---

### P2.5 — Client card недостающие вкладки (~10-15ч суммарно)

По 1 вкладке за PR:
- **Обзор** — дашборд из имеющихся данных клиента (воронка сделок, активные проекты, финансы) ~3ч
- **Сделки** — уже есть на `/crm/deals`, просто фильтр по clientId ~2ч
- **Сметы** — список estimates клиента ~2ч
- **Коммуникации** — аггрегатор Telegram + Email + Notes ~4ч (зависит от §11 telegram integration)
- **Файлы** — дерево папок клиента ~3ч

---

## P3 — Квартал (крупные модули, откладываемые до сигнала)

### P3.1 — Warehouse V3 Phase 1 полностью (TZ готов)

См. `WAREHOUSE_V3_PHASE1_FOLLOWUPS.md`:
- RLS scoping по `ownerEmployeeId`
- UI picker владельца локации
- `/scan` handler в worker bot (Gemini Vision)
- SDK `lookup_barcode` helper
- Cleanup смоук-записей

Эффорт: 8-10ч, 4 параллельных PR.

---

### P3.2 — Agent refactor follow-ups (TZ готов)

См. `AGENT_REFACTOR_FOLLOWUPS.md`:
- Idempotency guards на 4 триггер-файлах (particularly `calculateActualCost.ts` — infinite-loop risk per §2.1 CLAUDE.md)
- Unit tests для 5 bot handler модулей
- Unit tests для 3 Reconciliation хуков

Эффорт: 5ч.

---

### P3.3 — Tender / Bid / Subcontractor (§9 спеки, waitfor signal)

Крупный модуль (субчики, заявки, comparison matrix, awarding, portal). Не брать без явного сигнала:
- Реальный субчик приходит с первым тендером
- Или партнёр через SDK просит tender domain

Эффорт: 40-60ч.

---

### P3.4 — ProductionItem как отдельная сущность (§8 спеки)

Сейчас plan/fact живёт в `gtd_tasks.budgetAmount + actualDurationMinutes`. Для полноценного job-costing нужен отдельный collection. Нетривиальный рефакторинг (задачи ↔ production items ↔ time entries).

Эффорт: 20-30ч.

---

### P3.5 — Python SDK Phase 2 доделать + Phase 3

Из `PYTHON_SDK_SPEC.md`: finance + files + payroll domains (Phase 2 оставшиеся). Phase 3 = OpenAPI codegen.

Эффорт: 6-8ч Phase 2; Phase 3 — когда OpenAPI контракт стабилизируется.

---

### P3.6 — CRM_OVERHAUL_SPEC_V1 хвост (§13-18)

В спеке TODO-маркеры на:
- §13 API и AI-агент
- §14 Аналитика и AI-слой
- §15 Нефункциональные требования
- §16 Роли и права доступа
- §17 Roadmap и приоритеты (этот документ частично закрывает)
- §18 Метрики успеха

Нужно чтобы Денис доприслал эти секции. Без них CRM overhaul нельзя полноценно планировать.

---

## Dependency graph (что от чего зависит)

```
P0.1 (CI) ──┬──> P0.4 (merge open PR's)
            └──> все последующие PR проходят CI

P0.2 (infra-map) — independent
P0.3 (spinners) — independent

P1.1 (balance verify) — independent
P1.2 (RLS test) — independent
P1.3 (timezone) — independent
P1.4 (client header) ──> P2.5 (client tabs)
P1.5 (nav) — independent

P2.1 (deal→project) ──> P2.2 (change order)
                    ──> P2.3 (act)
                    
P2.4 (task flags) ──> P3.4 (ProductionItem split)

P3.x — все по сигналу
```

---

## Ориентировочные эффорты

| Стадия | Суммарно | Параллелизация |
|---|---|---|
| P0 (блокеры) | 4-5ч | 3 PR параллельно |
| P1 (неделя) | 10-15ч | 4 параллельно |
| P2 (месяц) | 30-40ч | по 1-2 за PR |
| P3 (квартал) | 80-120ч | зависит от сигналов |

---

## Метрики успеха

Через 1 месяц после старта фиксов должны увидеть:

1. **0 инцидентов** с «Failed to fetch» на /admin/* (P0.2 проверка)
2. **0 persistent CircularProgress** на core экранах (P0.3 проверка)
3. **Все PR зелёные в CI** (P0.1 проверка)
4. **Balance formula** — 0 расхождений с известными периодами (P1.1)
5. **Карточка клиента v2 header** в проде (P1.4)
6. **Deal win → Project auto-creation** работает на реальной сделке (P2.1)

---

## Что НЕ в плане сознательно

- Полный rewrite client card v2 (§4 спеки целиком) — слишком большой, по частям
- Все 11 модулей overhaul spec — только приоритетные для стройбизнеса
- Telegram интеграция §11 — уже частично живёт (worker + costs bots), глубокий рефакторинг отложен
- Client-portal phase-aware UX (§12) — ждём завершения фаз production
- Nonprofit marketing-pages (/docs, /blog, /features, /pricing) — проверить только что не 404'ят, контент не править

---

## Первый шаг

**С учётом переезда на новый сервер** логичная последовательность:

1. **P-1.1 (inventory hardcoded things, 1-2ч)** — быстрая инвентаризация. Сразу видно масштаб миграции.
2. **P0.1 (CI, 30 мин)** — нужно для любых будущих PR'ов.
3. **P0.2 (infra-map + Server Dashboard, 30 мин)** — первые конкретные хардкоды убрать.
4. **P-1.2 (env consolidation, 3-4ч)** — уже по результатам P-1.1.
5. **P-1.3 + P-1.4 (secrets + firebase topology, 2ч)** — документация без кода.
6. **P-1.5 (data export runbook, 2-3ч)** — полная готовность к переезду.

Суммарно ~8-12ч и проект готов к переезду + фикс CI + первые блокеры. После этого уже можно параллельно переносить и чинить UX (P0.3, P1.x).

Готов начать с **P-1.1** (inventory) прямо сейчас — скажи «да».
