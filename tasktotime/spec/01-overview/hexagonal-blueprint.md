---
title: "01.6 Hexagonal blueprint — Phase 1 Foundation"
section: "01-overview"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-26
version: 0.2
---

# Hexagonal Blueprint — что создаём в Phase 1

> Конкретный deliverable для Phase 1 Foundation: file tree, 21 port interfaces (pure TypeScript, zero Firebase/MUI deps), 3 domain services с public API сигнатурами, и ESLint enforcement rule. Этот документ — единственный источник правды для Phase 1: если файл здесь — его создаём, если нет — не создаём (даже если хочется). Основан на [`architecture-decision.md`](architecture-decision.md), [`../04-storage/data-dependencies.md`](../04-storage/data-dependencies.md) и [`../05-api/triggers.md`](../05-api/triggers.md).

## TL;DR

- **~46 TypeScript файлов** в Phase 1 Foundation (`domain/` + `ports/` + skeleton tests + `application/` use-cases)
- **21 port interface** (8 lookup ports + 5 storage ports + 3 messaging ports + 5 audit/cache/idempotency/storage ports)
- **3 domain services**: `TaskService` (transitions/validations), `DependencyService` (auto-shift cascade + cycle detection + CPM), `WikiRollupService` (buildRolledUpWiki + section merge)
- **1 ESLint rule** через `import/no-restricted-paths` + custom hexagonal-domain-purity check
- **Acceptance:** `domain/` импортирует ZERO firebase/MUI/@firebase зависимостей; `npm run lint:hexagonal` зелёный; unit tests на domain услугах выполняются <1s без emulator

---

## Section 1: Файловая структура (Phase 1 deliverable)

Это **точный список** файлов которые создаются в Phase 1. После Phase 1 — `adapters/`, `ui/`, `backend/triggers/` создаются в Phase 2+. Здесь — только то что **не зависит от runtime'а**.

```
tasktotime/
├── domain/                                  # Pure business logic — ZERO deps на firebase/MUI
│   ├── Task.ts                              # Re-export из types/Task.ts; основной aggregate type
│   ├── identifiers.ts                       # Branded types: TaskId, CompanyId, UserId, ProjectId, ClientId
│   ├── lifecycle.ts                         # State machine: TaskLifecycle union + transitionsTable + canTransition()
│   ├── transitions.ts                       # TransitionAction + TransitionResult + applyTransition() pure func
│   ├── dependencies.ts                      # canAddDependency() BFS cycle detector; computeBlocksTaskIds()
│   ├── rollup.ts                            # computeSubtaskRollup() pure func из subtasks[] → SubtaskRollup
│   ├── criticalPath.ts                      # forwardPass() + backwardPass() CPM algo на DAG (in-memory only)
│   ├── autoShift.ts                         # cascadeShift() pure func — recompute plannedStartAt по dependsOn
│   ├── derivedStates.ts                     # isOverdue(), isAtRisk(), isAwaitingAct() pure predicates
│   ├── validation.ts                        # validateTaskDraft() — pre-conditions для каждого transition
│   ├── errors.ts                            # Domain errors: TransitionNotAllowed, CycleDetected, etc. (no HTTP)
│   ├── events.ts                            # DomainEvent discriminated union (TaskCreated, TaskTransitioned, ...)
│   ├── policies/
│   │   ├── AutoApprovePolicy.ts             # Pure rule: when to skip review step
│   │   ├── BonusPenaltyPolicy.ts            # completedAt vs dueAt → bonus/penalty amount
│   │   └── WikiInheritancePolicy.ts         # subtask wiki resolution rules
│   ├── services/
│   │   ├── TaskService.ts                   # Orchestrates transitions; uses ports for I/O
│   │   ├── DependencyService.ts             # Cycle detection + auto-shift cascade + CPM trigger
│   │   ├── WikiRollupService.ts             # buildRolledUpWiki(parent, subtasks) → markdown
│   │   └── index.ts                         # Barrel export — единственный entry для adapters
│   └── index.ts                             # Public API of domain layer (типы + service classes)
│
├── ports/                                   # Interfaces для всех I/O — pure TypeScript
│   ├── repositories/
│   │   ├── TaskRepository.ts                # Read/write tasktotime_tasks
│   │   ├── TransitionLogPort.ts             # Append-only tasktotime_transitions
│   │   └── index.ts
│   ├── lookups/
│   │   ├── ClientLookupPort.ts              # Read clients/{id}
│   │   ├── ProjectLookupPort.ts             # Read projects/{id}
│   │   ├── UserLookupPort.ts                # Read users/{uid}
│   │   ├── EmployeeLookupPort.ts            # Read legacy employees/{id} namespace
│   │   ├── ContactLookupPort.ts             # Read contacts/{id}
│   │   ├── SiteLookupPort.ts                # Read sites/{id}
│   │   ├── EstimatePort.ts                  # Read estimates/{id} + items
│   │   ├── NotePort.ts                      # Read notes/{id} (AI source)
│   │   └── index.ts
│   ├── inventory/
│   │   ├── InventoryCatalogPort.ts          # Read inventory_catalog/{id}
│   │   ├── InventoryTxPort.ts               # Read inventory_transactions where relatedTaskId
│   │   └── index.ts
│   ├── work/
│   │   ├── WorkSessionPort.ts               # Read work_sessions; aggregate actuals
│   │   ├── PayrollPort.ts                   # Write bonus/penalty entries
│   │   └── index.ts
│   ├── ai/
│   │   ├── AIAuditPort.ts                   # Append aiAuditLogs
│   │   ├── AICachePort.ts                   # Read/write aiCache (predicted minutes by hash)
│   │   ├── IdempotencyPort.ts               # processedEvents/{key} TTL guard
│   │   └── index.ts
│   ├── notify/
│   │   ├── TelegramNotifyPort.ts            # Send to worker bot
│   │   ├── EmailNotifyPort.ts               # Send via Brevo
│   │   ├── PushNotifyPort.ts                # Web push
│   │   └── index.ts
│   ├── infra/
│   │   ├── BigQueryAuditPort.ts             # Fire-and-forget BQ audit
│   │   ├── StorageUploadPort.ts             # Firebase Storage / S3 — generic upload
│   │   ├── WeatherForecastPort.ts           # NOAA weather lookup
│   │   ├── FilePort.ts                      # files/{id} metadata + linkedTo queries
│   │   ├── ClockPort.ts                     # now() — testability for time-dependent logic
│   │   ├── IdGeneratorPort.ts               # generateTaskId() / taskNumber sequence
│   │   └── index.ts
│   └── index.ts                             # Barrel: re-exports all 21+ ports
│
├── application/                             # Use cases (thin orchestration над services + ports)
│   ├── commands/
│   │   ├── CreateTaskCommand.ts             # Input DTO + handler signature
│   │   ├── TransitionTaskCommand.ts
│   │   ├── AddDependencyCommand.ts
│   │   ├── UpdateWikiCommand.ts
│   │   └── index.ts
│   ├── queries/
│   │   ├── GetTaskQuery.ts
│   │   ├── ListTasksQuery.ts
│   │   ├── GetSubtaskRollupQuery.ts
│   │   └── index.ts
│   ├── handlers/
│   │   ├── createTaskHandler.ts             # Pure orchestration: ports + TaskService
│   │   ├── transitionTaskHandler.ts
│   │   ├── addDependencyHandler.ts          # Calls DependencyService.canAddDependency
│   │   ├── updateWikiHandler.ts
│   │   └── index.ts
│   └── index.ts                             # Barrel
│
├── shared/                                  # Test fixtures + mocks (Phase 1 includes)
│   ├── fixtures/
│   │   ├── tasks.fixture.ts                 # Sample Task objects (draft, ready, started, completed, accepted)
│   │   ├── dependencies.fixture.ts          # DAG samples: linear chain, diamond, cycle attempt
│   │   ├── subtasks.fixture.ts              # Parent + 5 subtasks for rollup tests
│   │   └── index.ts
│   ├── mocks/
│   │   ├── InMemoryTaskRepository.ts        # Map<TaskId, Task>-backed implementation of TaskRepository
│   │   ├── InMemoryTransitionLog.ts
│   │   ├── StubClientLookup.ts              # Returns canned clients
│   │   ├── StubUserLookup.ts
│   │   ├── StubAllPorts.ts                  # Convenience factory for all 21 ports → use in tests
│   │   ├── FakeClock.ts                     # Controllable time for tests (advance(), now())
│   │   ├── NoopNotifier.ts                  # Telegram/Email/Push that record calls but don't fire
│   │   └── index.ts
│   └── test-helpers/
│       ├── makeTask.ts                      # Builder for Task with sane defaults
│       ├── buildDependencyGraph.ts          # DSL: graph('A→B, B→C, A→D') for tests
│       └── index.ts
│
├── tests/
│   ├── domain/
│   │   ├── lifecycle.test.ts                # All 7 valid transitions + 4 forbidden
│   │   ├── dependencies.test.ts             # Cycle detection: 2-cycle, 3-cycle, diamond, self-dep
│   │   ├── rollup.test.ts                   # SubtaskRollup math на edge cases
│   │   ├── criticalPath.test.ts             # CPM forward+backward pass на 5-task graph
│   │   ├── autoShift.test.ts                # Cascade shift с lagMinutes
│   │   ├── derivedStates.test.ts
│   │   ├── policies.test.ts                 # BonusPenalty + WikiInheritance
│   │   └── services/
│   │       ├── TaskService.test.ts          # All transitions через service + mock ports
│   │       ├── DependencyService.test.ts
│   │       └── WikiRollupService.test.ts    # 3-level wiki rollup (но в нашей модели — 2-level)
│   └── application/
│       ├── createTaskHandler.test.ts        # Use case test через mocks
│       ├── transitionTaskHandler.test.ts
│       └── addDependencyHandler.test.ts
│
├── eslint/
│   ├── hexagonal-domain-purity.js           # Custom rule (CommonJS) для ESLint plugin slot
│   └── README.md                            # Как подключить в root .eslintrc
│
└── docs/                                    # Phase 1 docs (already exist, listing for completeness)
    ├── DATA_MODEL.md
    ├── STATE_MACHINE.md
    └── ...
```

