---
title: "02.2 Sub-types"
section: "02-data-model"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Sub-types для Task

> Все вспомогательные типы для `Task`: UserRef, Money, TaskDependency, Location, AcceptanceAct, TaskTool, TaskCategory, TaskPhase, SubtaskRollup, TaskWiki, WikiVersion, WikiAttachment. Каждый с TypeScript кодом + объяснением use case.

## Базовые типы

### `UserRef`

```typescript
interface UserRef {
  id: string;
  name: string;
  role?: 'executor' | 'reviewer' | 'observer';
}
```

**Use case:** ссылка на пользователя без полного объекта. Применяется в `createdBy`, `assignedTo`, `reviewedBy`, `coAssignees[]`, `wiki.updatedBy`. Поле `name` денормализовано — для отображения без N+1 запросов.

### `Money`

```typescript
interface Money {
  amount: number;
  currency: 'USD' | 'RUB' | 'EUR';
}
```

**Use case:** все денежные поля (`costInternal`, `priceClient`, `bonusOnTime`, `penaltyOverdue`). Currency хранится с каждой суммой, чтобы не зависеть от глобальной настройки company.

## Dependencies

### `TaskDependency`

```typescript
interface TaskDependency {
  taskId: string;
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish';
  lagMinutes?: number;
}
```

**Use case:** запись в `task.dependsOn[]`. Базовая модель в §1.1.

**Расширенная модель** (используется в §12.2 для полноценной DAG логики):

```typescript
interface TaskDependency {
  taskId: string;                                     // на кого ссылаемся
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
  lagMinutes?: number;                                // позитив = задержка после, негатив = можно начать раньше
  isHardBlock: boolean;                               // true → нельзя start пока predecessor не done; false → soft warning
  reason?: string;                                    // human-readable: «нужен permit перед demolition»
  createdAt: Timestamp;
  createdBy: UserRef;
}
```

**4 типа зависимостей** (PMI / Procore / MS Project standard):

- **Finish-to-Start (FS)** — самый частый. «Закончил drywall → начал painting»
- **Start-to-Start (SS)** — параллельные работы. «Электрик начал → плотник начал»
- **Finish-to-Finish (FF)** — синхронное окончание. «Inspection и cleanup кончаются вместе»
- **Start-to-Finish (SF)** — редкий, для shift-handoff

Подробно: [`../08-modules/graph-dependencies/task-dependency-interface.md`](../08-modules/graph-dependencies/task-dependency-interface.md)

## Location

### `Location`

```typescript
interface Location {
  address: string;
  lat?: number;
  lng?: number;
  siteId?: string;          // FK to sites collection
  notes?: string;           // "звонок на проходной" / "ключи у соседа"
}
```

**Use case:** адрес где выполняется задача. Координаты `lat/lng` нужны для weather day cron (NOAA API), maps view, distance auto-detect (Tampa +100mi). `siteId` ссылается на главную site/проект если есть централизованная информация (контакты, чертежи).

## Acceptance

### `AcceptanceAct`

```typescript
interface AcceptanceAct {
  url: string;
  signedAt: Timestamp;
  signedBy: string;
  signedByName: string;
  notes?: string;
  photos?: string[];
}
```

**Use case:** акт выполнения работ, подписанный клиентом. Когда `task.acceptance` заполнено — task переходит в lifecycle `accepted`. Поле `url` — ссылка на PDF в Storage. `signedBy` может быть `userId` (если внутренний клиент) или произвольная строка (внешний clientName). `photos[]` — фото-доказательства завершения работ.

## Tools

### `TaskTool`

```typescript
interface TaskTool {
  id: string;
  name: string;
  qty?: number;
  status: 'required' | 'reserved' | 'taken' | 'returned';
  source: 'company_inventory' | 'employee_personal' | 'rented';
}
```

**Use case:** инструменты нужные для выполнения задачи. `status` — workflow от планирования до возврата. `source` — откуда инструмент: со склада компании, личный сотрудника, или арендованный.

## Категории и фазы (NEW v0.2)

### `TaskCategory`

```typescript
type TaskCategory = 'work' | 'punch' | 'inspection' | 'permit' | 'closeout';
```

**Use case:** категория задачи для group-by в Gantt и фильтров. `'punch'` = задача из punch list (мелкие правки в конце проекта). **Не отдельная сущность** — просто category. См. [`../08-modules/construction-gantt/punch-list.md`](../08-modules/construction-gantt/punch-list.md)

### `TaskPhase`

```typescript
type TaskPhase = 'demo' | 'rough' | 'finish' | 'closeout';
```

