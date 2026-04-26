---
title: "02.1 Task — корневая сущность"
section: "02-data-model"
parent: "TZ_TASKTOTIME.md"
last_updated: 2026-04-25
version: 0.2
---

# Task — корневая сущность

> Полный TypeScript interface `Task` со всеми полями. Это центральная доменная модель модуля `tasktotime`. Все sub-types — в отдельном файле [`sub-types.md`](sub-types.md).

Файл: `tasktotime/types/Task.ts` (новый файл)

## Полный interface

```typescript
// tasktotime/types/Task.ts (новый файл)

export interface Task {
  // ─── Identity ─────────────────────────────────────────
  id: string;                       // Firestore doc id
  companyId: string;                // RLS scope (NEW! — текущий gtd_tasks без company-scope)
  taskNumber: string;               // human-readable (NEW: "T-2026-0042")

  // ─── Core content ─────────────────────────────────────
  title: string;
  description?: string;
  memo?: string;                    // private internal note
  checklistItems?: ChecklistItem[];
  attachments?: Attachment[];

  // ─── Lifecycle (state machine, см. §2) ────────────────
  lifecycle: TaskLifecycle;         // 'draft' | 'ready' | 'started' | 'blocked' | 'completed' | 'accepted' | 'cancelled'
  bucket: TaskBucket;               // 'inbox' | 'next' | 'someday' | 'archive' (organization, не state)
  priority: Priority;               // 'critical' | 'high' | 'medium' | 'low'

  // ─── People (требования Дениса) ───────────────────────
  createdBy: UserRef;               // = «кто создал»
  assignedTo: UserRef;              // primary executor
  reviewedBy?: UserRef;             // = «кто проверяет» (reviewer)
  coAssignees?: UserRef[];          // дополнительные исполнители
  requiredHeadcount: number;        // = «сколько людей нужно» (NEW field)
  linkedContactIds?: string[];      // = «справочник телефонов и людей для уточнения»

  // ─── Time (требования Дениса) ─────────────────────────
  createdAt: Timestamp;             // = «время создания»
  updatedAt: Timestamp;
  plannedStartAt?: Timestamp;       // = «время старта» (плановое)
  actualStartAt?: Timestamp;        // = «время старта» (фактическое — пишется при первом старте таймера или ручном «Начать»)
  dueAt: Timestamp;                 // = «когда нужно закончить» (REQUIRED, не optional)
  completedAt?: Timestamp;          // factual completion (но не подписан акт)
  acceptedAt?: Timestamp;           // акт подписан клиентом
  estimatedDurationMinutes: number; // = «время на выполнение» (REQUIRED, AI-suggested если не задано)
  actualDurationMinutes: number;    // computed via work_sessions aggregation

  // ─── Dependencies (auto-start от завершения другой) ──
  // См. §12 «Dependencies & Graph» для полной модели и DAG-визуализации
  dependsOn?: TaskDependency[];     // [{ taskId, type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish', lagMinutes? }]
  blocksTaskIds?: string[];         // reverse index, computed by onTaskUpdate trigger (для DAG queries)
  autoShiftEnabled: boolean;        // если true, plannedStartAt автосдвигается при изменении предшественника
  isCriticalPath: boolean;          // computed by trigger (NEW v0.2 — для Gantt highlighting)
  slackMinutes: number;             // computed: сколько минут можно опоздать без сдвига critical path

  // ─── Hierarchy (Task → Subtask, 2 уровня max) ────────
  // См. §11 «Hierarchy & Tree» — мы НЕ делаем 7-уровневую вложенность ClickUp
  parentTaskId?: string;            // если задача — subtask. Только 1 уровень: subtask НЕ может иметь свой sub-subtask.
  isSubtask: boolean;
  subtaskIds: string[];             // computed reverse index (для tree view + rollup queries без N+1)
  subtaskRollup?: SubtaskRollup;    // computed aggregates (см. §11.3): countByLifecycle, totalCostInternal, totalEstimatedMinutes, totalActualMinutes, completedFraction
  category?: TaskCategory;          // 'work' | 'punch' | 'inspection' | 'permit' | 'closeout' (NEW v0.2)
  phase?: TaskPhase;                // 'demo' | 'rough' | 'finish' | 'closeout' (NEW v0.2 — для group-by в Gantt)

  // ─── Wiki / Memory (NEW v0.2) ────────────────────────
  // См. §13 «Task Wiki» — markdown-страница привязанная к задаче
  wiki?: TaskWiki;                  // { contentMd, updatedAt, updatedBy, version, attachments[] }
  wikiInheritsFromParent: boolean;  // если true — рендерим parent.wiki + own.wiki как контекст

  // ─── Money (требования Дениса) ────────────────────────
  costInternal: Money;              // = «себестоимость» (NEW! отделено от sale price)
  priceClient: Money;               // = «продажная стоимость»
  bonusOnTime?: Money;              // = «премия за вовремя» (NEW)
  penaltyOverdue?: Money;           // = «штраф за не вовремя» (NEW)
  hourlyRate?: number;              // override per-task (если нет — берётся из user)
  totalEarnings: number;            // computed from work_sessions
  payments?: Payment[];             // если по задаче есть выплаты

  // ─── Materials & Tools (требования Дениса) ───────────
  materials?: TaskMaterial[];       // = «с каких материалов» (existing TaskMaterial type)
  materialsCostPlanned: number;     // computed
  materialsCostActual: number;      // computed
  requiredTools?: TaskTool[];       // = «инструменты» (NEW: { id, name, qty, status })

  // ─── Location (требования Дениса) ─────────────────────
  location?: Location;              // = «адрес выполнения» (NEW: { address, lat?, lng?, siteId? })

  // ─── Acceptance act (требования Дениса) ──────────────
  acceptance?: AcceptanceAct;       // = «акт выполнения» (NEW)
  // {
  //   url: string;                  // ссылка на PDF или Drive
  //   signedAt: Timestamp;
  //   signedBy: string;             // userId или внешний clientName
  //   signedByName: string;
  //   notes?: string;
  //   photos?: string[];             // фото-доказательства
  // }

  // ─── Linking ──────────────────────────────────────────
  clientId?: string;
  clientName?: string;              // denormalized
  projectId?: string;
  projectName?: string;
  // parentTaskId / isSubtask — см. секцию Hierarchy выше
  sourceEstimateId?: string;
  sourceEstimateItemId?: string;
  sourceNoteId?: string;
  linkedTaskIds?: string[];         // NEW v0.2 — non-blocking «see also» связи (cross-reference, не зависимость)

  // ─── AI / source tracking ─────────────────────────────
  source: 'web' | 'telegram' | 'voice' | 'ai' | 'estimate_decompose' | 'api';
  sourceAudioUrl?: string;
  aiAuditLogId?: string;
  aiEstimateUsed: boolean;          // флаг для AI accuracy log

  // ─── History & audit ──────────────────────────────────
  history: TaskHistoryEvent[];      // append-only via arrayUnion в triggers
  lastReminderSentAt?: Timestamp;   // для deadline cron

  // ─── Visibility ───────────────────────────────────────
  clientVisible: boolean;           // показывать ли в Client Portal
  internalOnly: boolean;            // скрыто от не-сотрудников

  // ─── Soft delete / archival ───────────────────────────
  archivedAt?: Timestamp;
  archivedBy?: string;
}
```

