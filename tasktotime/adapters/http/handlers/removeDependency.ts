/**
 * `DELETE /api/tasktotime/tasks/:id/dependencies/:depId` — unlink a
 * dependency edge.
 *
 * Path semantics: `:id` is the source task (the one carrying the
 * `dependsOn[]` entry). `:depId` is the predecessor task id (the `to` side
 * of the edge). The convention follows
 * `spec/05-api/rest-endpoints.md§DELETE /tasks/:id/dependencies/:depId`.
 *
 * Both endpoints of the edge MUST live in the caller's company; we verify
 * by looking up both tasks before delegating to the handler. Either one
 * being out-of-scope yields 404 to avoid information disclosure.
 *
 * The reverse `blocksTaskIds[]` denormalisation on the predecessor is
 * NOT touched here — that cleanup is handled by the `cascadeBlocksTaskIds`
 * trigger that fires when the source task's `dependsOn[]` is rewritten.
 *
 * Idempotency:
 *   - Key read from `Idempotency-Key` header OR `idempotencyKey` body field.
 *   - Replay returns the current source task with `skipped: true`.
 */

import type { Request, Response, NextFunction } from 'express';

import type { RemoveDependencyHandler } from '../../../application';
import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import {
  extractIdempotencyKey,
  parseRemoveDependencyParams,
} from '../schemas';
import { sendValidationError } from '../middleware';

export interface RemoveDependencyHttpDeps {
  handler: RemoveDependencyHandler;
  taskRepo: TaskRepository;
}

export function removeDependencyRoute(deps: RemoveDependencyHttpDeps) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) {
      next(new Error('attachAuthContext middleware not run'));
      return;
    }
    const { id, depId } = req.params;
    if (!id || !depId) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'taskId and depId path params required',
        },
      });
      return;
    }

    const idempotencyKey = extractIdempotencyKey(
      req.headers as unknown as Record<string, unknown>,
      req.body,
    );
    if (!idempotencyKey) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'Idempotency-Key header or `idempotencyKey` body field is required',
        },
      });
      return;
    }

    const parsed = parseRemoveDependencyParams(
      id,
      depId,
      req.auth.by,
      idempotencyKey,
    );
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }

    try {
      const [from, to] = await Promise.all([
        deps.taskRepo.findById(asTaskId(id)),
        deps.taskRepo.findById(asTaskId(depId)),
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

      const outcome = await deps.handler.execute(parsed.value);
      res.status(200).json({
        ok: true,
        task: outcome.task,
        skipped: outcome.skipped,
      });
    } catch (err) {
      next(err);
    }
  };
}
