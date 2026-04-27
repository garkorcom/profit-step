/**
 * `GET /api/tasktotime/tasks` — list tasks with filters.
 *
 * Filters live in the query string — see `parseListTasksQuery` for the
 * shape. The handler enforces the caller's company scope (the body's
 * `companyId` MUST match `req.auth.companyId`); any other value is treated
 * as 403 to avoid information disclosure.
 *
 * Pagination uses an opaque base64 cursor returned by the underlying
 * `TaskRepository.findMany`.
 */

import type { Request, Response, NextFunction } from 'express';

import type { TaskRepository, TaskFilter, ListOptions } from '../../../ports/repositories';
import { asCompanyId, asTaskId, asUserId } from '../../../domain/identifiers';
import { parseListTasksQuery } from '../schemas';
import { sendValidationError } from '../middleware';

export interface ListTasksHttpDeps {
  taskRepo: TaskRepository;
}

export function listTasksRoute(deps: ListTasksHttpDeps) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) {
      next(new Error('attachAuthContext middleware not run'));
      return;
    }
    const parsed = parseListTasksQuery(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      sendValidationError(res, parsed.errors);
      return;
    }
    if (parsed.value.companyId !== req.auth.companyId) {
      res.status(403).json({
        ok: false,
        error: {
          code: 'COMPANY_SCOPE_MISMATCH',
          message: 'companyId in query must match the caller scope',
        },
      });
      return;
    }

    const filter: TaskFilter = {
      companyId: asCompanyId(parsed.value.companyId),
    };
    if (parsed.value.lifecycle) filter.lifecycle = parsed.value.lifecycle;
    if (parsed.value.bucket) filter.bucket = parsed.value.bucket;
    if (parsed.value.assigneeId) {
      filter.assigneeId = asUserId(parsed.value.assigneeId);
    }
    if (parsed.value.parentTaskId === null) {
      filter.parentTaskId = null;
    } else if (parsed.value.parentTaskId) {
      filter.parentTaskId = asTaskId(parsed.value.parentTaskId);
    }
    if (parsed.value.projectId) filter.projectId = parsed.value.projectId;
    if (parsed.value.clientId) filter.clientId = parsed.value.clientId;
    if (parsed.value.isSubtask !== undefined) filter.isSubtask = parsed.value.isSubtask;
    if (parsed.value.archivedOnly) filter.archivedOnly = true;
    if (parsed.value.dueBefore !== undefined) filter.dueBefore = parsed.value.dueBefore;
    if (parsed.value.search) filter.search = parsed.value.search;

    const options: ListOptions = {};
    if (parsed.value.limit) options.limit = parsed.value.limit;
    if (parsed.value.cursor) options.cursor = parsed.value.cursor;
    if (parsed.value.orderBy) options.orderBy = parsed.value.orderBy;
    if (parsed.value.direction) options.direction = parsed.value.direction;

    try {
      const page = await deps.taskRepo.findMany(filter, options);
      res.status(200).json({
        ok: true,
        items: page.items,
        nextCursor: page.nextCursor ?? null,
      });
    } catch (err) {
      next(err);
    }
  };
}
