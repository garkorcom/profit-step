# План миграции в `tasktotime`

**Версия:** 0.1 draft
**Дата:** 2026-04-25
**Статус:** на согласование с Денисом

---

## 0. Принципы

1. **Старое не ломаем** до завершения переноса. Параллельно оба не работают.
2. **Единый production cutover** — не dual-write на N месяцев. Слишком хрупко на этом стеке (Firestore triggers, telegram bot, payroll агрегация).
3. **Каждая фаза имеет точку возврата** — git branch с тегом, можно откатить через revert.
4. **Тесты пишем ВПЕРЕДИ кода** (TDD-light) — особенно triggers и transitions.
5. **Деплой — только Денис** (CLAUDE.md §5). Каждая фаза заканчивается PR в `main`, Денис ревьюит, мерджит, деплоит.
6. **Никаких `git push --force` на main** (CLAUDE.md §2.4).
7. **Идемпотентность всех triggers** (CLAUDE.md §2.1) — каждый новый trigger обязан иметь guard (`processedEvents` collection ИЛИ field-change before/after).

---

## 1. Phase 0 — Preparation & Alignment (текущая)

**Длительность:** ~1 день
**Артефакты:**

- ✅ `tasktotime/AUDIT_SUMMARY.md` — done
- ✅ `tasktotime/TZ_TASKTOTIME.md` — done
- ✅ `tasktotime/MIGRATION_PLAN.md` — done (этот файл)
- ⏳ `tasktotime/README.md` — TBD
- ⏳ `tasktotime/INSTRUCTION.md` — TBD (для AI агентов, по образцу `tasks/INSTRUCTION.md`)

**Что нужно от Дениса:**

1. Прочитать `TZ_TASKTOTIME.md` целиком, особенно §9 «Открытые вопросы»
2. Решить:
   - Вариант для status drift cleanup в `mediaHandler.ts` (a/b/c)
   - Public read rule strategy (через API или JWT)
   - External AI bot — менять URL или держать proxy
   - Single dev vs Никита/Стёпа pipeline
   - Cutover window (выходные / нерабочие часы)
3. Отправить external AI bot разработчику предупреждение о потенциальном rename `/api/gtd-tasks/*` → `/api/tasktotime/*` (даже если решение «держать proxy» — на случай).

**Exit criteria:** GO/NO-GO от Дениса по основной концепции.

---

## 2. Phase 1 — Foundation (Frontend types + Backend services skeleton)

**Длительность:** ~2 дня
**Branch:** `feature/tasktotime-foundation`
**Risk:** низкий (чистое добавление, ничего не ломает)

### 2.1. Что делаем

**Frontend:**

```
tasktotime/frontend/
├── types/
│   ├── Task.ts                      ◄── полный interface из TZ §1.1
│   ├── lifecycle.ts                 ◄── TaskLifecycle enum + transitions table
│   ├── TaskMaterial.ts              ◄── re-export из inventory.types.ts
│   ├── TaskTool.ts                  ◄── NEW
│   ├── Location.ts                  ◄── NEW
│   ├── AcceptanceAct.ts             ◄── NEW
│   └── index.ts                     ◄── barrel export
├── api/
│   └── tasksApi.ts                  ◄── stub: эндпоинты + типизированные wrappers
└── shared/
    ├── fixtures/                    ◄── Task fixtures для тестов
    └── test-helpers/
        └── createTestTask.ts
```

**Backend:**

```
tasktotime/backend/
├── api/
│   ├── schemas.ts                   ◄── Zod schemas (single source — frontend импортирует)
│   ├── routes.ts                    ◄── Express skeleton (handlers TBD)
│   └── handlers/                    ◄── stubs возвращающие 501 Not Implemented
└── services/
    ├── TaskService.ts               ◄── domain logic skeleton
    └── DependencyService.ts         ◄── stub
```

**Shared:**

```
tasktotime/shared/
└── lifecycle.ts                     ◄── ОДИН source of truth для STATUS_OPTIONS, PRIORITY_OPTIONS, BUCKET_OPTIONS
```

### 2.2. Тесты

```
tasktotime/tests/unit/
├── types/
│   └── lifecycle.test.ts            ◄── transitions table coverage
├── services/
│   ├── TaskService.test.ts          ◄── domain logic stubs
│   └── DependencyService.test.ts
└── api/
    └── schemas.test.ts              ◄── Zod schema validation
```

### 2.3. Wiring

- В `src/types/index.ts` добавить re-export `Task` из `tasktotime/frontend/types`
- В `firestore.rules` — добавить блок `tasktotime_tasks/{id}` (см. TZ §4.3)
- В `firestore.indexes.json` — добавить 11 composite indexes (см. TZ §4.2). Деплоить — пока НЕ деплоим.
- В `functions/src/index.ts` — НЕ добавлять exports (handlers ещё стабы)

### 2.4. Exit criteria

- ✅ `npm run build` green
- ✅ `npm --prefix functions run build` green
- ✅ `tsc --noEmit` без новых ошибок
- ✅ Все unit тесты для lifecycle / TaskService skeleton — passing
- ✅ PR в `main`, code review (с `/ultrareview` если нужно)
- ❌ В UI ничего не видно — пока чистая инфраструктура

