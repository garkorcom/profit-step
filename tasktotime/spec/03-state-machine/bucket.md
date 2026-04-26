---
title: "03.4 Bucket — organizational tag"
section: "03-state-machine"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Bucket (организационный тег, не lifecycle)

> Поле `task.bucket` — `inbox` / `next` / `someday` / `archive`. Это **GTD-style organizational tag**, независимый от lifecycle. Используется для сортировки задач в pomodoro-style workflow («что делать дальше?»).

## Поле

```typescript
type TaskBucket = 'inbox' | 'next' | 'someday' | 'archive';
```

## Описание состояний

### `inbox`
Необработанные задачи. По умолчанию для AI/voice/email-источников: пришло из голоса в Telegram → попадает в inbox, пока PM не отсортирует.

### `next`
Готовы к работе. PM решил «эта задача — приоритет, делаем». Воркер видит сначала `next` задачи в своём списке.

### `someday`
Отложенные. «Идея, но не сейчас». Может перевестись в `next` через GTD-review.

### `archive`
Soft-deleted. Не показывается в основных views, но не удаляется физически. Ortho к `archivedAt` Timestamp поле — `bucket === 'archive'` означает скрытие, `archivedAt` пишется trigger'ом для аудита.

## Независимость от lifecycle

Bucket **не связан** с lifecycle. Все комбинации валидны:

| Bucket × Lifecycle | Пример use case |
|---|---|
| `inbox + draft` | AI создал draft из голоса, PM ещё не посмотрел |
| `inbox + ready` | Задача готова, но PM ещё не приоритезировал |
| `next + ready` | PM приоритезировал, ждём worker'а |
| `next + started` | Активная работа |
| `next + completed` | Закончили, ждём акта |
| `next + accepted` | Подписали (после короткого времени можно перевести в `archive`) |
| `someday + draft` | Идея «когда-нибудь сделаем bathroom remodel» |
| `someday + ready` | Готовая задача, но не сейчас (отложили на след. месяц) |
| `archive + accepted` | Закрытый, успешно завершённый, в архиве |
| `archive + cancelled` | Отменённый, в архиве |

## UI

В **Board view** колонки могут быть по lifecycle (default) или по bucket (toggle в filter).

В **MyTasks view** worker видит только `bucket === 'next'` (своё «на сегодня»).

В **Inbox view** PM видит только `bucket === 'inbox'` для триажа.

## Принцип: bucket — это про **когда делать**, lifecycle — про **где задача в жизни**

Денис не явно про bucket в требованиях, но GTD-pattern требует разделения «приоритет/планирование» (bucket) от «состояние работы» (lifecycle).

---

**См. также:**
- [Lifecycle](lifecycle.md) — отдельная state machine для состояния работы
- [Derived states](derived-states.md) — ещё одно измерение (computed)
- [`../06-ui-ux/views.md`](../06-ui-ux/views.md) — Inbox / MyTasks views построены вокруг bucket
