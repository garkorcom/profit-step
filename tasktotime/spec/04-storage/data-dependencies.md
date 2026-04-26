---
title: "04.5 Data dependencies — что откуда читать и куда писать"
section: "04-storage"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-26
version: 0.2
---

# Data Dependencies

> Полный inventory входящих и исходящих данных модуля `tasktotime`. Используется на Phase 1 для проектирования adapter слоёв (Hexagonal Architecture) и на Phase 2 для понимания blast radius каждого endpoint'а.

## TL;DR

- **READ:** 17 внешних Firestore коллекций (`clients`, `projects`, `users`, `employees`, `contacts`, `sites`, `inventory_catalog`, `inventory_transactions`, `estimates`, `notes`, `files`, `work_sessions`, `aiAuditLogs`, `aiCache`, `processedEvents`, `payroll_periods`, `companies`)
- **WRITE/TRIGGER:** 8 collections direct + 5 external side-effect channels (Telegram bot, Push notifications, Email, BigQuery audit, Cloud Storage)
- **Critical risks:**
  - Cascade infinite-loop через `subtaskRollup` + computed fields ($10k bomb risk при ошибке)
  - `companyId` отсутствует в legacy `gtd_tasks` docs → cross-tenant leak vector
  - Двойной namespace `employees/` vs `users/` для assignee (legacy compat)
  - Stale denormalized fields без cleanup triggers (`clientName`, `projectName`, `assignedTo.name`)
  - `firestore.rules` для `gtd_tasks` line 343 — `allow read: if true` (public read bug — НЕ повторять)

## Inputs (READ)

### `clients/{clientId}`

- **Поля используются:** `name`, `companyId`, `status`, `aliases`, `brief`, `clientName`
- **Где привязка в Task:** `Task.clientId` (string FK) + `Task.clientName` (denormalized snapshot)
- **Тип чтения:**
  - One-time read через `getDoc('clients/{id}')` в Cockpit (`useCockpitTask.ts:182-188`)
  - Bulk read через `getDocs(query(collection('clients'), where('status', '!=', 'archived')))` для dropdown selectors
  - Backend: `loadContextSnapshot` в `generateAiTask.ts:130` использует `clients/{clientId}` для AI scope analysis
- **Денормализация в Task:** `Task.clientName` копируется при создании/edit задачи; `Task.location.address` иногда копируется из `client.address`
- **Stale data risk:** **HIGH** — нет cleanup trigger при изменении `client.name`. Задача может на месяцы оставаться с устаревшим `clientName`. Решение: lazy reconcile в UI или новый `onClientUpdate` trigger
- **firestore.rules:** Line 286 — `allow read: if true` (публичный для Client Portal). Нет company-scope guard — потенциальный leak

### `projects/{projectId}`

- **Поля используются:** `name`, `clientId`, `clientName`, `companyId`, `address`, `aliases`, `type`, `status`, `updatedAt`
- **Где привязка в Task:** `Task.projectId` + `Task.projectName` (denormalized)
- **Тип чтения:**
  - One-time `getDocs(query(collection('projects'), where('clientId', '==', clientId)))` в Cockpit (`useCockpitTask.ts:225-240`) — авто-резолв "default project per client"
  - Bulk read для project dropdown
- **Денормализация в Task:** `Task.projectName`. Возможно `Task.location.address` если совпадает с проектом
- **Stale data risk:** **MEDIUM** — projects реже переименовываются, но всё равно нет cleanup trigger
- **firestore.rules:** Line 314 — `allow read, write: if isSignedIn()` (любой залогиненный)

### `users/{uid}`

- **Поля используются:** `displayName`, `email`, `companyId`, `role`, `telegramId`, `hourlyRate`, `aliases`, `referenceFacePhotoUrl`, `hierarchyPath`, `status`, `photoURL`
- **Где привязка в Task:** `Task.createdBy.id`, `Task.assignedTo.id`, `Task.reviewedBy.id`, `Task.coAssignees[].id` (UserRef.id)
- **Тип чтения:**
  - One-time `getDoc('users/{uid}')` для resolve assignee profile
  - Bulk `getDocs(collection('users'))` для dropdown selectors (`useCockpitTask.ts:191-202`)
  - Backend lookup в `sendMessageToWorker` (`workerMessaging.ts:18-22`) — `telegramId`
  - Backend: `findTelegramChatId` в `deadlineReminders.ts:152-162`
