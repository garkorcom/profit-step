/**
 * Domain errors. NO HTTP status codes — adapters translate to HTTP at the
 * boundary. NO Firebase types. Each error has a stable `code` for serialization.
 */

import type { TaskId } from './identifiers';
import type { TaskLifecycle, TransitionAction } from './lifecycle';

export type DomainErrorCode =
  | 'TRANSITION_NOT_ALLOWED'
  | 'CYCLE_DETECTED'
  | 'TASK_NOT_FOUND'
  | 'INVALID_DRAFT'
  | 'STALE_VERSION'
  | 'PRECONDITION_FAILED'
  | 'IDEMPOTENCY_HIT'
  | 'MAX_HIERARCHY_DEPTH'
  | 'SELF_DEPENDENCY';

export class DomainError extends Error {
  public readonly code: DomainErrorCode;
  public readonly meta?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.meta = meta;
    // Restore prototype chain — required when targeting ES5 / for instanceof
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TransitionNotAllowed extends DomainError {
  constructor(
    public readonly from: TaskLifecycle,
    public readonly action: TransitionAction,
    public readonly taskId?: TaskId,
  ) {
    super(
      'TRANSITION_NOT_ALLOWED',
      `Transition '${action}' is not allowed from state '${from}'`,
      { from, action, taskId },
    );
    this.name = 'TransitionNotAllowed';
    Object.setPrototypeOf(this, TransitionNotAllowed.prototype);
  }
}

export class CycleDetected extends DomainError {
  constructor(public readonly path: TaskId[]) {
    super('CYCLE_DETECTED', `Adding this dependency would create a cycle: ${path.join(' → ')}`, {
      path,
    });
    this.name = 'CycleDetected';
    Object.setPrototypeOf(this, CycleDetected.prototype);
  }
}

export class TaskNotFound extends DomainError {
  constructor(public readonly taskId: TaskId) {
    super('TASK_NOT_FOUND', `Task ${taskId} not found`, { taskId });
    this.name = 'TaskNotFound';
    Object.setPrototypeOf(this, TaskNotFound.prototype);
  }
}

export class InvalidDraft extends DomainError {
  constructor(public readonly missingFields: string[], public readonly taskId?: TaskId) {
    super(
      'INVALID_DRAFT',
      `Task draft is missing required fields: ${missingFields.join(', ')}`,
      { missingFields, taskId },
    );
    this.name = 'InvalidDraft';
    Object.setPrototypeOf(this, InvalidDraft.prototype);
  }
}

export class StaleVersion extends DomainError {
  constructor(public readonly taskId: TaskId, public readonly expectedUpdatedAt: number) {
    super(
      'STALE_VERSION',
      `Task ${taskId} was modified by someone else; expected updatedAt=${expectedUpdatedAt}`,
      { taskId, expectedUpdatedAt },
    );
    this.name = 'StaleVersion';
    Object.setPrototypeOf(this, StaleVersion.prototype);
  }
}

/**
 * Wiki concurrency conflict — caller's `expectedVersion` doesn't match the
 * current monotonic version. Modeled as a kind of `StaleVersion` so the
 * HTTP error mapper translates it to 409 Conflict, the same status as the
 * document-level concurrency case. Kept as a separate class so meta carries
 * `expectedVersion / currentVersion` instead of the parent class's
 * timestamp-shaped fields.
 *
 * `name = 'StaleVersion'` is deliberate — `tasktotime/adapters/http/middleware.ts:domainStatus()`
 * keys the HTTP status off `name`, and we want this to round-trip as 409
 * exactly like the timestamp variant. Keep both in sync if either is renamed.
 *
 * Was raised as `PreconditionFailed` (→ 400) until QA 2026-04-27 found the
 * status-code mismatch breaking frontend retry-on-409 logic.
 */
export class WikiStaleVersion extends DomainError {
  constructor(
    public readonly taskId: TaskId,
    public readonly expectedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      'STALE_VERSION',
      `Wiki version conflict on ${taskId} — expected ${expectedVersion}, current ${currentVersion}`,
      { taskId, expectedVersion, currentVersion },
    );
    this.name = 'StaleVersion';
    Object.setPrototypeOf(this, WikiStaleVersion.prototype);
  }
}

export class PreconditionFailed extends DomainError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super('PRECONDITION_FAILED', message, meta);
    this.name = 'PreconditionFailed';
    Object.setPrototypeOf(this, PreconditionFailed.prototype);
  }
}

export class MaxHierarchyDepth extends DomainError {
  constructor(public readonly taskId: TaskId) {
    super(
      'MAX_HIERARCHY_DEPTH',
      `Task ${taskId} cannot have grand-subtasks (max 2 levels)`,
      { taskId },
    );
    this.name = 'MaxHierarchyDepth';
    Object.setPrototypeOf(this, MaxHierarchyDepth.prototype);
  }
}

export class SelfDependency extends DomainError {
  constructor(public readonly taskId: TaskId) {
    super('SELF_DEPENDENCY', `Task ${taskId} cannot depend on itself`, { taskId });
    this.name = 'SelfDependency';
    Object.setPrototypeOf(this, SelfDependency.prototype);
  }
}