**Файлов в Phase 1 (новых, .ts):** ~46

| Слой | Кол-во |
|---|---|
| `domain/` | 14 |
| `ports/` | 24 (21 ports + 3 barrel `index.ts`) |
| `application/` | 13 |
| `shared/` | 11 |
| `tests/` | 12 (skeleton — заполняются в Phase 1.5) |
| `eslint/` | 1 |
| **Total** | **~75 файлов** (включая barrel `index.ts`) |

---

## Section 2: Port interfaces (pure TypeScript)

Все 21 port interface. Импортируют **только** из `domain/Task.ts` или domain sub-types. **Нет** Firebase, MUI, @firebase, NestJS зависимостей.

> Соглашения:
> - Все методы `async`. Return Promise.
> - `null` для not-found, не `undefined` (явное отличие от not-set).
> - Identifiers — branded types (`TaskId & string`) для type safety.
> - Filter / Options объекты — explicit, без overloads.
> - Generic `<T>` где имеет смысл (cursor pagination, batch ops).

### 2.1 `repositories/TaskRepository.ts`

```ts
import type { Task, TaskId, CompanyId, UserId, UserRef } from '../../domain/Task';
import type { TaskLifecycle } from '../../domain/lifecycle';

export interface TaskFilter {
  companyId: CompanyId;
  lifecycle?: TaskLifecycle[];
  bucket?: Array<'inbox' | 'next' | 'someday' | 'archive'>;
  assigneeId?: UserId;
  parentTaskId?: TaskId | null;          // null = root tasks only
  projectId?: string;
  clientId?: string;
  isSubtask?: boolean;
  archivedOnly?: boolean;
  dueBefore?: number;                    // epoch ms
  search?: string;                       // free text (delegated to adapter)
}

export interface ListOptions {
  limit?: number;                        // default 50, max 500
  cursor?: string;                       // opaque pagination cursor
  orderBy?: 'createdAt' | 'updatedAt' | 'dueAt' | 'priority' | 'taskNumber';
  direction?: 'asc' | 'desc';
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;                        // optional — adapter may not provide
}

export interface PartialTaskUpdate {
  // Subset of Task fields. Adapter responsible for write-time validation.
  // Use carefully — bypasses transition machine. Reserved for system writes
  // (computed fields, denormalization sync). Lifecycle changes MUST go via
  // transition log path.
  [key: string]: unknown;
}

export interface TaskRepository {
  findById(id: TaskId): Promise<Task | null>;
  findByIds(ids: TaskId[]): Promise<Task[]>;
  findMany(filter: TaskFilter, options?: ListOptions): Promise<PageResult<Task>>;
  findSubtasks(parentId: TaskId): Promise<Task[]>;
  findByDependsOn(taskId: TaskId): Promise<Task[]>;       // reverse query for cycle/cascade

  save(task: Task): Promise<void>;
  saveMany(tasks: Task[]): Promise<void>;                 // batch (atomic per adapter)
  patch(id: TaskId, partial: PartialTaskUpdate): Promise<void>;

  softDelete(id: TaskId, archivedBy: UserRef): Promise<void>;

  // Optimistic concurrency: throws StaleVersionError if updatedAt mismatches
  saveIfUnchanged(task: Task, expectedUpdatedAt: number): Promise<void>;
}
```