**Cleanup:** ничего не удаляем, ничего не перемещаем в archive.

---

## 3. Phase 2 — Backend implementation

**Длительность:** ~3-4 дня
**Branch:** `feature/tasktotime-backend`
**Risk:** средний (новые triggers — потенциальная billing-bomb если без guards)

### 3.1. Что делаем

**REST API (полный, но пишет в `tasktotime_tasks`):**

```
tasktotime/backend/api/handlers/
├── createTask.ts                    ◄── POST /api/tasktotime/tasks
├── updateTask.ts                    ◄── PATCH /api/tasktotime/tasks/:id
├── transitionTask.ts                ◄── POST /api/tasktotime/tasks/:id/transition
├── batchUpdateTasks.ts              ◄── POST /api/tasktotime/tasks/batch
├── listTasks.ts                     ◄── GET /api/tasktotime/tasks
├── getTask.ts                       ◄── GET /api/tasktotime/tasks/:id
├── deleteTask.ts                    ◄── DELETE /api/tasktotime/tasks/:id (soft)
├── addDependency.ts
├── signAcceptance.ts                ◄── POST /api/tasktotime/tasks/:id/acceptance
├── attachMaterial.ts
├── attachTool.ts
└── linkContact.ts
```

**Triggers:**

```
tasktotime/backend/triggers/
├── onTaskCreate.ts                  ◄── notify + audit. Idempotency: by-design (только onCreate).
├── onTaskUpdate.ts                  ◄── audit + cascade dependencies. WATCHED_FIELDS. Returns null если ничего не изменилось.
├── onTaskTransition.ts              ◄── side effects per lifecycle action. Idempotency: processedEvents.
└── onWorkSessionAggregate.ts        ◄── вынесено из clientJourneyTriggers, но пока НЕ заменяет старый — параллельно слушает оба triggers.
```

**Callables:**

```
tasktotime/backend/ai/
├── generateTask.ts                  ◄── портирован из generateAiTask, пишет в tasktotime_tasks
├── estimateTask.ts                  ◄── портирован из estimateTask
├── modifyTask.ts                    ◄── портирован из modifyAiTask
└── decomposeEstimate.ts             ◄── консолидирует projectAutomation + clientJourneyTriggers logic
```

**Scheduled:**

```
tasktotime/backend/scheduled/
├── deadlineReminders.ts             ◄── портирован, читает tasktotime_tasks
├── overdueEscalation.ts             ◄── NEW: penalty/bonus auto-apply
└── dayPlan.ts                       ◄── портирован
```

### 3.2. Тесты

```
tasktotime/tests/integration/
├── api/
│   ├── createTask.test.ts
│   ├── transitionTask.test.ts        ◄── ВСЕ transitions + invalid transitions
│   ├── listTasks.test.ts             ◄── RLS coverage (worker / foreman / admin)
│   └── batchUpdateTasks.test.ts
├── triggers/
│   ├── onTaskCreate.test.ts
│   ├── onTaskUpdate.test.ts          ◄── field-change guard, infinite-loop prevention
│   ├── onTaskTransition.test.ts
│   └── onWorkSessionAggregate.test.ts
└── ai/
    ├── generateTask.test.ts          ◄── mock-based (как existing)
    └── estimateTask.test.ts
```

### 3.3. Wiring

- В `functions/src/index.ts` — экспортировать новые triggers как `tasktotime_*` (имя функции в Firebase). НЕ удалять старые.
- В `functions/src/agent/agentApi.ts` — подключить `tasktotime/backend/api/routes.ts` под `/api/tasktotime/*`.
- Новые triggers слушают **новую коллекцию** `tasktotime_tasks` — старая `gtd_tasks` живёт параллельно, на неё триггеры старые. Без cross-pollination.

### 3.4. Exit criteria

- ✅ Все integration тесты — passing
- ✅ `firebase emulators:start` + ручная проверка endpoints (Postman / curl) — POST → GET → PATCH → transition → DELETE flow
- ✅ Triggers тестируются в emulators с idempotency (двойной create → одна notification)
- ✅ Cross-tenant RLS test — passing (наконец-то!)
- ✅ PR в `main`, Денис ревьюит, мерджит, **деплоит functions**
- ✅ В firebase console: новые `tasktotime_*` функции присутствуют
- ❌ UI пока ничего не делает — но API живой

**Risk monitoring (первые 48 часов после деплоя):**
- Firebase Functions logs — ловим errors / unexpected invocations
- Trigger invocation count — не должен совпадать с invocations старых триггеров (новая коллекция изолирована)
- Cost dashboard — не должно быть скачка чтений/записей

**Cleanup:** ничего не удаляем.

---

## 4. Phase 3 — Frontend implementation

**Длительность:** ~5-7 дней
**Branch:** `feature/tasktotime-frontend`
**Risk:** низкий-средний (frontend isolated, можно показать на отдельном route)

### 4.1. Что делаем

**Hooks:**

