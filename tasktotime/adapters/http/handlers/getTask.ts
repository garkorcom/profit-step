/**
 * `GET /api/tasktotime/tasks/:id` — fetch a single task.
 *
 * Read-only: dispatches directly to `TaskRepository.findById` (no command
 * needed for a pure read). Enforces company scope by comparing
 * `task.companyId` with `req.auth.companyId`. A mismatch returns 404 — we
 * do NOT surface the existence of out-of-scope tasks.
 */

import type { Request, Response, NextFunction } from 'express';

import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';

export interface GetTaskHttpDeps {
  taskRepo: TaskRepository;
}

export function getTaskRoute(deps: GetTaskHttpDeps) {
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
    try {
      const task = await deps.taskRepo.findById(asTaskId(id));
      if (!task || task.companyId !== req.auth.companyId) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Task ${id} not found` },
        });
        return;
      }
      res.status(200).json({ ok: true, task });
    } catch (err) {
      next(err);
    }
  };
}