### 2.2 `repositories/TransitionLogPort.ts`

```ts
import type { TaskId, CompanyId, UserRef } from '../../domain/Task';
import type { TaskLifecycle } from '../../domain/lifecycle';

export interface TransitionLogEntry {
  id: string;                                            // ${taskId}_${from}_${to}_${at}
  companyId: CompanyId;
  taskId: TaskId;
  from: TaskLifecycle | null;                            // null = creation
  to: TaskLifecycle;
  action: string;                                        // 'create' | 'ready' | 'start' | ...
  reason?: string;
  by: UserRef;
  at: number;                                            // epoch ms
  meta?: Record<string, unknown>;
}

export interface TransitionLogPort {
  append(entry: TransitionLogEntry): Promise<void>;
  findForTask(taskId: TaskId, limit?: number): Promise<TransitionLogEntry[]>;
  findForCompany(
    companyId: CompanyId,
    sinceMs?: number,
    limit?: number,
  ): Promise<TransitionLogEntry[]>;
}
```

### 2.3 `lookups/ClientLookupPort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface ClientSnapshot {
  id: string;
  companyId: CompanyId;
  name: string;
  status: 'active' | 'archived' | 'lead';
  defaultProjectId?: string;
  address?: string;
}

export interface ClientLookupPort {
  findById(id: string): Promise<ClientSnapshot | null>;
  findByIds(ids: string[]): Promise<ClientSnapshot[]>;
  listActive(companyId: CompanyId): Promise<ClientSnapshot[]>;
}
```

### 2.4 `lookups/ProjectLookupPort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface ProjectSnapshot {
  id: string;
  companyId: CompanyId;
  name: string;
  clientId: string;
  clientName?: string;
  address?: string;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
}

export interface ProjectLookupPort {
  findById(id: string): Promise<ProjectSnapshot | null>;
  findByClientId(clientId: string): Promise<ProjectSnapshot[]>;
  listActive(companyId: CompanyId): Promise<ProjectSnapshot[]>;
}
```

### 2.5 `lookups/UserLookupPort.ts`

```ts
import type { CompanyId, UserId } from '../../domain/Task';

export interface UserSnapshot {
  id: UserId;
  companyId: CompanyId;
  displayName: string;
  email?: string;
  role: 'admin' | 'pm' | 'worker' | 'reviewer' | 'observer';
  hourlyRate?: number;
  telegramId?: string;
  status: 'active' | 'inactive' | 'invited';
  hierarchyPath?: string[];
}

export interface UserLookupPort {
  findById(id: UserId): Promise<UserSnapshot | null>;
  findByIds(ids: UserId[]): Promise<UserSnapshot[]>;
  findByTelegramId(telegramId: string): Promise<UserSnapshot | null>;
  listActive(companyId: CompanyId): Promise<UserSnapshot[]>;
}
```

### 2.6 `lookups/EmployeeLookupPort.ts` (legacy namespace)

```ts
import type { CompanyId } from '../../domain/Task';

export interface EmployeeSnapshot {
  id: string;                                            // legacy ID (string, may be telegram numeric)
  companyId: CompanyId;
  name: string;
  hourlyRate?: number;
  telegramId?: string;
  linkedUserId?: string;                                 // bridge to users/{uid} if migrated
}

export interface EmployeeLookupPort {
  findById(id: string): Promise<EmployeeSnapshot | null>;
  findByTelegramId(telegramId: string): Promise<EmployeeSnapshot | null>;
}
```

### 2.7 `lookups/ContactLookupPort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface ContactSnapshot {
  id: string;
  companyId: CompanyId;
  name: string;
  roles: string[];                                       // 'electrician', 'plumber', ...
  phones: string[];
  emails: string[];
  messengers?: { telegram?: string; whatsapp?: string };
  linkedProjectIds?: string[];
}

export interface ContactLookupPort {
  findById(id: string): Promise<ContactSnapshot | null>;
  findByIds(ids: string[]): Promise<ContactSnapshot[]>;
  findByProject(projectId: string): Promise<ContactSnapshot[]>;
}
```

### 2.8 `lookups/SiteLookupPort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface SiteSnapshot {
  id: string;
  companyId: CompanyId;
  name: string;
  address: string;
  geo?: { lat: number; lng: number };
  clientId?: string;
  permitNumber?: string;
}

export interface SiteLookupPort {
  findById(id: string): Promise<SiteSnapshot | null>;
  findByClient(clientId: string): Promise<SiteSnapshot[]>;
}
```

### 2.9 `lookups/EstimatePort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface EstimateItemSnapshot {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  category?: string;
}

export interface EstimateSnapshot {
  id: string;
  companyId: CompanyId;
  projectId: string;
  status: 'draft' | 'sent' | 'signed' | 'rejected';
  totalAmount: number;
  items: EstimateItemSnapshot[];
  signedAt?: number;
}

