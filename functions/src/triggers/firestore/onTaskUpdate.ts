/**
 * @fileoverview GTD Task Update Trigger for Audit Logging
 * 
 * Logs task status changes and deadline shifts to BigQuery.
 * 
 * @module triggers/firestore/onTaskUpdate
 */

import * as functions from 'firebase-functions';
import { logAuditEvent } from '../../utils/auditLogger';

export const onTaskUpdate = functions
    .region('us-central1')
    .firestore.document('gtd_tasks/{taskId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const taskId = context.params.taskId;

        // Skip if no meaningful changes
        if (JSON.stringify(before) === JSON.stringify(after)) {
            return;
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

            console.log(`📊 Task ${taskId}: status ${before.status} → ${after.status}`);
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
            console.log(`📊 Task ${taskId}: deadline shifted by ${shiftDays} days`);
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

            console.log(`📊 Task ${taskId}: scope changed after approval`);
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
                console.log(`📩 Sent task assignment notification to ${assigneeId} for task ${taskId}`);
            }
        }
    });
