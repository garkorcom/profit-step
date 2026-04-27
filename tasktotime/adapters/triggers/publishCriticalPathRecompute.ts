/**
 * `publishCriticalPathRecompute` — fan-out helper called from
 * `onTaskUpdate` when the change affects the project graph.
 *
 * Publishes a single message to the `recomputeCriticalPath` Pub/Sub topic
 * so a separate subscriber Cloud Function can run the CPM forward +
 * backward pass for the whole project. Reading + recomputing 100-1000
 * tasks per project does not belong inside `onTaskUpdate` — that would
 * blow the trigger's latency budget and lock-step every edit. The Pub/Sub
 * boundary lets us debounce and run async.
 *
 * **Trigger fields** — only graph-affecting changes warrant a publish:
 *   - `dependsOn`               (graph topology)
 *   - `estimatedDurationMinutes`(durations on edges)
 *   - `plannedStartAt`          (project start anchor)
 *   - `completedAt`             (advances the project's actual finish; the
 *                                 forward pass uses it to clamp slack on
 *                                 already-done tasks downstream)
 *   - `projectId`               (re-parenting a task moves it between two
 *                                 projects' graphs — both need a fresh CPM)
 *
 * Other watched-field changes (assignee, description, lifecycle, etc.)
 * do NOT shift the critical path and are filtered out here.
 *
 * **Debounce — 5 seconds per project.** Implemented via the existing
 * `IdempotencyPort.reserve` with a 5-second TTL. Multiple rapid edits
 * across many tasks in the same project produce ONE Pub/Sub publish.
 * The subscriber will see the freshest state when it runs.
 *
 * **Skip when projectId is missing** — orphan tasks (no projectId) do
 * not participate in a CPM recompute.
 *
 * **Fire-and-forget contract** — Pub/Sub publish errors are swallowed by
 * the adapter; any unexpected throw here is caught and logged at warn.
 */

import type { Task } from '../../domain/Task';
import type { PubSubPort } from '../../ports/infra';
import type { ClockPort } from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import type { TaskWatchedField } from './_shared';

export const RECOMPUTE_CRITICAL_PATH_TOPIC = 'recomputeCriticalPath';
export const DEBOUNCE_TTL_MS = 5_000;

/**
 * Fields whose change should produce a Pub/Sub publish. Anything outside
 * this set leaves the critical path unaffected.
 *
 * `completedAt` is included because completion-time advances the project's
 * actual finish, which the forward + backward CPM pass uses to compute
 * fresh slack on downstream tasks.
 *
 * `projectId` is included because re-parenting a task moves it between
 * two projects' graphs — both need a fresh CPM. The subscriber receives
 * the AFTER projectId; a separate publish for the BEFORE side happens
 * when the caller passes both before/after to `shouldPublish` (the
 * onTaskUpdate trigger handles that fan-out).
 */
export const GRAPH_AFFECTING_FIELDS: ReadonlyArray<TaskWatchedField> = [
  'dependsOn',
  'estimatedDurationMinutes',
  'plannedStartAt',
  'completedAt',
  'projectId',
] as const;

export interface PublishCriticalPathRecomputeDeps {
  pubsub: PubSubPort;
  idempotency: IdempotencyPort;
  clock: ClockPort;
  logger?: AdapterLogger;
}

export type PublishCriticalPathRecomputeResult =
  | { published: true; messageId: string | null; projectId: string }
  | { skipped: 'no_graph_affecting_change' | 'no_project' | 'debounced' | 'publish_failed' };

/**
 * Decide whether the change calls for a critical-path republish. Used by
 * `onTaskUpdate` to gate the call.
 */
export function shouldPublishCriticalPathRecompute(
  changedFields: ReadonlyArray<TaskWatchedField>,
  after: Task,
): boolean {
  if (!after.projectId) return false;
  return changedFields.some((f) =>
    GRAPH_AFFECTING_FIELDS.includes(f as (typeof GRAPH_AFFECTING_FIELDS)[number]),
  );
}

export async function publishCriticalPathRecompute(
  changedFields: ReadonlyArray<TaskWatchedField>,
  after: Task,
  deps: PublishCriticalPathRecomputeDeps,
): Promise<PublishCriticalPathRecomputeResult> {
  const log = deps.logger ?? noopLogger;
  const projectId = after.projectId;
  if (!projectId) return { skipped: 'no_project' };
  if (
    !changedFields.some((f) =>
      GRAPH_AFFECTING_FIELDS.includes(f as (typeof GRAPH_AFFECTING_FIELDS)[number]),
    )
  ) {
    return { skipped: 'no_graph_affecting_change' };
  }

  // ── Debounce per project ────────────────────────────────────────────
  // Use IdempotencyPort with a project-scoped key. The 5-second TTL
  // collapses rapid edits across many tasks into a single Pub/Sub publish.
  const debounceKey = `cpm_${after.companyId}_${projectId}`;
  const reserved = await deps.idempotency.reserve(debounceKey, DEBOUNCE_TTL_MS);
  if (!reserved) {
    log.debug?.('publishCriticalPathRecompute.debounced', {
      projectId,
      companyId: after.companyId,
    });
    return { skipped: 'debounced' };
  }

  try {
    const messageId = await deps.pubsub.publish(RECOMPUTE_CRITICAL_PATH_TOPIC, {
      data: {
        projectId,
        companyId: after.companyId,
        triggeredByTaskId: after.id,
        triggeredByFields: changedFields.filter((f) =>
          GRAPH_AFFECTING_FIELDS.includes(f as (typeof GRAPH_AFFECTING_FIELDS)[number]),
        ),
        publishedAt: deps.clock.now(),
      },
      attributes: {
        projectId: projectId as string,
        companyId: after.companyId as string,
      },
      orderingKey: projectId as string,
    });
    return { published: true, messageId, projectId: projectId as string };
  } catch (err) {
    // The adapter is supposed to swallow errors; a thrown error here is a
    // surprise (e.g. logger throwing). Log + return without rethrow.
    log.warn?.(
      'publishCriticalPathRecompute.publish_threw (non-blocking)',
      {
        projectId,
        err: err instanceof Error ? err.message : String(err),
      },
    );
    return { skipped: 'publish_failed' };
  }
}