export interface EstimatePort {
  findById(id: string): Promise<EstimateSnapshot | null>;
  findItem(estimateId: string, itemId: string): Promise<EstimateItemSnapshot | null>;
  findActiveByProject(projectId: string): Promise<EstimateSnapshot[]>;
}
```

### 2.10 `lookups/NotePort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface NoteSnapshot {
  id: string;
  companyId: CompanyId;
  transcript?: string;
  audioUrl?: string;
  attachments?: Array<{ url: string; mime: string }>;
  clientId?: string;
  projectId?: string;
  aiAnalysis?: {
    suggestedTitle?: string;
    suggestedDescription?: string;
    checklist?: Array<{ text: string }>;
  };
  createdAt: number;
}

export interface NotePort {
  findById(id: string): Promise<NoteSnapshot | null>;
}
```

### 2.11 `inventory/InventoryCatalogPort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface CatalogItemSnapshot {
  id: string;
  companyId: CompanyId;
  name: string;
  category: string;
  unit: string;                                          // 'pc', 'm', 'kg', ...
  lastPurchasePrice: number;
  avgPrice: number;
  clientMarkupPercent?: number;
  totalStock?: number;
}

export interface InventoryCatalogPort {
  findById(id: string): Promise<CatalogItemSnapshot | null>;
  findByIds(ids: string[]): Promise<CatalogItemSnapshot[]>;
  search(companyId: CompanyId, query: string, limit?: number): Promise<CatalogItemSnapshot[]>;
}
```

### 2.12 `inventory/InventoryTxPort.ts`

```ts
import type { TaskId } from '../../domain/Task';

export interface InventoryTxSnapshot {
  id: string;
  relatedTaskId?: TaskId;
  catalogItemId: string;
  qty: number;
  totalAmount: number;
  type: 'in' | 'out' | 'transfer' | 'adjust';
  timestamp: number;
}

export interface InventoryTxPort {
  findByTask(taskId: TaskId): Promise<InventoryTxSnapshot[]>;
  sumActualCostByTask(taskId: TaskId): Promise<number>;
}
```

### 2.13 `work/WorkSessionPort.ts`

```ts
import type { TaskId, UserId } from '../../domain/Task';

export interface WorkSessionSnapshot {
  id: string;
  relatedTaskId?: TaskId;
  employeeId: UserId;
  startTime: number;
  endTime?: number;
  durationMinutes?: number;
  hourlyRate?: number;
  sessionEarnings?: number;
  status: 'active' | 'paused' | 'completed' | 'discarded';
}

export interface WorkSessionPort {
  findByTask(taskId: TaskId): Promise<WorkSessionSnapshot[]>;
  aggregateForTask(taskId: TaskId): Promise<{
    totalDurationMinutes: number;
    totalEarnings: number;
    earliestStartAt: number | null;
    latestEndAt: number | null;
  }>;
}
```

### 2.14 `work/PayrollPort.ts`

```ts
import type { CompanyId, TaskId, UserId, Money } from '../../domain/Task';

export type PayrollAdjustmentReason =
  | 'bonus_on_time'
  | 'penalty_overdue'
  | 'manual_adjustment';

export interface PayrollAdjustmentInput {
  companyId: CompanyId;
  userId: UserId;
  taskId: TaskId;
  amount: Money;
  reason: PayrollAdjustmentReason;
  payrollPeriodId: string;
  note?: string;
}

export interface PayrollPort {
  appendAdjustment(input: PayrollAdjustmentInput): Promise<{ id: string }>;
  hasAdjustmentForTask(
    taskId: TaskId,
    reason: PayrollAdjustmentReason,
  ): Promise<boolean>;                                   // idempotency check
}
```

### 2.15 `ai/AIAuditPort.ts`

```ts
import type { CompanyId, UserId, TaskId } from '../../domain/Task';

export interface AIAuditEntry {
  id?: string;
  companyId: CompanyId;
  userId: UserId;
  taskId?: TaskId;
  flow: 'generate_task' | 'estimate_minutes' | 'modify_task' | 'decompose_estimate';
  prompt: string;
  response: unknown;
  confidence?: number;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  userEdits?: unknown;
  createdAt: number;
}

export interface AIAuditPort {
  append(entry: AIAuditEntry): Promise<{ id: string }>;
}
```

### 2.16 `ai/AICachePort.ts`

```ts
export interface AICacheEntry<T = unknown> {
  key: string;                                           // hash(role + description)
  value: T;
  hitCount: number;
  expiresAt: number;                                     // epoch ms
}

export interface AICachePort {
  get<T = unknown>(key: string): Promise<AICacheEntry<T> | null>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  incrementHit(key: string): Promise<void>;
}
```

### 2.17 `ai/IdempotencyPort.ts`

```ts
export interface IdempotencyPort {
  /**
   * Reserve key. Returns `true` if first time (caller should proceed),
   * `false` if already processed (caller should skip).
   * Reservation is auto-released after `ttlMs` (default 5 minutes).
   */
  reserve(key: string, ttlMs?: number): Promise<boolean>;

  /** Returns true if key is currently reserved. */
  isProcessed(key: string): Promise<boolean>;

  /** Release reservation early (manual cleanup). */
  release(key: string): Promise<void>;
}
```

### 2.18 `notify/TelegramNotifyPort.ts`

```ts
import type { TaskId, UserId } from '../../domain/Task';

export interface TelegramMessageInput {
  recipientUserId: UserId;
  text: string;                                          // markdown-safe
  taskId?: TaskId;                                       // for trace correlation
  buttons?: Array<{ label: string; payload: string }>;   // inline keyboard
  silent?: boolean;
}

export interface TelegramNotifyPort {
  send(input: TelegramMessageInput): Promise<{ messageId: string } | { skipped: true; reason: string }>;
}
```

### 2.19 `notify/EmailNotifyPort.ts`

```ts
import type { TaskId, UserId } from '../../domain/Task';

