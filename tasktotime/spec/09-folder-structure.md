---
title: "09 Структура папки `tasktotime/`"
section: "09-folder-structure"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Структура папки `tasktotime/`

> Полная файловая структура нового модуля. Frontend / backend / shared / tests / docs. После полной миграции `tasktotime/` должен быть extractable в отдельный пакет.

ТЗ §3.

## Полное дерево

```
tasktotime/
├── README.md                       ◄── entry point (что читать, в каком порядке)
├── AUDIT_SUMMARY.md                ◄── что было найдено в существующем коде
├── TZ_TASKTOTIME.md                ◄── этот файл (продуктовое ТЗ)
├── MIGRATION_PLAN.md               ◄── phased migration с safety rails
├── INSTRUCTION.md                  ◄── для AI агентов (как у tasks/, crm/)
│
├── docs/
│   ├── DATA_MODEL.md               ◄── deep-dive в Task interface
│   ├── STATE_MACHINE.md            ◄── lifecycle transitions
│   ├── API_CONTRACT.md             ◄── REST + Callable signatures
│   ├── AI_INTEGRATION.md           ◄── как работает AI (estimate / generate / modify)
│   ├── TIME_TRACKING_INTEGRATION.md ◄── связь с work_sessions и payroll
│   └── UX_PRINCIPLES.md            ◄── 5 принципов (см. §6)
│
├── frontend/                       ◄── (Phase 2+) frontend код модуля
│   ├── types/
│   │   ├── Task.ts
│   │   ├── lifecycle.ts
│   │   └── index.ts
│   ├── api/
│   │   └── tasksApi.ts             ◄── единственный entry-point для CRUD
│   ├── hooks/
│   │   ├── useTasks.ts             ◄── single subscription (заменит useGTDTasks + useTasksMasonry)
│   │   ├── useTask.ts              ◄── single-task subscription (заменит useCockpitTask part)
│   │   └── useTaskTransitions.ts   ◄── lifecycle transitions
│   ├── components/
│   │   ├── TaskCard/               ◄── единая карточка (заменит GTDTaskCard + TaskSquare)
│   │   │   ├── TaskCard.tsx
│   │   │   ├── TaskCardCompact.tsx
│   │   │   └── TaskCardFull.tsx
│   │   ├── TaskBoard/              ◄── kanban view
│   │   ├── TaskTimeline/           ◄── timeline view
│   │   ├── TaskCalendar/           ◄── calendar view (один DnD движок!)
│   │   ├── TaskTable/              ◄── table view с inline edit
│   │   ├── TaskMap/                ◄── map view (новый, не stub!)
│   │   ├── TaskTree/               ◄── NEW v0.2 — иерархическое дерево (MUI X TreeView)
│   │   │   ├── TaskTree.tsx        (vertical tree, sidebar в Detail page)
│   │   │   ├── TaskTreeNode.tsx    (узел с lifecycle chip + counters)
│   │   │   └── ProjectTreePage.tsx (tree всех root-tasks проекта)
│   │   ├── TaskGraph/              ◄── NEW v0.2 — DAG (xyflow + dagre)
│   │   │   ├── TaskGraphView.tsx   (Mind Map view-таб)
│   │   │   ├── TaskNode.tsx        (custom xyflow node)
│   │   │   └── DependencyEdge.tsx  (custom edge с типами FS/SS/FF/SF)
│   │   ├── TaskWiki/               ◄── NEW v0.2 — markdown editor
│   │   │   ├── WikiEditor.tsx      (@uiw/react-md-editor based)
│   │   │   ├── WikiViewer.tsx      (rendered markdown)
│   │   │   ├── WikiVersionHistory.tsx
│   │   │   ├── WikiRollupView.tsx  (агрегация из subtasks с export buttons)
│   │   │   ├── WikiTemplates.tsx   (template picker)
│   │   │   └── slashCommands.ts    (/photo, /checklist, /link-task)
│   │   ├── TaskDetail/             ◄── replaces UnifiedCockpitPage
│   │   │   ├── TaskDetail.tsx
│   │   │   ├── sections/
│   │   │   │   ├── WorkSection.tsx     (журнал + таймер)
│   │   │   │   ├── MoneySection.tsx    (estimates + материалы + процентовка)
│   │   │   │   ├── ContextSection.tsx  (история + контакты + чертежи)
│   │   │   │   ├── HierarchySection.tsx ◄── NEW v0.2 (parent + subtasks tree)
│   │   │   │   ├── DependenciesSection.tsx ◄── NEW v0.2 (DAG mini)
│   │   │   │   └── WikiSection.tsx     ◄── NEW v0.2
│   │   ├── TaskQuickAdd/           ◄── единый quick-add (заменит 4 разных!)
│   │   ├── TaskCreateWizard/       ◄── replaces GTDCreatePage (89KB → разбить)
│   │   └── shared/
│   │       ├── TaskStatusBadge.tsx
│   │       ├── TaskPriorityIndicator.tsx
│   │       ├── TaskAcceptanceForm.tsx     ◄── NEW: подписать акт
│   │       ├── TaskDependencyPicker.tsx   ◄── NEW v0.2 (создание dependsOn)
│   │       ├── SubtaskListEditor.tsx      ◄── NEW v0.2 (inline + drag reorder)
│   │       ├── CriticalPathToggle.tsx     ◄── NEW v0.2 (Gantt button)
│   │       ├── GroupByDropdown.tsx        ◄── NEW v0.2 (Gantt/Board)
│   │       ├── PlanVsActualBar.tsx        ◄── NEW v0.2 (Gantt overlay)
│   │       └── WeatherDayMarker.tsx       ◄── NEW v0.2 (Gantt ☂)
│   └── pages/
│       └── TaskToTimePage.tsx       ◄── replaces UnifiedTasksPage
│
├── backend/                         ◄── (Phase 2+) cloud functions модуля
│   ├── api/
│   │   ├── routes.ts                ◄── Express routes (заменит agent/routes/tasks.ts)
│   │   ├── schemas.ts               ◄── Zod schemas (single source)
│   │   └── handlers/
│   │       ├── createTask.ts
│   │       ├── updateTask.ts
│   │       ├── transitionTask.ts    ◄── NEW: state machine endpoint
│   │       ├── batchUpdateTasks.ts
│   │       ├── listTasks.ts
│   │       └── deleteTask.ts
│   ├── triggers/
│   │   ├── onTaskCreate.ts          ◄── notification + audit log + parent.subtaskIds update
│   │   ├── onTaskUpdate.ts          ◄── audit + cascade auto-shift + parent.subtaskRollup recompute
│   │   ├── onTaskTransition.ts      ◄── side effects на смену lifecycle (suggest parent rollup)
│   │   ├── onWorkSessionAggregate.ts ◄── из clientJourneyTriggers (вытащить)
│   │   ├── onWikiUpdate.ts          ◄── NEW v0.2 — version snapshot + parent rollup invalidation
│   │   └── recomputeCriticalPath.ts ◄── NEW v0.2 — pubsub triggered, CPM batch для project
│   ├── ai/
│   │   ├── generateTask.ts          ◄── Claude (из generateAiTask)
│   │   ├── estimateTask.ts          ◄── Gemini (из estimateTask)
│   │   ├── modifyTask.ts            ◄── Claude inline edit (из modifyAiTask)
│   │   └── decomposeEstimate.ts     ◄── Этап 2 SPEC: estimate → tasks
│   ├── scheduled/
│   │   ├── deadlineReminders.ts     ◄── hourly cron
│   │   ├── overdueEscalation.ts     ◄── NEW: penalty/bonus auto-apply
│   │   └── dayPlan.ts               ◄── 7am EST cron
│   └── services/
│       ├── TaskService.ts           ◄── domain logic (transitions, validations)
│       ├── DependencyService.ts     ◄── auto-shift + cycle detection + CPM
│       ├── HierarchyService.ts      ◄── NEW v0.2 — subtask rollup, depth validation
│       ├── WikiService.ts           ◄── NEW v0.2 — markdown handling, version history
│       ├── WikiRollupService.ts     ◄── NEW v0.2 — buildRolledUpWiki + PDF export
│       ├── WeatherService.ts        ◄── NEW v0.2 — NOAA integration (mocked в dev)
│       └── CriticalPathService.ts   ◄── NEW v0.2 — CPM algorithm (forward/backward pass)
│
├── shared/                          ◄── (Phase 1) общие тесты/моки
│   ├── fixtures/
│   ├── mocks/
│   └── test-helpers/
│
└── tests/                           ◄── (Phase 1+) tests модуля
    ├── unit/
    ├── integration/
    └── e2e/
```