```
tasktotime/frontend/hooks/
├── useTasks.ts                      ◄── ОДНА subscription, replaces useGTDTasks + useTasksMasonry
├── useTask.ts                       ◄── single task, replaces useCockpitTask data layer
├── useTaskTransitions.ts            ◄── lifecycle actions (start/complete/accept/...)
├── useTaskDependencies.ts
├── useTaskAcceptance.ts
└── useTaskAi.ts                     ◄── replaces useAiTask
```

**Components:**

```
tasktotime/frontend/components/
├── TaskCard/                        ◄── ОДНА карточка (variant prop) replaces GTDTaskCard + TaskSquare
├── TaskBoard/                       ◄── replaces GTDBoard
├── TaskTimeline/                    ◄── replaces TasksMasonryPage
├── TaskCalendar/                    ◄── replaces CalendarPage (один DnD движок!)
├── TaskTable/                       ◄── replaces TasksTableView (с inline edit + bulk ops)
├── TaskMap/                         ◄── REPLACES STUB — реальная имплементация на Leaflet (как LocationMap)
├── TaskDetail/                      ◄── replaces UnifiedCockpitPage (104KB → разбит на 3 секции)
│   ├── TaskDetail.tsx
│   ├── sections/
│   │   ├── WorkSection.tsx          (журнал работ + таймер + чек-лист)
│   │   ├── MoneySection.tsx         (estimates + материалы + процентовка + acceptance)
│   │   └── ContextSection.tsx       (история + контакты + чертежи + dependencies)
│   └── header/
│       ├── TaskHeader.tsx
│       ├── TaskLifecycleBadge.tsx
│       └── TimerStickyButton.tsx
├── TaskQuickAdd/                    ◄── ОДНА quick-add форма с required полями
├── TaskCreateWizard/                ◄── replaces GTDCreatePage (89KB → разбит)
├── TaskAcceptanceForm/              ◄── NEW: подписать акт
├── TaskDependencyPicker/            ◄── NEW: dependsOn UI
└── shared/
    ├── TaskStatusBadge.tsx
    ├── TaskPriorityIndicator.tsx
    ├── LocationField.tsx
    ├── ToolsField.tsx
    └── TaskHistoryTimeline.tsx
```

**Page:**

```
tasktotime/frontend/pages/
└── TaskToTimePage.tsx               ◄── replaces UnifiedTasksPage (полная страница со свитчером views)
```

**Router:**

```typescript
// src/router/AppRouter.tsx — добавить:
<Route path="/tasktotime" element={<TaskToTimePage />} />
<Route path="/tasktotime/new" element={<TaskCreateWizard />} />
<Route path="/tasktotime/:id" element={<TaskDetail />} />

// СТАРЫЕ роуты (/crm/tasks, /crm/gtd/*) — НЕ ТРОГАЕМ, продолжают работать со старым кодом
```

### 4.2. Тесты

```
tasktotime/tests/unit/
├── hooks/
│   ├── useTasks.test.ts
│   ├── useTask.test.ts
│   └── useTaskTransitions.test.ts
└── components/
    ├── TaskCard/TaskCard.test.tsx
    ├── TaskBoard/TaskBoard.test.tsx
    └── TaskQuickAdd/TaskQuickAdd.test.tsx

tasktotime/tests/e2e/
├── createAndStartTask.cy.ts
├── completeAndAccept.cy.ts
├── dependencyAutoShift.cy.ts
└── workerDailyFlow.cy.ts
```

### 4.3. Wiring

- В `src/router/AppRouter.tsx` — добавить routes для `/tasktotime/*` (НЕ трогать `/crm/tasks/*`)
- В `src/components/Layout/Sidebar.tsx` или эквивалент — добавить пункт меню «TaskToTime (preview)»
- Новый страница использует **новые** API endpoints `/api/tasktotime/*` и **новую** коллекцию `tasktotime_tasks`. **НЕ ЧИТАЕТ** `gtd_tasks`.

### 4.4. Exit criteria

- ✅ `npm run build` green (vite)
- ✅ `oxlint` без новых ошибок
- ✅ Все unit + e2e тесты passing
- ✅ Manual UAT: Денис на staging URL пробует new module (CRUD + lifecycle + acceptance + dependency auto-shift + AI generate)
- ✅ Performance baseline: `useTasks()` subscription < 500ms initial load для 1000 задач
- ✅ Mobile preview: iPhone SE / iPad / Pixel Fold — UI читаем, touch targets ≥44×44
- ✅ PR в `main`, ревью, мердж
- ✅ Hosting deploy от Дениса

**Cleanup:** ничего не удаляем.

---

## 5. Phase 4 — Telegram bot migration

**Длительность:** ~3 дня
**Branch:** `feature/tasktotime-telegram`
**Risk:** **HIGH** — daily users, нет тестов на handlers (CLAUDE.md §2.2)

### 5.1. Что делаем

