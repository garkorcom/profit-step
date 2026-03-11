import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendMessage, sendMainMenu } from '../triggers/telegram/telegramUtils';

const db = admin.firestore();

/**
 * Scheduled function to check for long breaks (> 60 minutes)
 * and notify the employee.
 * Run frequency: Every 15 or 30 minutes.
 */
export const checkLongBreaks = functions.pubsub.schedule('every 15 minutes').onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    const thresholdMinutes = 60;
    const cutoffTime = admin.firestore.Timestamp.fromMillis(now.toMillis() - (thresholdMinutes * 60 * 1000));

    console.log('🔍 Checking for long breaks...');

    try {
        // Query active sessions that are paused
        const snapshot = await db.collection('work_sessions')
            .where('status', '==', 'paused')
            .where('lastBreakStart', '<=', cutoffTime)
            .get();

        if (snapshot.empty) {
            console.log('✅ No long breaks found.');
            return;
        }

        const batch = db.batch();
        let notificationCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();

            // Check if we already sent a notification recently (or ever for this break)
            // We'll use a flag 'breakNotificationSent' inside the session doc
            // or maybe a timestamp 'lastBreakNotificationTime' to remind every hour?
            // User requirement: "Bot sends notification". Let's send once.
            if (data.breakNotificationSent) {
                continue;
            }

            const employeeId = data.employeeId;
            const employeeName = data.employeeName || 'Employee';

            // Get Employee Profile to get Chat ID? 
            // Usually session doc has employee related info, but maybe not chat_id.
            // onWorkerBotMessage stores userId map or we look up 'employees' collection.
            // Actually, we can check 'employees/{employeeId}' doc for telegramChatId.
            // Or look up user profile.

            let chatId = data.telegramChatId; // Assuming we store this? 
            if (!chatId) {
                // Try to find it
                const empDoc = await db.collection('employees').doc(employeeId).get();
                chatId = empDoc.data()?.telegramChatId;

                if (!chatId) {
                    const userDoc = await db.collection('users').doc(employeeId).get();
                    chatId = userDoc.data()?.telegramChatId;
                }
            }

            if (chatId) {
                const message = `⏳ *Напоминание о перерыве*\n\n${employeeName}, ваш перерыв длится более 60 минут.\nВы еще отдыхаете? Не забудьте нажать *Resume* когда вернетесь к работе, или завершите смену.`;

                try {
                    await sendMessage(chatId, message);
                    await sendMainMenu(chatId, employeeId); // Force keyboard refresh

                    notificationCount++;
                    // Mark as sent
                    batch.update(doc.ref, {
                        breakNotificationSent: true,
                        lastBreakNotificationTime: now
                    });
                    console.log(`➡️ Notification sent to ${employeeName} (${chatId})`);
                } catch (err) {
                    console.error(`❌ Error sending Telegram API:`, err);
                }
            } else {
                console.warn(`⚠️ No chatId found for employee ${employeeId}`);
            }
        }

        if (notificationCount > 0) {
            await batch.commit();
        }

        console.log(`✅ Processed long breaks. Sent ${notificationCount} notifications.`);

    } catch (error) {
        console.error('❌ Error in checkLongBreaks:', error);
    }
});