## Принцип: всё task-related — внутри `tasktotime/`

После миграции **не должно быть** файлов с словом «task»:
- ❌ `src/components/tasks/`
- ❌ `src/hooks/useGTDTasks.ts`
- ❌ `functions/src/agent/routes/tasks.ts`
- ❌ `functions/src/triggers/clientJourneyTriggers.ts` (части про tasks вытаскиваются)

Всё это переносится в `tasktotime/frontend/`, `tasktotime/backend/`.

Старый код переносится в `_archived/` после успешной миграции.

## Что Phase 1 vs Phase 2+

### Phase 1 (early)
- `README.md`, `AUDIT_SUMMARY.md`, `TZ_TASKTOTIME.md`, `MIGRATION_PLAN.md`
- `docs/` — архитектурные доки
- `shared/` — fixtures и mocks для tests

### Phase 2 (active development)
- `backend/` — Cloud Functions переезжают
- `frontend/types/` + `api/` — типы и API клиент

### Phase 3+ (UI rebuild)
- `frontend/components/` — все UI components
- `frontend/hooks/` — единственные хуки
- `frontend/pages/` — страницы

### Phase 4 (cleanup)
- Old `src/` task code → `_archived/`
- Old triggers wrapping into `tasktotime/backend/triggers/`

### Phase 5 (data migration)
- Migration script `scripts/migrate-gtd-to-tasktotime.ts`
- Cutover в нерабочие часы

