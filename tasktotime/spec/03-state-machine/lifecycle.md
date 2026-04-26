---
title: "03.1 Lifecycle — состояния задачи"
section: "03-state-machine"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Lifecycle (state machine)

> 7 состояний жизненного цикла задачи + ASCII диаграмма переходов. Это поле `task.lifecycle`, write-only через transitions endpoint. Денис явно перечислил статусы: «начата, закончена, просрочена, выполнена» — эти слова смешивают **lifecycle state** (стадия жизни задачи) и **derived state** (computed по полям). Здесь — только lifecycle.

## Поле

```typescript
type TaskLifecycle = 'draft' | 'ready' | 'started' | 'blocked' | 'completed' | 'accepted' | 'cancelled';
```

**Write-only через transitions** — нельзя сделать `db.update({ lifecycle: 'started' })` напрямую. Только через `POST /api/tasktotime/tasks/:id/transition { action: 'start' }`.

## ASCII диаграмма

```
                ┌─────────┐
                │  draft  │  (черновик, не показывается воркерам)
                └────┬────┘
                     │ ready()
                ┌────▼────┐
                │  ready  │  (готова к старту, есть assignee + dueAt)
                └────┬────┘
                     │ start()      ◄─── = «начата» (Денис)
                ┌────▼────┐
       ┌────────│ started │────────┐
       │        └────┬────┘        │
   block()           │ complete()  cancel()
       │             │             │
   ┌───▼───┐    ┌────▼─────┐  ┌────▼────┐
   │blocked│    │completed │  │cancelled│  ◄─── = «закончена» (Денис, без акта)
   └───┬───┘    └────┬─────┘  └─────────┘
       │ unblock()   │ accept()
       └────►ready   │
                ┌────▼─────┐
                │ accepted │  ◄─── = «выполнена» (Денис, с актом)
                └──────────┘
```

## Описание состояний

### `draft`
Черновик. Не показывается воркерам — только PM/creator видит. Используется для AI-сгенерированных задач, которые ещё не подтверждены, или для PM черновиков.

### `ready`
Готова к старту. Обязательные поля заполнены: `assignedTo`, `dueAt`, `estimatedDurationMinutes`. Воркер видит её в своём списке.

### `started`
Воркер начал работу. `actualStartAt` установлен. Запущен timer (или ручной маркер «Начать»).

### `blocked`
Что-то мешает продолжить (нет материала, нужен permit, ждём ответа клиента). `blockedReason` обязателен. Можно только `unblock` обратно в `ready`.

### `completed`
Воркер завершил физическую работу. `completedAt` установлен. Но **акт не подписан** — это состояние Денис называет «закончена».

### `accepted`
Клиент подписал акт. `acceptance` объект заполнен (`url`, `signedAt`, `signedBy`, `signedByName`). `acceptedAt` установлен. Это финальное успешное состояние — Денис называет «выполнена».

### `cancelled`
Задача отменена. Может быть из любого состояния. Не считается failure — просто отмена (передумали, перенесли в другой проект).

## Какие состояния НЕ являются lifecycle

Следующие — это **derived states** (computed по полям), а не stored lifecycle:

- **«Просрочена»** = `dueAt < now && lifecycle in ('ready', 'started', 'blocked')` — derived, не отдельное состояние
- **«Под риском»** = `dueAt - now < estimatedDurationMinutes && lifecycle === 'ready'`
- **«Активная»** = `lifecycle === 'started'`
- **«Ждёт акта»** = `lifecycle === 'completed' && acceptance is null`

Подробно: [`derived-states.md`](derived-states.md)

## Какие состояния НЕ являются lifecycle (II)

`bucket` — это **organizational tag**, не lifecycle:

- `inbox` / `next` / `someday` / `archive`

`bucket` независим от `lifecycle`: `inbox + draft`, `next + ready`, `archive + accepted` — все валидные комбинации.

Подробно: [`bucket.md`](bucket.md)

---

**См. также:**
- [Transitions](transitions.md) — таблица всех валидных переходов и actions
- [Derived states](derived-states.md) — computed states (overdue, at-risk, active)
- [Bucket](bucket.md) — organizational bucket независимый от lifecycle
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — где живёт поле `lifecycle`
- [`../05-api/rest-endpoints.md`](../05-api/rest-endpoints.md) — endpoint `POST /api/tasktotime/tasks/:id/transition`
