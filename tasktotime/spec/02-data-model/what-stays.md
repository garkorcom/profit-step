---
title: "02.4 Что остаётся как было"
section: "02-data-model"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Что остаётся как было

> Поля и подсистемы, которые мы переносим из `GTDTask` в `Task` без изменений. Это упрощает миграцию и сохраняет совместимость с уже работающими интеграциями.

## Сохраняемые поля и подсистемы

### `priority` (4 уровня)

```typescript
type Priority = 'critical' | 'high' | 'medium' | 'low';
```

**Почему оставляем:** работающая GTD-семантика, все интеграции (filters, sorting, telegram bot) построены на ней.

### `context` (@home/@office/@calls)

GTD-style контексты — оставить для старых клиентов, которые привыкли. Новые клиенты могут игнорировать (default `null`).

**Почему оставляем:** backwards compat. Удаление сломает workflow существующих юзеров.

### `materials[]` и связь с inventory

```typescript
materials?: TaskMaterial[];
```

Связь с inventory transactions через `relatedTaskId` стринг-FK **не меняется**. `TaskMaterial` тип остаётся как есть в `src/types/inventory.types.ts`.

**Почему оставляем:** inventory module — отдельная подсистема со своими triggers и audit log. Менять FK = breaking change в inventory.

### `payments[]`, `budgetCategory`

```typescript
payments?: Payment[];
budgetCategory?: string;
```

Платёжная информация, привязанная к задаче. Используется в payroll и финансовом dashboard.

**Почему оставляем:** payroll module коннектится через эти поля. Менять = breaking change в payroll.

### AI audit (`aiAuditLogId`)

```typescript
aiAuditLogId?: string;
```

Ссылка на запись в коллекции `aiAuditLogs/{id}` — где AI-операции логируются.

**Почему оставляем:** aiAuditLogs — общая коллекция для всех AI-flows проекта (не только tasks). Не трогаем (см. CLAUDE.md §2.1).

### `taskHistory[]` events

```typescript
history: TaskHistoryEvent[];
```

Append-only лог событий: создание, transitions, AI-вмешательства, dependency shifts. Пишется через `arrayUnion()` в triggers.

**Почему оставляем:** уже работающий audit trail. Юзеры привыкли видеть timeline. Меняем только переименование `taskHistory` → `history` для краткости.

## Принцип «не трогаем»

Соседние коллекции, которые **остаются как есть**:

| Коллекция | Что |
|---|---|
| `work_sessions/{id}` | Сессии time-tracking. Task только ссылается через `relatedTaskId`. |
| `aiAuditLogs/{id}` | AI операции логирование. Task ссылается через `aiAuditLogId`. |
| `_idempotency/{key}` | Idempotency markers для cross-trigger guards. Не трогаем. |
| `notes/{id}` | Notes — отдельная подсистема (qualityLoop / financials / controllerId). См. open question #1. |
| `inventory_transactions/{id}` | Inventory ops. Task → material через `relatedTaskId`. |
| `clients/{id}` | Клиенты. Task ссылается через `clientId` + denormalized `clientName`. |
| `projects/{id}` | Проекты. Task ссылается через `projectId` + denormalized `projectName`. |
| `users/{uid}` | Пользователи. Task ссылается через `UserRef { id, name }`. |
| `sites/{id}` | Адреса/площадки. `Location.siteId` опциональная FK. |

---

**См. также:**
- [Что выкидываем из GTDTask](what-changes-from-gtdtask.md)
- [Task interface](task-interface.md) — где переиспользуются эти типы
- [`../04-storage/collections.md`](../04-storage/collections.md) — полный список коллекций tasktotime + соседних
- [`../04-storage/migration-mapping.md`](../04-storage/migration-mapping.md) — какие поля как переносим
