/**
 * Pure pre-condition validators for task transitions.
 *
 * Each function returns a list of missing/invalid fields (empty = OK) OR
 * throws `PreconditionFailed` / `InvalidDraft`. Callers (services) decide
 * whether to short-circuit or accumulate.
 *
 * NO Firebase, NO I/O.
 */

import type { Task } from './Task';
import { InvalidDraft, PreconditionFailed } from './errors';
import type { TransitionAction } from './lifecycle';

/**
 * Fields required to leave `draft` and become `ready`.
 * spec/03-state-machine/transitions.md §"ready()": assignedTo, dueAt,
 * estimatedDurationMinutes must be filled.
 */
export const REQUIRED_FOR_READY: ReadonlyArray<keyof Task> = [
  'assignedTo',
  'dueAt',
  'estimatedDurationMinutes',
] as const;

/**
 * Validate a task draft has all fields needed to enter `ready` lifecycle.
 * Returns missing field names (empty array if OK).
 */
export function validateReadyPreconditions(task: Pick<Task, keyof Task>): string[] {
  const missing: string[] = [];
  if (!task.assignedTo || !task.assignedTo.id) missing.push('assignedTo');
  if (!task.dueAt || task.dueAt <= 0) missing.push('dueAt');
  if (
    typeof task.estimatedDurationMinutes !== 'number' ||
    task.estimatedDurationMinutes <= 0
  ) {
    missing.push('estimatedDurationMinutes');
  }
  return missing;
}

/**
 * Throws `InvalidDraft` if any required field for `ready` is missing.
 */
export function assertReadyPreconditions(task: Task): void {
  const missing = validateReadyPreconditions(task);
  if (missing.length > 0) {
    throw new InvalidDraft(missing, task.id);
  }
}

/**
 * `block` action requires `reason` of >= 5 characters.
 */
export function assertBlockReason(reason: string | undefined): void {
  if (!reason || reason.trim().length < 5) {
    throw new PreconditionFailed(
      'block action requires a reason of at least 5 characters',
      { reason },
    );
  }
}

/**
 * `accept` action requires complete `acceptance` object.
 */
export function assertAcceptancePayload(
  acceptance: Task['acceptance'] | undefined,
): asserts acceptance is NonNullable<Task['acceptance']> {
  if (!acceptance) {
    throw new PreconditionFailed('accept action requires acceptance object');
  }
  const missing: string[] = [];
  if (!acceptance.url) missing.push('url');
  if (!acceptance.signedAt || acceptance.signedAt <= 0) missing.push('signedAt');
  if (!acceptance.signedBy) missing.push('signedBy');
  if (!acceptance.signedByName) missing.push('signedByName');
  if (missing.length > 0) {
    throw new PreconditionFailed(
      `acceptance object missing fields: ${missing.join(', ')}`,
      { missing },
    );
  }
}

/**
 * Generic dispatcher: validate pre-conditions for a given action.
 * Throws on violation.
 */
export function validateTaskDraft(task: Task, action: TransitionAction, payload?: {
  reason?: string;
  acceptance?: Task['acceptance'];
  blockedReason?: string;
}): void {
  switch (action) {
    case 'ready':
      assertReadyPreconditions(task);
      return;
    case 'block':
      // For block, prefer blockedReason; fall back to reason for compat.
      assertBlockReason(payload?.blockedReason ?? payload?.reason);
      return;
    case 'accept':
      assertAcceptancePayload(payload?.acceptance);
      return;
    case 'create':
    case 'start':
    case 'unblock':
    case 'complete':
    case 'cancel':
      // No additional precondition check beyond lifecycle table.
      return;
    default: {
      const _exhaustive: never = action;
      throw new PreconditionFailed(`Unknown transition action: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Hierarchy depth invariant — only 2 levels (parent + subtask, no
 * grand-subtasks). See spec/02-data-model/task-interface.md §Hierarchy.
 */
export function assertHierarchyDepth(parent: Task | null): void {
  if (parent && parent.isSubtask) {
    throw new PreconditionFailed(
      'Cannot create subtask of a subtask (max 2 hierarchy levels)',
      { parentTaskId: parent.id },
    );
  }
}
