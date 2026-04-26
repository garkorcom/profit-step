---
title: "Spec — Навигация"
section: "root"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# `tasktotime/spec/` — модульная декомпозиция ТЗ

> Это разбивка большого ТЗ `TZ_TASKTOTIME.md` (v0.2, ~1148 строк) на маленькие самодостаточные файлы. Каждый файл можно открыть и редактировать независимо. Кросс-ссылки в footer каждого документа.

**Источник:** `tasktotime/TZ_TASKTOTIME.md` (v0.2, 2026-04-25)
**Принцип:** один файл = одна тема. Никакой суммаризации — полный extract из ТЗ.

---

## Дерево

### `01-overview/` — общий контекст модуля

- [`context.md`](01-overview/context.md) — зачем модуль, цели, scope (§0 ТЗ)
- [`goals.md`](01-overview/goals.md) — почему `tasktotime` а не доработка `gtd_tasks`
- [`anti-patterns.md`](01-overview/anti-patterns.md) — жёсткие архитектурные ограничения (§1.4)
- [`glossary.md`](01-overview/glossary.md) — словарик терминов

### `02-data-model/` — доменная модель Task

- [`task-interface.md`](02-data-model/task-interface.md) — полный TypeScript interface `Task` (§1.1)
- [`sub-types.md`](02-data-model/sub-types.md) — все sub-types (UserRef, Money, TaskDependency, Location, AcceptanceAct, TaskTool, TaskCategory, TaskPhase, SubtaskRollup, TaskWiki, WikiVersion, WikiAttachment)
- [`what-changes-from-gtdtask.md`](02-data-model/what-changes-from-gtdtask.md) — что выкидываем из GTDTask (§1.2)
- [`what-stays.md`](02-data-model/what-stays.md) — что остаётся как было (§1.3)

### `03-state-machine/` — lifecycle

- [`lifecycle.md`](03-state-machine/lifecycle.md) — 7 lifecycle states + ASCII диаграмма (§2.1)
- [`transitions.md`](03-state-machine/transitions.md) — таблица всех валидных переходов
- [`derived-states.md`](03-state-machine/derived-states.md) — computed states: is_overdue, is_at_risk, is_active (§2.2)
- [`bucket.md`](03-state-machine/bucket.md) — organizational bucket (inbox/next/someday/archive) (§2.3)

### `04-storage/` — Firestore schema

- [`collections.md`](04-storage/collections.md) — список коллекций, mapping старая → новая (§4.1)
- [`indexes.md`](04-storage/indexes.md) — 11 composite indexes с обоснованием (§4.2)
- [`rules.md`](04-storage/rules.md) — firestore.rules полный код (§4.3)
- [`migration-mapping.md`](04-storage/migration-mapping.md) — поле gtd_tasks → поле tasktotime_tasks (для Phase 5 миграции)

### `05-api/` — API контракт

- [`rest-endpoints.md`](05-api/rest-endpoints.md) — REST endpoints под `/api/tasktotime/` (§5.1)
- [`callables.md`](05-api/callables.md) — callable functions (§5.2)
- [`triggers.md`](05-api/triggers.md) — Firestore + scheduled triggers с idempotency guards (§5.3)
- [`backwards-compat.md`](05-api/backwards-compat.md) — proxy `/api/gtd-tasks/*` до Phase 6

### `06-ui-ux/` — UX-принципы и views

- [`principles.md`](06-ui-ux/principles.md) — 5 правил для дизайна (§6)
- [`views.md`](06-ui-ux/views.md) — 10 views (Board / Tree / Calendar / WhoDoesWhat / Dispatch / Timeline / Graph / Map / Table / MyTasks)
- [`mockup-notes.md`](06-ui-ux/mockup-notes.md) — пометки про текущий HTML mockup
- [`mobile-thumb-zone.md`](06-ui-ux/mobile-thumb-zone.md) — детально про mobile UX
- [`task-card-anatomy.md`](06-ui-ux/task-card-anatomy.md) — что обязано показывать на карточке задачи

### `07-ai/` — AI-интеграция

- [`integration-overview.md`](07-ai/integration-overview.md) — общий обзор AI flows (§7.1 + §7.2)
- [`auto-fill.md`](07-ai/auto-fill.md) — auto-fill required fields для voice/email tasks
- [`decompose-estimate.md`](07-ai/decompose-estimate.md) — estimate → tasks с DAG зависимостей
- [`auto-shift.md`](07-ai/auto-shift.md) — cascade auto-shift при изменении предшественника
- [`anomaly-detection.md`](07-ai/anomaly-detection.md) — alert PM если actual ≫ estimated
- [`bonus-penalty-cron.md`](07-ai/bonus-penalty-cron.md) — overdueEscalation cron auto-apply bonus/penalty
- [`ai-safety.md`](07-ai/ai-safety.md) — aiAuditLogId, preview/diff, undo snackbar (§7.3)

### `08-modules/` — крупные модули (под-папки)

#### `08-modules/hierarchy/` — Task → Subtask

- [`model.md`](08-modules/hierarchy/model.md) — двухуровневая модель Task → Subtask (§11.1)
- [`auto-rollup.md`](08-modules/hierarchy/auto-rollup.md) — Linear-style auto-rollup статуса parent'а (§11.2)
- [`subtask-rollup-aggregate.md`](08-modules/hierarchy/subtask-rollup-aggregate.md) — SubtaskRollup interface (§11.3)
- [`tree-view-ui.md`](08-modules/hierarchy/tree-view-ui.md) — UI tree view (MUI X TreeView) (§11.4)
- [`tree-dnd.md`](08-modules/hierarchy/tree-dnd.md) — drag subtask между parents (§11.5)
- [`acceptance-criteria.md`](08-modules/hierarchy/acceptance-criteria.md) — acceptance criteria для Phase 3 (§11.6)

