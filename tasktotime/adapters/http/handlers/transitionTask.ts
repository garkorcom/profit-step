/**
 * `POST /api/tasktotime/tasks/:id/transition` — drive the lifecycle state
 * machine.
 *
 * Body: `{ action, reason?, blockedReason?, acceptance?, idempotencyKey }`.
 * The taskId comes from the path. The handler enforces caller scope by
 * fetching the task first and rejecting if `companyId` doesn't match.
 */

import type { Request, Response, NextFunction } from 'express';

import type { TransitionTaskHandler } from '../../../application';
import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import { parseTransitionBody } from '../schemas';
import { sendValidationError } from '../middleware';

export interface TransitionTaskHttpDeps {
  handler: TransitionTaskHandler;
  taskRepo: TaskRepository;
}

export function transitionTaskRoute(deps: TransitionTaskHttpDeps) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) {
      next(new Error('attachAuthContext middleware not run'));
      return;
    }
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'taskId path param required' },
      });
      return;
    }
    const parsed = parseTransitionBody(id, req.body, req.auth.by);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }

    try {
      // Scope check before invoking the lifecycle — out-of-scope returns 404.
      const existing = await deps.taskRepo.findById(asTaskId(id));
      if (!existing || existing.companyId !== req.auth.companyId) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Task ${id} not found` },
        });
        return;
      }
      const outcome = await deps.handler.execute(parsed.value);
      res.status(200).json({
        ok: true,
        task: outcome.task,
        events: outcome.events,
        skipped: outcome.skipped,
      });
    } catch (err) {
      next(err);
    }
  };
}