Миграция файлов:
- `functions/src/triggers/telegram/handlers/gtdHandler.ts` — переписать чтобы писал/читал `tasktotime_tasks`
- `functions/src/triggers/telegram/handlers/inboxHandler.ts` — то же
- `functions/src/triggers/telegram/handlers/mediaHandler.ts` — то же + **исправить status drift** (`'todo'/'in_progress'` → канонические `lifecycle` values)
- `functions/src/triggers/telegram/handlers/sessionManager.ts` — обновить task references
- `functions/src/triggers/telegram/handlers/locationFlow.ts` — обновить task references

**Чего избегаем:** не рефакторим bot logic — только заменяем коллекцию и точки касания.

### 5.2. Тесты

```
functions/test/telegram/
├── gtdHandler.test.ts                ◄── NEW (раньше не было!)
│   ├── /task command → task создан с lifecycle='ready'
│   ├── /tasks → list query
│   ├── /plan → AI day planner
│   ├── voice → batch tasks
│   └── callbacks (markDone, moveTask)
├── inboxHandler.test.ts              ◄── NEW
└── mediaHandler.test.ts              ◄── NEW (с проверкой что не пишет legacy 'todo'/'in_progress')
```

Тесты обязательны — иначе любая регрессия попадёт в прод (бригадиры пользуются ежедневно).

### 5.3. Wiring

Поскольку bot переключается на новую коллекцию **до** Phase 5 cutover, нужен **пересадочный механизм**:

- Опция A (предпочтительно): **dual-read** — bot читает обе коллекции (старую и новую), отображает merged view. Пишет — только в новую. Существующие живые задачи продолжают видеться, новые создаются в `tasktotime_tasks`.
- Опция B: **forward proxy** — bot читает только новую коллекцию, но при создании задачи запускается миграционный скрипт (Phase 5) сразу.

**Берём опцию A** — снижает риск.

### 5.4. Exit criteria

- ✅ Все 3 handler-тестовых файла green
- ✅ Manual UAT через @profitstepworker_bot на staging Firebase project: `/task`, `/tasks`, voice, callbacks
- ✅ PR + Денис ревью + functions deploy
- ✅ **Первые 48 часов мониторинг** (CLAUDE.md §5):
  - `firebase functions:log` live tail
  - Slack/Telegram канал для бригадиров — есть ли confused messages?
  - Если что-то ломается → revert (старая ветка готова)
- ✅ Подтверждение от 2-3 живых бригадиров: «всё работает как раньше»

**Cleanup:** ничего не удаляем.

---

## 6. Phase 5 — Data migration (gtd_tasks → tasktotime_tasks)

**Длительность:** ~1 день (включая cutover window)
**Branch:** `migration/gtd-to-tasktotime-data`
**Risk:** **CRITICAL** — production data move

### 6.1. Что делаем

**Скрипт миграции** (`scripts/migrate-gtd-to-tasktotime.ts`):

```typescript
// Псевдокод
async function migrate() {
  const gtdTasks = await firestore.collection('gtd_tasks').get();
  const batch = firestore.batch(); // 500 max per batch

  for (const doc of gtdTasks.docs) {
    const oldTask = doc.data();
    const newTask = transformTask(oldTask); // см. transformer ниже
    batch.set(firestore.collection('tasktotime_tasks').doc(doc.id), newTask);

    if (batch._ops.length >= 500) {
      await batch.commit();
      batch = firestore.batch();
    }
  }
  await batch.commit();
}

function transformTask(old: GTDTask): Task {
  return {
    id: old.id,
    companyId: old.companyId || resolveCompanyFromUser(old.ownerId),
    taskNumber: generateTaskNumber(old.createdAt), // T-2026-NNNN
    title: old.title,
    description: old.description,
    // ... mapping fields
    lifecycle: mapStatusToLifecycle(old.status),  // status → lifecycle
    bucket: mapStatusToBucket(old.status),        // status → bucket
    priority: old.priority,
    createdBy: { id: old.ownerId, name: old.ownerName },
    assignedTo: { id: old.assigneeId, name: old.assigneeName },
    requiredHeadcount: 1, // default; PM updates позже
    createdAt: old.createdAt,
    plannedStartAt: old.plannedStartDate || old.startDate,
    actualStartAt: old.actualStartDate,
    dueAt: old.dueDate || addDays(old.createdAt, 7), // default если нет
    estimatedDurationMinutes: old.estimatedDurationMinutes || old.estimatedMinutes || 60,
    actualDurationMinutes: old.actualDurationMinutes || 0,
    costInternal: { amount: old.actualLaborCost || 0, currency: 'USD' },
    priceClient: { amount: old.budgetAmount || 0, currency: 'USD' },
    materials: old.materials || [],
    location: null, // address не было в gtd_tasks — нужно ввод от PM
    requiredTools: [], // не было — пусто
    acceptance: null, // не было — пусто
    history: old.taskHistory || [],
    source: old.source || 'web',
    // ... etc
  };
}
```

**Mapping таблица** старых статусов в lifecycle:

