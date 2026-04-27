/**
 * `onTaskTransition` — fires on `tasktotime_transitions/{id}` onCreate.
 *
 * Each transition row is appended by `TaskService.transition` after the
 * lifecycle move + side-effects (actuals aggregation on `complete`, payroll
 * adjustments on `accept`) already happened. The trigger therefore handles
 * the **observer-side concerns** that the service does NOT do:
 *
 *   - BigQuery audit (every transition → analytics row).
 *   - Telegram notifications:
 *       `start`     → ping reviewer ("started: …"), if any.
 *       `complete`  → ping reviewer to acknowledge.
 *       `accept`    → ping assignee with bonus/penalty summary.
 *       `cancel`    → ping assignee + reviewer.
 *   - **Out of scope for PR-B1 (deferred to PR-B2):**
 *       - Cascade unblock (`dependsOn` reverse query) on `complete` /
 *         `cancel`. Needs a careful query + per-target idempotency.
 *       - Parent-rollup transition suggestion on `complete`. Needs the
 *         WikiRollup port wiring.
 *
 * **Idempotency** — `tasktotime_transition_<transitionId>_<eventId>`. The
 * transition collection is append-only; ids are deterministic
 * (`${taskId}_${from}_${to}_${at}`), so retries hit the same key.
 *
 * **Error policy** — notification failures and audit failures are logged
 * at warn but never thrown. The transition row is the system of record;
 * its existence alone is enough for downstream replays.
 */

import type { TransitionLogEntry } from '../../ports/repositories';
import type { Task, UserRef } from '../../domain/Task';
import type { TaskRepository } from '../../ports/repositories';
import type { TelegramNotifyPort } from '../../ports/notify';
import type { BigQueryAuditPort, ClockPort } from '../../ports/infra';
import type { IdempotencyPort } from '../../ports/ai';
import type { UserId } from '../../domain/identifiers';

import { type AdapterLogger, noopLogger } from '../firestore/_shared';
import {
  type DocumentChange,
  type TriggerResult,
  applied,
  idempotencyKey,
  skipped,
} from './_shared';

const EVENT_TYPE = 'tasktotime_transition';
const TTL_MS = 5 * 60 * 1000;

export interface OnTaskTransitionDeps {
  taskRepo: TaskRepository;
  idempotency: IdempotencyPort;
  telegram: TelegramNotifyPort;
  bigQueryAudit: BigQueryAuditPort;
  clock: ClockPort;
  logger?: AdapterLogger;
}

export async function onTaskTransition(
  change: DocumentChange<TransitionLogEntry>,
  deps: OnTaskTransitionDeps,
): Promise<TriggerResult> {
  const log = deps.logger ?? noopLogger;
  const { after, docId, eventId } = change;

  if (!after) return skipped('no_after_data');

  // ── Idempotency guard ───────────────────────────────────────────────
  const key = idempotencyKey(EVENT_TYPE, docId, eventId);
  const reserved = await deps.idempotency.reserve(key, TTL_MS);
  if (!reserved) {
    log.debug?.('onTaskTransition.skipped — already processed', { docId, eventId });
    return skipped('idempotency');
  }

  const transition = after;

  // ── Fetch task for context (notification copy + scope) ──────────────
  // The trigger is read-mostly — failures from the lookup are non-fatal:
  // we still emit the audit row. Notifications get skipped if the task
  // can't be loaded.
  let task: Task | null = null;
  try {
    task = await deps.taskRepo.findById(transition.taskId);
  } catch (err) {
    log.warn?.('onTaskTransition.task_lookup_failed', {
      taskId: transition.taskId,
      err,
    });
  }

  const effects: string[] = [];

  // ── 1. BigQuery audit (always fires) ────────────────────────────────
  await deps.bigQueryAudit.log({
    eventType: `task.transition.${transition.action}`,
    companyId: transition.companyId,
    actorId: transition.by.id,
    taskId: transition.taskId,
    occurredAt: transition.at,
    payload: {
      from: transition.from,
      to: transition.to,
      reason: transition.reason ?? null,
      transitionId: transition.id,
    },
  });
  effects.push('bigQueryAudit.log');

  // ── 2. Notifications per action ─────────────────────────────────────
  if (task) {
    await dispatchNotifications(deps, log, transition, task, effects);
  }

  return applied(effects);
}

