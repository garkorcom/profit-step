/**
 * Task — root aggregate type for tasktotime module.
 *
 * IMPORTANT trade-off (blueprint §Risks #1):
 *   Time fields use `number` (epoch ms), NOT Firebase `Timestamp`. Domain layer
 *   must be runtime-agnostic — no `firebase-admin` imports. Adapters convert
 *   Firestore Timestamp <-> number at the boundary.
 *
 * See:
 *   - spec/02-data-model/task-interface.md (full field list)
 *   - spec/02-data-model/sub-types.md (UserRef, Money, etc.)
 *   - spec/03-state-machine/lifecycle.md (TaskLifecycle field)
 */

import type {
  CompanyId,
  TaskId,
  UserId,
  ProjectId,
  ClientId,
  SiteId,
  EstimateId,
  EstimateItemId,
  NoteId,
  ContactId,
  CatalogItemId,
} from './identifiers';
import type { TaskLifecycle } from './lifecycle';

// ─── Time / Currency primitives ────────────────────────────────────────

/** Epoch milliseconds (UTC). Convert from Firestore Timestamp at adapters. */
export type EpochMs = number;

/** Money value with explicit currency (sub-types.md §Money). */
export interface Money {
  amount: number;
  currency: 'USD' | 'RUB' | 'EUR';
}

// ─── People / refs ──────────────────────────────────────────────────────

/**
 * Reference to a user. Denormalized `name` for display without N+1 lookups.
 * `id` may be a `UserId` (users/{uid}) or a legacy `employees/{id}` string —
 * disambiguation happens via `UserLookupPort` / `EmployeeLookupPort`.
 *
 * See spec/02-data-model/sub-types.md §UserRef.
 */
export interface UserRef {
  id: string;
  name: string;
  role?: 'executor' | 'reviewer' | 'observer';
}

// ─── Bucket / priority / category / phase ──────────────────────────────

/** Organizational tag — independent of lifecycle. See spec/03/bucket.md. */
export type TaskBucket = 'inbox' | 'next' | 'someday' | 'archive';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

/** Category for group-by in Gantt. See sub-types.md §TaskCategory. */
export type TaskCategory = 'work' | 'punch' | 'inspection' | 'permit' | 'closeout';

/** Construction phase for group-by in Gantt. See sub-types.md §TaskPhase. */
export type TaskPhase = 'demo' | 'rough' | 'finish' | 'closeout';

// ─── Source tracking ───────────────────────────────────────────────────

export type TaskSource = 'web' | 'telegram' | 'voice' | 'ai' | 'estimate_decompose' | 'api';

// ─── Sub-types ──────────────────────────────────────────────────────────

/**
 * Dependency edge from this task to another. Extended model per
 * spec/02-data-model/sub-types.md §TaskDependency (full PMI semantics).
 */
export interface TaskDependency {
  taskId: TaskId;
  type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
  /** Positive = delay after, negative = can start earlier. */
  lagMinutes?: number;
  /** true → cannot start until predecessor done; false → soft warning only. */
  isHardBlock: boolean;
  reason?: string;
  createdAt: EpochMs;
  createdBy: UserRef;
}

/** Job site location. See sub-types.md §Location. */
export interface Location {
  address: string;
  lat?: number;
  lng?: number;
  siteId?: SiteId;
  notes?: string;
}

/** Acceptance act (signed by client). See sub-types.md §AcceptanceAct. */
export interface AcceptanceAct {
  url: string;
  signedAt: EpochMs;
  signedBy: string;
  signedByName: string;
  notes?: string;
  photos?: string[];
}

export interface TaskTool {
  id: string;
  name: string;
  qty?: number;
  status: 'required' | 'reserved' | 'taken' | 'returned';
  source: 'company_inventory' | 'employee_personal' | 'rented';
}

/**
 * Computed aggregate from subtasks (recomputed via onTaskUpdate trigger).
 * See spec/08-modules/hierarchy/subtask-rollup-aggregate.md.
 */
export interface SubtaskRollup {
  countByLifecycle: Partial<Record<TaskLifecycle, number>>;
  totalCostInternal: number;
  totalPriceClient: number;
  totalEstimatedMinutes: number;
  totalActualMinutes: number;
  /** 0..1 — fraction of subtasks done/accepted. */
  completedFraction: number;
  /** min(subtask.dueAt) — real parent deadline. */
  earliestDueAt?: EpochMs;
  /** max(subtask.completedAt). */
  latestCompletedAt?: EpochMs;
  blockedCount: number;
}

// ─── Wiki ──────────────────────────────────────────────────────────────

export interface WikiVersion {
  version: number;
  contentMd: string;
  updatedAt: EpochMs;
  updatedBy: UserRef;
  changeSummary?: string;
}

export interface WikiAttachment {
  id: string;
  url: string;
  type: 'photo' | 'pdf' | 'drawing' | 'invoice';
  caption?: string;
  uploadedAt: EpochMs;
  uploadedBy: UserRef;
}

export interface TaskWiki {
  contentMd: string;
  updatedAt: EpochMs;
  updatedBy: UserRef;
  version: number;
  versionHistory?: WikiVersion[];
  attachments?: WikiAttachment[];
  templateId?: string;
}

// ─── Existing types (re-exported / referenced by Task) ─────────────────

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  doneAt?: EpochMs;
  doneBy?: UserRef;
}

export interface Attachment {
  id: string;
  url: string;
  name: string;
  mime?: string;
  size?: number;
  uploadedAt: EpochMs;
  uploadedBy?: UserRef;
}

