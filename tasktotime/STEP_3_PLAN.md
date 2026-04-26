# Шаг 3: Backend Implementation — план агентов + quality gates

**Версия:** 1.0
**Дата:** 2026-04-26
**Длительность:** 3-4 дня
**Output:** 2 PR — PR-A (adapters + REST) + PR-B (triggers + callables + tests)

---

## TL;DR

Я запускаю 6-8 subagent'ов в чёткой последовательности с verification gate после каждого. Между агентами проверяю что файлы написаны, типы валидные, testы зелёные. Triggers пишу сам или через code-architect (highest risk — billing bomb potential per CLAUDE.md §2.1).

---

## Pre-flight (я делаю руками, не агенты)

**Должно быть до старта:**
- ✅ PR #64 merged (Phase 0 + Phase 1) — done
- ✅ PR #65 merged (Phase 2 schema) — done
- ⏳ Денис задеплоил `firestore:rules` + `firestore:indexes` — **должен быть БЛОКИРУЮЩИЙ check** (триггеры запишут в коллекции с rules — если rules не deployed, тесты в emulator работают но prod упадёт)

**Проверки которые делаю до запуска агентов:**
```bash
# 1. Branch state
git switch -c feature/tasktotime-backend-pr-a origin/main
git pull origin main

# 2. Phase 1 + Phase 2 in main
git log --oneline origin/main -5 | grep tasktotime
# expect: 5f0e8b1 (Phase 2) + 4b1c1df (Phase 1)

# 3. Phase 1 tests still green
npm run tsc:tasktotime && npm run test:tasktotime
# expect: 125 unit tests pass

# 4. Existing patterns to reuse (cached from Explore agent run earlier)
ls functions/src/utils/guards.ts        # idempotency guards
ls functions/src/agent/schemas/         # Zod schema patterns
ls functions/test/helpers.ts            # test helpers
```

Если что-то из этого не зелёное — стоп, фикс, потом дальше.

---

## PR-A: Adapters + REST API (1.5-2 дня)

**Branch:** `feature/tasktotime-backend-pr-a`
**Скоп:** все 21 adapter + REST handlers + adapter tests. БЕЗ triggers (это PR-B).

### Step A1: Adapter design (parallel: 2 агента)

Запускаю в **параллель**:

#### Agent A1.1 — `code-architect`
**Prompt:** проектируем `adapters/firestore/*` для всех 21 порта. На вход — `tasktotime/spec/04-storage/data-dependencies.md` + `ports/index.ts`. Output: точный mapping port method → Firestore query/transaction pattern. Где использовать `runTransaction`, где batch, где `where + orderBy + limit`. Какие composite indexes из firestore.indexes.json применяются. **Сохранить в `tasktotime/spec/04-storage/adapter-mapping.md`.**

#### Agent A1.2 — `Explore`
**Prompt:** найти существующие patterns в profit-step которые надо переиспользовать в adapters:
- `functions/src/agent/routes/tasks.ts` — REST handler pattern (Zod + idempotency)
- `functions/src/utils/guards.ts` — `checkEventIdGuard`, `checkFieldChangeGuard`
- `functions/src/agent/schemas/taskSchemas.ts` — Zod schema style
- `functions/src/services/clientMetricsService.ts` — service class with DI
- `functions/test/helpers.ts` — test helpers
- Output: краткий cheat-sheet с файлами/строками для backend-developer.

**Quality gate перед Step A2:**
- [ ] adapter-mapping.md создан и покрывает все 21 порт
- [ ] cheat-sheet получен — есть concrete file:line references
- [ ] Если adapter-mapping противоречит spec/04-storage/data-dependencies.md → блокирующий вопрос Денису

---

### Step A2: Adapters implementation (1 агент с большой задачей)

#### Agent A2 — `backend-developer`
**Prompt:** реализовать все 21 adapter в `tasktotime/adapters/firestore/`. На вход: blueprint + adapter-mapping.md из A1.1 + cheat-sheet из A1.2. Использовать `firebase-admin/firestore` (НЕ `firebase` client SDK — это бэкэнд).