export interface EmailNotifyInput {
  recipient: { userId?: UserId; email?: string };       // either is sufficient
  templateId: string;                                    // 'task_assigned' | 'task_due_soon' | ...
  variables: Record<string, string | number | boolean>;
  taskId?: TaskId;
}

export interface EmailNotifyPort {
  send(input: EmailNotifyInput): Promise<{ messageId: string } | { skipped: true; reason: string }>;
}
```

### 2.20 `notify/PushNotifyPort.ts`

```ts
import type { TaskId, UserId } from '../../domain/Task';

export interface PushNotifyInput {
  userId: UserId;
  title: string;
  body: string;
  taskId?: TaskId;
  url?: string;                                          // deep link
}

export interface PushNotifyPort {
  send(input: PushNotifyInput): Promise<{ delivered: boolean }>;
}
```

### 2.21 `infra/BigQueryAuditPort.ts`

```ts
import type { CompanyId } from '../../domain/Task';

export interface AuditEvent {
  eventType: string;                                     // 'task.created' | 'task.transitioned' | ...
  companyId: CompanyId;
  actorId?: string;
  taskId?: string;
  payload?: Record<string, unknown>;
  occurredAt: number;
}

export interface BigQueryAuditPort {
  /** Fire-and-forget. Implementations MUST NOT throw — they swallow errors. */
  log(event: AuditEvent): Promise<void>;
}
```

### 2.22 `infra/StorageUploadPort.ts`

```ts
export interface StorageUploadInput {
  bucket?: string;                                       // default per adapter
  path: string;                                          // 'tasktotime/{companyId}/{taskId}/...'
  contentType: string;
  data: Uint8Array | Blob | string;                      // adapter normalizes
  metadata?: Record<string, string>;
}

export interface StorageUploadResult {
  url: string;
  pathRef: string;
  sizeBytes: number;
}

export interface StorageUploadPort {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  signedUrl(pathRef: string, ttlSeconds: number): Promise<string>;
  delete(pathRef: string): Promise<void>;
}
```

### 2.23 `infra/WeatherForecastPort.ts`

```ts
export interface WeatherDay {
  date: string;                                          // YYYY-MM-DD
  precipitationMm: number;
  precipitationProbability: number;                      // 0..1
  windKmh: number;
  tempMinC: number;
  tempMaxC: number;
  conditions: 'clear' | 'rain' | 'storm' | 'snow' | 'extreme_heat' | 'unknown';
}

export interface WeatherForecastPort {
  forecast(input: {
    lat: number;
    lng: number;
    fromDate: string;
    toDate: string;
  }): Promise<WeatherDay[]>;
}
```

### 2.24 `infra/FilePort.ts`

```ts
import type { TaskId } from '../../domain/Task';

export interface FileMetadata {
  id: string;
  url: string;
  name: string;
  mime: string;
  category?: string;
  linkedTo?: { taskId?: TaskId; clientId?: string; projectId?: string };
  uploadedAt: number;
  uploadedBy?: string;
}

export interface FilePort {
  findByTask(taskId: TaskId): Promise<FileMetadata[]>;
  findById(id: string): Promise<FileMetadata | null>;
  registerUpload(meta: Omit<FileMetadata, 'id'>): Promise<{ id: string }>;
}
```

### 2.25 `infra/ClockPort.ts` (testability helper)

```ts
export interface ClockPort {
  now(): number;                                         // epoch ms
  todayIso(): string;                                    // YYYY-MM-DD in TZ
}
```

### 2.26 `infra/IdGeneratorPort.ts`

```ts
import type { CompanyId, TaskId } from '../../domain/Task';