### Phase 6 (deprecate proxy)
- Remove `/api/gtd-tasks/*` proxy
- After 7 days zero usage

## extractability в отдельный пакет

После 3+ месяцев стабильности в проде — `tasktotime/` готова к extract:

- ✓ Никаких импортов из `src/components/` за пределами `tasktotime/`
- ✓ Никаких импортов из `functions/src/...` за пределами `tasktotime/backend/`
- ✓ Только impors других domains через explicit `tasksApi.ts` entry point
- ✓ Все dependencies на work_sessions / payroll / clients — через FK (id strings)

Тогда `tasktotime/` → `npm package @profit-step/tasktotime` или separate repo.

См. §8 ТЗ для open questions про extract:
> Не вытаскиваем `tasktotime` в отдельный npm-пакет / репо — **сохраняем in-tree** до полного passage всех тестов на проде (3+ месяца). После — можно extract.

См.: [`10-decisions/what-not-to-do.md`](10-decisions/what-not-to-do.md)

---

**См. также:**
- [`README.md`](README.md) — навигация по spec/
- [`../MIGRATION_PLAN.md`](../MIGRATION_PLAN.md) — phased migration plan
- [`05-api/rest-endpoints.md`](05-api/rest-endpoints.md) — что в backend/api/
- [`05-api/triggers.md`](05-api/triggers.md) — что в backend/triggers/
- [`05-api/callables.md`](05-api/callables.md) — что в backend/ai/
- [`06-ui-ux/views.md`](06-ui-ux/views.md) — что в frontend/components/
- [`10-decisions/what-not-to-do.md`](10-decisions/what-not-to-do.md) — extract decision