export interface Payment {
  id: string;
  amount: Money;
  paidAt: EpochMs;
  payerId?: string;
  reference?: string;
}

/**
 * History event recorded on the task. Discriminated union by `type`.
 * Persisted via `arrayUnion()` from triggers.
 */
export interface TaskHistoryEvent {
  type:
    | 'transition'
    | 'create'
    | 'edit'
    | 'comment'
    | 'attach'
    | 'unblock'
    | 'cancel'
    | 'wiki_update'
    | 'dependency_added'
    | 'dependency_removed';
  at: EpochMs;
  by: UserRef;
  /** Lifecycle from-state (only for `transition`). */
  from?: TaskLifecycle | null;
  /** Lifecycle to-state (only for `transition`). */
  to?: TaskLifecycle;
  action?: string;
  reason?: string;
  meta?: Record<string, unknown>;
}

/**
 * Material consumed by the task. Mirrors `TaskMaterial` from
 * `src/types/inventory.types.ts` (existing module).
 */
export interface TaskMaterial {
  catalogItemId: CatalogItemId;
  name: string;
  qtyPlanned: number;
  qtyActual?: number;
  unit: string;
  unitCost: number;
  totalCostPlanned: number;
  totalCostActual?: number;
}

// ─── Task aggregate ────────────────────────────────────────────────────

/**
 * Root aggregate for tasktotime. ALL time fields are epoch ms — adapters
 * convert from/to Firestore Timestamp. NO Firebase types in this file.
 *
 * Required vs optional follows spec/02-data-model/task-interface.md
 * §"Required vs optional поля".
 */
export interface Task {
  // ── Identity ─────────────────────────────────────────
  id: TaskId;
  companyId: CompanyId;
  taskNumber: string;

  // ── Core content ─────────────────────────────────────
  title: string;
  description?: string;
  memo?: string;
  checklistItems?: ChecklistItem[];
  attachments?: Attachment[];

  // ── Lifecycle ────────────────────────────────────────
  lifecycle: TaskLifecycle;
  bucket: TaskBucket;
  priority: Priority;
  /** Reason for `blocked` state — required when `lifecycle === 'blocked'`. */
  blockedReason?: string;

  // ── People ────────────────────────────────────────────
  createdBy: UserRef;
  assignedTo: UserRef;
  reviewedBy?: UserRef;
  coAssignees?: UserRef[];
  requiredHeadcount: number;
  linkedContactIds?: ContactId[];

  // ── Time ──────────────────────────────────────────────
  createdAt: EpochMs;
  updatedAt: EpochMs;
  plannedStartAt?: EpochMs;
  actualStartAt?: EpochMs;
  dueAt: EpochMs;
  completedAt?: EpochMs;
  acceptedAt?: EpochMs;
  estimatedDurationMinutes: number;
  actualDurationMinutes: number;

  // ── Dependencies ──────────────────────────────────────
  dependsOn?: TaskDependency[];
  /** Reverse index — computed by trigger. */
  blocksTaskIds?: TaskId[];
  autoShiftEnabled: boolean;
  isCriticalPath: boolean;
  slackMinutes: number;

  // ── Hierarchy (max 2 levels) ──────────────────────────
  parentTaskId?: TaskId;
  isSubtask: boolean;
  /** Reverse index — computed by trigger. */
  subtaskIds: TaskId[];
  subtaskRollup?: SubtaskRollup;
  category?: TaskCategory;
  phase?: TaskPhase;

  // ── Wiki ──────────────────────────────────────────────
  wiki?: TaskWiki;
  wikiInheritsFromParent: boolean;

  // ── Money ─────────────────────────────────────────────
  costInternal: Money;
  priceClient: Money;
  bonusOnTime?: Money;
  penaltyOverdue?: Money;
  hourlyRate?: number;
  totalEarnings: number;
  payments?: Payment[];

  // ── Materials & Tools ────────────────────────────────
  materials?: TaskMaterial[];
  materialsCostPlanned: number;
  materialsCostActual: number;
  requiredTools?: TaskTool[];

  // ── Location ──────────────────────────────────────────
  location?: Location;

  // ── Acceptance ────────────────────────────────────────
  acceptance?: AcceptanceAct;

  // ── Linking ───────────────────────────────────────────
  clientId?: ClientId;
  clientName?: string;
  projectId?: ProjectId;
  projectName?: string;
  sourceEstimateId?: EstimateId;
  sourceEstimateItemId?: EstimateItemId;
  sourceNoteId?: NoteId;
  /** Non-blocking "see also" cross-references. */
  linkedTaskIds?: TaskId[];

  // ── AI / source ──────────────────────────────────────
  source: TaskSource;
  sourceAudioUrl?: string;
  aiAuditLogId?: string;
  aiEstimateUsed: boolean;

  // ── History & audit ──────────────────────────────────
  history: TaskHistoryEvent[];
  lastReminderSentAt?: EpochMs;

  // ── Visibility ───────────────────────────────────────
  clientVisible: boolean;
  internalOnly: boolean;

  // ── Soft delete ───────────────────────────────────────
  archivedAt?: EpochMs;
  archivedBy?: UserId;
}

// ─── Re-exports for ports / services convenience ───────────────────────
export type {
  TaskId,
  CompanyId,
  UserId,
  ProjectId,
  ClientId,
  SiteId,
  EstimateId,
  EstimateItemId,
  NoteId,
  ContactId,
  CatalogItemId,
  FileId,
} from './identifiers';
