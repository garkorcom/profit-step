---
title: "03.3 Derived states (computed)"
section: "03-state-machine"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Derived states (computed, не stored)

> «Просрочена», «под риском», «активная», «ждёт акта» — это **не stored states**, а computed по другим полям. Денис в требованиях смешивал их с lifecycle states; здесь явно разделяем. UI должен показывать как badges поверх lifecycle chip.

## Computed states

### `is_overdue` — Просрочена

```typescript
is_overdue = dueAt < now && lifecycle in ('ready', 'started', 'blocked')
```

**Семантика:** дедлайн прошёл, а задача не закончена. Это **derived** — мы НЕ пишем `lifecycle = 'overdue'`, она остаётся в `ready/started/blocked`.

**Денис в ТЗ:** = «просрочена»

### `is_at_risk` — Под риском

```typescript
is_at_risk = (dueAt - now < estimatedDurationMinutes) && lifecycle === 'ready'
```

**Семантика:** до дедлайна осталось меньше времени, чем требуется на выполнение, а задача ещё не начата. Сигнал PM «срочно стартовать или сдвинуть».

### `is_active` — Активная

```typescript
is_active = lifecycle === 'started'
```

**Семантика:** прямо сейчас в работе. Простой alias на `lifecycle === 'started'` — но в UI показывается как pulse-эффект.

### `needs_estimate` — Нужна оценка

```typescript
needs_estimate = (estimatedDurationMinutes is missing) || (estimateConfidence < threshold)
```

**Семантика:** AI-suggested оценка либо отсутствует, либо низкая уверенность. Сигнал назначить кого-то опытного для ручной оценки.

### `needs_acceptance` — Ждёт акта

```typescript
needs_acceptance = lifecycle === 'completed' && acceptance is null
```

**Семантика:** воркер закончил, но клиент ещё не подписал. Висит в `completed` без перехода в `accepted`. Сигнал PM напомнить клиенту.

## UI: badges поверх lifecycle chip

| Derived state | Badge color | Label | Effect |
|---|---|---|---|
| `is_overdue` | red (rose-500) | «Просрочена» | Красная рамка карточки + chip |
| `is_at_risk` | yellow (amber-400) | «Под риском» | Жёлтая рамка |
| `is_active` | green (emerald-500) | «Активная» | Pulsing dot, не статичный chip |
| `needs_estimate` | gray (slate-400) | «Нужна оценка» | Inline action button «AI estimate» |
| `needs_acceptance` | blue (sky-500) | «Ждёт акта» | Inline action button «Подписать» |

**Принцип:** lifecycle chip всегда показывает базовое состояние (`ready`, `started`, etc.). Derived badges накладываются сверху как **дополнительная информация**, не подменяют.

## Почему НЕ хранить как stored

1. **Расчёт зависит от текущего времени** (`now`) — stored поле станет stale через секунду.
2. **Нет write-side эффектов** — никаких triggers/notifications не нужно при изменении.
3. **Storage cost** — это derived, не нужно занимать место в Firestore docs.
4. **Меньше места для багов** — нет риска что stored поле «застрянет» в неактуальном значении.

Cron `deadlineReminders` (см. [`../05-api/triggers.md`](../05-api/triggers.md)) каждый час сканирует задачи и отправляет push-уведомления для `is_overdue` и `is_at_risk` — но **не пишет** эти состояния в БД.

## Как фильтровать в queries

Поскольку это computed — в Firestore queries напрямую нельзя использовать. Workaround:

- **Server-side в API:** endpoint `GET /api/tasktotime/tasks?filter=overdue` фильтрует на сервере после fetch
- **Client-side в hooks:** `useTasks({ derived: ['is_overdue'] })` фильтрует в memory после subscription
- **Indexed fallback:** для частых queries «overdue» можно сделать composite index на `companyId + lifecycle + dueAt` и query `lifecycle in [ready, started, blocked] && dueAt < now`

---

**См. также:**
- [Lifecycle](lifecycle.md) — stored states которые показываются как chip
- [Transitions](transitions.md) — как меняется lifecycle (derived states при этом тоже могут поменяться)
- [Bucket](bucket.md) — ещё один организационный stored field
- [`../06-ui-ux/task-card-anatomy.md`](../06-ui-ux/task-card-anatomy.md) — как badges рендерятся на карточке
- [`../05-api/triggers.md`](../05-api/triggers.md) — `deadlineReminders` cron