- **Денормализация в Task:** `Task.createdBy.name`, `Task.assignedTo.name`, `Task.reviewedBy.name` (UserRef.name); возможно `Task.hourlyRate` (override)
- **Stale data risk:** **HIGH** — переименования и role changes часты в команде. Нужен `onUserUpdate` trigger для re-stamping всех assigned tasks
- **firestore.rules:** Line 51 — `allow read: if isSignedIn()` (auth-only, OK)

### `employees/{employeeId}` ⚠️ legacy коллекция, отдельная от users

- **Поля используются:** `telegramId`, `name`, `hourlyRate`, `companyId`
- **Где привязка в Task:** `Task.assignedTo.id` может быть `String(telegramUserId)` для legacy worker bot users
- **Тип чтения:**
  - First lookup в `sendMessageToWorker` (`workerMessaging.ts:13-17`) — пытается найти telegramId через `employees/{id}` ДО `users/{id}`
  - `findTelegramChatId` в `deadlineReminders.ts:163-175` — fallback если userId не найден в `users/`
  - sessionManager пишет в `employees/{userId}` при init session (`sessionManager.ts:43-47`)
- **Денормализация в Task:** `Task.assignedTo.name` (employees.name)
- **Stale data risk:** **VERY HIGH** — два namespace для одного и того же сотрудника. UserRef должен иметь дискриминатор `namespace: 'users' | 'employees'`
- **firestore.rules:** Line 412 — `allow read: if isSignedIn(); allow write: if isAdmin()`

### `contacts/{contactId}`

- **Поля используются:** `name`, `roles[]`, `phones[]`, `emails[]`, `messengers.telegram`, `messengers.whatsapp`, `linkedProjects[]`, `defaultCity`
- **Где привязка в Task:** `Task.linkedContactIds: string[]`
- **Тип чтения:**
  - Bulk read `getDocs(query(collection('contacts'), orderBy('name')))` — N+1 risk при отображении 50+ задач (`useCockpitTask.ts:204-211`)
  - Filter by `where('linkedProjects', 'array-contains', projectId)` (см. `contactsService.ts:69-74`)
- **Денормализация в Task:** Нет (только IDs). При open task — fetch all linked contacts on demand
- **Stale data risk:** **LOW** (нет денормализации). Но **N+1 risk** на task list view
- **firestore.rules:** Line 302 — `allow read: if isSignedIn()`

### `sites/{siteId}`

- **Поля используются:** `address`, `geo.lat`, `geo.lng`, `clientId`, `name`, `permitNumber`
- **Где привязка в Task:** `Task.location.siteId` (FK)
- **Тип чтения:** One-time `getDoc('sites/{siteId}')` для resolving address details
- **Денормализация в Task:** `Task.location.address`, `Task.location.lat`, `Task.location.lng` (всё внутри Location object)
- **Stale data risk:** **MEDIUM** — site address может смениться, но редко
- **firestore.rules:** Line 593 — `allow read: if isSignedIn()`
- **Index существует:** `(clientId ASC, createdAt DESC)` — `firestore.indexes.json:769-781`

### `inventory_catalog/{itemId}`

- **Поля используются:** `name`, `category`, `unit`, `lastPurchasePrice`, `avgPrice`, `clientMarkupPercent`, `totalStock`, `stockByLocation`
- **Где привязка в Task:** `Task.materials[].catalogItemId` (FK через `TaskMaterial`)
- **Тип чтения:**
  - One-time `getDoc('inventory_catalog/{id}')` для price snapshot при добавлении материала в задачу
  - Bulk read для materials picker
- **Денормализация в Task:** `Task.materials[].name`, `Task.materials[].plannedPrice`, `Task.materials[].unit` — всё внутри `TaskMaterial`
- **Stale data risk:** **HIGH for prices** — `lastPurchasePrice` обновляется регулярно при purchase transactions. Но в Task мы храним **snapshot** `plannedPrice` на момент планирования (правильно — иначе budget будет drift). Solution: clear contract «plannedPrice = snapshot, не следит за catalog»
- **firestore.rules:** Line 472 — `allow read: if isSignedIn()`

### `inventory_transactions/{txId}`