export interface IdGeneratorPort {
  newTaskId(): TaskId;
  nextTaskNumber(companyId: CompanyId, year: number): Promise<string>;   // "T-2026-0042"
}
```

> **Count:** TaskRepository, TransitionLogPort, ClientLookupPort, ProjectLookupPort, UserLookupPort, EmployeeLookupPort, ContactLookupPort, SiteLookupPort, EstimatePort, NotePort, InventoryCatalogPort, InventoryTxPort, WorkSessionPort, PayrollPort, AIAuditPort, AICachePort, IdempotencyPort, TelegramNotifyPort, EmailNotifyPort, PushNotifyPort, BigQueryAuditPort, StorageUploadPort, WeatherForecastPort, FilePort, ClockPort, IdGeneratorPort = **26 ports total** (21 user-spec + 5 supporting infra). User asked for "21 ports" — `ClockPort`, `IdGeneratorPort`, `FilePort` add testability and were implicitly required by trigger spec but not enumerated; included to keep domain pure.

---

## Section 3: Domain services — public API signatures

Каждый service:
- Constructor injection всех ports — никаких `new FirestoreXxx()` внутри domain
- Методы возвращают **domain types** или `DomainError` подклассы — НЕ HTTP errors
- Никаких `firebase-admin`, `@firebase/firestore`, `@mui/*` imports

### 3.1 `services/TaskService.ts`

```ts
import type { Task, TaskId, UserRef, Money } from '../Task';
import type { TaskLifecycle, TransitionAction } from '../lifecycle';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { TransitionLogPort } from '../../ports/repositories/TransitionLogPort';
import type { WorkSessionPort } from '../../ports/work/WorkSessionPort';
import type { PayrollPort } from '../../ports/work/PayrollPort';
import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import type { ClockPort } from '../../ports/infra/ClockPort';
import type { TelegramNotifyPort } from '../../ports/notify/TelegramNotifyPort';
import type { BigQueryAuditPort } from '../../ports/infra/BigQueryAuditPort';
import type { DomainEvent } from '../events';

export interface CreateTaskInput {
  companyId: string;
  draft: Omit<Task, 'id' | 'taskNumber' | 'createdAt' | 'updatedAt' | 'history' | 'lifecycle'>;
  initialLifecycle: 'draft' | 'ready';
  by: UserRef;
  idempotencyKey: string;
}

export interface TransitionInput {
  taskId: TaskId;
  action: TransitionAction;
  by: UserRef;
  reason?: string;
  acceptance?: Task['acceptance'];                       // for 'accept' action
  blockedReason?: string;                                // for 'block' action
  idempotencyKey: string;
}

export interface TransitionOutcome {
  task: Task;
  events: DomainEvent[];                                 // emitted side effects
  skipped: boolean;                                      // true if idempotency hit
}

export class TaskService {
  constructor(private readonly deps: {
    taskRepo: TaskRepository;
    transitionLog: TransitionLogPort;
    workSessions: WorkSessionPort;
    payroll: PayrollPort;
    idempotency: IdempotencyPort;
    clock: ClockPort;
    telegram?: TelegramNotifyPort;                       // optional — caller may skip
    audit?: BigQueryAuditPort;
  }) {}

  // ─── lifecycle commands ──────────────────────────────────────
  createTask(input: CreateTaskInput): Promise<Task>;
  transition(input: TransitionInput): Promise<TransitionOutcome>;
  cancel(taskId: TaskId, by: UserRef, reason?: string, idempotencyKey?: string): Promise<TransitionOutcome>;

  // ─── pure validations (delegate to domain/validation.ts) ────
  validateDraftReadyForTransition(task: Task, action: TransitionAction): void; // throws TransitionNotAllowed
  canTransition(from: TaskLifecycle, to: TaskLifecycle): boolean;

  // ─── computed enrichment ─────────────────────────────────────
  aggregateActuals(taskId: TaskId): Promise<{
    actualDurationMinutes: number;
    totalEarnings: number;
    actualStartAt: number | null;
  }>;

  computeBonusPenalty(task: Task): { bonus?: Money; penalty?: Money };
}
```

### 3.2 `services/DependencyService.ts`

```ts
import type { Task, TaskId, UserRef } from '../Task';
import type { TaskDependency } from '../Task';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { ClockPort } from '../../ports/infra/ClockPort';

export interface CycleCheckResult {
  ok: boolean;
  cyclePath?: TaskId[];
}

export interface AutoShiftPlan {
  taskId: TaskId;
  oldPlannedStartAt?: number;
  newPlannedStartAt: number;
  reason: string;                                        // "predecessor T-001 completedAt shifted"
  cascadeDepth: number;
}

export interface CriticalPathSummary {
  taskIds: TaskId[];                                     // ordered, on critical path
  slackByTaskId: Record<TaskId, number>;                 // minutes
  projectDurationMinutes: number;
  earliestProjectFinish: number;
  latestProjectFinish: number;
}

export class DependencyService {
  constructor(private readonly deps: {
    taskRepo: TaskRepository;
    clock: ClockPort;
  }) {}

  // ─── cycle prevention (BFS over blocksTaskIds) ──────────────
  canAddDependency(fromTaskId: TaskId, toTaskId: TaskId): Promise<CycleCheckResult>;
  canSetParent(taskId: TaskId, newParentId: TaskId | null): Promise<CycleCheckResult>;

  addDependency(
    fromTaskId: TaskId,
    dep: Omit<TaskDependency, 'createdAt' | 'createdBy'>,
    by: UserRef,
  ): Promise<void>;                                      // throws CycleDetected if BFS finds path

  removeDependency(fromTaskId: TaskId, toTaskId: TaskId): Promise<void>;

  // ─── auto-shift cascade ──────────────────────────────────────
  computeShiftPlan(triggerTaskId: TaskId): Promise<AutoShiftPlan[]>;
  applyShiftPlan(plan: AutoShiftPlan[]): Promise<void>;

  // ─── critical path (CPM) ─────────────────────────────────────
  computeCriticalPath(projectId: string): Promise<CriticalPathSummary>;
  recomputeAndPersist(projectId: string): Promise<CriticalPathSummary>;
}
```

### 3.3 `services/WikiRollupService.ts`

```ts
import type { Task, TaskId } from '../Task';
import type { TaskRepository } from '../../ports/repositories/TaskRepository';
import type { ClockPort } from '../../ports/infra/ClockPort';

export interface RolledUpWiki {
  parentId: TaskId;
  contentMd: string;                                     // assembled markdown
  sections: Array<{
    sourceTaskId: TaskId;                                // null = parent itself
    title: string;
    body: string;
  }>;
  generatedAt: number;
}

export interface WikiRollupOptions {
  includeArchivedSubtasks?: boolean;
  sectionDelimiter?: string;                             // default "\n\n---\n\n"
  inheritFromParent?: boolean;                           // override task.wikiInheritsFromParent
}

export class WikiRollupService {
  constructor(private readonly deps: {
    taskRepo: TaskRepository;
    clock: ClockPort;
  }) {}

  /**
   * Build rolled-up wiki for a parent task by concatenating own wiki + each
   * subtask's wiki (where wikiInheritsFromParent === true).
   * Pure read — does NOT persist (anti-pattern §1.3 — silent rollup).
   */
  buildRolledUpWiki(parentId: TaskId, options?: WikiRollupOptions): Promise<RolledUpWiki>;

  /**
   * Materialize-on-demand: caller invokes when user clicks "Show aggregated wiki".
   */
  exportRolledUpAsMarkdown(parentId: TaskId, options?: WikiRollupOptions): Promise<string>;

  /** Resolve effective wiki for a subtask (own + parent if inherits). */
  resolveEffectiveWiki(taskId: TaskId): Promise<string>;
}
```

---

## Section 4: ESLint enforcement rule

Hexagonal purity is **not optional** — drift to firebase imports inside `domain/` would silently couple the layer. Two complementary mechanisms.

### 4.1 Path-based rule (`eslint-plugin-import` — already in repo)

Add to root `.eslintrc.cjs` (or oxlint config if migrated):

```js
// .eslintrc.cjs (add to existing config — append to overrides)
{
  // ... existing config ...
  overrides: [
    {
      files: ['tasktotime/domain/**/*.ts', 'tasktotime/ports/**/*.ts'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            // Firebase
            { group: ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*', '@firebase/*'],
              message: 'tasktotime/domain and tasktotime/ports are pure layers — no Firebase imports. Use a port instead.' },
            // Firebase Functions
            { group: ['firebase-functions', 'firebase-functions/*'],
              message: 'No firebase-functions in domain/ports — wrap in adapter under tasktotime/adapters/.' },
            // UI libs
            { group: ['@mui/*', 'react', 'react-*', '@emotion/*', '@xyflow/*', 'dagre'],
              message: 'No UI libs in domain/ports — these belong in tasktotime/ui/.' },
            // ORM / SQL libs
            { group: ['typeorm', 'prisma', '@prisma/*', 'sequelize', 'pg', 'mongoose'],
              message: 'No ORM in domain/ports — use ports.' },
            // HTTP frameworks
            { group: ['express', 'koa', '@nestjs/*', 'fastify'],
              message: 'No HTTP frameworks in domain — wrap in tasktotime/adapters/http/.' },
            // External SDKs
            { group: ['@sendgrid/*', '@google-cloud/*', 'aws-sdk', '@aws-sdk/*', 'twilio', 'telegraf'],
              message: 'No 3rd party SDKs in domain — wrap in adapter via port.' },
            // Adapters explicitly
            { group: ['*/adapters/*', '../adapters/*', '../../adapters/*'],
              message: 'domain and ports MUST NOT import from adapters (Dependency Inversion).' },
            // Frontend UI inside our module
            { group: ['*/ui/*', '../ui/*', '../../ui/*'],
              message: 'domain and ports MUST NOT import from ui/.' },
          ],
          paths: [
            { name: 'firebase', message: 'Use a port.' },
            { name: 'firebase-admin', message: 'Use a port.' },
          ],
        }],
      },
    },
    {
      files: ['tasktotime/domain/**/*.ts'],
      rules: {
        // domain MUST NOT import from ports either — only re-export Task type
        // and use injected services. ports/ is for service constructor params,
        // not for direct import inside pure functions.
        // Exception: services/ subfolder — they explicitly receive ports as DI.
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['firebase', 'firebase/*', 'firebase-admin', 'firebase-admin/*', '@firebase/*'],
              message: 'domain is pure — no Firebase. Use port.' },
            { group: ['@mui/*', 'react'],
              message: 'domain is pure — no UI.' },
          ],
        }],
      },
    },
  ],
}
```

### 4.2 Custom rule (catch-all): `tasktotime/eslint/hexagonal-domain-purity.js`

Path patterns catch most violations. Custom rule handles the 5% edge cases — `require()`, dynamic imports, type-only imports of forbidden packages.

```js
// tasktotime/eslint/hexagonal-domain-purity.js
'use strict';