| Old `status` | New `lifecycle` | New `bucket` |
|---|---|---|
| `inbox` | `draft` | `inbox` |
| `next_action` | `ready` | `next` |
| `projects` | `ready` | `next` |
| `waiting` | `blocked` | `next` |
| `estimate` | `draft` | `next` |
| `someday` | `draft` | `someday` |
| `done` | `completed` | `archive` |
| `archived` (Agent API) | `cancelled` | `archive` |
| `completed` (Agent API) | `completed` | `archive` |
| `'todo'` (mediaHandler legacy) | `ready` | `next` |
| `'in_progress'` (mediaHandler legacy) | `started` | `next` |
| `'next'` (cron legacy) | `ready` | `next` |
| `'scheduled'` (cron legacy) | `ready` | `next` |
| `'approved'` (dead branch) | `ready` | `next` |

### 6.2. Verification скрипт

```typescript
// scripts/verify-tasktotime-migration.ts
// Сравнивает counts, sums, sample records между gtd_tasks и tasktotime_tasks
// Должен выдавать:
//   - Total docs: gtd_tasks=N, tasktotime_tasks=N (равенство)
//   - Sum of estimatedDurationMinutes: совпадает (с допустимой погрешностью на null→60 default)
//   - Sample 100 random IDs — fully matched
//   - Все clientId/projectId references валидны
//   - Lifecycle distribution counts — sane (не все в draft/cancelled)
```

### 6.3. Cutover window

**Время:** воскресенье 02:00-04:00 EST (минимальная активность бригадиров).
**Длительность:** запланировано 30 минут, max 60 минут.

**Шаги:**

1. **T-30 min:** Telegram объявление в bot канале «техработы 30 минут».
2. **T-15 min:** Деплой кода Phase 5 (writers переключаются на новую коллекцию).
3. **T-0:** Запуск migration script. Live monitoring count.
4. **T+10 min:** verification script. Если ошибки — `git revert`, redeploy старого кода. Запасное окно — 30 минут.
5. **T+15 min:** Smoke test с реальным аккаунтом: создать задачу через web → bot → cockpit → timer → complete → accept.
6. **T+20 min:** Hosting deploy (Phase 6 frontend cutover).
7. **T+30 min:** Done. Telegram объявление «работаем».

### 6.4. Rollback

Если что-то идёт не так в **T+0 до T+10**:
- Migration script — idempotent (проверяет existence before write). Можно прерывать.
- `gtd_tasks` НЕ очищается — остаётся как backup.
- `git revert <last-deploy-sha>` + `firebase deploy --only functions,hosting` — возврат на старую систему за ~5 минут.

Если ошибка обнаружена **через несколько часов / дней** после успешного выглядящего cutover:
- Forward-fix через PR (не revert — слишком много данных уже в новой коллекции).
- Поэтому Phase 7 (cleanup gtd_tasks) откладывается на 2 недели.

### 6.5. Exit criteria

- ✅ Migration script отработал, counts равны
- ✅ Verification script — все checks pass
- ✅ Smoke test — pass
- ✅ Live monitoring 24 часа — no surge in errors / billing
- ✅ Bot users не жалуются (3 случайных опроса бригадиров через 24h)

---

## 7. Phase 6 — Frontend cutover

**Длительность:** в составе Phase 5 cutover (T+20 min)
**Branch:** `feature/tasktotime-cutover`
**Risk:** medium — UI меняется, но старый код остаётся как fallback

### 7.1. Что делаем

**Router redirect:**

```typescript
// src/router/AppRouter.tsx
<Route path="/crm/tasks" element={<Navigate to="/tasktotime" replace />} />
<Route path="/crm/tasks/*" element={<Navigate to="/tasktotime" replace />} />
<Route path="/crm/gtd/*" element={<Navigate to="/tasktotime" replace />} />
<Route path="/crm/cockpit/:id" element={<Navigate to="/tasktotime/:id" replace />} />
<Route path="/crm/calendar" element={<Navigate to="/tasktotime?view=calendar" replace />} />
<Route path="/crm/inbox" element={<Navigate to="/tasktotime?view=board&bucket=inbox" replace />} />

// Старые компоненты остаются в коде, но не достижимы через router
```

**Sidebar / navigation:**

- Заменить пункт «Задачи» с `/crm/tasks` на `/tasktotime`
- Убрать/переименовать «Calendar» (теперь это view внутри `/tasktotime`)

**Dashboard widget:**

- `TasksWidget` — переключить на `useTasks()` hook (новый)
- `ClientTasksTab` — переключить на `useTasks({ clientId })`
- `ProjectGanttChart` — переключить на `useTasks({ projectId })`
- `useClientDashboard`, `useDashboardTasks`, `useDashboardActivity`, `useSiteDashboard` — все на новый hook

**Embedded views:**

- `OffboardingWizard` — обновить `gtdTasks` reference на `tasktotime_tasks`
- `UserSlideOver` — то же

### 7.2. Exit criteria

- ✅ Все existing pages работают (redirects тестируются manual)
- ✅ Hosting deploy — green
- ✅ В UI нет видимой регрессии для пользователей
- ✅ Performance: no degradation (subscription latency)

---

## 8. Phase 7 — Cleanup & Archive (через 2 недели после cutover)

**Длительность:** ~2 дня
**Branch:** `cleanup/archive-old-tasks-module`
**Risk:** low (удаляется уже unused код)

### 8.1. Что удаляем

**Frontend:**