#### `08-modules/graph-dependencies/` — DAG

- [`three-link-types.md`](08-modules/graph-dependencies/three-link-types.md) — иерархия / зависимости / cross-reference (§12.1)
- [`task-dependency-interface.md`](08-modules/graph-dependencies/task-dependency-interface.md) — модель TaskDependency + 4 типа FS/SS/FF/SF (§12.2)
- [`computed-fields.md`](08-modules/graph-dependencies/computed-fields.md) — blocksTaskIds / isCriticalPath / slackMinutes (§12.3)
- [`auto-shift-cascade.md`](08-modules/graph-dependencies/auto-shift-cascade.md) — cascade при изменении actualEndAt (§12.4)
- [`cycle-prevention.md`](08-modules/graph-dependencies/cycle-prevention.md) — BFS алгоритм cycle detection (§12.5)
- [`dag-visualization.md`](08-modules/graph-dependencies/dag-visualization.md) — Mind Map view: xyflow + dagre (§12.6)
- [`acceptance-criteria.md`](08-modules/graph-dependencies/acceptance-criteria.md) — acceptance criteria (§12.7)

#### `08-modules/wiki/` — Task Wiki

- [`concept.md`](08-modules/wiki/concept.md) — концепция wiki как «память задачи» (§13.1)
- [`storage.md`](08-modules/wiki/storage.md) — хранение TaskWiki (embed до 100KB) (§13.2)
- [`editor-ui.md`](08-modules/wiki/editor-ui.md) — markdown editor UI (§13.3)
- [`ai-helper.md`](08-modules/wiki/ai-helper.md) — AI-помощник для wiki (§13.4)
- [`templates.md`](08-modules/wiki/templates.md) — wikiTemplates коллекция (§13.5)
- [`inheritance.md`](08-modules/wiki/inheritance.md) — inheritance subtask из parent (§13.6)
- [`acceptance-criteria.md`](08-modules/wiki/acceptance-criteria.md) — acceptance criteria (§13.7)

#### `08-modules/wiki-rollup/` — Wiki Rollup

- [`concept.md`](08-modules/wiki-rollup/concept.md) — концепция on-demand toggle (§14.1)
- [`algorithm.md`](08-modules/wiki-rollup/algorithm.md) — псевдокод buildRolledUpWiki() (§14.2)
- [`ui.md`](08-modules/wiki-rollup/ui.md) — UI toggle и экспорт-кнопки (§14.3)
- [`edge-cases.md`](08-modules/wiki-rollup/edge-cases.md) — edge cases (§14.4)
- [`acceptance-criteria.md`](08-modules/wiki-rollup/acceptance-criteria.md) — acceptance criteria (§14.5)

#### `08-modules/construction-gantt/` — Construction Gantt patterns

- [`plan-vs-actual.md`](08-modules/construction-gantt/plan-vs-actual.md) — двойные полоски (§15.1)
- [`critical-path.md`](08-modules/construction-gantt/critical-path.md) — toggle, не default (§15.2)
- [`group-by.md`](08-modules/construction-gantt/group-by.md) — dropdown вместо swimlanes (§15.3)
- [`milestones.md`](08-modules/construction-gantt/milestones.md) — milestone diamonds (§15.4)
- [`weather-day.md`](08-modules/construction-gantt/weather-day.md) — NOAA integration (§15.5)
- [`punch-list.md`](08-modules/construction-gantt/punch-list.md) — как category, не отдельная коллекция (§15.6)
- [`daily-log.md`](08-modules/construction-gantt/daily-log.md) — интеграция с work_sessions (§15.7)
- [`acceptance-criteria.md`](08-modules/construction-gantt/acceptance-criteria.md) — acceptance criteria (§15.8)

### `09-folder-structure.md` — структура папки `tasktotime/`

- [`09-folder-structure.md`](09-folder-structure.md) — файловая структура frontend/backend/shared/tests/docs (§3)

### `10-decisions/` — открытые вопросы и решения

- [`open-questions.md`](10-decisions/open-questions.md) — все 16 открытых вопросов (§9)
- [`what-not-to-do.md`](10-decisions/what-not-to-do.md) — что НЕ делаем в первой фазе (§8)
- [`decision-log.md`](10-decisions/decision-log.md) — template для будущих решений Дениса

### `11-success-metrics.md` — метрики успеха

- [`11-success-metrics.md`](11-success-metrics.md) — acceptance criteria по 4 группам (§16)

---

## Порядок чтения для нового AI-агента

1. `01-overview/context.md` — что за модуль и зачем
2. `01-overview/anti-patterns.md` — что НЕ делаем
3. `02-data-model/task-interface.md` — главная сущность
4. `03-state-machine/lifecycle.md` — как живёт задача
5. `04-storage/collections.md` — где живёт в Firestore
6. `05-api/rest-endpoints.md` — как обращаться извне
7. Дальше — по конкретной задаче (модуль из `08-modules/`)

---

**См. также:**
- [`../TZ_TASKTOTIME.md`](../TZ_TASKTOTIME.md) — оригинальный полный ТЗ (источник этой декомпозиции)
- [`../MIGRATION_PLAN.md`](../MIGRATION_PLAN.md) — phased migration plan
- [`../INSTRUCTION.md`](../INSTRUCTION.md) — инструкции для AI-агентов
