import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();

// Config
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;

/**
 * Scheduled function that runs daily at 1:00 AM to finalize sessions.
 * 
 * Logic:
 * - Sessions from "day before yesterday" and earlier are finalized
 * - Edit window: "today" and "yesterday" = can edit
 * - Example: Today is Wednesday → Monday sessions get finalized
 * 
 * Benefits:
 * - Runs once per day instead of every hour (24x less server load)
 * - Predictable finalization time
 * - Simple date-based logic
 */
export const finalizeExpiredSessions = functions.pubsub
    .schedule('0 1 * * *') // Every day at 1:00 AM
    .timeZone('America/New_York')
    .onRun(async (context) => {
        // Calculate the cutoff date: end of day-before-yesterday
        const now = new Date();
        const dayBeforeYesterday = new Date(now);
        dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
        dayBeforeYesterday.setHours(23, 59, 59, 999); // End of that day

        console.log(`🔒 [finalizeExpiredSessions] Running daily finalization...`);
        console.log(`📅 Finalizing sessions from ${dayBeforeYesterday.toDateString()} and earlier`);

        try {
            // Find sessions that started on or before day-before-yesterday
            const snapshot = await db.collection('work_sessions')
                .where('startTime', '<=', admin.firestore.Timestamp.fromDate(dayBeforeYesterday))
                .get();

            if (snapshot.empty) {
                console.log('✅ No sessions to process.');
                return null;
            }

            const batch = db.batch();
            const notifications: Promise<void>[] = [];
            let finalizedCount = 0;
            let autoClosedCount = 0;
            let skippedCount = 0;

            for (const doc of snapshot.docs) {
                const session = doc.data();

                // Skip already finalized or processed sessions
                if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') {
                    skippedCount++;
                    continue;
                }

                // Skip correction entries and manual adjustments
                if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    skippedCount++;
                    continue;
                }

                const updates: any = {
                    finalizationStatus: 'finalized',
                    finalizedAt: admin.firestore.Timestamp.now(),
                };

                // Auto-close if still active or paused
                if (session.status === 'active' || session.status === 'paused') {
                    const startTime = session.startTime.toDate();
                    const newEndTime = new Date(startTime.getTime() + (1 * 60 * 60 * 1000)); // startTime + 1 hour
                    const durationMinutes = 60;
                    const hourlyRate = session.hourlyRate || 0;
                    const sessionEarnings = parseFloat(((durationMinutes / 60) * hourlyRate).toFixed(2));

                    Object.assign(updates, {
                        status: 'completed',
                        endTime: admin.firestore.Timestamp.fromDate(newEndTime),
                        durationMinutes,
                        sessionEarnings,
                        autoClosed: true,
                        description: (session.description || '') + ' [Auto-closed]',
                    });

                    autoClosedCount++;

                    // Notify worker via Telegram
                    const chatId = session.employeeId;
                    if (chatId && typeof chatId === 'number') {
                        const clientName = session.clientName || 'Unknown';
                        notifications.push(sendMessage(chatId,
                            `🔒 *Session Auto-Closed*\n\n` +
                            `Your session "${clientName}" from ${startTime.toLocaleDateString()} was left open.\n\n` +
                            `It has been automatically closed.\n` +
                            `⏱ Credited: 1 hour\n\n` +
                            `💡 Contact an administrator if you need adjustments.`
                        ));
                    }
                }

                batch.update(doc.ref, updates);
                finalizedCount++;
            }

            if (finalizedCount > 0) {
                await batch.commit();
            }

            await Promise.all(notifications);

            console.log(`✅ [finalizeExpiredSessions] Complete. Finalized: ${finalizedCount}, Auto-closed: ${autoClosedCount}, Skipped: ${skippedCount}`);
        } catch (error) {
            console.error('❌ [finalizeExpiredSessions] Error:', error);
        }

        return null;
    });

/**
 * Sends a Telegram message to the worker
 */
async function sendMessage(chatId: number, text: string) {
    if (!WORKER_BOT_TOKEN) {
        console.warn('WORKER_BOT_TOKEN not configured, skipping notification');
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
        });
    } catch (error: any) {
        console.error('Error sending Telegram message:', error.message);
    }
}

