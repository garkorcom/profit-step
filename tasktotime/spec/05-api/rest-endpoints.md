---
title: "05.1 REST endpoints"
section: "05-api"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# REST endpoints

> Все endpoints под префиксом `/api/tasktotime/`. Новый префикс — НЕ `/api/gtd-tasks/` чтобы был чёткий cutover. Старый `/api/gtd-tasks/*` остаётся работающим до Phase 6 как proxy для backwards compat (внешний AI bot).

Файл реализации: `tasktotime/backend/api/routes.ts`

## Полный список

```
POST   /api/tasktotime/tasks                    создать задачу
GET    /api/tasktotime/tasks                    список с фильтрами и RLS
GET    /api/tasktotime/tasks/:id                одна задача
PATCH  /api/tasktotime/tasks/:id                частичное обновление (НЕ для transitions!)
POST   /api/tasktotime/tasks/:id/transition     state machine: { action: 'start'|'complete'|'accept'|... }
POST   /api/tasktotime/tasks/batch              batch update (max 50)
DELETE /api/tasktotime/tasks/:id                soft delete (archivedAt)

POST   /api/tasktotime/tasks/:id/dependencies   добавить зависимость
DELETE /api/tasktotime/tasks/:id/dependencies/:depId

POST   /api/tasktotime/tasks/:id/acceptance     подписать акт
POST   /api/tasktotime/tasks/:id/materials      добавить материал
POST   /api/tasktotime/tasks/:id/tools          добавить инструмент
POST   /api/tasktotime/tasks/:id/contacts       привязать контакт

GET    /api/tasktotime/tasks/:id/files          related files
GET    /api/tasktotime/tasks/:id/sessions       work sessions для задачи
GET    /api/tasktotime/tasks/:id/audit          full audit trail (transitions + history)
```

## Endpoint deep-dive

### `POST /api/tasktotime/tasks`

**Создать задачу.**

- **Request schema (Zod):** все REQUIRED поля Task (см. [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md))
- **Response:** созданный Task с `id`, `taskNumber`, `lifecycle: 'draft'`
- **RLS:** `request.body.companyId === auth.companyId`
- **Idempotency key:** `idempotencyKey` в request body (опционально, для AI/voice flows)
- **Errors:** 400 invalid input, 403 RLS violation, 409 duplicate idempotency key

### `GET /api/tasktotime/tasks`

**Список с фильтрами.**

- **Query params:**
  - `lifecycle` — array filter
  - `bucket` — array filter
  - `assignedTo` — userId
  - `clientId`
  - `projectId`
  - `dueAtBefore` / `dueAtAfter` — Timestamp range
  - `parentTaskId` — для subtasks query
  - `derived` — array `['is_overdue', 'is_at_risk']` — server-side фильтрация
  - `limit` (default 50, max 200)
  - `cursor` — pagination
  - `orderBy` (default `createdAt:desc`)
- **Response:** `{ tasks: Task[], cursor: string | null }`
- **RLS:** автоматический `companyId == auth.companyId` через rules

### `GET /api/tasktotime/tasks/:id`

**Одна задача с полной информацией.**

- **Response:** Task (полный документ)
- **Errors:** 404 not found, 403 RLS violation

### `PATCH /api/tasktotime/tasks/:id`

**Частичное обновление.**

- **НЕ для transitions** — для изменения title, description, materials, tools, etc.
- Lifecycle менять можно ТОЛЬКО через `/transition` endpoint.
- **Request schema:** subset Task без `id`, `companyId`, `taskNumber`, `createdAt`, `lifecycle` (immutable here)
- **Response:** обновлённый Task
- **Errors:** 400 invalid (попытка изменить lifecycle), 403 RLS, 404 not found

### `POST /api/tasktotime/tasks/:id/transition`

**State machine endpoint.**

- **Request schema:**
  ```typescript
  {
    action: 'ready' | 'start' | 'complete' | 'accept' | 'block' | 'unblock' | 'cancel',
    reason?: string,            // обязательно для block/cancel
    acceptance?: AcceptanceAct, // обязательно для accept
    idempotencyKey?: string
  }
  ```
