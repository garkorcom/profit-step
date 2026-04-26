/**
 * CreateTaskCommand — DTO for creating a new task.
 *
 * Application layer accepts this DTO at HTTP / RPC boundary. Handler converts
 * it to TaskService.createTask input. Wire format MAY differ from
 * `TaskDraft` (e.g. plain strings instead of branded ids); the handler
 * normalizes.
 */

import type { Priority, TaskBucket, TaskCategory, TaskPhase, TaskSource, UserRef } from '../../domain/Task';

export interface CreateTaskCommand {
  /** Idempotency key — stable per user-action. */
  idempotencyKey: string;

  /** Initial lifecycle. Default 'draft'. */
  initialLifecycle?: 'draft' | 'ready';

  /** Author's user reference (server-derived from auth, not from client input). */
  by: UserRef;

  // Required content
  companyId: string;
  title: string;
  /** Epoch ms. */
  dueAt: number;
  estimatedDurationMinutes: number;

  // Lifecycle config
  bucket: TaskBucket;
  priority: Priority;
  source: TaskSource;

  // People
  assignedTo: UserRef;
  reviewedBy?: UserRef;
  coAssignees?: UserRef[];
  requiredHeadcount: number;
  linkedContactIds?: string[];

  // Optional content
  description?: string;
  memo?: string;
  category?: TaskCategory;
  phase?: TaskPhase;

  // Money
  costInternal: { amount: number; currency: 'USD' | 'RUB' | 'EUR' };
  priceClient: { amount: number; currency: 'USD' | 'RUB' | 'EUR' };

  // Hierarchy
  parentTaskId?: string;

  // Linking
  clientId?: string;
  clientName?: string;
  projectId?: string;
  projectName?: string;
  sourceEstimateId?: string;
  sourceEstimateItemId?: string;
  sourceNoteId?: string;

  // Visibility
  clientVisible?: boolean;
  internalOnly?: boolean;

  // Time (optional)
  plannedStartAt?: number;
}
