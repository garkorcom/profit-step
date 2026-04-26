# ТЗ: Автономный модуль `tasktotime` — Navigation Index

**Версия:** 0.2 (декомпозирована в [spec/](spec/) на 2026-04-26)
**Статус:** Phase 0 завершена. Phase 1 ждёт решений Дениса по 6 вопросам — см. [NEXT_STEPS.md](NEXT_STEPS.md) §1.

> **Это файл-индекс**, не сам ТЗ. Полное ТЗ разнесено по 71 файлу в [spec/](spec/) для удобной правки. Этот документ — карта где что лежит.
>
> **Архив:** оригинальный монолитный TZ v0.2 (1147 строк) сохранён в git history (commit перед декомпозицией). Если нужен полный текст в одном файле — `git show HEAD~N:tasktotime/TZ_TASKTOTIME.md`.

---

## Навигация

### 📋 Обзор

| Раздел | Файл | Что внутри |
|---|---|---|
| Контекст | [spec/01-overview/context.md](spec/01-overview/context.md) | Зачем модуль, цели |
| Цели | [spec/01-overview/goals.md](spec/01-overview/goals.md) | Почему `tasktotime` а не доработка `gtd_tasks` |
| Анти-паттерны | [spec/01-overview/anti-patterns.md](spec/01-overview/anti-patterns.md) | Что НЕ делаем (5 жёстких ограничений) |
| Глоссарий | [spec/01-overview/glossary.md](spec/01-overview/glossary.md) | Lifecycle / bucket / wiki / rollup / critical path / etc |
| **Архитектурное решение (NEW)** | [spec/01-overview/architecture-decision.md](spec/01-overview/architecture-decision.md) | **Hexagonal модуль, не микросервис. Готов к extract'у через 1-2 дня когда понадобится.** |
| **Hexagonal blueprint (NEW)** | [spec/01-overview/hexagonal-blueprint.md](spec/01-overview/hexagonal-blueprint.md) | **Phase 1 deliverable — 75 файлов: 14 domain + 24 ports + 13 application + 11 shared + 12 tests + 1 ESLint rule** |

### 📦 Доменная модель

| Раздел | Файл | Что внутри |
|---|---|---|
| Task interface | [spec/02-data-model/task-interface.md](spec/02-data-model/task-interface.md) | Полный TypeScript interface со всеми полями |
| Sub-types | [spec/02-data-model/sub-types.md](spec/02-data-model/sub-types.md) | UserRef, Money, TaskDependency, Location, AcceptanceAct, TaskTool, SubtaskRollup, TaskWiki, etc |
| Что выкидываем из GTDTask | [spec/02-data-model/what-changes-from-gtdtask.md](spec/02-data-model/what-changes-from-gtdtask.md) | Дубли, legacy, phantom fields |
| Что остаётся как было | [spec/02-data-model/what-stays.md](spec/02-data-model/what-stays.md) | priority, context, materials links, payments |

### 🔄 State Machine

| Раздел | Файл | Что внутри |
|---|---|---|
| Lifecycle | [spec/03-state-machine/lifecycle.md](spec/03-state-machine/lifecycle.md) | 7 состояний: draft → ready → started → blocked → completed → accepted → cancelled |
| Transitions | [spec/03-state-machine/transitions.md](spec/03-state-machine/transitions.md) | Валидные переходы + что происходит при transition |
| Derived states | [spec/03-state-machine/derived-states.md](spec/03-state-machine/derived-states.md) | is_overdue, is_at_risk, is_active, needs_acceptance |
| Bucket | [spec/03-state-machine/bucket.md](spec/03-state-machine/bucket.md) | inbox/next/someday/archive — independent от lifecycle |

### 💾 Хранилище (Firestore)

