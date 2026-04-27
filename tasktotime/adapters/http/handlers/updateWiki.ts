/**
 * `PUT /api/tasktotime/tasks/:id/wiki` — patch the task wiki with optimistic
 * concurrency.
 *
 * Body: `{ contentMd, expectedVersion, changeSummary? }`. Wiki edits sit
 * outside the lifecycle state machine; the version check ensures concurrent
 * editors don't silently overwrite each other.
 */

import type { Request, Response, NextFunction } from 'express';

import type { UpdateWikiHandler } from '../../../application';
import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import { parseUpdateWikiBody } from '../schemas';
import { sendValidationError } from '../middleware';

export interface UpdateWikiHttpDeps {
  handler: UpdateWikiHandler;
  taskRepo: TaskRepository;
}

export function updateWikiRoute(deps: UpdateWikiHttpDeps) {
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
    const parsed = parseUpdateWikiBody(id, req.body, req.auth.by);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }

    try {
      const existing = await deps.taskRepo.findById(asTaskId(id));
      if (!existing || existing.companyId !== req.auth.companyId) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Task ${id} not found` },
        });
        return;
      }
      const updated = await deps.handler.execute(parsed.value);
      res.status(200).json({ ok: true, task: updated });
    } catch (err) {
      next(err);
    }
  };
}
