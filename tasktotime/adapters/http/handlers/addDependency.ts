/**
 * `POST /api/tasktotime/tasks/:id/dependencies` — link two tasks with a
 * dependency edge.
 *
 * Body: `{ toTaskId, type, isHardBlock, lagMinutes?, reason? }`. The
 * `fromTaskId` comes from the path.
 *
 * Both endpoints of the edge must live in the caller's company; we verify
 * by looking up both tasks before delegating to the application handler.
 */

import type { Request, Response, NextFunction } from 'express';

import type { AddDependencyHandler } from '../../../application';
import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import { parseAddDependencyBody } from '../schemas';
import { sendValidationError } from '../middleware';

export interface AddDependencyHttpDeps {
  handler: AddDependencyHandler;
  taskRepo: TaskRepository;
}

export function addDependencyRoute(deps: AddDependencyHttpDeps) {
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
    const parsed = parseAddDependencyBody(id, req.body, req.auth.by);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }

    try {
      const [from, to] = await Promise.all([
        deps.taskRepo.findById(asTaskId(parsed.value.fromTaskId)),
        deps.taskRepo.findById(asTaskId(parsed.value.toTaskId)),
      ]);
      if (
        !from ||
        !to ||
        from.companyId !== req.auth.companyId ||
        to.companyId !== req.auth.companyId
      ) {
        res.status(404).json({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: 'One or both tasks not found in this company scope',
          },
        });
        return;
      }
      await deps.handler.execute(parsed.value);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  };
}
