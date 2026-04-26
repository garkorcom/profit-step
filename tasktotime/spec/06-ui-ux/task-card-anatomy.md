---
title: "06.5 Task card anatomy"
section: "06-ui-ux"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Task Card — anatomy

> Что **обязано** показывать на карточке задачи в каждом view. Принцип front-load contract: первые 200ms взгляда дают title + assignee + dueAt + lifecycle + location. Variants `compact` / `full` / `compact-with-progress` различаются level of detail.

Component: `tasktotime/frontend/components/TaskCard/TaskCard.tsx`

## Variants

```typescript
<TaskCard
  task={task}
  variant="compact" | "full" | "compact-with-progress"
  size="sm" | "md" | "lg"
  inContext="board" | "calendar" | "table" | "portal" | "dashboard"
  onTransition={(action) => ...}
/>
```

## Compact variant (kanban, calendar small cells)

**Обязательно (level 1, < 200ms взгляда):**

```
┌────────────────────────────────────┐
│  [●]  Title task here  [📍 Tampa]  │  ← priority dot, title, location
│       👤 Sergey  ⏰ 2d  [STARTED]   │  ← assignee avatar, due, lifecycle chip
└────────────────────────────────────┘
```

| Элемент | Что показываем | Когда скрываем |
|---|---|---|
| Priority dot | red/yellow/green/gray по priority | никогда |
| Title | task.title (truncate ellipsis если >40 chars) | никогда |
| Location | `📍 ${task.location?.address.shortName}` | если location null |
| Assignee | avatar + name initials | никогда |
| Due | `⏰ ${formatRelativeDue(task.dueAt)}` (e.g. «2d», «overdue 1h») | никогда |
| Lifecycle chip | colored chip (READY / STARTED / etc.) | никогда |

**Также (если применимо):**
- **Derived badges** (overdue / at-risk / needs_acceptance) — справа сверху
- **Materials count** — `🛠 3` если есть материалы
- **Subtask progress** — если parent task: `[==        ] 3/5` (если variant `compact-with-progress`)

## Full variant (Detail page header, large card)

Включает compact + дополнительно:

- **Description** (3 lines max truncate)
- **Project name** + client name
- **Created by + createdAt**
- **Estimated vs actual** mini-bar
- **Acceptance status** (если completed: «Ждёт акта» с кнопкой «Подписать»)
- **Quick actions row:** Start / Pause / Complete / Cancel

## Compact-with-progress variant (parent task в Tree view)

```
┌────────────────────────────────────┐
│  Bathroom remodel — Jim Dvorkin    │
│  👤 Sergey  ⏰ Apr 30  [STARTED]    │
│  Subtasks: 3/5 accepted (60%)      │  ← rollup info
│  [██████░░░░] $4,200 spent          │  ← cost bar
└────────────────────────────────────┘
```

Использует `task.subtaskRollup`:
- `completedFraction` → progress bar
- `countByLifecycle.accepted` / `subtasks.length` → counter
- `totalCostInternal` → spent amount

## Variant по context

| Context | Variant | Why |
|---|---|---|
| Board (kanban) | `compact` | Много задач, минимум место |
| Board (parent task) | `compact-with-progress` | Виден прогресс по subtasks |
| Calendar (small cell) | `compact` (size sm) | Очень мало места |
| Calendar (day view, expanded) | `full` (size md) | Больше места, больше деталей |
| Table | inline (текст в ячейках) | Не отдельная карточка |
| Detail page header | `full` (size lg) | Основная информация |
| Dashboard widget | `compact` (size sm) | Сжатый |
| Client Portal | `compact` (size md) + `clientVisible` filter | Только что клиенту видно |
| MyTasks (mobile) | `compact` (size lg) + big buttons | Easy touch |

## Lifecycle chip colors

| Lifecycle | Color (light) | Color (dark) | Icon |
|---|---|---|---|
| `draft` | gray-400 | gray-600 | 📝 |
| `ready` | blue-500 | blue-300 | ✓ |
| `started` | emerald-500 | emerald-300 | ▶ (pulsing) |
| `blocked` | amber-500 | amber-300 | ⏸ |
| `completed` | indigo-500 | indigo-300 | ⬛ |
| `accepted` | green-700 | green-400 | ✅ |
| `cancelled` | gray-300 | gray-700 | ✗ |

## Derived badges (overlap lifecycle)

Размещаются как **дополнение** к lifecycle chip, не вместо:

```
┌────────────────────────────────────┐
│  Title  [STARTED] [⚠ OVERDUE]      │  ← lifecycle + derived
└────────────────────────────────────┘
```

| Badge | Color | When |
|---|---|---|
| Overdue | red-500 | `is_overdue === true` |
| At risk | amber-400 | `is_at_risk === true` |
| Needs estimate | gray-400 | `needs_estimate === true` |
| Needs acceptance | sky-500 | `needs_acceptance === true` |

См.: [`../03-state-machine/derived-states.md`](../03-state-machine/derived-states.md)

## Avatar handling

- **1 assignee:** круглый avatar 24×24
- **assignedTo + 1-2 coAssignees:** stacked avatars (overlapping)
- **assignedTo + 3+ coAssignees:** stacked + counter «+3»
- **No avatar (deleted user / unassigned):** placeholder grey circle с «?»

## Hover / click behavior

- **Hover:** subtle scale 1.02 + shadow увеличивается. Tooltip с full title если truncated.
- **Click:** opens **Drawer** (sliding in from right) с Detail page summary. Click again or backdrop → close.
- **Long-click (mobile):** opens quick actions menu

## Accessibility

- Card как `<article>` element
- Title как `<h3>`
- Lifecycle chip как `<span role="status">`
- Avatar `alt={assignee.name}`
- Color НЕ единственный signal — иконки + text labels тоже

---

**См. также:**
- [Principles](principles.md) — front-load contract (правило #2)
- [Views](views.md) — где какой variant используется
- [Mobile thumb zone](mobile-thumb-zone.md) — sizing для touch
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — какие поля используются на карточке
- [`../03-state-machine/derived-states.md`](../03-state-machine/derived-states.md) — derived badges
- [`../08-modules/hierarchy/subtask-rollup-aggregate.md`](../08-modules/hierarchy/subtask-rollup-aggregate.md) — данные для compact-with-progress
