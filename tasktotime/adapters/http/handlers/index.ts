/**
 * Barrel for `tasktotime/adapters/http/handlers/`.
 *
 * Each handler module exports a factory `xxxRoute(deps)` that returns the
 * Express request handler. The factory shape is consistent across modules
 * so `routes.ts` can wire all of them in one place.
 */

export { createTaskRoute } from './createTask';
export type { CreateTaskHttpDeps } from './createTask';

export { getTaskRoute } from './getTask';
export type { GetTaskHttpDeps } from './getTask';

export { listTasksRoute } from './listTasks';
export type { ListTasksHttpDeps } from './listTasks';

export { transitionTaskRoute } from './transitionTask';
export type { TransitionTaskHttpDeps } from './transitionTask';

export { addDependencyRoute } from './addDependency';
export type { AddDependencyHttpDeps } from './addDependency';

export { updateWikiRoute } from './updateWiki';
export type { UpdateWikiHttpDeps } from './updateWiki';

export { getRollupRoute } from './getRollup';
export type { GetRollupHttpDeps } from './getRollup';
