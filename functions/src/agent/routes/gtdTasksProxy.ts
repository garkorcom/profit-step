/**
 * Composition wrapper for the legacy `/api/gtd-tasks/*` backwards-compat
 * proxy. The actual router factory lives in
 * `tasktotime/adapters/http/handlers/legacyGtdProxy/` (pure / tested in
 * isolation). This module wires the Cloud-Functions-side dependencies
 * (Firebase Admin handlers via the tasktotime composition root) and
 * exposes a ready-to-mount `RequestHandler`.
 *
 * Mount semantics (must precede the legacy `/api/gtd-tasks` routes in
 * `functions/src/agent/routes/tasks.ts`):
 *
 *   app.use(authMiddleware);
 *   app.use(rateLimitMiddleware);
 *   app.use('/api/gtd-tasks', getGtdTasksProxyRouter());   // ← THIS module
 *   app.use(taskRoutes);                                    // ← legacy tasks.ts
 *
 * Express matches in registration order. Mounting the proxy first means
 * every bot call to `/api/gtd-tasks/*` lands here and writes to
 * `tasktotime_tasks` instead of the legacy `gtd_tasks` collection. The
 * legacy `tasks.ts` becomes effectively dead code post-deploy but stays
 * in tree until Phase 6 cutover (no risk-free way to delete before then;
 * see `spec/05-api/backwards-compat.md`).
 *
 * Lazy-build pattern matches `http/router.ts`: don't pay the cost of
 * resolving secrets / spinning up the tasktotime composition root for a
 * cold start of an unrelated agentApi route.
 *
 * Why a separate file (vs. inline in `agentApi.ts`):
 *   - Mirrors the structure of `http/router.ts` for the canonical mount
 *     so future readers see the same shape on both sides.
 *   - Keeps the agentApi orchestration file small — it just calls
 *     `getGtdTasksProxyRouter()` once.
 *   - Tests of the composition wiring can import this without dragging
 *     in the entire agentApi initialisation.
 */

import type { RequestHandler } from 'express';

import { createGtdProxyRouter } from '../../../../tasktotime/adapters/http/handlers/legacyGtdProxy';
import { getTasktotimeServices } from '../../tasktotime/composition';

/**
 * Cached `RequestHandler` — one router per function instance. Same
 * reasoning as `http/router.ts`: the express `Router` type signatures
 * differ between the root and `functions/` workspaces (different
 * `@types/express-serve-static-core` versions), and `RequestHandler` is
 * the lowest common denominator.
 */
let cached: RequestHandler | null = null;

/**
 * Resolve the proxy router. Builds it (and the underlying tasktotime
 * services bundle) on first call; subsequent calls return the cached
 * instance.
 */
export function getGtdTasksProxyRouter(): RequestHandler {
  if (cached !== null) return cached;
  const services = getTasktotimeServices();
  const router = createGtdProxyRouter({
    taskRepo: services.adapters.taskRepo,
    createTaskHandler: services.createTaskHandler,
    patchTaskHandler: services.patchTaskHandler,
    transitionTaskHandler: services.transitionTaskHandler,
    deleteTaskHandler: services.deleteTaskHandler,
    now: () => Date.now(),
  }) as unknown as RequestHandler;
  cached = router;
  return router;
}
