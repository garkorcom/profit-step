/**
 * @fileoverview GTD Task Update Trigger for Audit Logging
 *
 * Logs task status changes, deadline shifts, scope changes, and
 * sends Telegram notifications for new assignees.
 *
 * SAFETY:
 * - try/catch with structured error logging (functions.logger)
 * - Field-change guard: skips early if none of the auditable fields changed
 * - Returns null on error to prevent retries
 *
 * @module triggers/firestore/onTaskUpdate
 */

import * as functions from 'firebase-functions';
import { logAuditEvent } from '../../utils/auditLogger';

/** Fields that this trigger cares about */
const WATCHED_FIELDS = [
    'status', 'dueDate', 'title', 'description',
    'assigneeId', 'assignees',
] as const;

export const onTaskUpdate = functions
    .region('us-central1')
    .firestore.document('gtd_tasks/{taskId}')
    .onUpdate(async (change, context) => {
        const taskId = context.params.taskId;

        try {
            const before = change.before.data();
            const after = change.after.data();

            // ═══════════════════════════════════════════════════
            // Field-change guard: skip if no watched fields changed
            // (replaces the old JSON.stringify deep-equal which was
            // expensive and could miss Timestamp reference changes)
            // ═══════════════════════════════════════════════════
            const hasRelevantChange = WATCHED_FIELDS.some((field) => {
                const bVal = before[field];
                const aVal = after[field];
                // Simple strict compare; Timestamps with same seconds
                // will differ by reference, but that is acceptable
                // (a false-positive just means we re-audit, no harm).
                return bVal !== aVal;
            });

            if (!hasRelevantChange) {
                functions.logger.debug('onTaskUpdate: no watched fields changed, skipping', { taskId });
                return null;
            }

            // ═══════════════════════════════════════════════════
            // Task Status Changed
            // ═══════════════════════════════════════════════════
            if (before.status !== after.status) {
                await logAuditEvent({
                    entityType: 'gtd_task',
                    entityId: taskId,
                    eventCode: 'TASK_STATUS_CHANGE',
                    actorUid: after.updatedBy || after.assigneeId,
                    projectId: after.clientId,
                    companyId: after.companyId,
                    before: { status: before.status },
                    after: { status: after.status },
                });

                functions.logger.info('onTaskUpdate: status change logged', {
                    taskId,
                    from: before.status,
                    to: after.status,
                });
            }

            // ═══════════════════════════════════════════════════
            // Deadline Shifted
            // ═══════════════════════════════════════════════════
            const beforeDue = before.dueDate?.seconds || before.dueDate?.toMillis?.() / 1000;
            const afterDue = after.dueDate?.seconds || after.dueDate?.toMillis?.() / 1000;

            if (beforeDue !== afterDue && beforeDue && afterDue) {
                const shiftMinutes = Math.round((afterDue - beforeDue) / 60);

                await logAuditEvent({
                    entityType: 'gtd_task',
                    entityId: taskId,
                    eventCode: 'DEADLINE_SHIFT',
                    actorUid: after.updatedBy,
                    projectId: after.clientId,
                    companyId: after.companyId,
                    before: { dueDate: new Date(beforeDue * 1000).toISOString() },
                    after: { dueDate: new Date(afterDue * 1000).toISOString() },
                    timeImpact: shiftMinutes, // Positive = pushed back, Negative = moved up
                });

                const shiftDays = Math.round(shiftMinutes / 1440);
                functions.logger.info('onTaskUpdate: deadline shift logged', {
                    taskId,
                    shiftDays,
                });
            }

            // ═══════════════════════════════════════════════════
            // Scope Changed (Title/Description after approval)
            // ═══════════════════════════════════════════════════
            if ((before.title !== after.title || before.description !== after.description) &&
                before.status === 'approved') {
                await logAuditEvent({
                    entityType: 'gtd_task',
                    entityId: taskId,
                    eventCode: 'SCOPE_CHANGE',
                    actorUid: after.updatedBy,
                    projectId: after.clientId,
                    companyId: after.companyId,
                    before: { title: before.title, description: before.description },
                    after: { title: after.title, description: after.description },
                });

                functions.logger.info('onTaskUpdate: scope change logged', { taskId });
            }

            // ═══════════════════════════════════════════════════
            // Task Assigned (New Assignee)
            // ═══════════════════════════════════════════════════
            const getAssignees = (data: any) => {
                const list: string[] = [];
                if (data.assigneeId) list.push(String(data.assigneeId));
                if (Array.isArray(data.assignees)) {
                    data.assignees.forEach((a: any) => list.push(String(a)));
                }
                return [...new Set(list)];
            };

            const beforeAssignees = getAssignees(before);
            const afterAssignees = getAssignees(after);

            const newAssignees = afterAssignees.filter(id => !beforeAssignees.includes(id));

            if (newAssignees.length > 0) {
                const { sendMessageToWorker, escapeHTML } = await import('../../utils/workerMessaging');

                const taskTitle = escapeHTML(after.title || 'Новая задача');
                let dueDateStr = 'Без срока';

                if (after.dueDate) {
                    const ts = after.dueDate.seconds || after.dueDate.toMillis?.() / 1000;
                    if (ts) {
                        dueDateStr = new Date(ts * 1000).toLocaleDateString('ru-RU');
                    }
                }

                const message = `🆕 <b>Новая задача:</b> ${taskTitle}\n📅 <b>Срок:</b> ${dueDateStr}\n\nНажмите /tasks чтобы посмотреть список задач.`;

                for (const assigneeId of newAssignees) {
                    await sendMessageToWorker(assigneeId, message);
                    functions.logger.info('onTaskUpdate: assignment notification sent', {
                        taskId,
                        assigneeId,
                    });
                }
            }

            return null;
        } catch (error: any) {
            functions.logger.error('onTaskUpdate: failed', {
                taskId,
                collection: 'gtd_tasks',
                errorMessage: error?.message,
                errorStack: error?.stack,
            });
            return null;
        }
    });