## Группировка полей (cheatsheet)

| Группа | Поля |
|---|---|
| **Identity** | `id`, `companyId`, `taskNumber` |
| **Core content** | `title`, `description`, `memo`, `checklistItems[]`, `attachments[]` |
| **Lifecycle** | `lifecycle`, `bucket`, `priority` |
| **People** | `createdBy`, `assignedTo`, `reviewedBy`, `coAssignees[]`, `requiredHeadcount`, `linkedContactIds[]` |
| **Time** | `createdAt`, `updatedAt`, `plannedStartAt`, `actualStartAt`, `dueAt`, `completedAt`, `acceptedAt`, `estimatedDurationMinutes`, `actualDurationMinutes` |
| **Dependencies** | `dependsOn[]`, `blocksTaskIds[]`, `autoShiftEnabled`, `isCriticalPath`, `slackMinutes` |
| **Hierarchy** | `parentTaskId`, `isSubtask`, `subtaskIds[]`, `subtaskRollup`, `category`, `phase` |
| **Wiki** | `wiki`, `wikiInheritsFromParent` |
| **Money** | `costInternal`, `priceClient`, `bonusOnTime`, `penaltyOverdue`, `hourlyRate`, `totalEarnings`, `payments[]` |
| **Materials & Tools** | `materials[]`, `materialsCostPlanned`, `materialsCostActual`, `requiredTools[]` |
| **Location** | `location` |
| **Acceptance** | `acceptance` |
| **Linking** | `clientId`, `clientName`, `projectId`, `projectName`, `sourceEstimateId`, `sourceEstimateItemId`, `sourceNoteId`, `linkedTaskIds[]` |
| **AI source** | `source`, `sourceAudioUrl`, `aiAuditLogId`, `aiEstimateUsed` |
| **History** | `history[]`, `lastReminderSentAt` |
| **Visibility** | `clientVisible`, `internalOnly` |
| **Soft delete** | `archivedAt`, `archivedBy` |

## Required vs optional поля

**REQUIRED** (без них task не создать):
- `id`, `companyId`, `taskNumber`
- `title`
- `lifecycle`, `bucket`, `priority`
- `createdBy`, `assignedTo`, `requiredHeadcount`
- `createdAt`, `updatedAt`, `dueAt`, `estimatedDurationMinutes`, `actualDurationMinutes` (default 0)
- `autoShiftEnabled`, `isCriticalPath` (default false), `slackMinutes` (default 0)
- `isSubtask` (default false), `subtaskIds[]` (default [])
- `wikiInheritsFromParent` (default true для subtask)
- `costInternal`, `priceClient`, `totalEarnings` (default 0)
- `materialsCostPlanned`, `materialsCostActual` (default 0)
- `source`, `aiEstimateUsed` (default false)
- `history[]` (default [])
- `clientVisible`, `internalOnly` (default false)

Все остальные — optional.

---

**См. также:**
- [Sub-types](sub-types.md) — UserRef, Money, TaskDependency, Location, AcceptanceAct, TaskTool, TaskCategory, TaskPhase, SubtaskRollup, TaskWiki, WikiVersion, WikiAttachment
- [Что выкидываем из GTDTask](what-changes-from-gtdtask.md)
- [Что остаётся как было](what-stays.md)
- [`../03-state-machine/lifecycle.md`](../03-state-machine/lifecycle.md) — state machine для поля `lifecycle`
- [`../04-storage/collections.md`](../04-storage/collections.md) — где живёт в Firestore
