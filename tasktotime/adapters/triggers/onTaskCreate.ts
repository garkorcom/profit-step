/**
 * `onTaskCreate` — fires when a new `tasktotime_tasks/{taskId}` document
 * lands. Pure handler (no `firebase-admin` imports — see `_shared.ts`).
 *
 * Side effects (per spec/05-api/triggers.md §onTaskCreate):
 *   1. Append an initial entry to `tasktotime_transitions` with
 *      `from: null`, `action: 'create'`, `to: <task.lifecycle>`.
 *   2. Notify the assignee (and reviewer, if set) via Telegram. Skip-not-throw
 *      if the recipient has no telegramId — TelegramNotifyAdapter handles
 *      that quietly.
 *   3. If `parentTaskId` is set, append the new task id to the parent's
 *      `subtaskIds[]` and set `isSubtask: true` on the child if it is not
 *      already (the application layer SHOULD set it on creation, but the
 *      trigger compensates for legacy / agent-driven writes).
 *   4. Fire-and-forget BigQuery audit row.
 *
 * **Idempotency** — `tasktotime_create_<taskId>_<eventId>`. Triggers can
 * fire multiple times (Firestore retry, manual replays); the dedupe key is
 * stable across retries because `eventId` is supplied by the Firebase
 * trigger context, not the wall clock.
 *
 * **Error policy** — failures in audit / notification are logged at warn
 * but never thrown. Failures in `transitionLog.append` are thrown — the
 * append is the system-of-record entry and must succeed.
 */

import type { Task } from '../../domain/Task';
import type { CompanyId, TaskId } from '../../domain/identifiers';
import type { TaskRepository, TransitionLogPort } from '../../ports/repositories';
import type { TelegramNotifyPort } from '../../ports/notify';
import type { BigQueryAuditPort, ClockPort } from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import {
  type DocumentChange,
  type TriggerResult,
  applied,
  idempotencyKey,
  skipped,
} from './_shared';

const EVENT_TYPE = 'tasktotime_create';
const TTL_MS = 5 * 60 * 1000;

export interface OnTaskCreateDeps {
  taskRepo: TaskRepository;
  transitionLog: TransitionLogPort;
  idempotency: IdempotencyPort;
  telegram: TelegramNotifyPort;
  bigQueryAudit: BigQueryAuditPort;
  clock: ClockPort;
  logger?: AdapterLogger;
}