- **Поля используются:** `relatedTaskId`, `qty`, `totalAmount`, `type`, `timestamp`
- **Где привязка в Task:** `Task.materials[].transactionId` обратная связь; query `where relatedTaskId == taskId`
- **Тип чтения:** Backend trigger `onCostCreated` или `onWorkSessionUpdate` aggregate `materialsCostActual` через `inventory_transactions where relatedTaskId == taskId`
- **Денормализация в Task:** `Task.materialsCostActual` — sum от inventory_transactions
- **Stale data risk:** Computed в trigger, должно автообновляться. Но в текущем коде **триггер не существует** (grep `materialsCostActual` в functions/ — нет). На сегодня поле руками заполняется через UI
- **firestore.rules:** Line 478 — `allow read: if isSignedIn(); allow update: if isAdmin()` (журнальный append-only по сути)

### `estimates/{estimateId}`

- **Поля используются:** `items[]` (для `sourceEstimateItemId` lookup), `projectId`, `companyId`, `status`, `totalAmount`
- **Где привязка в Task:** `Task.sourceEstimateId`, `Task.sourceEstimateItemId`
- **Тип чтения:**
  - Frontend: `estimatesApi.getClientEstimates(companyId, clientId)` через `useCockpitTask.ts:280` для AI auto-decompose features
  - Backend: `loadContextSnapshot` в `generateAiTask.ts:138-143` — read top 2 active estimates per project
- **Денормализация в Task:** `Task.priceClient.amount` иногда копируется из `estimateItem.amount` при decompose
- **Stale data risk:** **LOW** — estimates обычно immutable после signature
- **firestore.rules:** Line 138 — `allow read: if true; allow write: if isSignedIn()` (publicly readable for client portal)
- **Indexes:** `(projectId, status, createdAt DESC)` — `firestore.indexes.json:677-693`

### `notes/{noteId}`

- **Поля используются:** `transcript`, `attachments[]`, `clientId`, `projectId`, `aiAnalysis`, `chatId`, `sourceAudioUrl`
- **Где привязка в Task:** `Task.sourceNoteId` (single optional FK)
- **Тип чтения:** One-time `getDoc('notes/{noteId}')` для AI generate task from note flow (callable `parseSmartInput`)
- **Денормализация в Task:** `Task.title`, `Task.description`, `Task.checklistItems[]` иногда populate из `note.aiAnalysis.task`
- **Stale data risk:** **NONE** (notes immutable after AI processing)
- **firestore.rules:** Line 391 — `allow read: if isSignedIn(); allow create: if false` (Cloud Functions only)

### `files/{fileId}`

- **Поля используются:** `url`, `name`, `mimeType`, `linkedTo.taskId`, `linkedTo.clientId`, `linkedTo.projectId`, `category`, `uploadedAt`, `uploadedBy`
- **Где привязка в Task:** `Task.attachments[]` (URLs), `Task.wiki.attachments[]`, `Task.acceptance.url`, `Task.acceptance.photos[]`
- **Тип чтения:** Bulk query `where linkedTo.taskId == taskId` для отображения вложений задачи
- **Денормализация в Task:** Полные URL'ы хранятся в `Task.attachments[]` (не FK, а embedded). `linkedTo.taskId` обратная связь в `files` — для cleanup
- **Stale data risk:** **LOW**, files не переименовываются после upload
- **firestore.rules:** Line 461 — `allow read: if isSignedIn()`
- **Indexes:** `(linkedTo.taskId, uploadedAt DESC)` — `firestore.indexes.json:854-866`

### `work_sessions/{sessionId}`

- **Поля используются:** `relatedTaskId`, `durationMinutes`, `hourlyRate`, `sessionEarnings`, `status`, `endTime`, `employeeId`, `clientId`
- **Где привязка в Task:** Двусторонняя — `work_sessions.relatedTaskId == task.id`. Task aggregates `actualDurationMinutes` и `totalEarnings` из неё
- **Тип чтения:**
  - Backend trigger `onWorkSessionUpdate` (`onWorkSessionUpdate.ts:133-146`) — читает `gtd_tasks/{relatedTaskId}` для AI accuracy logging
  - Frontend `useSessionManager` для текущей активной сессии
  - Aggregate: `query(work_sessions, where('relatedTaskId', '==', taskId))`
