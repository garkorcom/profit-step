# Категория: TaskToTime (Задачи + Время)

## Назначение
Автономный модуль управления задачами для конструкшн-бизнеса. Заменяет старый `gtd_tasks` модуль (`src/components/gtd/`, `Cockpit`, `UnifiedTasksPage`) на полноценную производственную единицу со всеми атрибутами: время / деньги / материалы / инструменты / контакты / адрес / акт выполнения / lifecycle state machine / 2-level subtasks / DAG dependencies / wiki память.

Архитектура — **Hexagonal Architecture** (см. `spec/01-overview/architecture-decision.md`):
- `domain/` — pure TypeScript, ZERO Firebase/MUI
- `ports/` — 21 интерфейс для I/O
- `adapters/` — реализации (firestore, http, telegram, email, push, bigquery, storage, noaa)
- `ui/` — React, depends on domain only

## Как работать (Сценарии пользователя)
- **Board (Kanban)** — Денис/PM видит все задачи по lifecycle колонкам (Inbox / Ready / Started / Blocked / Completed / Accepted)
- **Tree** — иерархическое дерево root tasks → subtasks (2 уровня)
- **Calendar** — задачи на сетке дней с DnD reschedule
- **Live Ops** — live view «кто что делает сейчас» по людям
- **Dispatch Board** — PM tool «кто раздаёт какую задачу» (pool unassigned + crew с workload)
- **Timeline (Gantt)** — Plan vs Actual двойные полоски, critical path, dependencies
- **Graph (DAG)** — Mind Map зависимостей, xyflow + dagre
- **Map** — пины задач на карте Tampa
- **Table** — все поля + filters + bulk ops
- **My Tasks** — mobile-first для воркера со swipe + start timer
- **Detail Drawer** — 4 секции (Работа / Деньги / Контекст / Wiki) + lifecycle transitions + acceptance act sign

## Основные Связи (Отношения с другими модулями)
- **TaskToTime ↔ Time Tracking**: `work_sessions.relatedTaskId` агрегируется в `Task.actualDurationMinutes` через trigger `onWorkSessionCompleted`
- **TaskToTime ↔ Payroll**: `Task.bonusOnTime` / `Task.penaltyOverdue` создают `salary_adjustments` через cron `overdueEscalation`
- **TaskToTime ↔ Inventory**: `Task.materials[]` (TaskMaterial) ссылается на `inventory_catalog`, write-off через `inventory_transactions.relatedTaskId`
- **TaskToTime ↔ Estimates**: `Task.sourceEstimateId` + callable `decomposeEstimate` создаёт subtasks из estimate items
- **TaskToTime ↔ Clients/Projects**: `Task.clientId / projectId` денормализация (`clientName`, `projectName`)
- **TaskToTime ↔ Telegram**: bot `/task`, `/tasks`, `/plan`, voice→tasks через `gtdHandler.ts`
- **TaskToTime ↔ AI**: callables `generateTask` (Claude), `estimateTask` (Gemini), `modifyTask`, `decomposeEstimate` — все логируют в `aiAuditLogs`
- **TaskToTime ↔ Files**: `Task.attachments[]`, `Task.wiki.attachments[]`, `Task.acceptance.url` через `files/{id}.linkedTo.taskId`

Полный inventory — `spec/04-storage/data-dependencies.md` (17 read sources, 8 write targets, 5 external channels).

## Как это устроено (Для разработчика)
- **Коллекции Firestore**: 
  - `tasktotime_tasks/{taskId}` — главная (заменяет `gtd_tasks`)
  - `tasktotime_transitions/{transitionId}` — append-only audit log lifecycle переходов
  - `processedEvents/{eventId}` — idempotency markers для triggers (TTL 5 min)
- **Файлы/Компоненты**: всё под `tasktotime/`. Никаких task-related файлов в `src/components/`, `src/hooks/`, `functions/src/agent/routes/` после Phase 7 cleanup.
- **State machine**: lifecycle `draft → ready → started → {blocked, completed} → accepted` с правилами переходов в `domain/lifecycle.ts`. Только через `POST /api/tasktotime/tasks/:id/transition` или `useTaskTransitions` hook.
- **Hexagonal constraint**: `domain/` НЕ импортирует Firebase/MUI/NestJS. ESLint правило в CI.
- **Idempotency**: каждый trigger должен иметь guard через `processedEvents` collection ИЛИ field-change check ИЛИ `metricsProcessedAt` marker (CLAUDE.md §2.1 — billing bomb $10k+ risk).
- **Архитектура**: 
  - One source of truth — `useTasks()` hook (НЕ дублировать subscription как было в `useGTDTasks` + `useTasksMasonry`)
  - Один `<TaskCard variant="...">` для всех views
  - Status enum в одном месте — `shared/lifecycle.ts`

## Что посмотреть на GitHub или в Документации
- **`tasktotime/README.md`** — entry point + reading order
- **`tasktotime/AGENT_PLAN.md`** — план имплементации по 6 шагам с агентами
- **`tasktotime/TZ_TASKTOTIME.md`** — navigation index в spec/
- **`tasktotime/spec/`** — 73+ модульных файла спецификации
- **`tasktotime/mockup/index.html`** — визуальный prototype, 10 views + Drawer
- **`tasktotime/MIGRATION_PLAN.md`** — 7-фазный план миграции с safety rails
- **`tasktotime/AUDIT_SUMMARY.md`** — что нашли в текущем gtd_tasks при аудите

## Что НЕ делать
- Не возвращаться к старому `gtd_tasks` модулю (он в `_archived/` после Phase 7)
- Не плодить parallel hooks `useTaskBoard / useTaskTree / etc` — один `useTasks()` с projections
- Не дублировать `STATUS_OPTIONS` — он в одном месте, `shared/lifecycle.ts`
- Не делать subtasks глубже 2 уровней (anti-pattern ClickUp 7-level)
- Не impлементировать silent auto-rollup wiki (только on-demand toggle)
- Не auto-shift dependent tasks без подтверждения на weather days
- Не таскать >1 graph viz lib (xyflow + dagre OK; Cytoscape/D3-tree/GoJS — нет)
- Не использовать public read в Firestore rules (повторяет баг `gtd_tasks:343`)
