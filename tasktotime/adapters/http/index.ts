/**
 * Barrel for `tasktotime/adapters/http/*`.
 *
 * The HTTP adapter is the inbound edge of tasktotime. It translates Express
 * Request/Response into pure command/query DTOs, dispatches into the
 * application layer, and serialises results back to JSON.
 *
 * Composition root usage:
 *
 * ```ts
 * import { createTasktotimeRouter } from 'tasktotime/adapters/http';
 *
 * const router = createTasktotimeRouter({
 *   taskRepo,
 *   createTaskHandler,
 *   transitionTaskHandler,
 *   addDependencyHandler,
 *   updateWikiHandler,
 * });
 * agentApp.use('/api/tasktotime', router);
 * ```
 *
 * `attachAuthContext` and `tasktotimeErrorHandler` are exposed in case the
 * caller wants to mount handlers directly on a different parent app (e.g.
 * tests).
 */

export { createTasktotimeRouter } from './routes';
export type { TasktotimeRouterDeps } from './routes';

export {
  attachAuthContext,
  tasktotimeErrorHandler,
  sendValidationError,
} from './middleware';
export type { AuthContext } from './middleware';

export {
  parseCreateTaskBody,
  parseTransitionBody,
  parseAddDependencyBody,
  parseUpdateWikiBody,
  parseListTasksQuery,
  parsePatchTaskBody,
  parseDeleteTaskParams,
  parseRemoveDependencyParams,
  extractIdempotencyKey,
} from './schemas';
export type { ParseResult, ParseError } from './schemas';

export * from './handlers';