- **Денормализация в Task:** `Task.actualDurationMinutes` (sum), `Task.totalEarnings` (sum), `Task.actualStartAt` (min startTime)
- **Stale data risk:** **HIGH** — если session edit'ится (admin correction) после aggregation, task aggregates становятся stale. Решение — `onWorkSessionUpdate` пересчитывает task aggregates на любое изменение
- **firestore.rules:** Line 384 — `allow read, create, update: if isSignedIn()`
- **Indexes:** `(relatedTaskId, startTime DESC)` — `firestore.indexes.json:737-749` ✅

### `aiAuditLogs/{logId}` (high-level AI flows)

- **Поля используются:** `prompt`, `response`, `userEdits`, `confidence`, `model`, `tokens`, `cost`
- **Где привязка в Task:** `Task.aiAuditLogId` (FK для traceability)
- **Тип чтения:** Lazy — только при «debug AI generation» open в Cockpit
- **Денормализация в Task:** Только ID
- **Stale data risk:** None

### `ai_accuracy_logs/{logId}` ⚠️ отдельная коллекция от aiAuditLogs

- **Поля используются:** `predictedMinutes`, `actualMinutes`, `accuracyRatio`, `taskId`, `employeeRole`
- **Где привязка в Task:** Reverse — `ai_accuracy_logs.taskId == task.id`
- **Тип чтения:** Backend cron для AI continuous learning (не tasktotime)
- **Денормализация в Task:** None
- **Stale data risk:** None — append-only

### `processedEvents/{eventId}` (idempotency) ⚠️ создаём с нуля

- **Поля используются:** TTL marker, eventId, taskId, action
- **Где привязка в Task:** `_idempotency/${taskId}_create`, `${transitionId}_processed`, etc.
- **Тип чтения:** Sentinel check в начале triggers
- **Денормализация в Task:** None
- **Stale data risk:** None — TTL cleanup
- **Note:** не существует в проде сегодня. Tasktotime создаст с нуля. TTL — 5 минут стандартно.

### `aiCache/{cacheKey}`

- **Поля используются:** `predictedMinutes`, `description`, `role`, `expiresAt`, `hitCount`
- **Где привязка в Task:** Lookup при `aiTaskApi.estimateTask({ description, role })` (`aiCacheUtils.ts:54-86`)
- **Тип чтения:** One-time GetDoc by hashed key
- **Денормализация в Task:** None (cache used to populate `Task.estimatedDurationMinutes`)
- **Stale data risk:** Self-cleaning через TTL

### `payroll_periods/{periodId}` (для bonus/penalty cron)

- **Поля используются:** `startDate`, `endDate`, `status`, `id`
- **Где привязка в Task:** Indirect — bonus/penalty создаются с `payrollPeriod = "YYYY-MM"`
- **Тип чтения:** One-time GetDoc для current period
- **Денормализация в Task:** None
- **Stale data risk:** None

### `companies/{companyId}` (для CRM scope)

- **Поля используются:** `name`, `currency`, `timezone`, `settings`
- **Где привязка в Task:** `Task.companyId` (RLS scope)
- **Тип чтения:** Lazy — только для display компании в acceptance act
- **firestore.rules:** Line 236 — owner-scoped (`ownerCompanyId == getUserCompany()`)

## Outputs (WRITE / TRIGGER)

### `tasktotime_tasks/{taskId}` (own collection)

Главная writeable коллекция. Все поля из [`task-interface.md`](../02-data-model/task-interface.md). Writers:

| Writer | Где | Поля писем | Idempotency |
|---|---|---|---|
| Cockpit autosave | `useCockpitTask.handleSave` | большинство editable полей | optimistic version field |
| AI generation | callable `confirmAiTask` | весь объект из draft | hash на `(prompt + userId)` через aiCache |
| Telegram bot | `onWorkerBotMessage handlers` | `title`, `clientId`, `assigneeId`, `source: 'telegram'` | `processedEvents/${chatId}_${msgId}` |
| Estimate decompose | callable `decomposeEstimate` | bulk batch создания subtasks | `processedEvents/${estimateId}_decomposed` |
| Migration script | `scripts/migrate-gtd-to-tasktotime.ts` | весь объект from `gtd_tasks` | DRY_RUN flag, batch cursor |
| Cron `overdueEscalation` | scheduled | `lifecycle`, `payrollProcessedAt` | `task.payrollProcessedAt != null` guard |
| Cron `deadlineReminders` | scheduled | `lastReminderSentAt` only | `now - lastReminderSentAt > 24h` guard |
| Trigger `onTaskUpdate` (cascade) | self-trigger watching subtask | `subtaskRollup`, `isCriticalPath`, `slackMinutes` | watched-fields exclude list |