Файлы:
```
tasktotime/adapters/firestore/
├── FirestoreTaskRepository.ts
├── FirestoreTransitionLog.ts
├── FirestoreClientLookup.ts
├── FirestoreProjectLookup.ts
├── FirestoreUserLookup.ts
├── FirestoreEmployeeLookup.ts (двойной namespace logic)
├── FirestoreContactLookup.ts
├── FirestoreSiteLookup.ts
├── FirestoreEstimate.ts
├── FirestoreNote.ts
├── FirestoreInventoryCatalog.ts
├── FirestoreInventoryTx.ts
├── FirestoreWorkSession.ts
├── FirestorePayroll.ts
├── FirestoreAIAudit.ts
├── FirestoreAICache.ts
├── FirestoreIdempotency.ts (processedEvents/{key} с TTL)
├── FirestoreFile.ts
├── FirestoreClock.ts
├── FirestoreIdGenerator.ts (taskNumber sequence через transaction)
├── (NoopAdapters для notify в этой PR — реальные в PR-B)
├── adapter-tests-helpers.ts
└── index.ts (barrel + factory function)
```

Также `adapters/storage/`:
- `FirebaseStorageUpload.ts` — wrapper для Firebase Storage SDK
- `BigQueryAuditAdapter.ts` — fire-and-forget BQ writes (можно stub в PR-A, реальный в PR-B)

**Quality gate перед Step A3:**
- [ ] Все 21 adapter созданы
- [ ] Каждый имплементирует свой port interface (TypeScript check проходит)
- [ ] `npm run tsc:tasktotime` green (новый script `tsc:tasktotime-adapters` если нужно отдельно)
- [ ] Я ручью читаю `FirestoreTaskRepository.ts` — самый критичный — verify pattern + idempotency

**Что я мониторю во время агента:**
- Pulse check каждые 10-15 минут: `find tasktotime/adapters/firestore -type f -name "*.ts" | wc -l`
- Если меньше 5 файлов через 30 минут — что-то не так, escalate
- Если через 1 час < 15 файлов — кикнуть отдельный агент чтобы добить остальные

---

### Step A3: REST API handlers (1 агент)

#### Agent A3 — `backend-developer`
**Prompt:** реализовать REST endpoints `/api/tasktotime/*` по `spec/05-api/rest-endpoints.md`. Использовать adapters из A2 через DI, `application/handlers/*` из Phase 1 для бизнес-логики.

Файлы:
```
tasktotime/adapters/http/
├── routes.ts (Express Router setup)
├── handlers/
│   ├── createTask.ts (POST /api/tasktotime/tasks)
│   ├── getTask.ts (GET /api/tasktotime/tasks/:id)
│   ├── listTasks.ts (GET /api/tasktotime/tasks с фильтрами + RLS)
│   ├── updateTask.ts (PATCH /api/tasktotime/tasks/:id)
│   ├── transitionTask.ts (POST /api/tasktotime/tasks/:id/transition)
│   ├── batchUpdate.ts (POST /api/tasktotime/tasks/batch)
│   ├── deleteTask.ts (DELETE /api/tasktotime/tasks/:id — soft через archivedAt)
│   ├── addDependency.ts
│   ├── signAcceptance.ts
│   ├── attachMaterial.ts
│   ├── attachTool.ts
│   ├── linkContact.ts
│   ├── getFiles.ts
│   ├── getSessions.ts
│   ├── getAudit.ts
│   └── index.ts
├── schemas.ts (Zod schemas — single source)
├── middleware.ts (auth, idempotency check, RLS, error handler)
└── index.ts
```

Также интеграция:
- `functions/src/agent/agentApi.ts` — добавить mount `app.use('/api/tasktotime', tasktotimeRouter)` в существующий Express app

**Quality gate:**
- [ ] Все endpoints из spec созданы
- [ ] Zod schemas в `schemas.ts` (single source — frontend импортирует)
- [ ] Idempotency через `_idempotency/{key}` — как existing pattern в `functions/src/agent/routes/tasks.ts:75-90`
- [ ] RLS на `listTasks` — фильтр по `companyId` через `getUserCompany()` (как существующие patterns)
- [ ] Error handler конвертирует ZodError → 400, DomainErrors → 400, остальное → 500

