import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { WORKER_BOT_TOKEN, SCHEDULED_WORKER_SECRETS } from '../config';
const db = admin.firestore();

/**
 * Gets the start of a day (midnight)
 */
const getStartOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * Scheduled function that runs daily at 6:00 PM to remind workers about sessions
 * that will be finalized tomorrow at 1:00 AM.
 * 
 * Logic:
 * - Finds sessions from yesterday that are not yet finalized
 * - Sends Telegram reminder to the worker
 * 
 * Example: Today is Tuesday 6 PM
 * - Sessions from Monday will be finalized at Wed 1 AM
 * - This function sends reminders for Monday sessions
 */
export const sendSessionReminders = functions
    .runWith({ secrets: [...SCHEDULED_WORKER_SECRETS] })
    .pubsub
    .schedule('0 18 * * *') // Every day at 6:00 PM
    .timeZone('America/New_York')
    .onRun(async (context) => {
        const today = getStartOfDay(new Date());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        // Sessions from yesterday (will be finalized tomorrow at 1 AM)
        const startOfYesterday = yesterday;
        const endOfYesterday = new Date(yesterday);
        endOfYesterday.setHours(23, 59, 59, 999);

        console.log(`📧 [sendSessionReminders] Checking sessions from ${yesterday.toDateString()}...`);

        try {
            // Find sessions from yesterday that are still active/paused/pending
            const snapshot = await db.collection('work_sessions')
                .where('startTime', '>=', admin.firestore.Timestamp.fromDate(startOfYesterday))
                .where('startTime', '<=', admin.firestore.Timestamp.fromDate(endOfYesterday))
                .get();

            if (snapshot.empty) {
                console.log('✅ No sessions from yesterday.');
                return null;
            }

            const notifications: Promise<void>[] = [];
            let reminderCount = 0;
            let skippedCount = 0;

            for (const doc of snapshot.docs) {
                const session = doc.data();

                // Skip already finalized
                if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') {
                    skippedCount++;
                    continue;
                }

                // Skip corrections
                if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    skippedCount++;
                    continue;
                }

                // Skip if already reminded today
                if (session.reminderSentAt) {
                    const reminderDate = session.reminderSentAt.toDate();
                    if (getStartOfDay(reminderDate).getTime() === today.getTime()) {
                        skippedCount++;
                        continue;
                    }
                }

                const chatId = session.employeeId;
                if (chatId && typeof chatId === 'number') {
                    const clientName = session.clientName || 'Unknown';
                    const startTime = session.startTime?.toDate();
                    const status = session.status;

                    let message = `⏰ *Reminder: Session Review*\n\n`;
                    message += `📍 Client: ${clientName}\n`;
                    message += `📅 Date: ${startTime?.toLocaleDateString()}\n`;

                    if (status === 'active' || status === 'paused') {
                        message += `⚠️ Status: Still ${status.toUpperCase()}\n\n`;
                        message += `Please finish your session properly or contact an admin to correct the time.`;
                    } else {
                        message += `⏱ Duration: ${Math.floor((session.durationMinutes || 0) / 60)}h ${(session.durationMinutes || 0) % 60}m\n\n`;
                        message += `If you need to make corrections, please contact an admin.`;
                    }

                    notifications.push(
                        sendMessage(chatId, message).then(() => {
                            // Mark as reminded
                            doc.ref.update({
                                reminderSentAt: admin.firestore.Timestamp.now()
                            }).catch(err => console.error('Error updating reminder flag:', err));
                        })
                    );
                    reminderCount++;
                }
            }

            await Promise.all(notifications);

            console.log(`✅ [sendSessionReminders] Sent ${reminderCount} reminders, skipped ${skippedCount}`);
        } catch (error) {
            console.error('❌ [sendSessionReminders] Error:', error);
        }

        return null;
    });

/**
 * Sends a Telegram message to the worker
 */
async function sendMessage(chatId: number, text: string) {
    const token = WORKER_BOT_TOKEN.value();
    if (!token) {
        console.warn('WORKER_BOT_TOKEN not configured, skipping notification');
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
        });
    } catch (error: any) {
        console.error('Error sending Telegram message:', error.message);
    }
}
