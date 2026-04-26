/**
 * Domain events emitted by services. Discriminated union by `type`.
 *
 * Adapters subscribe to these to fire side-effects (Telegram notify,
 * BigQuery audit, payroll updates). Domain layer NEVER calls infrastructure
 * directly — it only emits events.
 *
 * See blueprint §3.1 — TaskService returns `events: DomainEvent[]` from
 * `transition()` and the application layer fans them out.
 */

import type { EpochMs, Money, UserRef } from './Task';
import type { TaskId, CompanyId, UserId } from './identifiers';
import type { TaskLifecycle, TransitionAction } from './lifecycle';

export interface BaseDomainEvent {
  type: string;
  taskId: TaskId;
  companyId: CompanyId;
  occurredAt: EpochMs;
  by: UserRef;
}

export interface TaskCreated extends BaseDomainEvent {
  type: 'task.created';
  initialLifecycle: 'draft' | 'ready';
}

export interface TaskTransitioned extends BaseDomainEvent {
  type: 'task.transitioned';
  from: TaskLifecycle;
  to: TaskLifecycle;
  action: TransitionAction;
  reason?: string;
}

export interface TaskBlocked extends BaseDomainEvent {
  type: 'task.blocked';
  reason: string;
}

export interface TaskUnblocked extends BaseDomainEvent {
  type: 'task.unblocked';
}

export interface TaskCompleted extends BaseDomainEvent {
  type: 'task.completed';
  completedAt: EpochMs;
  actualDurationMinutes: number;
}

export interface TaskAccepted extends BaseDomainEvent {
  type: 'task.accepted';
  acceptedAt: EpochMs;
  bonusOnTime?: Money;
  penaltyOverdue?: Money;
}

export interface TaskCancelled extends BaseDomainEvent {
  type: 'task.cancelled';
  reason?: string;
}

export interface DependencyAdded extends BaseDomainEvent {
  type: 'task.dependency_added';
  toTaskId: TaskId;
  dependencyType: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
}

export interface DependencyRemoved extends BaseDomainEvent {
  type: 'task.dependency_removed';
  toTaskId: TaskId;
}

export interface AutoShiftApplied extends BaseDomainEvent {
  type: 'task.auto_shifted';
  oldPlannedStartAt?: EpochMs;
  newPlannedStartAt: EpochMs;
  cascadeDepth: number;
}

export interface WikiUpdated extends BaseDomainEvent {
  type: 'task.wiki_updated';
  version: number;
  updatedByUserId: UserId;
}

export type DomainEvent =
  | TaskCreated
  | TaskTransitioned
  | TaskBlocked
  | TaskUnblocked
  | TaskCompleted
  | TaskAccepted
  | TaskCancelled
  | DependencyAdded
  | DependencyRemoved
  | AutoShiftApplied
  | WikiUpdated;

/**
 * Type-guard helper for filtering events by discriminator.
 */
export function isEventType<T extends DomainEvent['type']>(
  event: DomainEvent,
  type: T,
): event is Extract<DomainEvent, { type: T }> {
  return event.type === type;
}