---

### Step A4: Adapter tests (1 агент)

#### Agent A4 — `test-generator`
**Prompt:** написать integration тесты для adapters в `tasktotime/tests/adapters/`. Использовать Firebase emulator (как existing security tests). Проверять:
- TaskRepository CRUD round-trips
- TransitionLog append-only
- IdempotencyAdapter TTL behavior
- IdGenerator unique sequence under concurrency (transaction)

Файлы:
```
tasktotime/tests/adapters/
├── FirestoreTaskRepository.test.ts
├── FirestoreTransitionLog.test.ts
├── FirestoreIdempotency.test.ts
├── FirestoreIdGenerator.test.ts
└── (smoke tests для остальных — убедиться что adapter не падает)
```

Также — REST integration test:
```
tasktotime/tests/http/
├── createTask.test.ts (через supertest или fetch на emulator)
├── listTasks-RLS.test.ts (cross-tenant)
└── transition-state-machine.test.ts
```

**Quality gate:**
- [ ] Все adapter tests запускаются `firebase emulators:exec --only firestore`
- [ ] cross-tenant test passes (companyA не читает companyB)
- [ ] idempotency test passes (двойной POST → один doc)

---

### Step A5: PR-A создание (я делаю)

```bash
# Verification
npm run tsc:tasktotime  # все adapters compile
npm run test:tasktotime # 125 unit + new adapter tests
firebase emulators:exec --only firestore 'npm run test:adapters:tasktotime'

# Manual review критичных файлов
read tasktotime/adapters/firestore/FirestoreTaskRepository.ts
read tasktotime/adapters/firestore/FirestoreIdempotency.ts
read tasktotime/adapters/http/routes.ts

# Hexagonal purity check
grep -rE "from ['\"]firebase|from ['\"]@firebase" tasktotime/domain tasktotime/ports
# expect: empty (still no Firebase in domain/ports)

# Commit
git add tasktotime/adapters tasktotime/tests/adapters tasktotime/tests/http functions/src/agent/agentApi.ts package.json
git commit -m "feat(tasktotime): Phase 3 PR-A — Firestore adapters + REST API"
git push -u origin feature/tasktotime-backend-pr-a
gh pr create --title "..." --body "..."
```

---

## PR-B: Triggers + AI Callables (1.5-2 дня)

**Branch:** `feature/tasktotime-backend-pr-b` (after PR-A merged)
**Скоп:** 5 Firestore triggers + 6 AI callables + scheduled crons + final notification adapters.
**Risk level:** **HIGHEST** — triggers могут стать $10k bomb если без guards (CLAUDE.md §2.1).

### Step B1: Trigger architecture review (я + 1 агент)

#### Agent B1 — `code-architect`
**Prompt:** для каждого из 5 triggers — спроектировать idempotency strategy + WATCHED_FIELDS exclude list + transaction boundaries. На вход: `tasktotime/spec/05-api/triggers.md` + `functions/src/utils/guards.ts` (существующие helpers).

Output table format:
```
| Trigger | Source coll | Reads task? | Writes task? | Idempotency | WATCHED_FIELDS | Cycle risk |
|---|---|---|---|---|---|---|
| onTaskCreate | tasktotime_tasks/{id}.onCreate | yes (own) | no | by-design (onCreate) | n/a | low |
| onTaskUpdate | tasktotime_tasks/{id}.onUpdate | yes (before/after) | yes (subtaskRollup, isCriticalPath) | processedEvents/{eventId}_${updateBatch} | EXCLUDE: subtaskRollup, isCriticalPath, slackMinutes, blocksTaskIds, lastReminderSentAt, payrollProcessedAt | HIGH — самый критичный |
| onTaskTransition | (custom event from updateTask handler) | yes | yes (cascade) | processedEvents/${transitionId} | n/a | medium |
| onWorkSessionCompleted | work_sessions/{id}.onUpdate (status==completed) | yes | yes (actualDurationMinutes) | metricsProcessedAt marker on session | n/a | low |
| onWikiUpdate | tasktotime_tasks/{id}.onUpdate (wiki changed) | yes | yes (versionHistory) | (вычислять только если wiki.version changed) | only `wiki` field | low |
```