export async function onTaskCreate(
  change: DocumentChange<Task>,
  deps: OnTaskCreateDeps,
): Promise<TriggerResult> {
  const log = deps.logger ?? noopLogger;
  const { after, docId, eventId } = change;

  if (!after) return skipped('no_after_data');

  // ── Idempotency guard ───────────────────────────────────────────────
  const key = idempotencyKey(EVENT_TYPE, docId, eventId);
  const reserved = await deps.idempotency.reserve(key, TTL_MS);
  if (!reserved) {
    log.debug?.('onTaskCreate.skipped — already processed', { docId, eventId });
    return skipped('idempotency');
  }

  const task = after;
  const effects: string[] = [];

  // ── 1. Append initial transition entry ──────────────────────────────
  // The append MUST succeed — without it, the audit log loses the create
  // event entirely. We rely on the deterministic id in TransitionLogPort
  // (`${taskId}_${from}_${to}_${at}`) to make a retry idempotent at the
  // store level too.
  await deps.transitionLog.append({
    id: `${task.id}_null_${task.lifecycle}_${task.createdAt}`,
    companyId: task.companyId,
    taskId: task.id,
    from: null,
    to: task.lifecycle,
    action: 'create',
    by: task.createdBy,
    at: task.createdAt,
    meta: { source: task.source },
  });
  effects.push('transitionLog.append(create)');

  // ── 2. Notify assignee + reviewer (skip-not-throw on no telegramId) ─
  await safeNotify(
    deps,
    log,
    task,
    task.assignedTo.id,
    'assignee',
    effects,
  );
  if (task.reviewedBy && task.reviewedBy.id !== task.assignedTo.id) {
    await safeNotify(deps, log, task, task.reviewedBy.id, 'reviewer', effects);
  }

  // ── 3. Parent subtask back-fill ─────────────────────────────────────
  if (task.parentTaskId) {
    await safeAttachToParent(deps, log, task, effects);
  }

  // ── 4. BigQuery audit (fire-and-forget; adapter swallows errors) ────
  await deps.bigQueryAudit.log({
    eventType: 'task.created',
    companyId: task.companyId,
    actorId: task.createdBy.id,
    taskId: task.id,
    occurredAt: deps.clock.now(),
    payload: {
      lifecycle: task.lifecycle,
      bucket: task.bucket,
      source: task.source,
      hasParent: !!task.parentTaskId,
    },
  });
  effects.push('bigQueryAudit.log');

  return applied(effects);
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function safeNotify(
  deps: OnTaskCreateDeps,
  log: AdapterLogger,
  task: Task,
  recipientId: string,
  role: 'assignee' | 'reviewer',
  effects: string[],
): Promise<void> {
  try {
    const text = renderCreateNotification(task, role);
    const result = await deps.telegram.send({
      recipientUserId: asUserIdLite(recipientId),
      text,
      taskId: task.id,
      silent: false,
    });
    if ('skipped' in result) {
      log.debug?.('onTaskCreate.notify skipped', {
        taskId: task.id,
        recipient: recipientId,
        reason: result.reason,
      });
    } else {
      effects.push(`telegram.send(${role})`);
    }
  } catch (err) {
    // Notification failure must NOT block the trigger; downstream
    // monitoring picks it up.
    log.warn?.('onTaskCreate.notify failed (non-blocking)', {
      taskId: task.id,
      recipient: recipientId,
      err,
    });
  }
}

async function safeAttachToParent(
  deps: OnTaskCreateDeps,
  log: AdapterLogger,
  task: Task,
  effects: string[],
): Promise<void> {
  const parentId = task.parentTaskId;
  if (!parentId) return;
  try {
    const parent = await deps.taskRepo.findById(parentId);
    if (!parent) {
      log.warn?.('onTaskCreate.parent_not_found', {
        taskId: task.id,
        parentId,
      });
      return;
    }
    if (parent.companyId !== task.companyId) {
      // Cross-tenant parent reference is a bug — refuse to back-fill.
      log.warn?.('onTaskCreate.parent_cross_tenant', {
        taskId: task.id,
        parentId,
        taskCompanyId: task.companyId,
        parentCompanyId: parent.companyId,
      });
      return;
    }
    if ((parent.subtaskIds ?? []).some((id) => id === task.id)) {
      // Already attached — likely a retry that overlapped with a
      // previous successful run.
      return;
    }
    await deps.taskRepo.patch(parentId, {
      subtaskIds: [...(parent.subtaskIds ?? []), task.id],
    });
    effects.push('taskRepo.patch(parent.subtaskIds)');

    if (!task.isSubtask) {
      await deps.taskRepo.patch(task.id, { isSubtask: true });
      effects.push('taskRepo.patch(child.isSubtask)');
    }
  } catch (err) {
    log.warn?.('onTaskCreate.attach_to_parent failed (non-blocking)', {
      taskId: task.id,
      parentId,
      err,
    });
  }
}

function renderCreateNotification(
  task: Task,
  role: 'assignee' | 'reviewer',
): string {
  const verb = role === 'assignee' ? 'assigned to you' : 'set for your review';
  const due = new Date(task.dueAt).toISOString().slice(0, 10);
  return `<b>New task ${verb}</b>\n${escapeHtmlText(task.title)}\nDue: ${due}`;
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Local re-brand to avoid pulling in `asUserId` solely for the cast.
function asUserIdLite(s: string): import('../../domain/identifiers').UserId {
  return s as import('../../domain/identifiers').UserId;
}

// Re-export for test convenience.
export const __test__ = { TTL_MS, EVENT_TYPE };

// Type guard exports for downstream consumers.
export type { TaskId, CompanyId };
