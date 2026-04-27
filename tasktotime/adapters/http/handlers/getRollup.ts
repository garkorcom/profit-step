/**
 * `GET /api/tasktotime/tasks/:id/rollup` — computed subtask rollup for a
 * parent task.
 *
 * Pulls the parent + subtasks from `TaskRepository` and runs the pure
 * `computeSubtaskRollup` to produce the on-the-fly aggregate. The parent
 * task's persisted `subtaskRollup` field is denormalized by triggers and may
 * lag — this endpoint always recomputes for an authoritative view.
 *
 * Query string: `?includeArchived=true` to count archived subtasks too
 * (default: skip archived).
 */

import type { Request, Response, NextFunction } from 'express';

import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import { computeSubtaskRollup } from '../../../domain/rollup';

export interface GetRollupHttpDeps {
  taskRepo: TaskRepository;
}

export function getRollupRoute(deps: GetRollupHttpDeps) {
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
    const includeArchived = req.query.includeArchived === 'true';

    try {
      const taskId = asTaskId(id);
      const parent = await deps.taskRepo.findById(taskId);
      if (!parent || parent.companyId !== req.auth.companyId) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: `Task ${id} not found` },
        });
        return;
      }
      const subtasks = await deps.taskRepo.findSubtasks(taskId);
      const filtered = includeArchived
        ? subtasks
        : subtasks.filter((t) => t.archivedAt == null);
      const rollup = computeSubtaskRollup(filtered);
      res.status(200).json({ ok: true, parentTaskId: id, rollup });
    } catch (err) {
      next(err);
    }
  };
}