### `tasktotime_transitions/{transitionId}` (NEW collection)

Append-only audit log. Writers:
- `onTaskUpdate` trigger — при `lifecycle change`
- `onTaskTransition` trigger reads, не writes

**Idempotency:** Doc ID = `${taskId}_${fromState}_${toState}_${at.toMillis()}` — естественно уникальный

### Triggered writes to other collections

#### `clients/{clientId}` — НЕТ direct writes from tasktotime
Tasktotime **не пишет** в clients. Только READ. Решение чистое.

#### `projects/{projectId}` — потенциальный write через `projectMetricsService` (TBD)
Если spec расширится — `project.totalActualHours += task.actualDurationMinutes / 60` через trigger. **Сейчас не реализовано.**

#### `work_sessions/{sessionId}` — НЕТ direct writes from tasktotime triggers
Чтобы избежать circular trigger. Workers пишут в work_sessions через `useSessionManager` / Telegram bot — tasktotime только reads aggregate.

⚠️ **Существующий обратный путь:** `onWorkSessionUpdate.ts:133-146` читает `gtd_tasks` и пишет в `ai_accuracy_logs`. Это OK (не пишет обратно в task). Но **`onWorkSessionUpdate` НЕ обновляет `task.actualDurationMinutes`** — это надо добавить в новый `onWorkSessionCompleted` trigger из spec (`triggers.md:79-88`).

#### `inventory_transactions/{txId}` — write при «issue materials»
Когда юзер на UI говорит «выдал материалы по задаче» — пишется `inventory_transactions` doc с `relatedTaskId`. Это **не trigger от tasktotime**, это direct UI action через `inventoryService.createTransaction`.

#### `aiAuditLogs/{logId}` — write при AI generation flow
Callable `generateAiTask` пишет audit log с `taskId` после confirm. Independent collection, append-only.

#### `_idempotency/{key}` (или `processedEvents/{id}`) — write от каждого trigger
**Important:** не существует в проде сегодня. Tasktotime создаёт. TTL — 5 минут стандартно.

#### `salary_adjustments/{id}` или `payroll_ledger/{entryId}` — write от `overdueEscalation` cron
Bonus/penalty entries. Writer: scheduled function `overdueEscalation` (`triggers.md:124-131`). Idempotency: `task.payrollProcessedAt != null` guard.

⚠️ **Коллекция `salary_adjustments` НЕ существует в проде.** Может пишется в `payroll_ledger` (line 423 firestore.rules). Spec должен уточнить точное имя.

#### Subcollection `tasktotime_tasks/{taskId}/wiki_history/{versionId}`
Write от `onWikiUpdate` trigger когда `versionHistory.length >= 10` — append old version into subcollection. Idempotency: append-only by version number.

### External side effects

#### Telegram bot messages (через `sendMessageToWorker`)

- **Где:** `onTaskCreate`, `onTaskUpdate` (assignee added), `deadlineReminders`, `onTaskTransition` (action='complete' notify reviewer)
- **Trigger pattern:** `await sendMessageToWorker(assigneeId, message)` (`workerMessaging.ts:7-58`)
- **Idempotency guard:** **MISSING** в текущем коде — bot может спамить если trigger перезапустится. Tasktotime должен добавить `lastNotificationAt` поле или dedup через `processedEvents`
- **Reverse impact:** если Telegram API down — выкинет error но не зафейлит trigger (try/catch, return null)
- **Cost:** $0 (Telegram API free) но spam customer experience risk

#### Email notifications (через Brevo)

- **Где:** TBD — текущий код только для invitations. Tasktotime может расширить
- **Trigger pattern:** `emailService.sendTaskAssigned({ ... })`
- **Idempotency:** через `notifications/` collection (firestore.rules:225)
- **Reverse impact:** failed sends → пишется в `emailEvents/` (super-admin only read)

#### Push notifications (web push)

- **Где:** `notifications/{id}` collection (firestore.rules:225-233)
- **Trigger pattern:** Cloud Function пишет doc, frontend listener показывает
- **Idempotency:** через docID

#### BigQuery audit log

