---
title: "03.2 Transitions — валидные переходы"
section: "03-state-machine"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Transitions — валидные переходы

> Полный список разрешённых переходов между lifecycle states. Все остальные комбинации — error. Каждый transition имеет action name, side effects (что пишется в БД), и triggers (какие notifications/cascades запускаются).

Endpoint: `POST /api/tasktotime/tasks/:id/transition { action: 'start' | 'complete' | ... }`

## Таблица валидных transitions

| From | To | Action | Side effects (writes) | Triggers (cascades) |
|---|---|---|---|---|
| `draft` | `ready` | `ready()` | `lifecycle = 'ready'` | Notification assignee'у через Telegram |
| `ready` | `started` | `start()` | `lifecycle = 'started'`, `actualStartAt = now` | Timer start (если связан), notification reviewer |
| `started` | `blocked` | `block({ reason })` | `lifecycle = 'blocked'`, `blockedReason = reason`, `taskHistory event` | Notification PM, баннер «blocked» в UI |
| `blocked` | `ready` | `unblock()` | `lifecycle = 'ready'`, append `unblock` event in history | Notification assignee «можно продолжать» |
| `started` | `completed` | `complete()` | `lifecycle = 'completed'`, `completedAt = now`, aggregate actuals (`actualDurationMinutes`, `totalEarnings`, `materialsCostActual`) | Cascade: unblock tasks где `dependsOn` includes this; suggest accept в parent если все subtasks completed |
| `completed` | `accepted` | `accept({ acceptance })` | `lifecycle = 'accepted'`, `acceptedAt = now`, `acceptance = { url, signedAt, signedBy, signedByName, notes?, photos? }` (REQUIRED) | Notification PM «акт подписан»; рассчитать bonusOnTime/penaltyOverdue в payroll |
| `*` | `cancelled` | `cancel({ reason? })` | `lifecycle = 'cancelled'`, append `cancel` event with reason | Cascade: unblock tasks где `dependsOn` includes this (с пометкой «cancelled, not completed») |

**Запрещённые переходы** (вернёт 400):
- `draft → started` (нужно сначала `ready`)
- `accepted → started` (после акта — только cancel)
- `accepted → completed` (нельзя «откатить» подпись)
- `completed → started` (нельзя продолжать после завершения)

## Action signatures (REST)

### `ready()`

```http
POST /api/tasktotime/tasks/:id/transition
{ "action": "ready" }
```

Pre-condition: `assignedTo`, `dueAt`, `estimatedDurationMinutes` все заполнены. Иначе 400.

### `start()`

```http
POST /api/tasktotime/tasks/:id/transition
{ "action": "start" }
```

Side effect: `actualStartAt = now`. Эта же задача может быть принят к работе через Telegram bot — там тот же endpoint вызывается.

### `block({ reason })`

```http
POST /api/tasktotime/tasks/:id/transition
{ "action": "block", "reason": "Нет permit, ждём комитет" }
```

Pre-condition: `reason` обязателен (min 5 chars).

### `unblock()`

```http
POST /api/tasktotime/tasks/:id/transition
{ "action": "unblock" }
```

Side effect: append `unblock` event в `history[]`. Возвращает в `ready` (даже если был `started` до block — пусть worker заново начнёт).

### `complete()`

```http
POST /api/tasktotime/tasks/:id/transition
{ "action": "complete" }
```

Side effect: `completedAt = now`, агрегирует actuals из `work_sessions[]`. Триггер `onTaskTransition` пускает cascade unblock зависимых задач.

### `accept({ acceptance })`

```http
POST /api/tasktotime/tasks/:id/transition
{
  "action": "accept",
  "acceptance": {
    "url": "https://...",
    "signedAt": "2026-04-25T...",
    "signedBy": "user-id-or-client-name",
    "signedByName": "Jim Dvorkin",
    "notes": "OK, with minor punch list items",
    "photos": ["https://..."]
  }
}
```

Pre-condition: `acceptance` объект обязателен. Без него — 400. Триггер `onTaskTransition` запускает payroll-расчёт `bonusOnTime` если `completedAt ≤ dueAt`, `penaltyOverdue` иначе.

### `cancel({ reason? })`

```http
POST /api/tasktotime/tasks/:id/transition
{ "action": "cancel", "reason": "Заказчик отменил" }
```

Может быть из любого состояния. Side effect: cascade — задачи которые `dependsOn` cancelled task получают warning баннер «зависимость отменена».

## История transitions

Каждый успешный transition пишется в:

1. **`task.history[]`** — `arrayUnion()` событие `{ type: 'transition', from, to, action, by, at, ...meta }`
2. **`tasktotime_transitions/{id}`** — отдельная коллекция (NEW в v0.2) — append-only audit log для отчётности

Это даёт двойную защиту: audit trail на самой задаче (для UI timeline) + независимый audit log (для аудита и compliance).

## Idempotency

Все transitions защищены `_idempotency/{key}` — если ту же задачу запросили `start` дважды (например, из-за retry в bot), второй вызов вернёт 200 с уже существующим результатом, не дублирует записи.

---

**См. также:**
- [Lifecycle](lifecycle.md) — описание самих состояний
- [Derived states](derived-states.md) — что НЕ является transition (overdue, at-risk)
- [`../05-api/rest-endpoints.md`](../05-api/rest-endpoints.md) — endpoint signatures
- [`../05-api/triggers.md`](../05-api/triggers.md) — onTaskTransition trigger details