| Раздел | Файл | Что внутри |
|---|---|---|
| Коллекции | [spec/04-storage/collections.md](spec/04-storage/collections.md) | tasktotime_tasks, tasktotime_transitions; что НЕ трогаем |
| Indexes | [spec/04-storage/indexes.md](spec/04-storage/indexes.md) | 11 composite indexes с обоснованием |
| Rules | [spec/04-storage/rules.md](spec/04-storage/rules.md) | Company-scoped rules, без public read |
| Migration mapping | [spec/04-storage/migration-mapping.md](spec/04-storage/migration-mapping.md) | gtd_tasks → tasktotime_tasks field mapping для Phase 5 |
| **Data dependencies (NEW)** | [spec/04-storage/data-dependencies.md](spec/04-storage/data-dependencies.md) | **17 read sources + 8 write targets + 5 external channels + risks** |

### 🌐 API

| Раздел | Файл | Что внутри |
|---|---|---|
| REST endpoints | [spec/05-api/rest-endpoints.md](spec/05-api/rest-endpoints.md) | `/api/tasktotime/*` полный список |
| Callables | [spec/05-api/callables.md](spec/05-api/callables.md) | generateTask, confirmTask, modifyTask, estimateTask, decomposeEstimate, generateDayPlan |
| Triggers | [spec/05-api/triggers.md](spec/05-api/triggers.md) | onTaskCreate/Update/Transition + scheduled с idempotency guards |
| Backwards compat | [spec/05-api/backwards-compat.md](spec/05-api/backwards-compat.md) | `/api/gtd-tasks/*` proxy + AI bot coordination |

### 🎨 UI/UX

| Раздел | Файл | Что внутри |
|---|---|---|
| 5 принципов дизайна | [spec/06-ui-ux/principles.md](spec/06-ui-ux/principles.md) | One source of truth, front-load contract, lifecycle as state machine, AI reversible, mobile-first |
| 10 views | [spec/06-ui-ux/views.md](spec/06-ui-ux/views.md) | Board/Tree/Calendar/WhoDoesWhat/Dispatch/Timeline/Graph/Map/Table/MyTasks |
| Заметки про mockup | [spec/06-ui-ux/mockup-notes.md](spec/06-ui-ux/mockup-notes.md) | **Сюда вписываешь feedback после ревью HTML** |
| Mobile thumb zone | [spec/06-ui-ux/mobile-thumb-zone.md](spec/06-ui-ux/mobile-thumb-zone.md) | Bottom 1/3 actions, 44×44 touch targets |
| Анатомия карточки | [spec/06-ui-ux/task-card-anatomy.md](spec/06-ui-ux/task-card-anatomy.md) | Что обязано показывать на task card |

### 🤖 AI

| Раздел | Файл | Что внутри |
|---|---|---|
| Обзор AI flows | [spec/07-ai/integration-overview.md](spec/07-ai/integration-overview.md) | Какие callables, как работают |
| Auto-fill полей | [spec/07-ai/auto-fill.md](spec/07-ai/auto-fill.md) | Voice/email → fields через AI |
| Decompose estimate | [spec/07-ai/decompose-estimate.md](spec/07-ai/decompose-estimate.md) | Estimate → tasks с DAG |
| Auto-shift cascade | [spec/07-ai/auto-shift.md](spec/07-ai/auto-shift.md) | Сдвиг при изменении предшественника |
| Anomaly detection | [spec/07-ai/anomaly-detection.md](spec/07-ai/anomaly-detection.md) | Alert PM при actual ≫ estimated |
| Bonus/Penalty cron | [spec/07-ai/bonus-penalty-cron.md](spec/07-ai/bonus-penalty-cron.md) | Auto-apply в payroll |
| AI safety | [spec/07-ai/ai-safety.md](spec/07-ai/ai-safety.md) | Audit, preview, undo, rate limit |

### 🧱 Крупные модули (v0.2 additions)

