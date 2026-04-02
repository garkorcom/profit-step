import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
const db = admin.firestore();

// CONFIG
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';
const REMINDER_HOURS = 4;
const AUTO_CLOSE_HOURS = 16;
const PAID_HOURS_ON_AUTO_CLOSE = 1; // 1 hour

export const checkLongSessions = functions.pubsub.schedule('every 30 minutes').onRun(async (context) => {
    console.log('⏰ Running checkLongSessions...');

    const now = admin.firestore.Timestamp.now();
    const fourHoursAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - REMINDER_HOURS * 60 * 60 * 1000);

    try {
        // Query sessions older than 4 hours (covers both 4h reminders and 16h closures)
        const snapshot = await db.collection('work_sessions')
            .where('status', '==', 'active')
            .where('startTime', '<=', fourHoursAgo)
            .get();

        if (snapshot.empty) {
            console.log('✅ No long sessions found.');
            return null;
        }

        console.log(`Processing ${snapshot.size} active sessions...`);

        const batch = db.batch();
        let operationsCount = 0;
        const notificationPromises: Promise<void>[] = [];

        for (const doc of snapshot.docs) {
            const session = doc.data();
            const startTime: admin.firestore.Timestamp = session.startTime;
            const durationMs = now.toMillis() - startTime.toMillis();
            const durationHours = durationMs / (1000 * 60 * 60);

            // --- CASE 1: AUTO CLOSE (> 16 Hours) ---
            if (durationHours >= AUTO_CLOSE_HOURS) {
                console.log(`Closing session ${doc.id} (Duration: ${durationHours.toFixed(1)}h)`);

                // Calculate new End Time = Start Time + 1 Hour
                const newEndTime = admin.firestore.Timestamp.fromMillis(startTime.toMillis() + PAID_HOURS_ON_AUTO_CLOSE * 60 * 60 * 1000);

                batch.update(doc.ref, {
                    status: 'auto_closed',
                    endTime: newEndTime,
                    durationMinutes: PAID_HOURS_ON_AUTO_CLOSE * 60, // 60 mins
                    description: 'System: Auto-closed due to >16h inactivity.',
                    autoClosedAt: now
                });

                if (session.employeeId) {
                    const msg = `🛑 *Session Auto-Closed*\n\nYour session was active for over ${AUTO_CLOSE_HOURS} hours.\nIt has been automatically closed.\nPaid time: ${PAID_HOURS_ON_AUTO_CLOSE} hour.`;
                    notificationPromises.push(sendMessage(Number(session.employeeId), msg));
                }
                operationsCount++;

            }
            // --- CASE 2: REMINDER (> 4 Hours) ---
            else if (durationHours >= REMINDER_HOURS && !session.reminderSent) {
                console.log(`Sending reminder for session ${doc.id}`);

                batch.update(doc.ref, {
                    reminderSent: true
                });

                if (session.employeeId) {
                    const msg = `⚠️ *Reminder*\n\nYou have been working for over ${REMINDER_HOURS} hours.\nDon't forget to press "Finish Work" when you are done!`;
                    notificationPromises.push(sendMessage(Number(session.employeeId), msg));
                }
                operationsCount++;
            }
        }

        // Commit batch updates
        if (operationsCount > 0) {
            await batch.commit();
            console.log(`💾 Committed ${operationsCount} updates.`);
        }

        // Send notifications
        await Promise.all(notificationPromises);
        console.log('✅ Notifications sent.');

    } catch (error) {
        console.error('❌ Error in checkLongSessions:', error);
    }

    return null;
});

async function sendMessage(chatId: number, text: string) {
    if (!WORKER_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (error: any) {
        console.error(`Failed to send message to ${chatId}:`, error.message);
    }
}
