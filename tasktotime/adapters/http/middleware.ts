/**
 * HTTP middleware — auth context extraction + structured error handler.
 *
 * Auth itself (Bearer token, Firebase JWT) is enforced by the upstream
 * `agentApi.authMiddleware` in `functions/src/agent/`. Here we just pull the
 * resulting context out of the express Request and into a strongly-typed
 * `AuthContext` for use in handlers, plus convert thrown errors into JSON
 * responses with stable codes.
 *
 * The middleware is intentionally adapter-thin — domain rules, RLS, and
 * idempotency live in the application/domain layers.
 */

import type { NextFunction, Request, Response } from 'express';

import type { UserRef } from '../../domain/Task';
import { AdapterError } from '../errors';

// ─── Auth context ───────────────────────────────────────────────────────

export interface AuthContext {
  /** Caller user ref (for `by` field on commands). */
  by: UserRef;
  /** Company scope (for RLS enforcement). */
  companyId: string;
  /** Bearer token type — `'master'` is the static AGENT_API_KEY path. */
  tokenType: 'master' | 'employee' | 'jwt';
}

/**
 * Express's `Request` already has `agentUserId`, `agentUserName`,
 * `effectiveUserId` etc. set by the agent middleware in
 * `functions/src/agent/agentMiddleware.ts`. We normalise those into a single
 * `AuthContext` and stash it on `req.auth`.
 *
 * The fields below are also augmented onto Request so the middleware can
 * read what the upstream agent middleware wrote. Both augmentations are
 * scoped to the global `Express.Request` namespace; the same fields exist
 * (with broader types) in `functions/src/agent/agentMiddleware.ts`.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Tasktotime auth context. Set by `attachAuthContext`. */
      auth?: AuthContext;
      /** Set by upstream agent middleware. */
      agentUserId?: string;
      agentUserName?: string;
      agentTokenType?: 'master' | 'employee' | 'jwt';
      effectiveUserId?: string;
      effectiveTeamId?: string | null;
    }
  }
}

/**
 * Extract `AuthContext` from upstream agent-middleware fields. Throws
 * `Unauthorized` if the upstream middleware didn't set them.
 */
export function attachAuthContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const userId = req.effectiveUserId ?? req.agentUserId;
  const userName = req.agentUserName ?? userId;
  const tokenType = req.agentTokenType ?? 'master';

  // Company id source — first the impersonated team scope, then header,
  // then the static OWNER_COMPANY_ID for master tokens. Header is the
  // common case for the agent.
  const headerCompanyId = req.header('x-company-id');
  const companyId = headerCompanyId ?? req.effectiveTeamId ?? req.agentUserId;

  if (!userId || !userName || !companyId) {
    next(
      new AdapterError(
        'EXTERNAL_FAILURE',
        'Missing auth context — agentApi auth middleware did not run before tasktotime routes',
        {
          op: 'http.attachAuthContext',
          hasUserId: !!userId,
          hasCompanyId: !!companyId,
        },
      ),
    );
    return;
  }

  req.auth = {
    by: { id: userId, name: userName },
    companyId,
    tokenType,
  };
  next();
}

// ─── Error handler ──────────────────────────────────────────────────────

/**
 * Map any thrown error into `{ ok: false, error: { code, message } }`.
 * Distinguishes:
 *
 *   - `AdapterError` → `error.code` taken directly; HTTP status from a small
 *     mapping table (NOT_FOUND→404, INVALID_INPUT→400, others 500).
 *   - Domain errors (anything with a `name` like `TransitionNotAllowed`,
 *     `CycleDetected`, `StaleVersion`) → 409 Conflict with the original
 *     message.
 *   - Unknown errors → 500 with a generic message; the original is logged.
 *
 * Express requires the 4-arg signature for error handlers; the unused
 * `_next` argument is part of that contract.
 */
export function tasktotimeErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    // express recovery — we cannot send another response; bail.
    return;
  }

  if (err instanceof AdapterError) {
    res.status(adapterStatus(err.code)).json({
      ok: false,
      error: { code: err.code, message: err.message, meta: err.meta },
    });
    return;
  }

  if (err instanceof Error) {
    const code = err.name && err.name !== 'Error' ? err.name : 'INTERNAL';
    const status = domainStatus(code);
    res.status(status).json({
      ok: false,
      error: { code, message: err.message },
    });
    return;
  }

  res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL',
      message: typeof err === 'string' ? err : 'Unknown error',
    },
  });
}

function adapterStatus(code: AdapterError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'INVALID_INPUT':
      return 400;
    case 'IDEMPOTENCY_CONFLICT':
      return 409;
    case 'STALE_VERSION':
      return 409;
    case 'ILLEGAL_PATCH':
      return 422;
    case 'TRANSACTION_ABORTED':
      return 503;
    case 'MISSING_INDEX':
      return 503;
    case 'STORAGE_FAILURE':
    case 'EXTERNAL_FAILURE':
    default:
      return 500;
  }
}

function domainStatus(name: string): number {
  // Domain error names map to HTTP status. Add new domain errors here as
  // they are introduced.
  switch (name) {
    case 'TransitionNotAllowed':
    case 'IdempotencyKeyConflict':
    case 'StaleVersion':
    case 'CycleDetected':
    case 'DuplicateDependency':
      return 409;
    case 'TaskNotFound':
      return 404;
    case 'ValidationError':
    case 'InvalidDependencyInput':
    case 'InvalidDraft':
    case 'PreconditionFailed':
    case 'MaxHierarchyDepth':
    case 'SelfDependency':
      // Pre-condition / draft validation errors — surface as 400 per
      // spec/03-state-machine/transitions.md §"ready()" ("else 400").
      return 400;
    case 'PermissionDenied':
      return 403;
    default:
      return 500;
  }
}

// ─── Validation helper ─────────────────────────────────────────────────

/**
 * Send a 400 response from a `parseXxx` failure result. Returns `true` if
 * the response was sent (caller should `return`); `false` otherwise.
 */
export function sendValidationError(
  res: Response,
  errors: ReadonlyArray<{ path: string; message: string }>,
): true {
  res.status(400).json({
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Request body failed validation',
      issues: errors,
    },
  });
  return true;
}