#### Иерархия Task → Subtask
- [spec/08-modules/hierarchy/model.md](spec/08-modules/hierarchy/model.md) — 2-level model + почему не глубже
- [spec/08-modules/hierarchy/auto-rollup.md](spec/08-modules/hierarchy/auto-rollup.md) — Linear-style rollup правила
- [spec/08-modules/hierarchy/subtask-rollup-aggregate.md](spec/08-modules/hierarchy/subtask-rollup-aggregate.md) — SubtaskRollup computed
- [spec/08-modules/hierarchy/tree-view-ui.md](spec/08-modules/hierarchy/tree-view-ui.md) — MUI X TreeView
- [spec/08-modules/hierarchy/tree-dnd.md](spec/08-modules/hierarchy/tree-dnd.md) — drag subtask с cycle prevention
- [spec/08-modules/hierarchy/acceptance-criteria.md](spec/08-modules/hierarchy/acceptance-criteria.md) — Phase 3 acceptance

#### Граф зависимостей (DAG)
- [spec/08-modules/graph-dependencies/three-link-types.md](spec/08-modules/graph-dependencies/three-link-types.md) — иерархия / зависимости / cross-reference
- [spec/08-modules/graph-dependencies/task-dependency-interface.md](spec/08-modules/graph-dependencies/task-dependency-interface.md) — TaskDependency + FS/SS/FF/SF
- [spec/08-modules/graph-dependencies/computed-fields.md](spec/08-modules/graph-dependencies/computed-fields.md) — blocksTaskIds, isCriticalPath, slack
- [spec/08-modules/graph-dependencies/auto-shift-cascade.md](spec/08-modules/graph-dependencies/auto-shift-cascade.md) — caсcade implementation
- [spec/08-modules/graph-dependencies/cycle-prevention.md](spec/08-modules/graph-dependencies/cycle-prevention.md) — BFS algorithm
- [spec/08-modules/graph-dependencies/dag-visualization.md](spec/08-modules/graph-dependencies/dag-visualization.md) — Mind Map view (xyflow + dagre)
- [spec/08-modules/graph-dependencies/acceptance-criteria.md](spec/08-modules/graph-dependencies/acceptance-criteria.md)

#### Wiki — память задачи
- [spec/08-modules/wiki/concept.md](spec/08-modules/wiki/concept.md) — wiki как «память задачи»
- [spec/08-modules/wiki/storage.md](spec/08-modules/wiki/storage.md) — embed до 100KB + wiki_history subcollection
- [spec/08-modules/wiki/editor-ui.md](spec/08-modules/wiki/editor-ui.md) — markdown editor, slash-commands, auto-save
- [spec/08-modules/wiki/ai-helper.md](spec/08-modules/wiki/ai-helper.md) — AI «Дополни wiki» / «Wiki из голоса»
- [spec/08-modules/wiki/templates.md](spec/08-modules/wiki/templates.md) — wikiTemplates с placeholders
- [spec/08-modules/wiki/inheritance.md](spec/08-modules/wiki/inheritance.md) — subtask inherits parent context
- [spec/08-modules/wiki/acceptance-criteria.md](spec/08-modules/wiki/acceptance-criteria.md)

#### Wiki Rollup — агрегация из subtasks
- [spec/08-modules/wiki-rollup/concept.md](spec/08-modules/wiki-rollup/concept.md) — on-demand toggle
- [spec/08-modules/wiki-rollup/algorithm.md](spec/08-modules/wiki-rollup/algorithm.md) — buildRolledUpWiki псевдокод
- [spec/08-modules/wiki-rollup/ui.md](spec/08-modules/wiki-rollup/ui.md) — toggle + export buttons (PDF/Word/MD/Акт)
- [spec/08-modules/wiki-rollup/edge-cases.md](spec/08-modules/wiki-rollup/edge-cases.md)
- [spec/08-modules/wiki-rollup/acceptance-criteria.md](spec/08-modules/wiki-rollup/acceptance-criteria.md)

