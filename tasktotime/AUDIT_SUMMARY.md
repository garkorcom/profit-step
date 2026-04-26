# Аудит существующего модуля задач — сводный отчёт

**Дата:** 2026-04-25
**Проведён:** code-explorer + general-purpose + ui-ux-designer agents (parallel)
**Цель:** инвентаризация перед выносом в автономный модуль `tasktotime`

---

## TL;DR

1. **Production source-of-truth** — root collection `gtd_tasks/{id}` (не subcollection). Все live-paths пишут туда: web UI, Telegram worker bot, AI generation, time tracking, project automation.
2. **`/crm/tasks?view=board`** → `UnifiedTasksPage.tsx` → `<GTDBoard />` (49KB, 7 GTD-колонок с DnD).
3. **3 параллельных «модуля задач» в коде** — `gtd_tasks` (живой), `companies/{cid}/tasks` через `taskApi.ts` (DEAD), `notes` коллекция (отдельная подсистема с qualityLoop / financials, частично дублирует tasks).
4. **~50 hardcoded references** на `'gtd_tasks'` строку — backend triggers, agent API, callables, telegram bot, frontend hooks, components, pages, types, rules, indexes, tests.
5. **5 источников правды для статуса** в коде (drift): `GTDStatus` type, Zod schema, telegram bot enum, deadlineReminders query, mediaHandler legacy strings (`'todo'`/`'in_progress'`).
6. **Триггеров на gtd_tasks — 2** (`onTaskCreate`, `onTaskUpdate`) + 2 косвенных (`onWorkSessionCompletedAggregateTask`, `onProjectCreatedInitAssets`). **Infinite-loop guards в порядке**, но инкрементальная агрегация `actualLaborCost` идёт через одну точку транзакции (хрупкая).
7. **Тестов — частично:** `useGTDTasks`, agent API tasks routes, `generateAiTask`, `scopeMatcher` покрыты. **`gtdHandler.ts` (Telegram), `useTasksMasonry`, `useCockpitTask`, `moveGtdTask`, триггеры — БЕЗ unit-тестов.**

---

## Раздел 1. Что есть сейчас (architecture)

### 1.1. Routes (`src/router/AppRouter.tsx`)

| Route | Component | Notes |
|---|---|---|
| `/crm/tasks` (default `?view=board`) | `UnifiedTasksPage` | Точка входа |
| `/crm/tasks?view=board` | → `<GTDBoard />` | Kanban, primary |
| `/crm/tasks?view=timeline` | → `<TasksMasonryPage hideHeader />` | Дублирует Board другим UI |
| `/crm/tasks?view=calendar` | → `<CalendarPage />` | Использует другой DnD движок |
| `/crm/tasks?view=table` | → `<TasksTableView />` | Read-only, без bulk ops |
| `/crm/tasks?view=map` | → `<TasksMapView />` | **STUB** "Coming soon" |
| `/crm/gtd/new` | `GTDCreatePage` (89KB) | Wizard создания |
| `/crm/gtd/:taskId`, `/crm/cockpit/:taskId` | `UnifiedCockpitPage` (104KB) | Детальная страница |
| `/crm/tasks-masonry` | **DUPLICATE registration** (lines 229 + 238 in router) | Bug |
| `/crm/gtd`, `/crm/calendar`, `/crm/inbox`, `/tasks` | Legacy redirects | OK |

### 1.2. Backend (Cloud Functions)

