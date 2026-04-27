/**
 * `PATCH /api/tasktotime/tasks/:id` — partial update for non-state-machine
 * fields.
 *
 * Body: see `parsePatchTaskBody` for the wire shape. Lifecycle / history /
 * identity fields MUST flow through dedicated endpoints (`/transition`,
 * `/wiki`) and are rejected at the schema layer with HTTP 400.
 *
 * Cross-tenant guard: the existing task is read FIRST and its `companyId`
 * compared with `req.auth.companyId`. A mismatch returns 404 (not 403) to
 * avoid information disclosure about tasks that exist in other tenants —
 * mirrors the pattern in `getTask.ts` / `transitionTask.ts`.
 *
 * Idempotency:
 *   - The key is read from the `Idempotency-Key` header OR the
 *     `idempotencyKey` body field (both supported per the spec).
 *   - The handler reserves the key BEFORE any mutation; a replay returns
 *     the current task with `skipped: true`.
 */

import type { Request, Response, NextFunction } from 'express';

import type { PatchTaskHandler } from '../../../application';
import type { TaskRepository } from '../../../ports/repositories';
import { asTaskId } from '../../../domain/identifiers';
import {
  extractIdempotencyKey,
  parsePatchTaskBody,
} from '../schemas';
import { sendValidationError } from '../middleware';

export interface PatchTaskHttpDeps {
  handler: PatchTaskHandler;
  taskRepo: TaskRepository;
}

export function patchTaskRoute(deps: PatchTaskHttpDeps) {
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

    const parsed = parsePatchTaskBody(id, req.body, req.auth.by, idempotencyKey);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }

    try {
      // Scope check before invoking the handler — out-of-scope returns 404.
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
        skipped: outcome.skipped,
      });
    } catch (err) {
      next(err);
    }
  };
}
