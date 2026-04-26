/**
 * Adapter-layer errors. These wrap Firestore-specific failure modes into
 * stable, domain-friendly errors that callers in the application/domain
 * layer can handle without leaking infrastructure types.
 *
 * Conventions:
 *   - Stable `code` for serialization (mirrors domain DomainError pattern).
 *   - Original error preserved on `cause` for debugging.
 *   - NO Firebase imports in error class definitions — they are plain TS.
 *
 * See spec/04-storage/adapter-mapping.md §"Convention notes" → Error mapping.
 */

export type AdapterErrorCode =
  | 'MISSING_INDEX'
  | 'STALE_VERSION'
  | 'ILLEGAL_PATCH'
  | 'NOT_FOUND'
  | 'TRANSACTION_ABORTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STORAGE_FAILURE'
  | 'EXTERNAL_FAILURE';

export class AdapterError extends Error {
  public readonly code: AdapterErrorCode;
  public readonly meta?: Record<string, unknown>;
  public readonly cause?: unknown;

  constructor(
    code: AdapterErrorCode,
    message: string,
    meta?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.meta = meta;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a Firestore query fails because a composite index does not
 * yet exist. Adapter detects via `FAILED_PRECONDITION` error code and
 * remaps so the error is actionable.
 */
export class MissingIndexError extends AdapterError {
  constructor(message: string, meta?: Record<string, unknown>, cause?: unknown) {
    super('MISSING_INDEX', message, meta, cause);
    this.name = 'MissingIndexError';
    Object.setPrototypeOf(this, MissingIndexError.prototype);
  }
}

/**
 * Thrown when an optimistic-concurrency `saveIfUnchanged` finds the stored
 * `updatedAt` does not match the expected value. Caller MUST re-read,
 * re-apply, retry — or surface an explicit "this task was changed" error.
 *
 * Re-uses the same code as the domain `StaleVersion` for callers that
 * want a single catch.
 */
export class StaleVersion extends AdapterError {
  constructor(
    public readonly taskId: string,
    public readonly expectedUpdatedAt: number,
    cause?: unknown,
  ) {
    super(
      'STALE_VERSION',
      `Task ${taskId} was modified by someone else; expected updatedAt=${expectedUpdatedAt}`,
      { taskId, expectedUpdatedAt },
      cause,
    );
    this.name = 'StaleVersion';
    Object.setPrototypeOf(this, StaleVersion.prototype);
  }
}

/**
 * Thrown when `TaskRepository.patch` is called with a key that is on the
 * forbidden list (lifecycle, history, transitions, id, companyId, createdAt,
 * createdBy). Such fields MUST flow through the lifecycle/transition machine.
 */
export class IllegalPatchError extends AdapterError {
  constructor(
    public readonly taskId: string,
    public readonly forbiddenKeys: string[],
  ) {
    super(
      'ILLEGAL_PATCH',
      `Refusing to patch task ${taskId}: forbidden keys ${forbiddenKeys.join(', ')}. Use TaskService.transition for lifecycle changes.`,
      { taskId, forbiddenKeys },
    );
    this.name = 'IllegalPatchError';
    Object.setPrototypeOf(this, IllegalPatchError.prototype);
  }
}

/**
 * Map a Firestore SDK error to an AdapterError where applicable. Used by
 * adapters to wrap try/catch and emit stable codes upstream.
 */
export function mapFirestoreError(err: unknown, ctx?: Record<string, unknown>): AdapterError {
  const e = err as { code?: string | number; message?: string };
  const code = String(e?.code ?? '');
  const message = e?.message ?? String(err);

  if (code === '9' || code === 'failed-precondition' || /index/i.test(message)) {
    return new MissingIndexError(`Firestore reported missing index: ${message}`, ctx, err);
  }
  if (code === '10' || code === 'aborted') {
    return new AdapterError('TRANSACTION_ABORTED', message, ctx, err);
  }
  if (code === '5' || code === 'not-found') {
    return new AdapterError('NOT_FOUND', message, ctx, err);
  }
  return new AdapterError('STORAGE_FAILURE', message, ctx, err);
}
