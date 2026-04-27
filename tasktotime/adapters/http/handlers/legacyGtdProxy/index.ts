/**
 * Barrel for the `/api/gtd-tasks/*` backwards-compat proxy.
 *
 * The proxy is mounted by the composition root in
 * `functions/src/agent/routes/gtdTasksProxy.ts`. This barrel re-exports
 * the public surface (router factory + helpers used by tests) and the
 * pure status-drift map for the rare downstream caller that needs the
 * canonical translation without the HTTP shell.
 *
 * See: `tasktotime/spec/05-api/backwards-compat.md`.
 */

export {
  createGtdProxyRouter,
  legacyCreateRoute,
  legacyGetRoute,
  legacyListRoute,
  legacyPatchRoute,
  legacyDeleteRoute,
} from './createGtdProxyRouter';
export type {
  GtdProxyRouterDeps,
  ProxyRouteDeps,
} from './createGtdProxyRouter';

export {
  legacyStatusToLifecycle,
  lifecycleToLegacyStatus,
  isKnownLegacyStatus,
  LEGACY_TO_LIFECYCLE,
  LIFECYCLE_TO_LEGACY,
} from './statusDriftMap';

export {
  legacyCreateToTasktotime,
  legacyPatchToTasktotime,
  legacyListQueryToTasktotime,
  lifecycleToTransitionAction,
  tasktotimeTaskToLegacy,
} from './translate';
export type { LegacyTaskShape, LegacyPatchPlan, LegacyCreateBody } from './translate';