**Сохранить в `tasktotime/spec/05-api/trigger-safety-matrix.md`.**

**Я делаю review этой matrix перед B2 — это самый рискованный gate.** Если что-то выглядит loop-prone — обсуждаем.

---

### Step B2: Triggers implementation (я делаю сам, не агент)

**Почему сам:** triggers — единственное место где ошибка стоит $10k+. Не делегирую subagent'у. Использую `Edit/Write` напрямую с careful pattern matching на существующий `onTaskUpdate.ts:39-51`, `clientMetricsTriggers.ts:44-52`, `onWorkSessionCompletedAggregateTask.ts:413`.

Файлы:
```
tasktotime/adapters/triggers/
├── onTaskCreate.ts
├── onTaskUpdate.ts (cascade rollup + critical path recompute)
├── onTaskTransition.ts (cascade unblock dependent tasks)
├── onWorkSessionCompleted.ts (aggregate actuals — extracted from existing clientJourneyTriggers)
├── onWikiUpdate.ts (version history snapshot)
└── index.ts (export все)

functions/src/index.ts — добавить exports новых функций (не удалять существующие!)
```

**Каждый trigger обязан:**
1. **Idempotency check FIRST** — перед любыми reads/writes
2. **Field-change guard** — return null если ничего из watchlist не изменилось
3. **No transitive cascade** — max 3 levels вложенности (config-level limit)
4. **try/catch with error log** — не бросать необработанные exceptions, не retry'ить

**Я пишу один trigger → пишу для него тест → проверяю → пишу следующий.** Не batch.

**Critical tests:**
```
tasktotime/tests/triggers/
├── onTaskCreate.test.ts — basic + idempotency
├── onTaskUpdate.loop-prevention.test.ts — попытка цикла rollup → assert НЕ зацикливается
├── onTaskUpdate.cascade.test.ts — A done → B plannedStartAt shifted
├── onTaskUpdate.subtask-rollup.test.ts — все subtasks accepted → parent suggests accept
├── onTaskTransition.test.ts — start/complete/accept side effects
├── onWorkSessionCompleted.aggregate.test.ts — duration sum + double-counting prevention
├── onWikiUpdate.version-history.test.ts — append-only, max 10 inline
└── infinite-loop.regression.test.ts — синтетический сценарий который должен НЕ зациклиться
```

---

### Step B3: AI Callables (1 агент)

#### Agent B3 — `backend-developer`
**Prompt:** реализовать 6 AI callables в `tasktotime/adapters/ai/`. Использовать existing patterns из `functions/src/callable/ai/generateAiTask.ts` (Claude tool use) и `functions/src/callable/ai/estimateTask.ts` (Gemini fallback chain).

Файлы:
```
tasktotime/adapters/ai/
├── generateTask.ts (Claude scope analysis)
├── estimateTask.ts (Gemini hours/cost estimator с aiCache)
├── modifyTask.ts (Claude inline edit)
├── decomposeEstimate.ts (estimate → subtasks с DAG)
├── confirmTask.ts (apply AI draft + audit log)
├── generateDayPlan.ts (AI day planner)
├── prompts/ (template strings отдельно — для ясности)
└── index.ts
```

Использовать existing secrets: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (smoke check `functions/src/index.ts`).

**Quality gate:**
- [ ] Все callables с региональным affinity (us-east1 для Claude, default для Gemini per existing pattern)
- [ ] aiAuditLogs/{id} запись ВСЕГДА перед return
- [ ] aiCache check — для idempotent estimateTask
- [ ] Rate limit (1 mutation per task per 60s) — через `processedEvents/${taskId}_ai_${type}_${minute}`
- [ ] Mocked Anthropic/Gemini in tests (existing pattern в `generateAiTask.integration.test.ts`)

---

### Step B4: Scheduled crons (1 агент или сам)