- **Где:** Все trigger'ы зовут `logAuditEvent` (`functions/src/utils/auditLogger.ts:87-113`)
- **Trigger pattern:** Non-blocking, fire-and-forget
- **Idempotency:** event_id unique (timestamp + random)
- **Reverse impact:** Failed inserts logged to `systemErrors/` (super-admin only)

#### Cloud Storage (Firebase Storage)

- **Где:** `Task.attachments[].url`, `Task.wiki.attachments[].url`, `Task.acceptance.photos[]`
- **Trigger pattern:** Frontend uploads via Storage SDK, then writes URL to Firestore
- **Idempotency:** Hash-based filenames для dedup
- **Reverse impact:** Storage quota exceeded → upload fails

## Diagram

```
                  ┌─────────────────────────┐
                  │  tasktotime_tasks/{id}  │ ← главная writeable
                  └──────────┬──────────────┘
                             │
       ┌─── reads ──┬────────┴────────┬─── writes ──┐
       │            │                 │             │
       ▼            ▼                 ▼             ▼
   ┌─────────┐  ┌─────────┐    ┌─────────────┐  ┌──────────────┐
   │clients/ │  │users/   │    │tasktotime_  │  │inventory_    │
   │projects/│  │employees│    │transitions/ │  │transactions/ │
   │contacts/│  │  (FK)   │    │  (audit)    │  │  (issue)     │
   │sites/   │  └─────────┘    └─────────────┘  └──────────────┘
   │estimates│
   │notes/   │  ┌─────────┐    ┌─────────────┐  ┌──────────────┐
   │files/   │  │work_    │    │processedEv/ │  │payroll_ledger│
   │companies│  │sessions │    │_idempotency │  │salary_adjust │
   └─────────┘  └─────────┘    │ (TTL)       │  │ (bonus/pen)  │
                ↑              └─────────────┘  └──────────────┘
                │
   ┌────────────┼─────── trigger pulls ────────────┐
   │            │                                  │
   ▼            ▼                                  ▼
   onTaskCreate    onWorkSessionCompleted       overdueEscalation (cron)
   onTaskUpdate    (NEW from spec)              deadlineReminders (cron)
   onTaskTransition                              recomputeCriticalPath (pubsub)
   onWikiUpdate

  External side effects ──→ Telegram (sendMessageToWorker)
                          ─→ Email (Brevo)
                          ─→ Push (notifications/)
                          ─→ BigQuery (auditLogger)
                          ─→ Cloud Storage (file uploads)
```

## Risks & gotchas

### Stale denormalized data (HIGH)
- `Task.clientName` ↔ `clients/{id}.name` — нет sync trigger
- `Task.projectName` ↔ `projects/{id}.name` — нет sync trigger
- `Task.assignedTo.name` ↔ `users/{uid}.displayName` — нет sync trigger
- `Task.materials[].name` ↔ `inventory_catalog/{id}.name` — нет sync trigger
- **Mitigation:** Phase 1 — add `onClientUpdate`, `onUserUpdate`, `onProjectUpdate` cleanup triggers OR document «lazy reconcile in UI» as accepted tech-debt

### N+1 queries (MEDIUM)
- TaskList view загружает 50 задач → каждая с `linkedContactIds[]` → потенциально 50 × 5 = 250 contact reads
- **Mitigation:** lazy load contacts в task detail; batch get при list view; кэш на уровне React Query / SWR

### Cross-tenant leak (HIGH)
- `gtd_tasks` legacy docs **без `companyId`** (см. `migration-mapping.md:117-124`)
- Migration script добавляет, но fresh writes из existing gtd_tasks UI continue без companyId
- **Mitigation:** strict Firestore rule `request.resource.data.companyId == requestingUserCompanyId()`. Migration script bulletproof. Default deny если companyId missing.

### Missing composite indexes
Уже существуют в `firestore.indexes.json`:
- `gtd_tasks (clientId, createdAt DESC)` ✅
- `gtd_tasks (assigneeId, createdAt DESC)` ✅
- `gtd_tasks (status, dueDate)` ✅
- `gtd_tasks (status, priority)` ✅
- `work_sessions (relatedTaskId, startTime DESC)` ✅
- `files (linkedTo.taskId, uploadedAt DESC)` ✅