#### Construction Gantt (Procore-style)
- [spec/08-modules/construction-gantt/plan-vs-actual.md](spec/08-modules/construction-gantt/plan-vs-actual.md) — двойные полоски
- [spec/08-modules/construction-gantt/critical-path.md](spec/08-modules/construction-gantt/critical-path.md) — CPM toggle
- [spec/08-modules/construction-gantt/group-by.md](spec/08-modules/construction-gantt/group-by.md) — dropdown вместо swimlanes
- [spec/08-modules/construction-gantt/milestones.md](spec/08-modules/construction-gantt/milestones.md) — diamonds для inspection/permit
- [spec/08-modules/construction-gantt/weather-day.md](spec/08-modules/construction-gantt/weather-day.md) — NOAA + ☂ marker
- [spec/08-modules/construction-gantt/punch-list.md](spec/08-modules/construction-gantt/punch-list.md) — как category, не отдельная коллекция
- [spec/08-modules/construction-gantt/daily-log.md](spec/08-modules/construction-gantt/daily-log.md) — work_sessions integration
- [spec/08-modules/construction-gantt/acceptance-criteria.md](spec/08-modules/construction-gantt/acceptance-criteria.md)

### 📁 Структура папок

[spec/09-folder-structure.md](spec/09-folder-structure.md) — полное дерево `tasktotime/{frontend,backend,shared,tests}/...`

### 🤔 Решения и анти-паттерны

| Раздел | Файл | Что внутри |
|---|---|---|
| 16 открытых вопросов | [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) | **Сюда вписываешь решения** |
| Что не делаем в Phase 1 | [spec/10-decisions/what-not-to-do.md](spec/10-decisions/what-not-to-do.md) | Нет GraphQL / OCC / offline-first / etc |
| Decision log | [spec/10-decisions/decision-log.md](spec/10-decisions/decision-log.md) | Заполняется по мере решений |

### ✅ Метрики успеха

[spec/11-success-metrics.md](spec/11-success-metrics.md) — acceptance criteria по 4 группам.

---

## Где править что

| Хочу изменить... | Открой файл |
|---|---|
| Поля Task interface | [spec/02-data-model/task-interface.md](spec/02-data-model/task-interface.md) |
| Lifecycle states / transitions | [spec/03-state-machine/](spec/03-state-machine/) |
| API endpoints | [spec/05-api/rest-endpoints.md](spec/05-api/rest-endpoints.md) |
| UX правила | [spec/06-ui-ux/principles.md](spec/06-ui-ux/principles.md) |
| Иерархия Task→Subtask | [spec/08-modules/hierarchy/](spec/08-modules/hierarchy/) |
| DAG зависимости | [spec/08-modules/graph-dependencies/](spec/08-modules/graph-dependencies/) |
| Wiki | [spec/08-modules/wiki/](spec/08-modules/wiki/) |
| Wiki Rollup | [spec/08-modules/wiki-rollup/](spec/08-modules/wiki-rollup/) |
| Gantt patterns | [spec/08-modules/construction-gantt/](spec/08-modules/construction-gantt/) |
| Ответы на 16 вопросов | [spec/10-decisions/open-questions.md](spec/10-decisions/open-questions.md) |
| Заметки по mockup | [spec/06-ui-ux/mockup-notes.md](spec/06-ui-ux/mockup-notes.md) |

---

## Changelog

- **v0.2 (2026-04-25 19:10 EDT)** — добавлены: graph dependencies (расширенный `dependsOn` + DAG), 2-level hierarchy (Task → Subtask), tree visualization (MUI TreeView + @xyflow/react), task wiki (markdown editor inline), wiki rollup, construction Gantt patterns. Источник: `docs/RESEARCH_2026-04-25.md`.
- **v0.2 (2026-04-26)** — декомпозиция в 71-файловый [spec/](spec/) для модульной правки.
- **v0.1 (2026-04-25 18:05 EDT)** — первая версия после аудита 3 агентов.