| Слой | Файл | Назначение |
|---|---|---|
| Express REST (`/api/gtd-tasks/*`) | `functions/src/agent/routes/tasks.ts` (419 строк) | 5 endpoints: POST, GET list, PATCH, DELETE (soft → archived), batch-update |
| Callables | `functions/src/callable/ai/generateAiTask.ts` (637 строк) | Claude-based, region us-east1, audit trail в `aiAuditLogs` |
| Callables | `functions/src/callable/ai/modifyAiTask.ts` | Claude inline edit, region europe-west1 |
| Callables | `functions/src/callable/ai/estimateTask.ts` (312 строк) | Gemini, hours/cost/materials estimator с кешем |
| Callables | `functions/src/callable/gtd/moveGtdTask.ts` | Atomic DnD column move |
| Callables | `functions/src/callable/gtd/generateDayPlan.ts` | AI day planner |
| Триггеры | `functions/src/triggers/firestore/onTaskCreate.ts` | Telegram уведомление assignee |
| Триггеры | `functions/src/triggers/firestore/onTaskUpdate.ts` (174 строк) | Audit log + assignment notify, field-change guard на 6 watched fields |
| Триггеры | `functions/src/triggers/firestore/clientJourneyTriggers.ts:234` | `onProjectCreatedInitAssets` — auto-generate tasks из estimate |
| Триггеры | `functions/src/triggers/firestore/clientJourneyTriggers.ts:395` | `onWorkSessionCompletedAggregateTask` — agg `actualDurationMinutes`/`actualLaborCost` |
| Telegram bot | `functions/src/triggers/telegram/handlers/gtdHandler.ts` | `/task`, `/tasks`, `/plan`, voice→tasks, callbacks |
| Telegram bot | `functions/src/triggers/telegram/handlers/inboxHandler.ts` | Voice → inbox tasks |
| Telegram bot | `functions/src/triggers/telegram/handlers/mediaHandler.ts` | AI progress updates от голосовых отчётов |
| Scheduled | `functions/src/scheduled/deadlineReminders.ts` | Hourly cron, deadline notifications |
| Scheduled | `functions/src/scheduled/scheduledDayPlan.ts` | 7am EST cron, daily plan |

### 1.3. Frontend

**UI компоненты:**
- `src/components/gtd/` — 15 компонентов: `GTDBoard.tsx` (49KB), `GTDColumn`, `GTDTaskCard`, `GTDEditDialog` (66KB), `GTDSubtasksTable` (71KB), `GTDFilterBuilder`, `AuditTaskInput`, `CompactHeader`, `ColumnIndicator`, `DynamicFormField`, `RepairTicketInput`, `ShoppingListInput`, `TaskChecklist`, `TaskHistoryTimeline`
- `src/components/tasks/` — 3 файла AI-helpers: `AiDraftPreview`, `AiGenerateButton`, `SmartCockpitInput`
- `src/components/tasks-masonry/` — `TaskSquare`, `TasksMasonryHeader` (touch-optimized)
- `src/components/tasks-unified/` — `TasksTableView` (read-only sortable), `TasksMapView` (stub)
- `src/components/cockpit/` — `useCockpitTask`, `WorkSessionsList`, `EstimatesTabContent`, `BlueprintsTabContent`, `cockpit.types.ts`
- `src/components/crm/ClientTasksTab.tsx`, `TaskMaterialsTab.tsx`
- `src/components/dashboard/widgets/TasksWidget.tsx`

**Hooks:**
- `useGTDTasks` (283 строки) — primary subscription, optimistic DnD, CRUD
- `useTasksMasonry` (399 строк) — параллельная subscription, group logic, multi-select
- `useAiTask` (276 строк) — AI state machine
- `useCockpitTask` — single-task orchestrator + autosave
- `useSessionManager` — timer integration

**Types:**
- `src/types/gtd.types.ts` (702 строки, 28KB) — `GTDTask` interface ~200 fields
- `src/types/task.types.ts` (DEAD)
- `src/types/notes.types.ts` (357 строк) — `Note` (separate concept, имеет `gates`/`financials`/`controllerId`)
- `src/types/inventory.types.ts` — `TaskMaterial` (embedded shape)

### 1.4. Firestore

