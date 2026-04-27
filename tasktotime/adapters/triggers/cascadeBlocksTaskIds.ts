/**
 * `cascadeBlocksTaskIds` — keep `blocksTaskIds[]` denormalisation in sync
 * with `dependsOn[]` whenever a task's dependency list changes.
 *
 * Called from `onTaskUpdate` when the watched diff includes `dependsOn`.
 * The handler is split into its own file so each cascade stays under SRP
 * and the fan-out logic stays out of the audit-row path.
 *
 * Why we need this — the `Task` aggregate stores predecessors on
 * `dependsOn` (forward edges). The `blocksTaskIds[]` reverse edge is the
 * denormalisation used by the cascade-unblock check on `complete` and by
 * the dependency-graph UI. Without keeping them in lock-step the graph view
 * shows stale "blocks" arrows and `onTaskTransition` cannot find dependents.
 *
 * **Loop safety (CLAUDE.md §2.1).** Each `target.blocksTaskIds` patch is
 * itself a Firestore write that fires `onTaskUpdate` on the target — but
 * `blocksTaskIds` is on the EXCLUDED list inside `_shared.ts`, so the
 * follow-up `onTaskUpdate` exits with `no_watched_field_change`. The
 * cascade therefore terminates after one hop per target. Do **not**
 * remove `blocksTaskIds` from the exclusion list without re-deriving the
 * loop proof here.
 *
 * **Cross-tenant guard.** Refuse to mutate a target that belongs to a
 * different `companyId`. Such a reference is a bug somewhere upstream
 * (probably an agent-driven write that bypassed RLS); we log a warn and
 * leave the target alone.
 *
 * **Idempotency at the patch level.** A target whose `blocksTaskIds`
 * already contains the source task id is a no-op skip (no write). Same
 * for "remove" when the id was never there.
 */

import type { Task, TaskDependency } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories';
import type { TaskId } from '../../domain/identifiers';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';

export interface CascadeBlocksTaskIdsDeps {
  taskRepo: TaskRepository;
  logger?: AdapterLogger;
}

export interface CascadeBlocksTaskIdsResult {
  added: TaskId[];
  removed: TaskId[];
  skippedCrossTenant: TaskId[];
  skippedNotFound: TaskId[];
}

/**
 * Compute the diff between `before.dependsOn` and `after.dependsOn`, then
 * apply reverse-edge patches on each affected target.
 */
export async function cascadeBlocksTaskIds(
  before: Task,
  after: Task,
  deps: CascadeBlocksTaskIdsDeps,
): Promise<CascadeBlocksTaskIdsResult> {
  const log = deps.logger ?? noopLogger;
  const beforeTargets = collectTargets(before.dependsOn);
  const afterTargets = collectTargets(after.dependsOn);

  const addTargets = setDiff(afterTargets, beforeTargets);
  const removeTargets = setDiff(beforeTargets, afterTargets);

  const result: CascadeBlocksTaskIdsResult = {
    added: [],
    removed: [],
    skippedCrossTenant: [],
    skippedNotFound: [],
  };

  for (const targetId of addTargets) {
    await mutateTarget(deps, log, after, targetId, 'add', result);
  }
  for (const targetId of removeTargets) {
    await mutateTarget(deps, log, after, targetId, 'remove', result);
  }

  return result;
}

// ─── Internals ─────────────────────────────────────────────────────────

function collectTargets(deps: TaskDependency[] | undefined): TaskId[] {
  if (!deps || deps.length === 0) return [];
  return deps.map((d) => d.taskId);
}

function setDiff(a: TaskId[], b: TaskId[]): TaskId[] {
  const setB = new Set(b);
  // Preserve order, dedupe within `a`.
  const seen = new Set<TaskId>();
  const out: TaskId[] = [];
  for (const id of a) {
    if (setB.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function mutateTarget(
  deps: CascadeBlocksTaskIdsDeps,
  log: AdapterLogger,
  source: Task,
  targetId: TaskId,
  op: 'add' | 'remove',
  result: CascadeBlocksTaskIdsResult,
): Promise<void> {
  let target: Task | null;
  try {
    target = await deps.taskRepo.findById(targetId);
  } catch (err) {
    // Lookup failure is non-fatal for the cascade; the target's reverse
    // edge will be inconsistent until the next dependsOn write. Log and
    // continue so the rest of the cascade still applies.
    log.warn?.('cascadeBlocksTaskIds.lookup_failed', {
      sourceId: source.id,
      targetId,
      err,
    });
    result.skippedNotFound.push(targetId);
    return;
  }
  if (!target) {
    log.warn?.('cascadeBlocksTaskIds.target_missing', {
      sourceId: source.id,
      targetId,
    });
    result.skippedNotFound.push(targetId);
    return;
  }
  if (target.companyId !== source.companyId) {
    log.warn?.('cascadeBlocksTaskIds.cross_tenant_target', {
      sourceId: source.id,
      sourceCompanyId: source.companyId,
      targetId,
      targetCompanyId: target.companyId,
    });
    result.skippedCrossTenant.push(targetId);
    return;
  }

  const current = target.blocksTaskIds ?? [];
  const has = current.includes(source.id);
  if (op === 'add' && has) return; // already present, skip write
  if (op === 'remove' && !has) return; // already absent, skip write

  const next = op === 'add'
    ? [...current, source.id]
    : current.filter((id) => id !== source.id);

  try {
    await deps.taskRepo.patch(targetId, { blocksTaskIds: next });
    if (op === 'add') result.added.push(targetId);
    else result.removed.push(targetId);
  } catch (err) {
    log.warn?.('cascadeBlocksTaskIds.patch_failed', {
      sourceId: source.id,
      targetId,
      op,
      err,
    });
    // Mirror lookup-failure behaviour: continue the rest of the cascade.
    result.skippedNotFound.push(targetId);
  }
}