- `src/components/gtd/` → переместить в `_archived/gtd/`
- `src/components/tasks/` → `_archived/tasks/`
- `src/components/tasks-masonry/` → `_archived/tasks-masonry/`
- `src/components/tasks-unified/` → `_archived/tasks-unified/`
- `src/components/cockpit/` → `_archived/cockpit/`
- `src/pages/crm/UnifiedTasksPage.tsx` → `_archived/`
- `src/pages/crm/TasksMasonryPage.tsx` → `_archived/`
- `src/pages/crm/UnifiedCockpitPage.tsx` → `_archived/`
- `src/pages/crm/GTDCreatePage.tsx` → `_archived/`
- `src/types/gtd.types.ts` → `_archived/types/`
- `src/types/task.types.ts` → DELETE (dead code)
- `src/api/taskApi.ts` → DELETE (dead code)
- `src/api/aiTaskApi.ts` → DELETE (заменён tasksApi.ts)
- `src/hooks/useGTDTasks.ts`, `useTasksMasonry.ts`, `useAiTask.ts` → `_archived/hooks/`

**Backend:**

- `functions/src/agent/routes/tasks.ts` → DELETE (заменён tasktotime/backend/api/routes.ts)
- `functions/src/agent/schemas/taskSchemas.ts` → DELETE
- `functions/src/callable/ai/generateAiTask.ts`, `modifyAiTask.ts`, `estimateTask.ts` → DELETE
- `functions/src/callable/gtd/moveGtdTask.ts`, `generateDayPlan.ts` → DELETE
- `functions/src/triggers/firestore/onTaskCreate.ts`, `onTaskUpdate.ts` → DELETE (есть в tasktotime/backend/triggers)
- В `functions/src/index.ts` — убрать exports старых функций. Они автоматически undeployed на следующем `firebase deploy --only functions`.

**Firestore:**

- Дать Firestore коллекции `gtd_tasks` ещё пожить **3 месяца** как backup (read-only).
- После 3 месяцев — удалить через admin SDK script `scripts/cleanup-gtd-tasks.ts` (с двойным confirmation от Дениса).
- Удалить indexes `gtd_tasks` из `firestore.indexes.json`
- Удалить rules для `gtd_tasks`, `companies/{cid}/tasks`, `users/{uid}/tasks`, `users/{uid}/gtd_tasks`

### 8.2. Cleanup checklist

- [ ] grep `'gtd_tasks'` в коде — должно остаться 0 occurrences
- [ ] grep `'gtdTasks'` — 0
- [ ] grep `companies/.+/tasks` — 0
- [ ] grep `from '.*gtd.*types'` — 0
- [ ] CLAUDE.md обновить: список «не ломать модули» обновить (gtd → tasktotime)
- [ ] PROJECT_MAP.md обновить: tasks секция → tasktotime
- [ ] DEVELOPER_GUIDE.md обновить
- [ ] Удалить task-related упоминания в `~/projects/pipeline/` старых сессий (по желанию Дениса)

### 8.3. Exit criteria

- ✅ Все greps возвращают 0
- ✅ `npm run build` + `tsc --noEmit` + `oxlint` — green
- ✅ Все тесты проходят
- ✅ Размер bundle уменьшился (старые компоненты GTDBoard 49KB + GTDEditDialog 66KB + GTDSubtasksTable 71KB + UnifiedCockpitPage 104KB + GTDCreatePage 89KB = **379 KB удалено**)

---

## 9. Файлы для обновления (полный список)

### 9.1. Backend

| Файл | Действие |
|---|---|
| `functions/src/agent/routes/tasks.ts` | DELETE (Phase 7) после Phase 6 cutover |
| `functions/src/agent/routes/files.ts:458-481` | UPDATE — `gtd_tasks` → `tasktotime_tasks` |
| `functions/src/agent/routes/timeTracking.ts:97-110, 388-400, 968-975` | UPDATE — task lookup для hourlyRate |
| `functions/src/agent/routes/inventory.ts:707, 767, 1020` | UPDATE — relatedTaskId, materialsUsed |
| `functions/src/agent/routes/projectAutomation.ts:51-100` | UPDATE — generate-tasks-from-estimate |
| `functions/src/agent/routes/projects.ts:172` | UPDATE — project tasks listing |
| `functions/src/agent/routes/estimates.ts:298-352, 412-440` | UPDATE — convert-to-tasks, from-tasks |
| `functions/src/agent/routes/clients.ts:493-504, 677` | UPDATE — merge collections, client detail |
| `functions/src/agent/routes/portal.ts:107` | UPDATE — portal data |
| `functions/src/agent/routes/finance.ts:50, 52` | UPDATE — finance tasks |
| `functions/src/agent/routes/dashboard.ts:28` | UPDATE — dashboard tasks |
| `functions/src/triggers/firestore/onTaskCreate.ts` | DELETE (Phase 7), есть в tasktotime |
| `functions/src/triggers/firestore/onTaskUpdate.ts` | DELETE (Phase 7) |
| `functions/src/triggers/firestore/clientJourneyTriggers.ts:234, 395` | SPLIT — `onWorkSessionCompletedAggregateTask` вынесен в tasktotime; `onProjectCreatedInitAssets` обновлён писать в `tasktotime_tasks` |
| `functions/src/triggers/workSessions/onWorkSessionUpdate.ts:122-191` | UPDATE — AI accuracy log |
| `functions/src/services/TimeTrackingService.ts:167-212` | UPDATE — closeSessionInTx |
| `functions/src/triggers/telegram/handlers/gtdHandler.ts` | UPDATE (Phase 4) |
| `functions/src/triggers/telegram/handlers/inboxHandler.ts` | UPDATE (Phase 4) |
| `functions/src/triggers/telegram/handlers/mediaHandler.ts` | UPDATE (Phase 4 + status fix) |
| `functions/src/scheduled/deadlineReminders.ts` | UPDATE + status reconciliation |
| `functions/src/notifications/alertNotifications.ts:128` | UPDATE — overdue alerts |
| `functions/src/services/clientMetricsService.ts:97` | UPDATE — Client Card V2 metrics |
| `functions/src/callable/ai/*` | DELETE (Phase 7), есть в tasktotime |
| `functions/src/callable/gtd/*` | DELETE (Phase 7) |
| `functions/src/index.ts:619-642` | UPDATE — exports |

