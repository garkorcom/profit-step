/**
 * Pure transition application — given a task + action + payload, return the
 * next task state and the list of domain events to emit.
 *
 * No I/O, no Firebase, no DB writes — services use this to compute the new
 * Task object and pass it to the repository for persistence.
 *
 * See spec/03-state-machine/transitions.md.
 */

import type { Task, EpochMs, UserRef } from './Task';
import { canTransition, nextState } from './lifecycle';
import type { TaskLifecycle, TransitionAction } from './lifecycle';
import { TransitionNotAllowed } from './errors';
import { validateTaskDraft } from './validation';
import type { DomainEvent } from './events';

export interface TransitionPayload {
  reason?: string;
  acceptance?: Task['acceptance'];
  blockedReason?: string;
}

export interface TransitionResult {
  task: Task;
  from: TaskLifecycle;
  to: TaskLifecycle;
  events: DomainEvent[];
}

/**
 * Pure: given current task + action, produce the next Task and events.
 *
 * Side-effect notes:
 *   - `actualStartAt`, `completedAt`, `acceptedAt`, `blockedReason` are set
 *     here based on the action.
 *   - History event is appended with `{type:'transition', from, to, action}`.
 *   - `updatedAt` is bumped to `now`.
 *
 * Aggregation of actuals (durationMinutes, totalEarnings) — done OUTSIDE
 * this pure function by `TaskService.aggregateActuals` which uses ports.
 */
export function applyTransition(
  task: Task,
  action: TransitionAction,
  payload: TransitionPayload,
  by: UserRef,
  now: EpochMs,
): TransitionResult {
  const from = task.lifecycle;
  const to = nextState(from, action);
  if (!to || !canTransition(from, action)) {
    throw new TransitionNotAllowed(from, action, task.id);
  }

  // Pre-condition check
  validateTaskDraft(task, action, payload);

  // Build next task — clone, then apply per-action mutations
  const next: Task = {
    ...task,
    lifecycle: to,
    updatedAt: now,
    history: [
      ...(task.history ?? []),
      {
        type: 'transition',
        at: now,
        by,
        from,
        to,
        action,
        reason: payload.reason ?? payload.blockedReason,
      },
    ],
  };

  switch (action) {
    case 'ready':
      // Just lifecycle change; clear blockedReason if any
      next.blockedReason = undefined;
      break;

    case 'start':
      // Set actualStartAt only on FIRST start (don't overwrite on resume from blocked)
      if (!next.actualStartAt) next.actualStartAt = now;
      break;

    case 'block':
      next.blockedReason = payload.blockedReason ?? payload.reason;
      break;

    case 'unblock':
      next.blockedReason = undefined;
      break;

    case 'complete':
      next.completedAt = now;
      break;

    case 'accept':
      next.acceptedAt = now;
      if (payload.acceptance) {
        next.acceptance = payload.acceptance;
      }
      break;

    case 'cancel':
      // Soft cancel — no field changes besides lifecycle/history
      break;

    case 'create':
      // Should not be called via applyTransition (handled by createTask)
      throw new TransitionNotAllowed(from, action, task.id);
  }

  // Build events
  const baseEvent = {
    taskId: task.id,
    companyId: task.companyId,
    occurredAt: now,
    by,
  };

  const events: DomainEvent[] = [
    {
      ...baseEvent,
      type: 'task.transitioned',
      from,
      to,
      action,
      reason: payload.reason,
    },
  ];

  if (action === 'block') {
    events.push({
      ...baseEvent,
      type: 'task.blocked',
      reason: payload.blockedReason ?? payload.reason ?? '',
    });
  } else if (action === 'unblock') {
    events.push({ ...baseEvent, type: 'task.unblocked' });
  } else if (action === 'complete') {
    events.push({
      ...baseEvent,
      type: 'task.completed',
      completedAt: now,
      actualDurationMinutes: next.actualDurationMinutes,
    });
  } else if (action === 'accept') {
    events.push({
      ...baseEvent,
      type: 'task.accepted',
      acceptedAt: now,
      bonusOnTime: next.bonusOnTime,
      penaltyOverdue: next.penaltyOverdue,
    });
  } else if (action === 'cancel') {
    events.push({
      ...baseEvent,
      type: 'task.cancelled',
      reason: payload.reason,
    });
  }

  return { task: next, from, to, events };
}
