---
title: "06.2 Views (10 видов)"
section: "06-ui-ux"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Views — 10 видов модуля

> Список всех views в `tasktotime`. Каждый view = отдельная компонента в `tasktotime/frontend/components/`. Все используют один `useTasks()` хук + одну `<TaskCard>`. Различаются projection / layout / interactivity.

URL pattern: `/tasktotime?view={viewName}`

## Полный список

| # | View | URL | Use case | Для какой роли |
|---|---|---|---|---|
| 1 | **Board** | `?view=board` | Kanban — drag-drop по lifecycle колонкам | PM, worker, reviewer |
| 2 | **Tree** | `?view=tree` | Иерархическое дерево (parent → subtasks) | PM (project view) |
| 3 | **Calendar** | `?view=calendar` | Day/week/month view с DnD | PM, worker (планирование) |
| 4 | **WhoDoesWhat** | `?view=whodoeswhat` | Group by assignee — кто что делает сегодня | PM (брифинг) |
| 5 | **Dispatch** | `?view=dispatch` | Mobile-optimized — для бригадира на объекте | Brigadier (mobile-first) |
| 6 | **Timeline (Gantt)** | `?view=timeline` | Construction Gantt с plan-vs-actual, critical path | PM, client (с visibility=true) |
| 7 | **Graph (Mind Map)** | `?view=graph` | DAG зависимостей через xyflow | PM (планирование зависимостей) |
| 8 | **Map** | `?view=map` | Geographic view — задачи на карте | PM (route planning), worker (маршрут на день) |
| 9 | **Table** | `?view=table` | Inline edit, sortable columns | PM (bulk operations) |
| 10 | **MyTasks** | `?view=mytasks` | Только свои `assignedTo === me` | Worker (default landing) |

## View deep-dive

### Board (kanban)

**Component:** `tasktotime/frontend/components/TaskBoard/`

- Колонки по `lifecycle` (default) или `bucket` (toggle)
- Drag card между колонками = `transition` action
- Filters: assignee, project, client, priority, derived states
- Group-by dropdown (см. [`../08-modules/construction-gantt/group-by.md`](../08-modules/construction-gantt/group-by.md))

### Tree (иерархия)

**Component:** `tasktotime/frontend/components/TaskTree/`

- MUI X TreeView — vertical expand/collapse
- Parent → subtasks с lifecycle chip + counter
- Drag subtask между parent'ами (см. [`../08-modules/hierarchy/tree-dnd.md`](../08-modules/hierarchy/tree-dnd.md))
- Используется также в Detail page sidebar

См. подробно: [`../08-modules/hierarchy/tree-view-ui.md`](../08-modules/hierarchy/tree-view-ui.md)

### Calendar

**Component:** `tasktotime/frontend/components/TaskCalendar/`

- Day / week / month переключатель
- DnD reschedule — drag task на новый день = update `plannedStartAt` + `dueAt`
- **Один DnD движок** (НЕ копировать из старого календаря с разным DnD)

### WhoDoesWhat

**Component:** `tasktotime/frontend/components/WhoDoesWhat/`

- Group by assignee
- Avatars + список задач каждого
- Inline conflict detection: «У Серёжи 3 задачи на сегодня — total 12h, рабочий день 8h»

### Dispatch

**Component:** `tasktotime/frontend/components/TaskDispatch/`

- Mobile-first
- Большие touch targets
- Sticky timer внизу
- Quick actions: start/pause/complete

### Timeline (Construction Gantt)

**Component:** `tasktotime/frontend/components/TaskTimeline/`

Все features из §15 ТЗ:
- Plan vs Actual overlay (см. [`../08-modules/construction-gantt/plan-vs-actual.md`](../08-modules/construction-gantt/plan-vs-actual.md))
- Critical Path toggle (см. [`../08-modules/construction-gantt/critical-path.md`](../08-modules/construction-gantt/critical-path.md))
- Group-by dropdown (см. [`../08-modules/construction-gantt/group-by.md`](../08-modules/construction-gantt/group-by.md))
- Milestone diamonds (см. [`../08-modules/construction-gantt/milestones.md`](../08-modules/construction-gantt/milestones.md))
- Weather day overlay (см. [`../08-modules/construction-gantt/weather-day.md`](../08-modules/construction-gantt/weather-day.md))
- Punch list compact (см. [`../08-modules/construction-gantt/punch-list.md`](../08-modules/construction-gantt/punch-list.md))
- Daily Log dot (см. [`../08-modules/construction-gantt/daily-log.md`](../08-modules/construction-gantt/daily-log.md))

### Graph (Mind Map)

**Component:** `tasktotime/frontend/components/TaskGraph/`

DAG визуализация через `@xyflow/react` + dagre auto-layout. Подробно: [`../08-modules/graph-dependencies/dag-visualization.md`](../08-modules/graph-dependencies/dag-visualization.md)

### Map

**Component:** `tasktotime/frontend/components/TaskMap/`

- Geographic view используя `task.location.lat/lng`
- Кластеризация если много задач на одной точке
- Marker color = lifecycle
- Click marker → opens task drawer
- **НЕ stub** (как в существующем коде, который ничего не показывает)

### Table

**Component:** `tasktotime/frontend/components/TaskTable/`

- Inline edit ячейки
- Sortable columns
- Multi-select для bulk operations (`POST /api/tasktotime/tasks/batch`)
- CSV export
- Filters в header

### MyTasks

**Component:** `tasktotime/frontend/components/MyTasksView/`

- Filter `assignedTo.id === currentUser.uid` принудительный
- Default landing для voucher worker
- Group by `bucket` (Inbox / Next / Today / Someday)
- Big buttons «Начать» / «Pause» / «Закончить» для primary actions

## Coverage matrix (use case × view)

| Use case | Best view |
|---|---|
| «Что мне делать сейчас?» | MyTasks |
| «Кто что делает сегодня?» | WhoDoesWhat |
| «Передвинуть задачу на следующую неделю» | Calendar |
| «Декомпозировать estimate в tasks» | Tree |
| «Понять что блокирует проект» | Graph (DAG) |
| «Маршрут на сегодня для бригадира» | Map |
| «Bulk update приоритета 20 задачам» | Table |
| «Подписать акт» | Detail page (drilldown из любого view) |
| «План-факт по проекту для клиента» | Timeline (Gantt) |
| «Triage inbox задач» | Board (filter bucket=inbox) |

## URL state

URL params для shareability:
```
/tasktotime?view=board&filter[lifecycle]=ready,started&filter[assignee]=user-id&groupBy=phase
```

При смене view — фильтры по возможности сохраняются (если применимы).

---

**См. также:**
- [Principles](principles.md) — каждый view следует 5 правилам
- [Mobile thumb zone](mobile-thumb-zone.md) — Dispatch и MyTasks особенно
- [Task card anatomy](task-card-anatomy.md) — что показывает карточка в каждом view
- [Mockup notes](mockup-notes.md) — реальный mockup с примерами views
- [`../08-modules/`](../08-modules/) — крупные модули (graph, hierarchy, gantt, wiki) определяют детали соответствующих views