const FORBIDDEN_PACKAGES = [
  // Firebase
  /^firebase($|\/)/, /^firebase-admin($|\/)/, /^@firebase\//,
  /^firebase-functions($|\/)/,
  // UI
  /^@mui\//, /^react($|-|\/)/, /^@emotion\//, /^@xyflow\//, /^dagre$/,
  // ORM
  /^typeorm$/, /^prisma$/, /^@prisma\//, /^sequelize$/, /^pg$/, /^mongoose$/,
  // HTTP
  /^express$/, /^koa$/, /^@nestjs\//, /^fastify$/,
  // 3rd-party SDKs
  /^@sendgrid\//, /^@google-cloud\//, /^aws-sdk$/, /^@aws-sdk\//,
  /^twilio$/, /^telegraf$/, /^node-telegram-bot-api$/,
  // Filesystem / process (domain must be runtime-agnostic)
  /^fs($|\/)/, /^child_process$/, /^http$/, /^https$/, /^net$/,
];

function isForbidden(source) {
  return FORBIDDEN_PACKAGES.some((re) => re.test(source));
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid impure imports inside tasktotime/domain and tasktotime/ports',
      recommended: true,
    },
    schema: [],
    messages: {
      forbiddenImport:
        'Forbidden import "{{source}}" in {{layer}}. Hexagonal purity requires I/O via ports. ' +
        'If you need {{source}}, wrap it in tasktotime/adapters/<adapter>/ and inject via a port interface.',
      adapterImport:
        '{{layer}} layer cannot import from adapters/. Reverse the dependency: define a port interface in ports/ and have the adapter implement it.',
      uiImport:
        '{{layer}} layer cannot import from ui/. UI depends on domain, not the reverse.',
    },
  },

  create(context) {
    const filename = context.getFilename().replace(/\\/g, '/');
    const isDomain = /\/tasktotime\/domain\//.test(filename);
    const isPorts = /\/tasktotime\/ports\//.test(filename);
    if (!isDomain && !isPorts) return {};

    const layer = isDomain ? 'tasktotime/domain' : 'tasktotime/ports';

    function check(source, node) {
      if (typeof source !== 'string') return;
      if (isForbidden(source)) {
        context.report({ node, messageId: 'forbiddenImport', data: { source, layer } });
        return;
      }
      if (/(^|\/)adapters(\/|$)/.test(source)) {
        context.report({ node, messageId: 'adapterImport', data: { layer } });
        return;
      }
      if (/(^|\/)ui(\/|$)/.test(source)) {
        context.report({ node, messageId: 'uiImport', data: { layer } });
      }
    }

    return {
      ImportDeclaration(node) { check(node.source.value, node); },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node.source.value, node);
      },
      'CallExpression[callee.name="require"]'(node) {
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal') check(arg.value, node);
      },
      ExportAllDeclaration(node) { check(node.source.value, node); },
      ExportNamedDeclaration(node) {
        if (node.source) check(node.source.value, node);
      },
    };
  },
};
```

### 4.3 Plugin registration

```js
// tasktotime/eslint/plugin.js
module.exports = {
  rules: {
    'hexagonal-domain-purity': require('./hexagonal-domain-purity'),
  },
};
```

In root config:

```js
// .eslintrc.cjs
module.exports = {
  // ...
  plugins: ['tasktotime'],
  // (resolved via "tasktotime" → ./tasktotime/eslint/plugin.js — add to package.json eslintConfig "rulePaths")
  rules: {
    'tasktotime/hexagonal-domain-purity': 'error',
  },
};
```

### 4.4 CI gate

Add to `package.json`:

```json
{
  "scripts": {
    "lint:hexagonal": "eslint 'tasktotime/domain/**/*.ts' 'tasktotime/ports/**/*.ts' --max-warnings 0"
  }
}
```

GitHub Actions step (or pre-commit hook):

```yaml
- name: Hexagonal purity
  run: npm run lint:hexagonal
