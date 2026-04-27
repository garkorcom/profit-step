/**
 * Tasktotime HTTP router — wires every handler factory into an Express
 * `Router`. The composition root in `functions/src/agent/` builds the
 * dependencies (adapters + application handlers + services) and passes
 * them in one bag so the router can do a one-shot setup.
 *
 * Mount point convention: `/api/tasktotime/*`. The parent `agentApi` runs
 * auth + rate-limiting before this router, then `attachAuthContext` (below)
 * normalises the auth fields into a single `req.auth` object for handlers.
 */

import { Router } from 'express';

import type { TaskRepository } from '../../ports/repositories';
import type {
  AddDependencyHandler,
  CreateTaskHandler,
  DeleteTaskHandler,
  PatchTaskHandler,
  RemoveDependencyHandler,
  TransitionTaskHandler,
  UpdateWikiHandler,
} from '../../application';

import {
  addDependencyRoute,
  createTaskRoute,
  deleteTaskRoute,
  getRollupRoute,
  getTaskRoute,
  listTasksRoute,
  patchTaskRoute,
  removeDependencyRoute,
  transitionTaskRoute,
  updateWikiRoute,
} from './handlers';
import { attachAuthContext, tasktotimeErrorHandler } from './middleware';

export interface TasktotimeRouterDeps {
  taskRepo: TaskRepository;
  createTaskHandler: CreateTaskHandler;
  transitionTaskHandler: TransitionTaskHandler;
  addDependencyHandler: AddDependencyHandler;
  updateWikiHandler: UpdateWikiHandler;
  patchTaskHandler: PatchTaskHandler;
  deleteTaskHandler: DeleteTaskHandler;
  removeDependencyHandler: RemoveDependencyHandler;
}

/**
 * Build the tasktotime express router. The returned router is meant to be
 * mounted under `/api/tasktotime` from the parent app.
 *
 * Endpoint catalogue (all behind agentApi auth + rate-limit):
 *
 *   POST   /tasks                                    — create
 *   GET    /tasks                                    — list (filters via query string)
 *   GET    /tasks/:id                                — fetch one
 *   PATCH  /tasks/:id                                — partial update (NOT lifecycle)
 *   DELETE /tasks/:id                                — soft delete (sets archivedAt)
 *   POST   /tasks/:id/transition                     — drive lifecycle
 *   POST   /tasks/:id/dependencies                   — add dependency edge
 *   DELETE /tasks/:id/dependencies/:depId            — remove dependency edge
 *   PUT    /tasks/:id/wiki                           — patch wiki (optimistic-concurrency)
 *   GET    /tasks/:id/rollup                         — recompute subtask rollup
 *
 * Errors thrown from handlers are caught by `tasktotimeErrorHandler` (added
 * last). Unknown errors return HTTP 500 with `{ code: 'INTERNAL' }`.
 */
export function createTasktotimeRouter(deps: TasktotimeRouterDeps): Router {
  const router = Router();

  router.use(attachAuthContext);

  router.post(
    '/tasks',
    createTaskRoute({ handler: deps.createTaskHandler }),
  );
  router.get('/tasks', listTasksRoute({ taskRepo: deps.taskRepo }));
  router.get('/tasks/:id', getTaskRoute({ taskRepo: deps.taskRepo }));
  router.patch(
    '/tasks/:id',
    patchTaskRoute({
      handler: deps.patchTaskHandler,
      taskRepo: deps.taskRepo,
    }),
  );
  router.delete(
    '/tasks/:id',
    deleteTaskRoute({
      handler: deps.deleteTaskHandler,
      taskRepo: deps.taskRepo,
    }),
  );
  router.post(
    '/tasks/:id/transition',
    transitionTaskRoute({
      handler: deps.transitionTaskHandler,
      taskRepo: deps.taskRepo,
    }),
  );
  router.post(
    '/tasks/:id/dependencies',
    addDependencyRoute({
      handler: deps.addDependencyHandler,
      taskRepo: deps.taskRepo,
    }),
  );
  router.delete(
    '/tasks/:id/dependencies/:depId',
    removeDependencyRoute({
      handler: deps.removeDependencyHandler,
      taskRepo: deps.taskRepo,
    }),
  );
  router.put(
    '/tasks/:id/wiki',
    updateWikiRoute({
      handler: deps.updateWikiHandler,
      taskRepo: deps.taskRepo,
    }),
  );
  router.get('/tasks/:id/rollup', getRollupRoute({ taskRepo: deps.taskRepo }));

  router.use(tasktotimeErrorHandler);
  return router;
}
