/**
 * Backwards-compat proxy: `/api/gtd-tasks/*` → `/api/tasktotime/*`.
 *
 * Spec: `tasktotime/spec/05-api/backwards-compat.md`.
 *
 * Why this exists: the external AI bot `@crmapiprofit_bot` is hard-coded
 * against the legacy `/api/gtd-tasks/*` URL surface (see CLAUDE.md §4 live
 * risk #2). Until the external developer updates their prompt, every bot
 * call must keep landing on a working endpoint that internally writes the
 * canonical `tasktotime_tasks` collection.
 *
 * Design constraints:
 *
 *   1. The proxy must NOT touch the legacy `gtd_tasks` collection — the
 *      whole point is to deprecate the dual-source-of-truth situation.
 *      Reads/writes flow through the existing tasktotime handlers, which
 *      use only `tasktotime_tasks`.
 *
 *   2. The proxy is a THIN translation layer on top of the same handlers
 *      that `/api/tasktotime/*` uses. We do NOT duplicate auth, scope, or
 *      idempotency logic — those live in the application handlers and the
 *      `attachAuthContext` middleware.
 *
 *   3. The proxy must be cheap to remove. When Phase 6 cutover lands and
 *      the bot has switched, deleting this file plus its `app.use()` line
 *      is enough. No reach-back into application code.
 *
 *   4. Logging: every proxied request emits a deprecation warning so that
 *      after Phase 6 we can confirm zero traffic before deletion. The
 *      warning includes `User-Agent` to identify which bot version is
 *      still calling.
 *
 * Endpoint catalogue:
 *
 *   POST   /              → POST /api/tasktotime/tasks
 *   GET    /              → GET  /api/tasktotime/tasks  (list)
 *   GET    /:id           → GET  /api/tasktotime/tasks/:id
 *   PATCH  /:id           → PATCH /api/tasktotime/tasks/:id
 *                           + optional POST /tasks/:id/transition if status drift
 *   DELETE /:id           → DELETE /api/tasktotime/tasks/:id  (soft delete)
 *
 * Mounts at `/api/gtd-tasks` from the composition root; routes inside use
 * the relative paths above.
 *
 * Endpoints intentionally NOT proxied:
 *
 *   POST /api/gtd-tasks/batch-update — the bot does not call it. If a
 *     future caller needs it, layer it as a follow-up.
 *
 *   POST /api/gtd-tasks/:id/start  /  /complete (mentioned in
 *     spec/05-api/backwards-compat.md) — dropped because the live bot uses
 *     `PATCH /:id { status }` instead, and we already cover that path.
 *     Re-add as a separate diff if the bot prompt changes.
 *
 *   The legacy AI callables `generateAiTask` / `confirmAiTask` /
 *     `modifyAiTask` are Cloud Functions callables, NOT REST endpoints, so
 *     they fall outside this router. They still target `gtd_tasks` and must
 *     be migrated in their own PR (see CLAUDE.md and the AI flows in
 *     `functions/src/callable/ai/`).
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import type { TaskRepository } from '../../../../ports/repositories';
import type {
  CreateTaskHandler,
  PatchTaskHandler,
  TransitionTaskHandler,
  DeleteTaskHandler,
} from '../../../../application';
import { asTaskId } from '../../../../domain/identifiers';

import { attachAuthContext } from '../../middleware';
import { listTasksRoute } from '../listTasks';
import {
  legacyCreateToTasktotime,
  legacyPatchToTasktotime,
  legacyListQueryToTasktotime,
  lifecycleToTransitionAction,
  tasktotimeTaskToLegacy,
} from './translate';

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * Dependencies for the proxy router. Composition root passes the SAME
 * application handlers used by `/api/tasktotime/*` so the two surfaces
 * stay behaviour-equivalent (idempotency keys, transitions, soft delete).
 */