```

A single Firebase import inside `tasktotime/domain/**` → CI red, blocks merge.

---

## Section 5: Acceptance criteria for Phase 1

Phase 1 Foundation is **done** when ALL of the following are GREEN:

### 5.1 Type & lint gates

- ✓ `tsc --noEmit` passes for `tasktotime/domain/**`, `tasktotime/ports/**`, `tasktotime/application/**`, `tasktotime/shared/**`, `tasktotime/tests/**`
- ✓ `npm run lint:hexagonal` exits 0 — zero warnings
- ✓ Custom ESLint rule catches `import 'firebase-admin'` inside `domain/` test fixture (negative test in CI)

### 5.2 Unit tests

- ✓ `tasktotime/tests/domain/**` — `npm run test -- tasktotime/tests/domain` runs in **< 1 second** (no emulator, no I/O)
- ✓ Coverage targets:
  - `domain/lifecycle.ts`: 100% (state machine fully exercised)
  - `domain/dependencies.ts`: 100% (cycle BFS branches)
  - `domain/rollup.ts`: 95% (edge cases on empty subtask list, all-blocked, mixed)
  - `domain/services/*`: 90% via mocks
- ✓ All 7 valid lifecycle transitions tested + 4 forbidden transitions throw `TransitionNotAllowed`
- ✓ Cycle detection tests: 2-cycle, 3-cycle, diamond (no cycle), self-dep, 100-task linear chain (perf check)

### 5.3 Architectural invariants

- ✓ `domain/` directory has **zero** transitive deps on `firebase-*`, `@firebase/*`, `@mui/*`, `react`, `express` (verified via `npm ls --json | jq` script in CI, see acceptance script `tasktotime/tests/architecture/no-firebase-in-domain.test.ts`)
- ✓ `ports/` directory exports **only interfaces, types, and pure constants** — no classes, no implementation (enforced by AST check in same architecture test file)
- ✓ Each port has at least one `InMemory*` or `Stub*` mock in `shared/mocks/`
- ✓ `domain/services/*Service.ts` constructors take `{ ports... }` — verified by structural test that no service has a parameterless constructor

### 5.4 Documentation cross-refs

- ✓ Every port file has TSDoc block referring to the spec section that motivates it (e.g. `// See spec/04-storage/data-dependencies.md §clients/{clientId}`)
- ✓ `tasktotime/eslint/README.md` explains how to add a new forbidden package
- ✓ This blueprint document linked from `tasktotime/spec/01-overview/README.md` (parent index)

### 5.5 Extract-readiness smoke test

- ✓ `npm pack --dry-run` on a synthetic `package.json` listing only `tasktotime/domain/**`, `tasktotime/ports/**`, `tasktotime/application/**`, `tasktotime/shared/**` produces a tarball with **zero** `firebase-*` in `dependencies`
- ✓ The synthetic tarball, copied into `/tmp/extract-smoke/`, runs `npm install` + `npm run test:domain` green — proving the layer is genuinely portable

---

## Risks during Phase 1 implementation

| Risk | Likelihood | Mitigation |
|---|---|---|
| Developer adds `import { Timestamp } from 'firebase-admin'` to `domain/Task.ts` for convenience | HIGH | ESLint rule + CI gate; replace with `number` (epoch ms) in domain types — adapter converts |
| `UserRef` ambiguity (`users/` vs `employees/`) leaks into domain | MEDIUM | UserId branded type + EmployeeLookupPort + UserLookupPort separate; resolution policy lives in `application/` |
| `ports/` accumulate "convenience" methods that pull I/O complexity into ports (e.g. `findTasksAndDecorateWithClient`) | MEDIUM | Keep ports CRUD-shaped; composition happens in application/ handlers or services |
| Triggers in adapters/ end up calling each other's services across boundaries (hidden coupling) | MEDIUM | Each trigger emits DomainEvent, separate event-bus adapter forwards — no service-to-trigger calls |
| Cycle detection BFS reads from stale `blocksTaskIds` | LOW | `DependencyService.canAddDependency` reads inside transaction (adapter-level concern, but contract documented) |

---

## What is NOT in Phase 1

- ✗ `adapters/firestore/*` — Phase 2
- ✗ `adapters/http/*`, `adapters/telegram/*`, `adapters/email/*`, `adapters/bigquery/*`, `adapters/storage/*`, `adapters/noaa/*` — Phase 2
- ✗ `ui/*` — Phase 3
- ✗ `backend/triggers/*` — Phase 2 (will be thin shells calling `application/handlers/*`)
- ✗ Integration tests with emulator — Phase 2
- ✗ E2E Cypress — Phase 3
- ✗ Migration script `scripts/migrate-gtd-to-tasktotime.ts` — Phase 5

These exist in [`../09-folder-structure.md`](../09-folder-structure.md) for completeness but are **explicitly out of scope for Phase 1**.

---

**См. также:**
- [`architecture-decision.md`](architecture-decision.md) — почему Hexagonal а не микросервис
- [`../02-data-model/task-interface.md`](../02-data-model/task-interface.md) — Task type
- [`../02-data-model/sub-types.md`](../02-data-model/sub-types.md) — UserRef, Money, TaskDependency, ...
- [`../03-state-machine/lifecycle.md`](../03-state-machine/lifecycle.md) + [`transitions.md`](../03-state-machine/transitions.md) — state machine
- [`../04-storage/data-dependencies.md`](../04-storage/data-dependencies.md) — full I/O inventory motivating each port
- [`../05-api/triggers.md`](../05-api/triggers.md) — triggers using these services as application layer
- [`../08-modules/graph-dependencies/cycle-prevention.md`](../08-modules/graph-dependencies/cycle-prevention.md) — BFS algo behind DependencyService
- [`../08-modules/hierarchy/subtask-rollup-aggregate.md`](../08-modules/hierarchy/subtask-rollup-aggregate.md) — math behind rollup
- [`../09-folder-structure.md`](../09-folder-structure.md) — full module tree (Phase 1 + future phases)