**Use case:** стандартные фазы remodel/construction. Используется для group-by в Gantt:
- `demo` — демонтаж
- `rough` — черновые работы (электрика, сантехника, каркас)
- `finish` — чистовая отделка
- `closeout` — сдача объекта, punch list

## Computed aggregate

### `SubtaskRollup`

```typescript
interface SubtaskRollup {
  // Computed by onTaskUpdate trigger когда subtask меняется.
  countByLifecycle: Record<TaskLifecycle, number>;  // { ready: 3, started: 1, completed: 2, accepted: 0 }
  totalCostInternal: number;                         // sum of subtask.costInternal
  totalPriceClient: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  completedFraction: number;                         // 0..1, процент done/accepted
  earliestDueAt?: Timestamp;                         // min(subtask.dueAt) — реальный дедлайн parent'а
  latestCompletedAt?: Timestamp;                     // max(subtask.completedAt)
  blockedCount: number;                              // сколько subtasks в lifecycle='blocked'
}
```

**Use case:** computed aggregate на parent task. Пересчитывается trigger'ом `onTaskUpdate` атомарно (transaction) когда любая subtask меняется. Используется для:

- `completedFraction` → progress bar в карточке parent
- `earliestDueAt` → реальный дедлайн parent'а (одна просроченная subtask = просроченный parent)
- `totalCostInternal/PriceClient` → финансовая картинка
- `blockedCount` → алерт PM

Подробно: [`../08-modules/hierarchy/subtask-rollup-aggregate.md`](../08-modules/hierarchy/subtask-rollup-aggregate.md)

## Wiki types (NEW v0.2)

### `TaskWiki`

```typescript
interface TaskWiki {
  // Markdown-страница привязанная к задаче. См. §13.
  contentMd: string;                  // Markdown source (max 100KB)
  updatedAt: Timestamp;
  updatedBy: UserRef;
  version: number;                    // increments on each save (для optimistic concurrency)
  versionHistory?: WikiVersion[];     // last 10 versions inline (older — в subcollection wiki_history/)
  attachments?: WikiAttachment[];     // photos / drawings / pdfs встроенные в wiki
  templateId?: string;                // если создана из template (e.g. "bathroom-remodel-checklist")
}
```

**Use case:** долгосрочная память задачи. Markdown текст с разделами (Scope / Materials / Permits / Risks / Acceptance criteria). Embedded на task до 100KB; больше — в subcollection. `version` инкрементируется при каждом сохранении для optimistic concurrency. Подробно: [`../08-modules/wiki/storage.md`](../08-modules/wiki/storage.md)

### `WikiVersion`

```typescript
interface WikiVersion {
  version: number;
  contentMd: string;
  updatedAt: Timestamp;
  updatedBy: UserRef;
  changeSummary?: string;             // optional 1-line summary
}
```

**Use case:** запись о версии wiki в `versionHistory[]`. Хранятся последние 10 версий inline; более старые — в subcollection `tasktotime_tasks/{taskId}/wiki_history/{versionId}`. Используется для отката изменений и conflict resolution UI (как Notion).

### `WikiAttachment`

```typescript
interface WikiAttachment {
  id: string;
  url: string;
  type: 'photo' | 'pdf' | 'drawing' | 'invoice';
  caption?: string;
  uploadedAt: Timestamp;
  uploadedBy: UserRef;
}
```

**Use case:** фотки / drawings / pdfs / invoices встроенные в wiki через slash-command `/photo` или drag-drop. Файлы лежат в Firebase Storage по `url`, метаданные — здесь.

## Existing types (re-exported as-is)

Эти типы переиспользуются из других модулей без изменений:

- **`TaskMaterial`** — из `src/types/inventory.types.ts`
- **`ChecklistItem`, `Attachment`, `Payment`, `TaskHistoryEvent`** — из `gtd.types.ts` (мигрированы в `tasktotime/types/`)

---

**См. также:**
- [Task interface](task-interface.md) — главная сущность, использующая все эти sub-types
- [Что выкидываем из GTDTask](what-changes-from-gtdtask.md)
- [`../08-modules/hierarchy/subtask-rollup-aggregate.md`](../08-modules/hierarchy/subtask-rollup-aggregate.md) — детали по SubtaskRollup
- [`../08-modules/graph-dependencies/task-dependency-interface.md`](../08-modules/graph-dependencies/task-dependency-interface.md) — расширенная модель TaskDependency
- [`../08-modules/wiki/storage.md`](../08-modules/wiki/storage.md) — детали хранения TaskWiki