export interface GtdProxyRouterDeps {
  taskRepo: TaskRepository;
  createTaskHandler: CreateTaskHandler;
  patchTaskHandler: PatchTaskHandler;
  transitionTaskHandler: TransitionTaskHandler;
  deleteTaskHandler: DeleteTaskHandler;
  /**
   * Wall clock — used for default `dueAt` on create when the bot's payload
   * has no `dueDate`. Composition root injects `Date.now()`; tests inject
   * a fake clock.
   */
  now: () => number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Idempotency key extraction. Mirrors `extractIdempotencyKey` in
 * `tasktotime/adapters/http/schemas.ts` but keeps the proxy free of an
 * inbound dep on the schema module.
 */
function extractIdempotencyKey(req: Request): string | undefined {
  const headerValue =
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key' as 'idempotency-key'];
  if (typeof headerValue === 'string' && headerValue.length > 0) return headerValue;
  if (typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)) {
    const v = (req.body as Record<string, unknown>).idempotencyKey;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Standard error envelope for the legacy bot caller. */
function send400(
  res: Response,
  code: string,
  message: string,
  field?: string,
): void {
  res.status(400).json({
    ok: false,
    error: { code, message, ...(field ? { field } : {}) },
  });
}

function send404(res: Response, taskId: string): void {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `Task ${taskId} not found` },
  });
}

/**
 * Deprecation logger — emits one warn-level line per proxied call so the
 * Phase 6 zero-traffic check is mechanical (count log lines for 7 days).
 *
 * Direct `console.warn` is intentional: the proxy is a temporary shim and
 * we want it discoverable in any logging setup without depending on the
 * structured logger configuration.
 */
