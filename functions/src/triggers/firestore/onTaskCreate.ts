/**
 * @fileoverview GTD Task Create Trigger
 * 
 * Sends Telegram notifications to newly assigned workers when a task is created.
 * 
 * @module triggers/firestore/onTaskCreate
 */

import * as functions from 'firebase-functions';

export const onTaskCreate = functions
    .region('us-central1')
    .firestore.document('gtd_tasks/{taskId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const taskId = context.params.taskId;

        // Extract assignees
        const getAssignees = (docData: any) => {
            const list: string[] = [];
            if (docData.assigneeId) list.push(String(docData.assigneeId));
            if (Array.isArray(docData.assignees)) {
                docData.assignees.forEach((a: any) => list.push(String(a)));
            }
            return [...new Set(list)];
        };

        const initialAssignees = getAssignees(data);

        if (initialAssignees.length > 0) {
            // Lazy load the helper to avoid cold start impact if no assignees
            const { sendMessageToWorker, escapeHTML } = await import('../../utils/workerMessaging');

            const taskTitle = escapeHTML(data.title || 'Новая задача');
            let dueDateStr = 'Без срока';

            if (data.dueDate) {
                const ts = data.dueDate.seconds || data.dueDate.toMillis?.() / 1000;
                if (ts) {
                    dueDateStr = new Date(ts * 1000).toLocaleDateString('ru-RU');
                }
            }

            const message = `🆕 <b>Новая задача:</b> ${taskTitle}\n📅 <b>Срок:</b> ${dueDateStr}\n\nНажмите /tasks чтобы посмотреть список задач.`;

            for (const assigneeId of initialAssignees) {
                await sendMessageToWorker(assigneeId, message);
                console.log(`📩 Sent task assignment notification to ${assigneeId} for new task ${taskId}`);
            }
        }
    });
