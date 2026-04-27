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
 *   2. (Future) Archive `versionHistory[0]` to a `wiki_history/` subcollection
 *      when the inline buffer overflows. Currently the application handler
 *      caps the inline buffer at 10 via `slice(-9) + new`, so overflow does
 *      not happen unless someone bypasses the handler. Out of scope for
 *      PR-B1 — TODO for PR-B2 once the WikiHistoryPort lands.
 *   3. (Future) Parent `subtaskRollup.wikiSummary` invalidation for
 *      subtasks with `wikiInheritsFromParent: true`. Same TODO.
 *
 * **Field-change guard** — strict equality on `wiki.contentMd` AND
 * `wiki.attachments`. Wiki updates don't write to the task's other fields,
 * so we use the cheapest possible guard rather than a `diffWatchedFields`
 * full sweep.
 *
 * **Idempotency** — `tasktotime_wiki_update_<taskId>_<eventId>`.
 */

import type { Task, TaskWiki } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories';
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

export interface OnWikiUpdateDeps {
  taskRepo: TaskRepository;
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

  return applied(effects);
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

export const __test__ = { TTL_MS, EVENT_TYPE };