| Collection | Status | Назначение |
|---|---|---|
| `gtd_tasks/{taskId}` | **PRIMARY** | Все production paths |
| `companies/{cid}/tasks/{taskId}` | **DEAD** | Только `taskApi.ts` пишет, ни один UI не читает |
| `users/{uid}/tasks`, `users/{uid}/gtd_tasks` | **DEAD** | Только rules, нет code refs |
| `notes/{noteId}` | SEPARATE | Telegram inbox + qualityLoop, может конвертироваться в gtd_tasks (флаг `convertedToTaskId`, но writer'а нет) |
| `work_sessions/{sid}` | LIVE | `relatedTaskId` → gtd_tasks |
| `aiAuditLogs/{id}` | LIVE | AI generation audit |
| `_idempotency/{key}` | LIVE | Agent API dedup (24h TTL) |
| `processedEvents/{id}` | LIVE | Trigger idempotency |
| `aiCache/{key}` | LIVE | Кеш `estimateTask` ответов |

**Indexes:** 11 composite indexes на `gtd_tasks` (`firestore.indexes.json:552-668, 1087-1112`).

**Rules:** `firestore.rules:326-359`:
- `read: if true` (public — Client Portal читает напрямую)
- `create: if signedIn && ownerId == auth.uid`
- `update: if owner | assignee | manager-of-owner | manager-of-assignee` (через `hierarchyPath`)
- `delete: if owner only`

---

## Раздел 2. GTDTask — текущая модель данных (~200 полей)

Группы полей в `src/types/gtd.types.ts`:

| Группа | Поля |
|---|---|
| Identity | `id, ownerId, ownerName, assigneeId, assigneeName, coAssignees[], coAssigneeIds[]` |
| Core content | `title, description, memo, attachments[], checklistItems[]` |
| Status | `status` (`inbox/next_action/waiting/projects/estimate/someday/done`), `priority`, `context`, `taskType`, `needsEstimate` |
| Linking | `clientId, clientName, projectId, projectName, linkedContactIds[], parentTaskId, isSubtask, sourceNoteId, source` (telegram/web/voice) |
| Time | `createdAt, updatedAt, startDate, dueDate, completedAt, estimatedDurationMinutes, actualDurationMinutes, estimatedMinutes` (дубль с DurationMinutes!) |
| Gantt | `dependsOn[], isMilestone, ganttColor, plannedStartDate, plannedEndDate, actualStartDate, actualEndDate, clientApprovalRequired, reminderEnabled, reminderTime` |
| Money | `hourlyRate, totalEarnings, totalTimeSpentMinutes, budgetAmount, paidAmount, payments[], budgetCategory, progressPercentage, actualLaborCost` |
| Materials | `materials[]` (TaskMaterial), `materialsCostPlanned, materialsCostActual` |
| Acceptance | `acceptedAt, acceptedBy` (поля есть — writer'а нет!) |
| History | `taskHistory[]` (events) |
| AI/audio | `sourceAudioUrl, order, aiAuditLogId, scopeStatus, zone` (`zone` пишется, но не в типе!) |

---

## Раздел 3. Drift и проблемы (что нужно решить при миграции)

### 3.1. Status enum drift (5 источников правды)

| Источник | Значения |
|---|---|
| `GTDStatus` type (gtd.types.ts:27) | `inbox / next_action / waiting / projects / estimate / someday / done` |
| Agent API Zod schema (taskSchemas.ts) | + `completed` + `archived` |
| Telegram bot (gtdHandler.ts:19) | минус `estimate` |
| `deadlineReminders.ts:41` query | `inbox / next / waiting / scheduled / someday` (`'next'`/`'scheduled'` неизвестны типу!) |
| `mediaHandler.ts:462` query | `todo / in_progress` (legacy, конфликт) |
| `onTaskUpdate.ts:107` | проверяет `'approved'` (dead branch — нет нигде) |
| Orphan `Task` type | `todo / in-progress / done` |

### 3.2. Дубликаты сущностей

- **Board (`GTDBoard`) vs Timeline (`TasksMasonryPage`)** — один и тот же `gtd_tasks` рендерится двумя разными UI с разными хуками, разной DnD-логикой (двойная подписка на `/crm/tasks`).
- **Quick-Add дублирован 4+ раза:** TasksMasonryPage `QuickAddDialog`, GTDColumn inline TextField, GTDBoard FAB → wizard, TasksWidget callback.
- **Status options дублируются 5 раз:** `STATUS_OPTIONS` (cockpit.types.ts — без 'someday'!), `STATUS_PIPELINE` (GTDEditDialog — 4 статуса!), `STATUS_LABELS` (TasksTableView), `GTD_COLUMNS` (gtd.types.ts), `STATUS_COLORS`.
- **Priority colors** — 4 источника с расхождениями.
- **Two DnD libs:** `@hello-pangea/dnd` (Board/Masonry) и `@dnd-kit/core` (Calendar) — двойной bundle.

### 3.3. Phantom fields (есть в типе, нет writer'а)

- `acceptedAt`, `acceptedBy` — нет flow
- `clientApprovalRequired`, `reminderEnabled`, `reminderTime` — нет UI
- Gantt: `dependsOn`, `isMilestone`, `ganttColor`, `plannedStartDate/EndDate` — есть в типе, есть `ProjectGanttChart.tsx`, но не интегрирован в основной flow
- `totalEarnings`, `totalTimeSpentMinutes` — заявлены как aggregate, но реальный writer пишет в **другие поля** (`actualDurationMinutes`, `actualLaborCost`)
- `acceptanceDoc` — поля для акта выполнения **нет вообще**
- `siteId` — в Agent API schema **есть**, в `GTDTask` type **нет** (теряется при чтении)
- `zone` — наоборот: пишется в `confirmAiTask`, в типе нет

### 3.4. RLS / Security risks

- `useGTDTasks` query без `where`-фильтра — грузит ВСЕ задачи всех компаний (cost + privacy issue)
- `firestore.rules` `gtd_tasks: read: if true` — публичный read
- Hard `deleteDoc` в frontend vs soft-delete (status='archived') в Agent API — несогласованность
- Cross-tenant bypass test существует (`functions/test/rlsCrossTenant.test.ts`), но не запускался регулярно (см. CLAUDE.md §4 «живые риски»)

### 3.5. Infinite-loop / billing risks

Ни одного активного бомба не обнаружено, **но**:
- `onTaskUpdate` watches `dueDate` field changes — миграционный скрипт меняющий формат дат вызовет audit explosion (не loop, но шум)
- `onWorkSessionCompletedAggregateTask` — единственная точка инкремента `actualLaborCost`, защищена только `metricsProcessedAt` маркером на сессии
- `onTaskUpdate` field-change guard на 6 watched fields — OK, но dead branch `'approved'` (line 107)

---

## Раздел 4. Связи с соседними модулями (blast radius)

| Модуль | Точки касания | Risk при миграции |
|---|---|---|
| **Time Tracking / Payroll** | `closeSessionInTx` (TimeTrackingService.ts:167-212), `onWorkSessionCompletedAggregateTask`, frontend `useSessionManager`, AI accuracy log (`onWorkSessionUpdate.ts:122-191`) | **CRITICAL** — переименование коллекции = $0/hr cascade fail для воркеров, агрегация уйдёт в призрак |
| **Materials / Inventory** | `materials[]` embed на task; inventory transactions с `relatedTaskId`; `POST /api/inventory/transactions/task` с реальной existence-check; norm write-off | High — bulk write-off валится если task не resolves по ID |
| **Purchase Orders** | `PurchaseOrder.taskId, taskTitle` (subcollection `companies/{cid}/purchase_orders`) | Low — string-FK, не FK в БД-смысле |
| **Telegram Worker bot** | `gtdHandler.ts` (9 occurrences), `inboxHandler.ts` (voice → tasks), `mediaHandler.ts` (legacy 'todo'/'in_progress'), deadlineReminders cron | **HIGH** — daily users, без unit tests, refactored из 2142-строчного монолита |
| **AI bot `@crmapiprofit_bot`** (внешний) | Использует `/api/gtd-tasks/*` endpoints, документация на `https://profit-step.web.app/bot-docs/` | **HIGH** — координировать со внешним разработчиком при изменении URL |
| **Projects / Clients** | `projectId`, `clientId` денормализация на task; `ClientTasksTab`, `ProjectGanttChart`, `useClientDashboard`, `useSiteDashboard`; merge logic в `clients.ts:493-504` | Medium — string FKs выживут, но queries пойдут в новую коллекцию |
| **Estimates** | `sourceEstimateId` денормализация; `onProjectCreatedInitAssets` auto-generate; `POST /api/estimates/:id/convert-to-tasks` parent+sub-tasks; `POST /api/estimates/from-tasks` обратная | High — auto-generation flow «утверждение estimate → tasks» (Этап 2 SPEC) |
| **Calendar** | `dueDate`, `startDate`, Gantt fields; CalendarPage с другим DnD движком | Medium — нужно re-deploy 11 composite indexes |
| **Files / Attachments** | `linkedTo.taskId` на `files/{id}`; `GET /api/gtd-tasks/:id/files` хардкод | Low — string FK |
| **Client Portal** | Public read через rules + portalFilter strip-down (`portalFilter.ts:108-120`) | Medium — preserve auth model или закончить API-only переход |
| **RBAC** | `'tasks'` entity в `src/types/rbac.types.ts` (используется всеми 4 ролями) | Medium |

---

## Раздел 5. Test coverage

### 5.1. Покрыто

- `useGTDTasks` — `src/hooks/__tests__/useGTDTasks.test.ts`
- Agent API `tasks.ts` — `functions/test/agentApi/tasks.test.ts` (CRUD + idempotency)
- `generateAiTask` — `functions/test/generateAiTask.integration.test.ts` (mock-based)
- `scopeMatcher` — `functions/test/scopeMatcher.test.ts`
- `clientMetricsService` — `functions/test/clientMetricsService.test.ts`
- `rlsCrossTenant` — `functions/test/rlsCrossTenant.test.ts` (есть, но не запускался регулярно)

### 5.2. НЕ покрыто

| Файл | Risk |
|---|---|
| `useTasksMasonry.ts` (399 lines) | Medium |
| `useCockpitTask.ts` | High — основной orchestrator |
| `useAiTask.ts` (276 lines) | Medium |
| `moveGtdTask.ts` callable | High — production-critical atomic move |
| `modifyAiTask.ts`, `estimateTask.ts` callables | Low/Medium |
| `onTaskCreate.ts`, `onTaskUpdate.ts` triggers | High — Telegram production |
| `onProjectCreatedInitAssets`, `onWorkSessionCompletedAggregateTask` | High — financial impact |
| `gtdHandler.ts`, `inboxHandler.ts`, `mediaHandler.ts` (Telegram) | **High** — live worker bot |
| `deadlineReminders.ts`, `scheduledDayPlan.ts` | Medium |
| `GTDBoard.tsx`, `GTDEditDialog.tsx`, `GTDSubtasksTable.tsx` (49+66+71 = 186KB UI) | Medium |
| `GTDCreatePage.tsx` (89KB), `UnifiedCockpitPage.tsx` (104KB) | High |

---

## Раздел 6. Соответствие требуемым полям нового ТЗ

Денис явно перечислил необходимые поля для новой задачи. Сводная таблица "что есть / чего не хватает":

| Требование | Текущее состояние | Action |
|---|---|---|
| Время создания | ✅ `createdAt` | Переместить из спрятанного Accordion в visible header |
| Время старта (планируемое) | ✅ `startDate`, `plannedStartDate` | Консолидировать в одно поле |
| Время старта (фактическое) | ⚠️ `actualStartDate` поле есть, writer'а нет | Добавить writer (например, при первом старте таймера или при ручном «Начать») |
| Автопривязка старта к завершению другой | ⚠️ `dependsOn[]` есть в типе, UI нет | Добавить dependency picker + auto-shift |
| Время на выполнение (план) | ⚠️ `estimatedDurationMinutes` + `estimatedMinutes` (дубль) | Консолидировать |
| Время на выполнение (факт) | ✅ `actualDurationMinutes` через trigger | OK |
| Сколько людей нужно | ❌ Нет поля | Добавить `requiredHeadcount` |
| Кто создал | ✅ `ownerId, ownerName` | Поднять из Accordion в visible |
| Кто проверяет | ⚠️ `coAssignees[].role: 'reviewer'` тип есть, flow нет | Реализовать reviewer workflow |
| Дедлайн | ✅ `dueDate` | OK |
| Себестоимость | ⚠️ `actualLaborCost` + `materialsCostActual` (split) | Добавить агрегатное `costAmount` или показывать explicit split |
| Продажная стоимость | ✅ `budgetAmount`, `estimatedPriceClient` | Семантически переименовать (budget vs price) |
| Премия за вовремя | ❌ Нет | Добавить `bonusOnTime` |
| Штраф за просрочку | ❌ Нет | Добавить `penaltyOverdue` |
| Материалы | ✅ `materials[]`, `materialsCostPlanned/Actual` | Добавить indicator на карточке |
| Контакты для уточнения | ✅ `linkedContactIds[]` | Добавить chip на карточке |
| Адрес выполнения | ❌ Нет на task. На client/project есть. | Добавить `location: { address, lat?, lng? }` |
| Инструменты | ❌ Нет (есть только в AI response, не сохраняется) | Добавить `requiredTools[]` |
| Акт выполнения | ❌ Нет (gates есть только у Note) | Добавить `acceptanceDoc { url, signedAt, signedBy, signedByName, notes }` |
| Статус «начата» | ⚠️ `acceptedAt` ≠ started; есть activeSession проверка | Добавить lifecycle status `started` (либо computed, либо field) |
| Статус «закончена» | ✅ `done` + `completedAt` | OK для work-completed |
| Статус «просрочена» | Computed (`dueDate < now && status !== 'done'`) | Оставить computed, но добавить визуальное выделение overdue *внутри* активных колонок |
| Статус «выполнена» (с актом) | ❌ Нет различения «закончена» vs «выполнена с актом» | Lifecycle status `accepted` (после подписания акта) |

---

## Раздел 7. UX-проблемы (top 10)

1. **P-1 (Critical):** Дубль Board ↔ Timeline (Masonry) — 2 хука, 2 карточки, 2 DnD. Один из них надо убрать или мерджить.
2. **P-2 (Critical):** Cockpit перегружен 7 вкладками + 3 accordion-ами. На mobile — невыносимо. Нужна группировка в 3 секции.
3. **P-3 (Critical):** Quick-Add не покрывает требуемые поля — нет assignee, estimatedDuration, location, бюджет.
4. **P-4 (Critical):** Status enum drift между UI / Agent API / Telegram bot / cron / legacy — bug-генератор.
5. **P-5 (High):** TasksMapView — заглушка, хотя для конструкшн-бизнеса карта = критичная view.
6. **P-6 (High):** Создатель задачи (`ownerName`) спрятан за Accordion — нарушение F-pattern.
7. **P-7 (High):** Нет skeleton-loaders и retry на network errors.
8. **P-8 (Medium):** Mobile gestures inconsistent — swipe в Board ≠ swipe в Masonry.
9. **P-9 (Medium):** Glassmorphism + 11px font — accessibility issues.
10. **P-10 (Medium):** Цветовая инфляция (9 цветов на одной карточке) + цвета как hex-литералы (нет дизайн-токенов).

---

## Раздел 8. Highest-risk hot spots при миграции

1. **`closeSessionInTx`** в `TimeTrackingService.ts` — single source of truth для time aggregation.
2. **`onWorkSessionCompletedAggregateTask`** trigger — `metricsProcessedAt` marker prevents double-counting.
3. **Worker bot `gtdHandler.ts`** — 568 lines в `sessionManager.ts`, 465 в `locationFlow.ts`, NO unit tests, daily users.
4. **`mediaHandler.ts` voice→task progress writes** — uses non-canonical statuses `'todo'/'in_progress'`. Если новый модуль строго типизирует — бот падает silently.
5. **External AI bot** — публичный URL contract `/api/gtd-tasks/*`. Денис должен координировать любой rename.
6. **`firestore.rules:326-359` public read** — Client Portal читает напрямую. Сохранить auth model или закончить API-only переход первым.
7. **11 composite indexes** — must rebuild; Firestore блокирует production queries 10-30 мин для крупной коллекции.

---

## Раздел 9. Cleanup candidates (предложение)

После успешной миграции:
- Удалить `src/types/task.types.ts` + `src/api/taskApi.ts` + rules `companies/{cid}/tasks`, `users/{uid}/tasks`, `users/{uid}/gtd_tasks` — 4 dead paths
- Реконсилировать status drift: `mediaHandler.ts` → канонические значения; `deadlineReminders.ts` → канонические значения
- Удалить `Project` deprecated interface в `gtd.types.ts:80`
- Удалить dead branch `'approved'` в `onTaskUpdate.ts:107`
- Перенести в `_archived/`: `src/components/gtd/`, `src/components/tasks/`, `src/components/tasks-masonry/`, `src/components/tasks-unified/`, `src/components/cockpit/`, `src/pages/crm/UnifiedTasksPage.tsx`, `TasksMasonryPage.tsx`, `UnifiedCockpitPage.tsx`, `GTDCreatePage.tsx` — после успешной миграции

---

## Раздел 10. Migration touch points (50+ файлов)

Полный список — см. отдельный документ `MIGRATION_PLAN.md`, раздел "Файлы для обновления".
