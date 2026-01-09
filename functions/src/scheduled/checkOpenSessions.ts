import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();

// Config (Same as main bot)
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;

export const checkOpenSessions = functions.pubsub.schedule('every 1 hours').onRun(async (context) => {
    // "Clean up next day":
    // Run periodically. Find sessions started BEFORE today (start of day).
    // If active -> Close at Start + 1 hour.

    const now = new Date();
    // We want to target sessions from "Yesterday" or older.
    // If session started > 14 hours ago and is still active, we assume it's abandoned from previous day.
    const CUTOFF_HOURS = 14;
    const cutoffTime = new Date(now.getTime() - CUTOFF_HOURS * 60 * 60 * 1000);

    console.log(`🔍 Checking for stale sessions older than ${CUTOFF_HOURS} hours...`);

    const snapshot = await db.collection('work_sessions')
        .where('status', '==', 'active')
        .where('startTime', '<=', admin.firestore.Timestamp.fromDate(cutoffTime))
        .get();

    if (snapshot.empty) return null;

    console.log(`Found ${snapshot.size} stale sessions.`);

    const batch = db.batch();
    const notifications: Promise<void>[] = [];

    for (const doc of snapshot.docs) {
        const session = doc.data();
        const startTime = session.startTime.toDate();
        const chatId = session.employeeId;

        // Rule: Start + 1 Hour
        const newEndTime = new Date(startTime.getTime() + (1 * 60 * 60 * 1000));
        const durationMinutes = 60;
        const hourlyRate = session.hourlyRate || 0;
        const sessionEarnings = parseFloat(((durationMinutes / 60) * hourlyRate).toFixed(2));

        batch.update(doc.ref, {
            status: 'completed',
            endTime: admin.firestore.Timestamp.fromDate(newEndTime),
            durationMinutes: durationMinutes,
            sessionEarnings: sessionEarnings,
            description: (session.description || '') + ' (Auto-closed: Next Day Rule)',
            autoClosed: true,
            // Clean up reminder fields if any existed
            reminderCount: admin.firestore.FieldValue.delete(),
            lastReminderTime: admin.firestore.FieldValue.delete()
        });

        if (chatId) {
            notifications.push(sendMessage(chatId, `🌚 **Session Auto-Closed**\n\nYour session was left open overnight.\nIt has been closed automatically.\n\n⏱ Credited: 1h\n💡 You can ask an admin to correct this if you worked longer.`));
        }
    }

    await batch.commit();
    await Promise.all(notifications);
    console.log(`✅ Closed ${snapshot.size} stale sessions.`);

    return null;
});

async function sendMessage(chatId: number, text: string, options: any = {}) {
    if (!WORKER_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...options
        });
    } catch (error: any) {
        console.error('Error sending message:', error.message);
    }
}
