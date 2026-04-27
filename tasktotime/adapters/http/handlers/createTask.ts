/**
 * `POST /api/tasktotime/tasks` — create a new task.
 *
 * Body: see `parseCreateTaskBody` for the wire shape. The `by` field is
 * filled from `req.auth` — clients cannot impersonate users.
 *
 * Idempotency:
 *   - Caller MUST pass `idempotencyKey` (string).
 *   - Replays of the same key for the same user return the cached task
 *     instead of creating a new one (handled inside `TaskService.createTask`).
 */

import type { Request, Response, NextFunction } from 'express';

import type { CreateTaskHandler } from '../../../application';
import { parseCreateTaskBody } from '../schemas';
import { sendValidationError } from '../middleware';

export interface CreateTaskHttpDeps {
  handler: CreateTaskHandler;
}

export function createTaskRoute(deps: CreateTaskHttpDeps) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) {
      next(new Error('attachAuthContext middleware not run'));
      return;
    }
    const parsed = parseCreateTaskBody(req.body, req.auth.by);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }
    if (parsed.value.companyId !== req.auth.companyId) {
      res.status(403).json({
        ok: false,
        error: {
          code: 'COMPANY_SCOPE_MISMATCH',
          message: 'companyId in body must match the caller scope',
        },
      });
      return;
    }
    try {
      const task = await deps.handler.execute(parsed.value);
      res.status(201).json({ ok: true, task });
    } catch (err) {
      next(err);
    }
  };
}