### 9.2. Frontend

| Файл | Действие |
|---|---|
| `src/router/AppRouter.tsx:219-238` | UPDATE — добавить tasktotime routes (Phase 3), redirects (Phase 6) |
| `src/hooks/useGTDTasks.ts` | DELETE (Phase 7) |
| `src/hooks/useTasksMasonry.ts` | DELETE (Phase 7) |
| `src/hooks/useAiTask.ts` | DELETE (Phase 7) |
| `src/hooks/useSessionManager.ts:75-101` | UPDATE — pull-to-task aggregation на новую коллекцию |
| `src/hooks/useClientDashboard.ts:437` | UPDATE |
| `src/hooks/dashboard/useDashboardTasks.ts:36` | UPDATE |
| `src/hooks/dashboard/useDashboardActivity.ts:54` | UPDATE |
| `src/components/gtd/*` | ARCHIVE (Phase 7) |
| `src/components/tasks/*` | ARCHIVE |
| `src/components/tasks-masonry/*` | ARCHIVE |
| `src/components/tasks-unified/*` | ARCHIVE |
| `src/components/cockpit/*` | ARCHIVE |
| `src/components/dashboard/widgets/TasksWidget.tsx` | UPDATE — переключить hook |
| `src/components/crm/ClientTasksTab.tsx` | UPDATE |
| `src/components/crm/TaskMaterialsTab.tsx` | UPDATE / merge into tasktotime |
| `src/components/projects/ProjectGanttChart.tsx` | UPDATE — `gtd_tasks` → `tasktotime_tasks` |
| `src/components/admin/OffboardingWizard.tsx:55-443` | UPDATE — task offboarding |
| `src/components/admin/UserSlideOver.tsx:89` | UPDATE |
| `src/components/siteDashboard/useSiteDashboard.ts:77` | UPDATE |
| `src/pages/crm/UnifiedTasksPage.tsx` | ARCHIVE |
| `src/pages/crm/TasksMasonryPage.tsx` | ARCHIVE |
| `src/pages/crm/UnifiedCockpitPage.tsx` | ARCHIVE |
| `src/pages/crm/CalendarPage.tsx` | ARCHIVE (заменён TaskCalendar) |
| `src/pages/crm/GTDCreatePage.tsx` | ARCHIVE |
| `src/api/taskApi.ts` | DELETE — dead code |
| `src/api/aiTaskApi.ts` | DELETE — заменён tasksApi.ts |
| `src/api/estimatesApi.ts:158, 176` | UPDATE — refs to tasks |
| `src/api/userDetailApi.ts:179, 322` | UPDATE |
| `src/api/devlogService.ts:160, 171` | UPDATE |
| `src/types/gtd.types.ts` | ARCHIVE (Phase 7) |
| `src/types/task.types.ts` | DELETE — dead code |
| `src/types/inventory.types.ts:199-216` | KEEP — TaskMaterial остаётся, но imports переключаются |
| `src/types/erp.types.ts:114-144, 309` | UPDATE — PurchaseOrder.taskId, WarrantyTask.taskId references на новый Task type |
| `src/types/rbac.types.ts:22, 137-158` | UPDATE — `'tasks'` entity → `'tasktotime'` или alias |

### 9.3. Firestore config

| Файл | Действие |
|---|---|
| `firestore.rules:108-110` | DELETE — unused users/{uid}/tasks |
| `firestore.rules:117-120` | DELETE — unused users/{uid}/gtd_tasks |
| `firestore.rules:254-256` | DELETE — unused companies/{cid}/tasks |
| `firestore.rules:326-359` | DELETE (Phase 7) — gtd_tasks rules |
| `firestore.rules` (new block) | ADD — tasktotime_tasks rules (Phase 1) |
| `firestore.indexes.json:552-668, 1087-1112` | DELETE (Phase 7) — gtd_tasks indexes |
| `firestore.indexes.json` (new block) | ADD — tasktotime_tasks 11 composite indexes (Phase 1) |