#### Agent B4 — `backend-developer` (легкий)
**Prompt:** 3 scheduled functions:
- `deadlineReminders` (hourly) — query overdue tasks → Telegram notify
- `overdueEscalation` (daily 9am EST) — auto-apply bonus/penalty в payroll
- `dayPlan` (daily 7am EST) — call generateDayPlan для каждого active worker

Использовать existing `functions/src/scheduled/deadlineReminders.ts` как reference (но адаптированный под new collection + lifecycle types).

---

### Step B5: Notification adapters (parallel: 1 агент)

#### Agent B5 — `backend-developer`
**Prompt:** заменить NoopAdapters из PR-A на реальные:
- `TelegramNotifyAdapter` — wrapper над `sendMessageToWorker` из существующего `functions/src/utils/workerMessaging.ts`
- `EmailNotifyAdapter` — Brevo client (если existing pattern есть)
- `PushNotifyAdapter` — write doc в `notifications/{id}` (existing pattern)
- `BigQueryAuditAdapter` — реальная impl (был stub в PR-A)
- `WeatherForecastAdapter` — NOAA API mock (real API в Phase 4 polish)

---

### Step B6: Integration & infinite-loop tests (1 агент)

#### Agent B6 — `test-generator`
**Prompt:** end-to-end integration tests с emulator (Firestore + Functions):
- create → transition → complete → accept full flow
- subtask rollup propagation
- dependency cascade (5-task chain — actualEnd shift → propagate → no infinite loop)
- AI generate → confirm → audit log
- cross-tenant isolation (повторно — must still pass)
- mediaHandler-style legacy status writes — translate-or-reject (per Денисово решение Open Q #5)

```
tasktotime/tests/integration/
├── full-task-lifecycle.test.ts
├── dependency-cascade.test.ts
├── subtask-rollup-propagation.test.ts
├── ai-flow-end-to-end.test.ts
└── cross-tenant.test.ts (повтор)
```

**Quality gate перед PR-B:**
- [ ] Все trigger tests passing (особенно loop-prevention.test)
- [ ] AI callables работают с mocked APIs
- [ ] Integration cascade test passes (5-task chain, no infinite loop)
- [ ] Cross-tenant test passes
- [ ] `firebase emulators:exec --only firestore,functions 'npm run test:integration:tasktotime'` green

---

### Step B7: PR-B создание (я делаю)

```bash
# Final verification — всё что есть в Шаге 3
npm run tsc:tasktotime
npm run test:tasktotime  # unit
npm run test:adapters:tasktotime  # adapter integration
firebase emulators:exec 'npm run test:integration:tasktotime'  # full E2E

# Hexagonal purity (still!)
grep -rE "from ['\"]firebase|from ['\"]@firebase" tasktotime/domain tasktotime/ports

# Manual code review критичных файлов
read tasktotime/adapters/triggers/onTaskUpdate.ts  # самый рискованный
read tasktotime/adapters/triggers/onWorkSessionCompleted.ts
read tasktotime/adapters/ai/generateTask.ts

# functions/src/index.ts diff — что мы экспортируем
git diff functions/src/index.ts

# Commit + push + PR
```

PR description должен явно указать:
- Список новых exported Cloud Functions (`tasktotime_*`)
- Что эти функции attached к **новой** коллекции — НЕ конфликтуют со старыми triggers gtd_tasks
- Risk monitoring instructions (48h log watch после deploy)
- Rollback план

---

## Что я мониторю по ходу всех агентов

### Pulse checks
- Каждые 10-15 минут пока агент в background: `find tasktotime/<expected-folder> -type f -name "*.ts" | wc -l`
- Если файлов меньше ожидаемого через 1.5x время → escalate
- Если агент падает (notification error) → читаю summary, перезапускаю с conкретным feedback

### После каждого агента
- `npm run tsc:tasktotime` — TypeScript clean
- `npm run test:tasktotime` — unit tests pass
- Hexagonal purity grep — domain/ports без Firebase
- Read 2-3 ключевых файла глазами — sanity quality check
- Если что-то не так → не запускаю следующий агент пока не починю

### Critical risk triggers (только я делаю, не агенты)
- `onTaskUpdate.ts` (cascade + rollup recompute) — billing bomb potential
- `onWorkSessionCompleted.ts` (aggregation) — corrupted earnings data potential
- Migration script (Phase 5, не сейчас) — data loss potential

### Что эскалирую тебе сразу
- Failing critical tests (loop prevention, cross-tenant)
- Trigger без idempotency guard
- Domain/ports import Firebase
- Тестовое покрытие < 70% на triggers
- Resource cost concerns в emulator (если N+1 vidno)

---

## Timeline (realistic)

| Sub-step | Длительность | Агенты parallel? |
|---|---|---|
| Pre-flight | 15 min | — (я сам) |
| A1: Adapter design | 20-30 min | 2 параллельно |
| A2: Adapters impl | 60-90 min | 1 |
| A3: REST handlers | 45-60 min | 1 |
| A4: Adapter tests | 30-45 min | 1 |
| A5: PR-A create | 10 min | — |
| **PR-A subtotal** | **~3-4 часа** | |
| (Денис ревьюит + merge PR-A) | TBD | |
| B1: Trigger safety matrix | 20-30 min | 1 |
| B2: Triggers (я сам) | 90-120 min | — |
| B3: AI callables | 60-90 min | 1 |
| B4: Scheduled | 30-45 min | 1 |
| B5: Notification adapters | 30-45 min | 1 |
| B6: Integration tests | 45-60 min | 1 |
| B7: PR-B create | 10 min | — |
| **PR-B subtotal** | **~5-6 часов** | |

**Total active work:** 8-10 часов в течение 1-2 дней (с учётом ожидания агентов в background).

---

## Что должно быть зелёным к концу Шага 3

- ✅ Все adapter tests pass
- ✅ Все trigger tests pass (включая loop prevention)
- ✅ Cross-tenant test pass
- ✅ AI callable tests pass (с mocked external APIs)
- ✅ Integration E2E test pass
- ✅ `tsc:tasktotime` green
- ✅ Hexagonal purity (domain/ports без Firebase)
- ✅ Existing tests не сломаны (`npm run test`)
- ✅ Existing build не сломан (`npm run build`)
- ✅ Functions/src/index.ts экспортирует новые функции под `tasktotime_*` префиксом
- ✅ Firebase emulator стартует чистый

---

## Что я НЕ делаю в Шаге 3

- Frontend код (Шаг 4)
- Telegram bot rewrites (Шаг 5)
- Migration script (Шаг 6)
- `firebase deploy --only functions` — деплой только Денис
- Trigger который пишет обратно в `tasktotime_tasks` без idempotency guard

---

## Блокирующие вопросы которые могут возникнуть

1. **AI bot URL contract** (Open Q #4) — внешний @crmapiprofit_bot использует `/api/gtd-tasks/*`. В PR-A нужно решить: backwards-compat прокси или break? **Default:** прокси на 1-2 месяца (Денис может изменить).
2. **mediaHandler legacy statuses** (Open Q #5) — bot пишет `'todo'/'in_progress'`. **В PR-B handler:** translate-on-write в trigger. Telegram bot rewrite — это Шаг 5.
3. **Wiki rollup primary** (Open Q #6) — markdown viewer или PDF export. **Default в PR-B:** оба, но markdown в UI первый, PDF как опция.

Если в процессе появится новый блокирующий вопрос — escalate в pipeline file `~/projects/pipeline/{date}/blocked-tasktotime-step3.md` (или просто прямой ping в этой сессии).

---

**См. также:**
- [AGENT_PLAN.md](AGENT_PLAN.md) — общий план 6 шагов
- [MIGRATION_PLAN.md](MIGRATION_PLAN.md) — risk register
- [spec/05-api/triggers.md](spec/05-api/triggers.md) — детали triggers
- [spec/04-storage/data-dependencies.md](spec/04-storage/data-dependencies.md) — I/O контракт
- [CLAUDE.md §2.1](../CLAUDE.md) — defensive programming
