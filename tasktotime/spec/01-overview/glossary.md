---
title: "01.4 Глоссарий"
section: "01-overview"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Глоссарий терминов

> Короткие определения ключевых терминов, которые встречаются по всему ТЗ. Если встретил незнакомый термин — сначала сюда.

## Lifecycle (жизненный цикл)

State machine задачи: `draft → ready → started → completed → accepted` (с branches `blocked`, `cancelled`). Это **stored поле** `task.lifecycle`. Изменяется ТОЛЬКО через transitions endpoint, не напрямую.

См.: [`../03-state-machine/lifecycle.md`](../03-state-machine/lifecycle.md)

## Bucket (организационный карман)

Поле `task.bucket`: `inbox` / `next` / `someday` / `archive`. **Независим от lifecycle** — для GTD-style сортировки. Например, `inbox + draft` или `next + ready`.

См.: [`../03-state-machine/bucket.md`](../03-state-machine/bucket.md)

## Parent (родительская задача)

Task верхнего уровня, которая может содержать subtasks. Имеет собственный lifecycle, cost, acceptance, wiki.

## Subtask (подзадача)

`Task { isSubtask: true, parentTaskId: 'parent-id' }`. **Не может иметь свои sub-subtasks** (2-уровневое ограничение). Глубже — это уже отдельная задача с `linkedTaskIds`.

См.: [`../08-modules/hierarchy/model.md`](../08-modules/hierarchy/model.md)

## Dependency (зависимость)

Связь между задачами через `dependsOn[]`: `Task A` не может стартовать пока `Task B` не закончен. 4 типа: FS / SS / FF / SF (PMI стандарт). В отличие от иерархии — рисуется как **DAG** (стрелки).

См.: [`../08-modules/graph-dependencies/three-link-types.md`](../08-modules/graph-dependencies/three-link-types.md)

## Rollup (агрегация)

Computed агрегат subtasks на parent. Поле `parent.subtaskRollup` содержит:

- `countByLifecycle` — { ready: 3, started: 1, completed: 2 }
- `totalCostInternal`, `totalPriceClient`
- `totalEstimatedMinutes`, `totalActualMinutes`
- `completedFraction` (0..1)
- `earliestDueAt` — реальный дедлайн parent'а

Пересчитывается триггером `onTaskUpdate` атомарно.

См.: [`../08-modules/hierarchy/subtask-rollup-aggregate.md`](../08-modules/hierarchy/subtask-rollup-aggregate.md)

## Wiki

Markdown-страница привязанная к задаче (`task.wiki.contentMd`). Это **долгосрочная память задачи** — контекст, decisions, gotchas, photos, ссылки на permits.

См.: [`../08-modules/wiki/concept.md`](../08-modules/wiki/concept.md)

## Wiki Rollup (агрегированный wiki)

**On-demand toggle** — собрать wiki всех subtasks в один документ. Не stored, рендерится по требованию. Используется для финальных отчётов, актов выполнения, hand-off документов.

См.: [`../08-modules/wiki-rollup/concept.md`](../08-modules/wiki-rollup/concept.md)

## Acceptance (акт)

`task.acceptance` — подписанный клиентом акт выполнения работ. Содержит: `url` (PDF), `signedAt`, `signedBy`, `signedByName`, `notes`, `photos[]`. **Без acceptance задача в lifecycle = `completed`, с acceptance — `accepted`.**

## Punch list

«Мелкие правки в конце проекта». **Не отдельная коллекция**, а просто `Task { category: 'punch', phase: 'closeout' }`. В Gantt отображаются compact-режимом в bottom row проекта.

См.: [`../08-modules/construction-gantt/punch-list.md`](../08-modules/construction-gantt/punch-list.md)

## Critical Path (критический путь)

CPM (Critical Path Method) — цепочка задач которые блокируют общий срок проекта. Если критическая задача задерживается — задерживается весь проект. Поле `task.isCriticalPath: boolean` пересчитывается trigger'ом.

См.: [`../08-modules/construction-gantt/critical-path.md`](../08-modules/construction-gantt/critical-path.md)

## Slack (запас по времени)

`task.slackMinutes` — float: на сколько минут можно опоздать без сдвига critical path. `slack === 0` = critical task.

## Swimlane vs Group-by

- **Swimlane** — традиционная Kanban-практика: отдельная горизонтальная дорожка в визуализации для каждого assignee / phase. **Анти-паттерн в construction Gantt** — плодит дубли табов.
- **Group-by** — dropdown в одной view, который меняет группировку строк (`none / project / room / crew / executor / phase / category`). **Наш выбор.**

См.: [`../08-modules/construction-gantt/group-by.md`](../08-modules/construction-gantt/group-by.md)

## DAG (Directed Acyclic Graph)

Ориентированный граф без циклов. Используется для визуализации зависимостей задач. Реализуется через `@xyflow/react` + dagre auto-layout.

См.: [`../08-modules/graph-dependencies/dag-visualization.md`](../08-modules/graph-dependencies/dag-visualization.md)

## Auto-shift cascade

Каскадный пересчёт `plannedStartAt` для всех зависимых задач когда предшественник закончился позже плана. С rate limit max 3 levels в одной транзакции (защита от bomb).

См.: [`../08-modules/graph-dependencies/auto-shift-cascade.md`](../08-modules/graph-dependencies/auto-shift-cascade.md)

## Idempotency guard

Защита от повторной обработки одного и того же события в Cloud Functions. Реализуется через `processedEvents/{eventId}` коллекцию или `before === after` early return. Критично для предотвращения infinite loops (см. CLAUDE.md §2.1).

## RLS (Row-Level Security)

Company-scoping в Firestore: пользователь видит только документы где `resource.data.companyId == userCompanyId()`. Текущий `gtd_tasks` без company-scoping — security hole, который мы исправляем в `tasktotime`.

См.: [`../04-storage/rules.md`](../04-storage/rules.md)

---

**См. также:**
- [Контекст модуля](context.md)
- [Анти-паттерны](anti-patterns.md)
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — где встречается большинство этих терминов
