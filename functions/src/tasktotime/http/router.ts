/**
 * Tasktotime HTTP router — wraps the pure router factory from
 * `tasktotime/adapters/http` with the Cloud-Functions-side composition
 * root, then mounts under `/api/tasktotime`.
 *
 * `agentApi.ts` runs `authMiddleware` + `rateLimitMiddleware` before this
 * router. Inside, `attachAuthContext` (from
 * `tasktotime/adapters/http/middleware.ts`) normalises the agent middleware
 * fields into a typed `req.auth`.
 *
 * The router is built lazily on first request. The `getRouter` cache lives
 * outside the request handler so cold starts of unrelated routes don't pay
 * the cost.
 */

import type { RequestHandler } from 'express';

import { createTasktotimeRouter } from '../../../../tasktotime/adapters/http';
import { getTasktotimeServices } from '../composition';

/**
 * Cache the express Router as a `RequestHandler` rather than `Router`.
 * The functions/ workspace ships a different `@types/express-serve-static-core`
 * version than the root workspace, and the two `Router` types are
 * structurally incompatible at the property level (despite identical
 * runtime shape). Casting through `RequestHandler` (which is just
 * `(req, res, next) => void` in both versions) sidesteps the version
 * mismatch without runtime impact.
 */
let cached: RequestHandler | null = null;

export function getTasktotimeRouter(): RequestHandler {
  if (cached !== null) return cached;
  const services = getTasktotimeServices();
  const router = createTasktotimeRouter({
    taskRepo: services.adapters.taskRepo,
    createTaskHandler: services.createTaskHandler,
    transitionTaskHandler: services.transitionTaskHandler,
    addDependencyHandler: services.addDependencyHandler,
    updateWikiHandler: services.updateWikiHandler,
    patchTaskHandler: services.patchTaskHandler,
    deleteTaskHandler: services.deleteTaskHandler,
    removeDependencyHandler: services.removeDependencyHandler,
  }) as unknown as RequestHandler;
  cached = router;
  return router;
}
