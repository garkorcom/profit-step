/**
 * `onWikiUpdate` — fires on `tasktotime_tasks/{taskId}` updates where the
 * `wiki.contentMd` or `wiki.attachments` field changed. Pure handler.
 *
 * This trigger is the **observer** of wiki edits — version bookkeeping
 * itself lives in `application/handlers/updateWikiHandler.ts`, which keeps
 * the version + sliding window of 10 inline `versionHistory[]` entries.
 * The trigger fires _after_ that write so the side effects below see the
 * already-bumped version.
 *
 * Side effects (per spec/05-api/triggers.md §onWikiUpdate):
 *   1. BigQuery audit row.
 *   2. **Archive overflow** — if the inline `versionHistory[]` carries more
 *      than 10 entries, the oldest entry is moved to the per-task
 *      subcollection `tasktotime_tasks/{taskId}/wiki_history/{versionId}`
 *      via {@link WikiHistoryPort.append}. The parent doc is then patched
 *      to keep only the **latest 10** entries inline. The application
 *      handler already caps at 10 via `slice(-9) + new`, so this branch
 *      only fires for legacy data or callers that bypass the handler.
 *   3. (Future) Parent `subtaskRollup.wikiSummary` invalidation for
 *      subtasks with `wikiInheritsFromParent: true`. TODO post PR-B6.
 *
 * **Field-change guard** — strict equality on `wiki.contentMd` AND
 * `wiki.attachments`. Wiki updates don't write to the task's other fields,
 * so we use the cheapest possible guard rather than a `diffWatchedFields`
 * full sweep.
 *
 * **Idempotency** — `tasktotime_wiki_update_<taskId>_<eventId>`. The
 * deterministic subcollection doc id (`v${version}`) makes a retried
 * archive write a no-op overwrite, so even a partial replay (audit
 * succeeded, archive failed) lands the same data on retry.
 *
 * **Patch safety** — the `versionHistory` crop uses `taskRepo.patch` with
 * a single `wiki.versionHistory` dotted-path key. We do NOT touch
 * `wiki.contentMd`, `wiki.version`, `wiki.updatedAt` etc., so the trigger
 * cannot loop on its own write (the field-change guard at the top of the
 * handler also blocks that).
 */

import type { Task, TaskWiki, WikiVersion } from '../../domain/Task';
import type { TaskId } from '../../domain/identifiers';
import type {
  TaskRepository,
  WikiHistoryPort,
} from '../../ports/repositories';
import type { BigQueryAuditPort, ClockPort } from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import {
  type DocumentChange,
  type TriggerResult,
  applied,
  idempotencyKey,
  shallowEqual,
  skipped,
} from './_shared';

const EVENT_TYPE = 'tasktotime_wiki_update';
const TTL_MS = 5 * 60 * 1000;

/**
 * Inline `versionHistory[]` cap. Older entries spill into the per-task
 * `wiki_history/` subcollection. Mirrors the application handler's
 * `slice(-9) + new = 10` window — kept here as a named constant so the
 * trigger's overflow check stays readable and a future bump only requires
 * one edit.
 */
const INLINE_VERSION_HISTORY_CAP = 10;

export interface OnWikiUpdateDeps {
  taskRepo: TaskRepository;
  wikiHistory: WikiHistoryPort;
  idempotency: IdempotencyPort;
  bigQueryAudit: BigQueryAuditPort;
  clock: ClockPort;
  logger?: AdapterLogger;
}

