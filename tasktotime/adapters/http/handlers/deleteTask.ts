/**
 * `DELETE /api/tasktotime/tasks/:id` — soft-delete a task.
 *
 * The handler does NOT hard-delete; it sets `archivedAt = now()` and
 * `archivedBy = req.auth.by.id` (denormalised). The Firestore adapter
 * additionally writes `isArchived: true` and `bucket: 'archive'` so
 * subsequent listing queries can exclude archived rows efficiently.
 *
 * Cross-tenant guard: identical pattern to `patchTask.ts` — the existing
 * task is read first and its `companyId` compared with the caller's. A
 * mismatch (or a missing task) returns 404; we never leak existence of
 * out-of-scope tasks.
 *
 * Idempotency:
 *   - The key is read from the `Idempotency-Key` header OR the
 *     `idempotencyKey` body field. The DELETE method has no body in many
 *     REST clients, so the header is the primary path; the body is allowed
 *     for AI / voice flows that synthesise the request.
 *   - Replays return the original `archivedAt` with `skipped: true`.
 *   - A second delete on an already-archived task with a NEW idempotency
 *     key is also a no-op (the soft-delete state machine is monotonic).
 */

import type { Request, Response, NextFunction } from 'express';

import type { DeleteTaskHandler } from '../../../application';
import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import {
  extractIdempotencyKey,
  parseDeleteTaskParams,
} from '../schemas';
import { sendValidationError } from '../middleware';

export interface DeleteTaskHttpDeps {
  handler: DeleteTaskHandler;
  taskRepo: TaskRepository;
}

export function deleteTaskRoute(deps: DeleteTaskHttpDeps) {
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

    const parsed = parseDeleteTaskParams(id, req.auth.by, idempotencyKey);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }

    try {
      // Scope check first — out-of-scope returns 404 (not 403) to avoid
      // information disclosure about cross-tenant tasks.
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
        archivedAt: outcome.archivedAt,
        skipped: outcome.skipped,
      });
    } catch (err) {
      next(err);
    }
  };
}