**Missing для tasktotime:**
- `tasktotime_tasks (companyId, lifecycle, dueAt)` — для CRM dashboard «всё что near deadline»
- `tasktotime_tasks (companyId, assignedTo.id, lifecycle)` — для personal task list
- `tasktotime_tasks (companyId, projectId, parentTaskId)` — для hierarchy queries
- `tasktotime_tasks (companyId, parentTaskId, lifecycle)` — for subtaskRollup recompute
- `tasktotime_transitions (companyId, taskId, at DESC)`
- `tasktotime_transitions (companyId, action, at DESC)`

### Circular triggers (CRITICAL — $10k bomb risk)
Сценарии loop'ов:

1. **`onTaskUpdate` → `subtaskRollup` recompute → re-trigger:**
   - subtask меняется → trigger пишет `parent.subtaskRollup`
   - parent doc update → re-trigger того же `onTaskUpdate`
   - Если в watchlist `subtaskRollup` → bomb. **Mitigation:** WATCHED_FIELDS exclude `subtaskRollup`, `isCriticalPath`, `slackMinutes`, `blocksTaskIds`

2. **`onWorkSessionCompleted` → write `task.actualDurationMinutes`:**
   - Если `onTaskUpdate` watching `actualDurationMinutes` → re-trigger → re-aggregate → loop
   - **Mitigation:** Use `metricsProcessedAt` marker и/или watching list exclusion

3. **`onTaskTransition` → cascade unblock dependent tasks → их `onTaskUpdate` triggers:**
   - 100 dependent tasks → 100 trigger executions
   - **Mitigation:** Pub/Sub debounce, batch updates

### gtd_tasks security rule bug
`firestore.rules` line 343: `allow read: if true` — **публичное чтение всех задач без auth!** Известный (recorded в memory обзоре Apr 25). Tasktotime rules ДОЛЖЕН ставить `allow read: if isSignedIn() && resource.data.companyId == getUserCompany()`.

### Двойной namespace (`employees/` vs `users/`)
sendMessageToWorker (`workerMessaging.ts:11-22`) ищет в обоих. UserRef.id ambiguous. **Mitigation:** UserRef extends `{ namespace?: 'users' | 'employees' }` или migration to unify.

### Cleanup при удалении clients/projects
Если удалить `clients/{id}` — все задачи остаются с `clientId` указывающим на не-existing doc. UI показывает blank. **Mitigation:** soft-delete (`isArchived: true`) только, без hard delete; либо trigger `onClientDelete` → bulk update tasks `clientArchivedAt`.

## Acceptance for Phase 1

- ✅ Все 17 inputs покрыты adapter ports (`ClientPort`, `ProjectPort`, `UserPort`, `EmployeePort`, `ContactPort`, `SitePort`, `InventoryCatalogPort`, `InventoryTxPort`, `EstimatePort`, `NotePort`, `FilePort`, `WorkSessionPort`, `AIAuditPort`, `AIAccuracyPort`, `AICachePort`, `IdempotencyPort`, `PayrollPort`)
- ✅ Все writes через `TaskRepository` (single writer-class) — никто кроме него не пишет в `tasktotime_tasks` и `tasktotime_transitions`
- ✅ `TelegramNotifier`, `EmailNotifier`, `PushNotifier`, `BigQueryAuditor`, `StorageUploader` — отдельные классы (мокабельны)
- ✅ Tests с mock'ами всех ports без emulator
- ✅ Idempotency contract: каждый trigger принимает `idempotencyKey: string` параметр; check `processedEvents/{key}` ДО любых writes
- ✅ Composite indexes для типовых queries добавлены в `firestore.indexes.json`
- ✅ `firestore.rules` для `tasktotime_tasks` и `tasktotime_transitions` строго company-scoped (НЕ повторять баг line 343)
- ✅ UserRef с явным `namespace: 'users' | 'employees'` или unified migration
- ✅ Cleanup triggers для денормализованных полей (или explicit «accept stale» tech-debt note)

---

**См. также:**
- [Collections](collections.md) — high-level коллекции
- [Indexes](indexes.md) — composite indexes
- [Rules](rules.md) — firestore.rules
- [Migration mapping](migration-mapping.md) — gtd_tasks → tasktotime_tasks
- [`../05-api/triggers.md`](../05-api/triggers.md) — детали trigger'ов
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — Task interface
- [`../02-data-model/sub-types.md`](../02-data-model/sub-types.md) — UserRef, Money, etc.
- [`../10-decisions/open-questions.md`](../10-decisions/open-questions.md)
