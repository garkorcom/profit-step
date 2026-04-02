/**
 * @fileoverview GTD Deadline Reminders Scheduled Function
 * 
 * Runs hourly to check for tasks with upcoming deadlines and sends
 * Telegram notifications to assigned users.
 * 
 * Reminder Schedule:
 * - 24 hours before: "⏰ Завтра дедлайн: {task}"
 * - 1 hour before: "🔥 Через час: {task}"
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';

/**
 * Scheduled function that runs every hour to send deadline reminders
 */
export const sendDeadlineReminders = functions.pubsub
    .schedule('0 * * * *') // Every hour at :00
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('⏰ [sendDeadlineReminders] Starting...');

        const now = new Date();

        // Time windows for reminders
        const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
        const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const twentyFiveHoursFromNow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        try {
            // Query tasks with dueDate in the reminder windows
            // Note: dueDate is stored as ISO string YYYY-MM-DD
            const snapshot = await db.collection('gtd_tasks')
                .where('status', 'in', ['inbox', 'next', 'waiting', 'scheduled', 'someday'])
                .get();

            if (snapshot.empty) {
                logger.info('✅ No tasks to check');
                return null;
            }

            let remindersSent = 0;
            let hourReminders = 0;
            let dayReminders = 0;

            for (const doc of snapshot.docs) {
                const task = doc.data();
                const taskId = doc.id;

                // Skip if no dueDate
                if (!task.dueDate) continue;

                // Skip if already reminded for this period
                const lastReminder = task.lastReminderSent?.toDate?.();
                if (lastReminder && (now.getTime() - lastReminder.getTime()) < 12 * 60 * 60 * 1000) {
                    // Already reminded in last 12 hours
                    continue;
                }

                // Parse dueDate (format: YYYY-MM-DD or with time)
                let dueDateTime: Date;
                if (task.dueDate.includes('T')) {
                    dueDateTime = new Date(task.dueDate);
                } else {
                    // Date only - assume end of day
                    dueDateTime = new Date(task.dueDate + 'T23:59:59');
                }

                // Add time if exists
                if (task.dueTime) {
                    const [hours, minutes] = task.dueTime.split(':');
                    dueDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                }

                // Find Telegram chatId for the assigned user
                const chatId = await findTelegramChatId(task.assignedTo || task.createdBy, task.telegramUserId);
                if (!chatId) continue;

                // Check 1-hour window
                if (dueDateTime >= now && dueDateTime <= oneHourFromNow) {
                    const message = formatReminderMessage(task, '🔥 Через час', taskId);
                    await sendTelegramMessage(chatId, message);
                    await doc.ref.update({
                        lastReminderSent: admin.firestore.FieldValue.serverTimestamp(),
                        lastReminderType: '1h'
                    });
                    hourReminders++;
                    remindersSent++;
                }
                // Check 24-hour window (avoid duplicate if already sent for 1h)
                else if (dueDateTime >= twentyFourHoursFromNow && dueDateTime <= twentyFiveHoursFromNow) {
                    if (task.lastReminderType === '24h') continue;

                    const message = formatReminderMessage(task, '⏰ Завтра дедлайн', taskId);
                    await sendTelegramMessage(chatId, message);
                    await doc.ref.update({
                        lastReminderSent: admin.firestore.FieldValue.serverTimestamp(),
                        lastReminderType: '24h'
                    });
                    dayReminders++;
                    remindersSent++;
                }
            }

            logger.info(`✅ [sendDeadlineReminders] Done: ${remindersSent} reminders (${hourReminders} 1h, ${dayReminders} 24h)`);
        } catch (error) {
            logger.error('❌ [sendDeadlineReminders] Error:', error);
        }

        return null;
    });

/**
 * Format reminder message
 */
function formatReminderMessage(task: any, prefix: string, taskId: string): string {
    let msg = `${prefix}:\n\n📝 *${task.title}*`;

    if (task.clientName) {
        msg += `\n👤 Клиент: ${task.clientName}`;
    }
    if (task.dueTime) {
        msg += `\n🕐 Время: ${task.dueTime}`;
    }
    if (task.priority === 'high') {
        msg += `\n🔥 Высокий приоритет`;
    }

    // Add link to task in web UI
    msg += `\n\n📋 [Открыть в CRM](https://profit-step.web.app/crm/cockpit?task=${taskId})`;

    return msg;
}

/**
 * Find Telegram chatId for a user
 */
async function findTelegramChatId(userId?: string, telegramUserId?: number): Promise<number | null> {
    // Direct telegram ID
    if (telegramUserId && typeof telegramUserId === 'number') {
        return telegramUserId;
    }

    // Try to find user by platform userId
    if (userId) {
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                if (userData?.telegramId) {
                    return typeof userData.telegramId === 'number'
                        ? userData.telegramId
                        : parseInt(userData.telegramId);
                }
            }

            // Try employees collection (by string ID)
            const empDoc = await db.collection('employees').doc(userId).get();
            if (empDoc.exists) {
                const empData = empDoc.data();
                if (empData?.telegramId) {
                    return typeof empData.telegramId === 'number'
                        ? empData.telegramId
                        : parseInt(empData.telegramId);
                }
            }
        } catch (e) {
            logger.warn('Error finding user telegramId', e);
        }
    }

    return null;
}

/**
 * Send Telegram message
 */
async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
    if (!WORKER_BOT_TOKEN) {
        logger.warn('WORKER_BOT_TOKEN not configured');
        return;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
        logger.info(`📨 Reminder sent to ${chatId}`);
    } catch (error: any) {
        logger.error(`Error sending reminder to ${chatId}:`, error.message);
    }
}
