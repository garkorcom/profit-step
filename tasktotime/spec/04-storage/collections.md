---
title: "04.1 Firestore коллекции"
section: "04-storage"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Firestore коллекции

> Список всех Firestore коллекций модуля `tasktotime`. Главная — `tasktotime_tasks/{id}` (RENAME из `gtd_tasks`). Соседние подсистемы (work_sessions, aiAuditLogs, _idempotency, notes) **не трогаем** — task только ссылается через FK.

## Таблица: старая → новая

| Коллекция | Старая | Новая | Что делаем |
|---|---|---|---|
| Главная задачи | `gtd_tasks/{id}` | `tasktotime_tasks/{id}` | **RENAME** (миграция в Phase 5) |
| История переходов | — | `tasktotime_transitions/{id}` | **NEW** — append-only audit лог |
| Зависимости индекс | — | computed by trigger в `Task.blocksTaskIds` | **NEW** (computed field, не отдельная коллекция) |
| Sessions | `work_sessions/{id}` | `work_sessions/{id}` | **НЕ ТРОГАЕМ** — только reference через `relatedTaskId` |
| AI audit | `aiAuditLogs/{id}` | `aiAuditLogs/{id}` | **НЕ ТРОГАЕМ** — общая коллекция всех AI flows |
| Idempotency | `_idempotency/{key}` | `_idempotency/{key}` | **НЕ ТРОГАЕМ** — cross-trigger guards |
| Notes (separate) | `notes/{id}` | `notes/{id}` | **НЕ ТРОГАЕМ** — отдельная подсистема (qualityLoop / financials / controllerId). См. open question #1 |

## Subcollections

### `tasktotime_tasks/{taskId}/wiki_history/{versionId}`

Старые версии wiki (>10). Inline в `task.wiki.versionHistory[]` хранятся последние 10; всё что старше — здесь. Используется для отката изменений на длительной дистанции.

См. [`../08-modules/wiki/storage.md`](../08-modules/wiki/storage.md)

## Принцип «не трогаем»

Соседние коллекции остаются как есть, чтобы не каскадить breaking changes:

- **`work_sessions`** — payroll и time-tracking зависят. Меняем = ломаем payroll.
- **`aiAuditLogs`** — общая для всех AI features (не только tasks). Меняем = ломаем все остальные AI flows.
- **`_idempotency`** — system-critical. Меняем = высокий риск infinite loops.
- **`notes`** — отдельная подсистема, не должна смешиваться с tasks. См. open question #1 в [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md).

## Соседние коллекции (через FK)

`Task` ссылается на эти коллекции через ID-FK + (optionally) denormalized name field для отображения:

| Поле в Task | Коллекция | Denormalized |
|---|---|---|
| `clientId` | `clients/{id}` | `clientName` |
| `projectId` | `projects/{id}` | `projectName` |
| `assignedTo.id` | `users/{uid}` | `assignedTo.name` (UserRef) |
| `createdBy.id` | `users/{uid}` | `createdBy.name` |
| `reviewedBy.id` | `users/{uid}` | `reviewedBy.name` |
| `linkedContactIds[]` | `contacts/{id}` (TBD) | — |
| `materials[].materialId` | `inventory_materials/{id}` | через `TaskMaterial` |
| `requiredTools[].id` | `inventory_tools/{id}` (TBD) | `name` денорм. |
| `location.siteId` | `sites/{id}` | — |
| `sourceEstimateId` | `estimates/{id}` | — |
| `sourceNoteId` | `notes/{id}` | — |
| `aiAuditLogId` | `aiAuditLogs/{id}` | — |
| `acceptance.signedBy` | `users/{uid}` или строка | `acceptance.signedByName` |

## Главная новая коллекция: `tasktotime_tasks`

Полная схема документа — см. [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md).

Document ID — Firestore auto-id или manual `T-2026-0042` slug (см. `taskNumber` в Task interface).

Composite indexes — см. [`indexes.md`](indexes.md).

Security rules — см. [`rules.md`](rules.md).

## Новая audit collection: `tasktotime_transitions`

```typescript
interface TaskTransition {
  id: string;                       // doc id
  taskId: string;                   // FK
  companyId: string;                // RLS
  from: TaskLifecycle;
  to: TaskLifecycle;
  action: 'ready' | 'start' | 'complete' | 'accept' | 'block' | 'unblock' | 'cancel';
  by: UserRef;
  at: Timestamp;
  reason?: string;                  // для block/cancel
  meta?: Record<string, unknown>;   // действие-специфичные данные (e.g. acceptance object)
}
```

**Зачем отдельная коллекция:** task.history[] limited (Firestore array max ~1MB). Для долгой истории и compliance отчётов — отдельный append-only log.

**Indexes:** `companyId + taskId + at(desc)`, `companyId + by.id + at(desc)`, `companyId + action + at(desc)`.

---

**См. также:**
- [Indexes](indexes.md) — composite indexes для tasktotime_tasks
- [Rules](rules.md) — firestore.rules
- [Migration mapping](migration-mapping.md) — поле gtd_tasks → tasktotime_tasks для скрипта миграции
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — что внутри документа
- [`../05-api/triggers.md`](../05-api/triggers.md) — какие триггеры пишут в эти коллекции