// ─── Notifications ─────────────────────────────────────────────────────

async function dispatchNotifications(
  deps: OnTaskTransitionDeps,
  log: AdapterLogger,
  t: TransitionLogEntry,
  task: Task,
  effects: string[],
): Promise<void> {
  switch (t.action) {
    case 'start':
      // Ping reviewer that work has begun.
      if (task.reviewedBy && task.reviewedBy.id !== t.by.id) {
        await safeSend(
          deps,
          log,
          task.reviewedBy.id,
          renderStartMsg(task, t.by),
          task.id,
          effects,
          'start_reviewer',
        );
      }
      break;
    case 'complete':
      if (task.reviewedBy && task.reviewedBy.id !== t.by.id) {
        await safeSend(
          deps,
          log,
          task.reviewedBy.id,
          renderCompleteMsg(task, t.by),
          task.id,
          effects,
          'complete_reviewer',
        );
      }
      break;
    case 'accept':
      // Ping assignee with bonus/penalty summary.
      await safeSend(
        deps,
        log,
        task.assignedTo.id,
        renderAcceptMsg(task),
        task.id,
        effects,
        'accept_assignee',
      );
      break;
    case 'cancel':
      // Both assignee and reviewer want to know.
      await safeSend(
        deps,
        log,
        task.assignedTo.id,
        renderCancelMsg(task, t),
        task.id,
        effects,
        'cancel_assignee',
      );
      if (task.reviewedBy && task.reviewedBy.id !== task.assignedTo.id) {
        await safeSend(
          deps,
          log,
          task.reviewedBy.id,
          renderCancelMsg(task, t),
          task.id,
          effects,
          'cancel_reviewer',
        );
      }
      break;
    default:
      // 'create', 'ready', 'block', 'unblock' — observer-only (audit only).
      break;
  }
}

async function safeSend(
  deps: OnTaskTransitionDeps,
  log: AdapterLogger,
  recipientId: string,
  text: string,
  taskId: string,
  effects: string[],
  tag: string,
): Promise<void> {
  try {
    const result = await deps.telegram.send({
      recipientUserId: recipientId as UserId,
      text,
      taskId: taskId as Task['id'],
      silent: false,
    });
    if ('skipped' in result) {
      log.debug?.('onTaskTransition.notify skipped', {
        tag,
        recipientId,
        taskId,
        reason: result.reason,
      });
    } else {
      effects.push(`telegram.send(${tag})`);
    }
  } catch (err) {
    log.warn?.('onTaskTransition.notify failed (non-blocking)', {
      tag,
      recipientId,
      taskId,
      err,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderStartMsg(task: Task, actor: UserRef): string {
  return (
    `<b>Started:</b> ${escapeHtml(task.title)}\n` +
    `By: ${escapeHtml(actor.name)}`
  );
}

function renderCompleteMsg(task: Task, actor: UserRef): string {
  return (
    `<b>Completed:</b> ${escapeHtml(task.title)}\n` +
    `By: ${escapeHtml(actor.name)} — ready for review.`
  );
}

function renderAcceptMsg(task: Task): string {
  const lines = [
    `<b>Accepted:</b> ${escapeHtml(task.title)}`,
  ];
  if (task.bonusOnTime) {
    lines.push(
      `Bonus: ${task.bonusOnTime.amount.toFixed(2)} ${task.bonusOnTime.currency}`,
    );
  }
  if (task.penaltyOverdue) {
    lines.push(
      `Penalty: ${task.penaltyOverdue.amount.toFixed(2)} ${task.penaltyOverdue.currency}`,
    );
  }
  return lines.join('\n');
}

function renderCancelMsg(task: Task, t: TransitionLogEntry): string {
  const reason = t.reason ? `\nReason: ${escapeHtml(t.reason)}` : '';
  return (
    `<b>Cancelled:</b> ${escapeHtml(task.title)}\n` +
    `By: ${escapeHtml(t.by.name)}${reason}`
  );
}

export const __test__ = { TTL_MS, EVENT_TYPE };