### 9.4. Tests

| Файл | Действие |
|---|---|
| `functions/test/agentApi/tasks.test.ts` | UPDATE / replace по новому API |
| `functions/test/agentApi/phase3.test.ts` | UPDATE refs |
| `functions/test/agentApi/testSetup.ts` | UPDATE refs |
| `functions/test/clientMetricsService.test.ts` | UPDATE refs |
| `functions/test/client-dedup.test.ts` | UPDATE refs |
| `functions/test/rlsCrossTenant.test.ts` | UPDATE — обязательно проходить, проверять company-scoping |
| `functions/test/generateAiTask.integration.test.ts` | REPLACE по новому generateTask |
| `functions/test/scopeMatcher.test.ts` | KEEP — domain-agnostic |
| `src/hooks/__tests__/useGTDTasks.test.ts` | DELETE |
| `firestore.rules.test.ts` | UPDATE — проверять tasktotime_tasks rules |

### 9.5. Документация

| Файл | Действие |
|---|---|
| `CLAUDE.md` | UPDATE §2.2 (не ломать модули): `gtd_tasks` → `tasktotime_tasks`, добавить ссылку на `tasktotime/` |
| `CLAUDE.md` §11 | ADD entry о миграции |
| `PROJECT_MAP.md` | UPDATE — секция Tasks → tasktotime |
| `DEVELOPER_GUIDE.md` | UPDATE references |
| `tasks/INSTRUCTION.md` | DELETE или REDIRECT на `tasktotime/INSTRUCTION.md` |
| `docs/PROJECT_WORKFLOW_SPEC_V1.md` | UPDATE — упоминания gtd-tasks |
| `https://profit-step.web.app/bot-docs/` | UPDATE (через external dev) — `/api/gtd-tasks/*` → `/api/tasktotime/*` |

### 9.6. External

| Файл | Действие |
|---|---|
| External AI bot `@crmapiprofit_bot` | COORDINATE — обновить config внешнего dev'а после Phase 6 |
| Firebase Console | MONITOR — после каждого деплоя 48 часов мониторинг |

---

## 10. Timeline (предварительная)

| Phase | Длительность | Кумулятивно |
|---|---|---|
| Phase 0 — Alignment | 1 день | 1 день |
| Phase 1 — Foundation | 2 дня | 3 дня |
| Phase 2 — Backend | 3-4 дня | 7 дней |
| Phase 3 — Frontend | 5-7 дней | 14 дней |
| Phase 4 — Telegram | 3 дня | 17 дней |
| Phase 5 — Data migration + cutover | 1 день | 18 дней |
| (Soak period) | 14 дней | 32 дня |
| Phase 7 — Cleanup & Archive | 2 дня | 34 дня |
| (gtd_tasks backup TTL) | 90 дней | 124 дня |

**Calendar estimate:** реалистично 5-6 недель active work + 3 месяца до полного выпиливания backup коллекции.

**При параллельной работе через pipeline (Никита/Стёпа):** можно сократить до 3 недель active work — Никита делает backend (Phase 2), Стёпа фронт (Phase 3) параллельно.

---

## 11. Что может пойти не так (risk register)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Telegram bot регрессия после Phase 4 | Medium | High | Тесты на handlers (раньше не было), 48h monitoring, rollback готов |
| `gtd_tasks` data corruption во время migration | Low | Critical | Idempotent script, verify script, gtd_tasks остаётся read-only backup на 3 месяца |
| External AI bot ломается на rename URL | High (если коммуникация плохая) | Medium | Proxy `/api/gtd-tasks/*` → `/api/tasktotime/*` поддерживается, dev предупреждён за 2 недели |
| Cross-tenant RLS leak в новой коллекции | Low | Critical | `rlsCrossTenant.test.ts` обязателен в CI |
| Performance degradation на subscriptions | Medium | Medium | Phase 3 includes performance baseline (1000 tasks < 500ms) |
| Firestore index build блокирует queries | Medium | High | Indexes deployed in Phase 1 (заранее), build time ~30 min для production scale |
| Денис не успевает review PRs из-за параллельной работы | Medium | Medium | Маленькие PRs (по фазам), не более 3 дней в каждом |
| Pre-existing 13 TS errors всплывают при миграции | Low | Low | CLAUDE.md §4: «не игнорируй при правке этих модулей» — фикс по ходу если попадаются |
| Notes ↔ Tasks конверсия становится критичной | Low | Medium | Открытый вопрос §9.1 в TZ — Денис решает |

---

## 12. Что нужно от Дениса перед Phase 1

1. **Прочитать TZ_TASKTOTIME.md** целиком (~30 минут)
2. **Решить открытые вопросы §9 в TZ** (8 пунктов)
3. **Подтвердить timeline** — реалистичный или нужно растянуть
4. **Решить:** один Claude или pipeline (Никита/Стёпа) — для координации
5. **Обозначить cutover окно** — какие выходные подходят для Phase 5

После этого — стартую Phase 1 в новой ветке `feature/tasktotime-foundation` с PR в `main`.