- **Response:** обновлённый Task с новым lifecycle
- **Errors:** 400 invalid transition (e.g. `accepted → started`), 400 missing acceptance, 403 RLS

См. подробно: [`../03-state-machine/transitions.md`](../03-state-machine/transitions.md)

### `POST /api/tasktotime/tasks/batch`

**Batch update (max 50 tasks).**

- **Request schema:**
  ```typescript
  {
    operations: Array<{ id: string, patch: Partial<Task> }>
  }
  ```
- **Response:** `{ succeeded: string[], failed: Array<{ id, error }> }`
- **Use case:** drag-drop bulk reorder в kanban, bulk update в Table view

### `DELETE /api/tasktotime/tasks/:id`

**Soft delete (sets `archivedAt`).**

- Пишет `archivedAt = now`, `archivedBy = auth.uid`, `bucket = 'archive'`
- Физическое удаление НЕ происходит (даже admin делает через explicit hard-delete endpoint, TBD)

### `POST /api/tasktotime/tasks/:id/dependencies`

**Добавить зависимость.**

- **Request schema:**
  ```typescript
  {
    taskId: string,
    type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish',
    lagMinutes?: number,
    isHardBlock: boolean,
    reason?: string
  }
  ```
- **Cycle detection:** API делегирует в `DependencyService.canAddDependency(fromId, toId)`. Если cycle — 400 «Cycle detected: A → B → C → A»
- **Response:** обновлённый Task с новой dependency

См.: [`../08-modules/graph-dependencies/cycle-prevention.md`](../08-modules/graph-dependencies/cycle-prevention.md)

### `DELETE /api/tasktotime/tasks/:id/dependencies/:depId`

**Удалить зависимость.**

- `depId` = индекс или `taskId` зависимости (TBD — лучше отдельный depId field)

### `POST /api/tasktotime/tasks/:id/acceptance`

**Подписать акт.**

Эквивалент `POST /transition { action: 'accept', acceptance: {...} }` — есть как convenience endpoint.

### `POST /api/tasktotime/tasks/:id/materials`

**Добавить материал в задачу.**

- **Request schema:** `TaskMaterial` (из inventory module)
- Триггер пересчитывает `materialsCostPlanned`

### `POST /api/tasktotime/tasks/:id/tools`

**Добавить инструмент.**

- **Request schema:** `TaskTool`

### `POST /api/tasktotime/tasks/:id/contacts`

**Привязать контакт.**

- **Request schema:** `{ contactId: string }`
- Append в `linkedContactIds[]`

### `GET /api/tasktotime/tasks/:id/files`

**Related files.**

Возвращает массив files где `linkedTo.taskId === id`. Включает: attachments, wiki attachments, acceptance photos.

### `GET /api/tasktotime/tasks/:id/sessions`

**Work sessions для задачи.**

Query `work_sessions` where `relatedTaskId === id`. Возвращает агрегаты + список сессий.

### `GET /api/tasktotime/tasks/:id/audit`

**Full audit trail.**

Объединяет:
- `task.history[]` (inline events)
- `tasktotime_transitions/` где `taskId === id`
- `aiAuditLogs/` где `targetTaskId === id`

Возвращает single timeline отсортированный по `at` desc.

## Idempotency

Все mutating endpoints (`POST`, `PATCH`, `DELETE`) поддерживают `Idempotency-Key` header или `idempotencyKey` в body. Сервер хранит ключ в `_idempotency/{key}` 24 часа. При повторе — возвращает кэшированный результат, не дублирует mutation.

## Error format

```typescript
{
  error: {
    code: 'invalid_input' | 'rls_violation' | 'not_found' | 'cycle_detected' | 'invalid_transition' | ...,
    message: string,
    details?: Record<string, unknown>
  }
}
```

---

**См. также:**
- [Callables](callables.md) — отдельный layer для AI flows
- [Triggers](triggers.md) — какие triggers запускаются при mutations
- [Backwards compat](backwards-compat.md) — `/api/gtd-tasks/*` proxy
- [`../03-state-machine/transitions.md`](../03-state-machine/transitions.md) — детали transitions endpoint
- [`../04-storage/rules.md`](../04-storage/rules.md) — RLS enforcement