function logDeprecated(req: Request): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[gtdTasksProxy] DEPRECATED ${req.method} ${req.originalUrl ?? req.url} ` +
      `from user-agent='${req.headers['user-agent'] ?? 'unknown'}' ` +
      `caller='${req.auth?.by.id ?? 'unauthenticated'}'`,
  );
}

// ─── Route factories ────────────────────────────────────────────────────
//
// Each factory returns a single express RequestHandler. Exposed
// individually (in addition to being wired into `createGtdProxyRouter`)
// so tests can drive them with fake req/res — same convention as the
// canonical handlers in `../createTask.ts`, `../patchTask.ts`, etc.

export interface ProxyRouteDeps {
  taskRepo: TaskRepository;
  createTaskHandler: CreateTaskHandler;
  patchTaskHandler: PatchTaskHandler;
  transitionTaskHandler: TransitionTaskHandler;
  deleteTaskHandler: DeleteTaskHandler;
  now: () => number;
}

/** `POST /api/gtd-tasks` — create. */
export function legacyCreateRoute(deps: Pick<ProxyRouteDeps, 'createTaskHandler' | 'now'>) {
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) {
      next(new Error('attachAuthContext middleware not run'));
      return;
    }
    const idempotencyKey = extractIdempotencyKey(req);
    if (!idempotencyKey) {
      send400(
        res,
        'VALIDATION_ERROR',
        'Idempotency-Key header or `idempotencyKey` body field is required',
      );
      return;
    }

    const translated = legacyCreateToTasktotime(
      req.body,
      req.auth.by,
      req.auth.companyId,
      idempotencyKey,
      deps.now(),
    );
    if (!translated.ok) {
      send400(
        res,
        translated.error!.code,
        translated.error!.message,
        translated.error!.field,
      );
      return;
    }

    try {
      const command = translated.value!.body as unknown as Parameters<
        typeof deps.createTaskHandler.execute
      >[0];
      const task = await deps.createTaskHandler.execute(command);
      res.status(201).json({
        ok: true,
        // Legacy "taskId" key kept for bot compatibility — the original
        // legacy POST responded with `{ taskId }`.
        taskId: task.id,
        task: tasktotimeTaskToLegacy(task),
      });
    } catch (err) {
      next(err);
    }
  };
}

/** `GET /api/gtd-tasks/:id` — single fetch. */
export function legacyGetRoute(deps: Pick<ProxyRouteDeps, 'taskRepo'>) {
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
      send400(res, 'VALIDATION_ERROR', 'taskId path param required');
      return;
    }
    try {
      const task = await deps.taskRepo.findById(asTaskId(id));
      if (!task || task.companyId !== req.auth.companyId) {
        send404(res, id);
        return;
      }
      res.status(200).json({ ok: true, task: tasktotimeTaskToLegacy(task) });
    } catch (err) {
      next(err);
    }
  };
}

/** `GET /api/gtd-tasks` — list with legacy filter aliases. */
export function legacyListRoute(deps: Pick<ProxyRouteDeps, 'taskRepo'>) {
  // Build the upstream tasktotime list handler once; we drive it via a
  // per-call response shim that translates outbound items.
  const upstream = listTasksRoute({ taskRepo: deps.taskRepo });
  return async function (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.auth) {
      next(new Error('attachAuthContext middleware not run'));
      return;
    }
    const translated = legacyListQueryToTasktotime(
      req.query as Record<string, unknown>,
      req.auth.companyId,
    );
    if (!translated.ok) {
      send400(
        res,
        translated.error!.code,
        translated.error!.message,
        translated.error!.field,
      );
      return;
    }

    // Shim req.query so the upstream handler sees the translated filter.
    // Note: we mutate via Object.defineProperty because some Express
    // implementations make `req.query` a getter.
    const originalQuery = req.query;
    Object.defineProperty(req, 'query', {
      value: translated.value as Record<string, unknown>,
      writable: true,
      configurable: true,
    });

    // Wrap res.json to translate the items array on the way out.
    const originalJson = res.json.bind(res);
    res.json = ((payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'items' in payload &&
        Array.isArray((payload as { items: unknown }).items)
      ) {
        const p = payload as {
          ok?: boolean;
          items: Array<unknown>;
          nextCursor?: string | null;
        };
        return originalJson({
          ok: p.ok ?? true,
          tasks: p.items.map((t) =>
            tasktotimeTaskToLegacy(t as Parameters<typeof tasktotimeTaskToLegacy>[0]),
          ),
          nextCursor: p.nextCursor ?? null,
          // Legacy-compat: bot expects a `total` field. We set
          // `tasks.length` because tasktotime list does not return a
          // count; this matches the bot's expectation that "total = how
          // many we returned this page".
          total: p.items.length,
          hasMore: p.nextCursor !== null && p.nextCursor !== undefined,
        });
      }
      return originalJson(payload);
    }) as typeof res.json;

    try {
      await upstream(req, res, next);
    } finally {
      // Restore req.query for any downstream middleware that might read
      // it after this handler (defensive — `next()` for a list rarely
      // continues into more handlers, but the cleanup is cheap).
      Object.defineProperty(req, 'query', {
        value: originalQuery,
        writable: true,
        configurable: true,
      });
    }
  };
}

/** `PATCH /api/gtd-tasks/:id` — patch + optional transition. */
export function legacyPatchRoute(
  deps: Pick<
    ProxyRouteDeps,
    'taskRepo' | 'patchTaskHandler' | 'transitionTaskHandler'
  >,
) {
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
      send400(res, 'VALIDATION_ERROR', 'taskId path param required');
      return;
    }
    const idempotencyKey = extractIdempotencyKey(req);
    if (!idempotencyKey) {
      send400(
        res,
        'VALIDATION_ERROR',
        'Idempotency-Key header or `idempotencyKey` body field is required',
      );
      return;
    }

    const translated = legacyPatchToTasktotime(req.body);
    if (!translated.ok) {
      send400(
        res,
        translated.error!.code,
        translated.error!.message,
        translated.error!.field,
      );
      return;
    }

    try {
      // Cross-tenant guard first — out-of-scope returns 404 (matches
      // tasktotime convention so we don't leak existence).
      const existing = await deps.taskRepo.findById(asTaskId(id));
      if (!existing || existing.companyId !== req.auth.companyId) {
        send404(res, id);
        return;
      }

      const plan = translated.value!;

      // Apply patch FIRST (if any) so the transition action sees the
      // already-updated content.
      if (plan.hasPatchFields) {
        await deps.patchTaskHandler.execute({
          idempotencyKey: `proxy.patch.${idempotencyKey}`,
          by: req.auth.by,
          taskId: id,
          patch: plan.patchBody as Parameters<
            typeof deps.patchTaskHandler.execute
          >[0]['patch'],
        });
      }

      // Apply transition if the legacy patch carried a status change.
      if (plan.lifecycleTarget) {
        const action = lifecycleToTransitionAction(plan.lifecycleTarget);
        if (action) {
          // Only fire transition if we're actually changing lifecycle. A
          // no-op (legacy status equiv to current lifecycle) skips silently.
          if (existing.lifecycle !== plan.lifecycleTarget) {
            await deps.transitionTaskHandler.execute({
              taskId: id,
              action,
              by: req.auth.by,
              idempotencyKey: `proxy.transition.${idempotencyKey}`,
              ...(action === 'block' && { blockedReason: 'Set via legacy proxy' }),
            });
          }
        }
      }

      const after = await deps.taskRepo.findById(asTaskId(id));
      if (!after) {
        send404(res, id);
        return;
      }
      res.status(200).json({ ok: true, task: tasktotimeTaskToLegacy(after) });
    } catch (err) {
      next(err);
    }
  };
}

/** `DELETE /api/gtd-tasks/:id` — soft delete. */
export function legacyDeleteRoute(
  deps: Pick<ProxyRouteDeps, 'taskRepo' | 'deleteTaskHandler'>,
) {
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
      send400(res, 'VALIDATION_ERROR', 'taskId path param required');
      return;
    }
    const idempotencyKey = extractIdempotencyKey(req);
    if (!idempotencyKey) {
      send400(
        res,
        'VALIDATION_ERROR',
        'Idempotency-Key header or `idempotencyKey` body field is required',
      );
      return;
    }
    try {
      const existing = await deps.taskRepo.findById(asTaskId(id));
      if (!existing || existing.companyId !== req.auth.companyId) {
        send404(res, id);
        return;
      }
      const outcome = await deps.deleteTaskHandler.execute({
        idempotencyKey: `proxy.delete.${idempotencyKey}`,
        by: req.auth.by,
        taskId: id,
      });
      res.status(200).json({
        ok: true,
        archivedAt: outcome.archivedAt,
        // Legacy bot expects `archived: true` on success; preserve.
        archived: true,
      });
    } catch (err) {
      next(err);
    }
  };
}

// ─── Router factory ────────────────────────────────────────────────────

export function createGtdProxyRouter(deps: GtdProxyRouterDeps): Router {
  const router = Router();

  // Auth context propagation — REUSES the agentApi auth middleware via the
  // upstream-set req fields. We do NOT re-authenticate; we only normalise.
  router.use(attachAuthContext);

  // Deprecation logging — runs after auth so we get the caller id.
  router.use((req, _res, next) => {
    logDeprecated(req);
    next();
  });

  router.post(
    '/',
    legacyCreateRoute({ createTaskHandler: deps.createTaskHandler, now: deps.now }),
  );
  router.get('/', legacyListRoute({ taskRepo: deps.taskRepo }));
  router.get('/:id', legacyGetRoute({ taskRepo: deps.taskRepo }));
  router.patch(
    '/:id',
    legacyPatchRoute({
      taskRepo: deps.taskRepo,
      patchTaskHandler: deps.patchTaskHandler,
      transitionTaskHandler: deps.transitionTaskHandler,
    }),
  );
  router.delete(
    '/:id',
    legacyDeleteRoute({
      taskRepo: deps.taskRepo,
      deleteTaskHandler: deps.deleteTaskHandler,
    }),
  );

  return router;
}