export async function onWikiUpdate(
  change: DocumentChange<Task>,
  deps: OnWikiUpdateDeps,
): Promise<TriggerResult> {
  const log = deps.logger ?? noopLogger;
  const { before, after, docId, eventId } = change;

  if (!before || !after) return skipped('missing_change_sides');

  // ── Field-change guard ──────────────────────────────────────────────
  if (
    before.wiki?.contentMd === after.wiki?.contentMd &&
    shallowEqual(before.wiki?.attachments, after.wiki?.attachments)
  ) {
    return skipped('wiki_unchanged');
  }

  // ── Idempotency guard ───────────────────────────────────────────────
  const key = idempotencyKey(EVENT_TYPE, docId, eventId);
  const reserved = await deps.idempotency.reserve(key, TTL_MS);
  if (!reserved) {
    log.debug?.('onWikiUpdate.skipped — already processed', { docId, eventId });
    return skipped('idempotency');
  }

  const effects: string[] = [];

  // ── BigQuery audit ──────────────────────────────────────────────────
  await deps.bigQueryAudit.log({
    eventType: 'task.wiki.updated',
    companyId: after.companyId,
    actorId: after.wiki?.updatedBy.id ?? after.assignedTo.id,
    taskId: after.id,
    occurredAt: deps.clock.now(),
    payload: summariseWikiChange(before.wiki, after.wiki),
  });
  effects.push('bigQueryAudit.log');

  // ── Archive overflow ────────────────────────────────────────────────
  // The application handler already caps `versionHistory` at 10. This
  // branch is the safety net for legacy data or callers that bypass the
  // handler. We only act when the post-write inline buffer carries more
  // than 10 entries.
  const versionHistory = after.wiki?.versionHistory ?? [];
  if (versionHistory.length > INLINE_VERSION_HISTORY_CAP) {
    const archived = await archiveOverflow(
      after.id,
      versionHistory,
      deps,
      log,
    );
    if (archived > 0) {
      effects.push(`wikiHistory.append.x${archived}`);
      effects.push('taskRepo.patch.versionHistory');
    }
  }

  return applied(effects);
}

/**
 * Move the oldest overflowed entries into `wiki_history/`, then patch the
 * parent doc to keep only the latest {@link INLINE_VERSION_HISTORY_CAP}
 * inline. Returns the number of entries archived.
 *
 * Append order matters: we archive in oldest-first order so a partial
 * failure (some appends succeed, the rest plus the patch don't) still
 * leaves the inline buffer valid. The trigger's idempotency reservation
 * blocks re-runs on the same eventId; the deterministic subcollection
 * doc id makes a retried archive write a no-op overwrite of the same
 * payload. After all appends succeed we patch the parent doc once with
 * the cropped inline buffer.
 */
async function archiveOverflow(
  taskId: TaskId,
  versionHistory: WikiVersion[],
  deps: Pick<OnWikiUpdateDeps, 'wikiHistory' | 'taskRepo'>,
  log: AdapterLogger,
): Promise<number> {
  const overflow = versionHistory.length - INLINE_VERSION_HISTORY_CAP;
  if (overflow <= 0) return 0;

  // Oldest entries first — `versionHistory` is append-order, so the head
  // of the array is the oldest. Slice once to avoid mutating the input.
  const toArchive = versionHistory.slice(0, overflow);
  const toKeep = versionHistory.slice(overflow);

  for (const entry of toArchive) {
    await deps.wikiHistory.append(taskId, {
      version: entry.version,
      contentMd: entry.contentMd,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
      changeSummary: entry.changeSummary,
      // `WikiVersion` does not carry attachments — they live on the wiki
      // root, not per-version. The history snapshot intentionally omits
      // them so a render of an old version uses the wiki's current
      // attachment registry.
    });
    log.debug?.('onWikiUpdate.archived', { taskId, version: entry.version });
  }

  // Patch the parent doc — single dotted-path field. Does not change any
  // watched field, so the field-change guard at the top of `onWikiUpdate`
  // blocks the resulting onUpdate from re-firing this branch.
  await deps.taskRepo.patch(taskId, {
    'wiki.versionHistory': toKeep,
  });

  return toArchive.length;
}

function summariseWikiChange(
  before: TaskWiki | undefined,
  after: TaskWiki | undefined,
): Record<string, unknown> {
  return {
    versionFrom: before?.version ?? null,
    versionTo: after?.version ?? null,
    contentLengthFrom: (before?.contentMd ?? '').length,
    contentLengthTo: (after?.contentMd ?? '').length,
    attachmentsFrom: before?.attachments?.length ?? 0,
    attachmentsTo: after?.attachments?.length ?? 0,
  };
}

export const __test__ = { TTL_MS, EVENT_TYPE, INLINE_VERSION_HISTORY_CAP };
