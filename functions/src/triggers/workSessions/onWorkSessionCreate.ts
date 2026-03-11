import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import { safeConfig } from '../../utils/safeConfig';
import { sendMainMenu } from '../telegram/telegramUtils';

const db = admin.firestore();

export const onWorkSessionCreate = functions.firestore
    .document('work_sessions/{sessionId}')
    .onCreate(async (snap, context) => {
        const sessionData = snap.data();
        const employeeId = sessionData.employeeId;
        const description = sessionData.description || 'No description';
        const clientName = sessionData.clientName ? ` for ${sessionData.clientName}` : '';

        // Only notify if status is 'active' (in case we create completed sessions for history)
        if (sessionData.status !== 'active') {
            return;
        }

        try {
            // 1. Get Telegram ID from User Profile
            const userDoc = await db.collection('users').doc(employeeId).get();
            if (!userDoc.exists) {
                console.log(`User ${employeeId} not found, skipping Telegram notification.`);
                return;
            }

            const userData = userDoc.data();
            const telegramChatId = userData?.telegramChatId || userData?.telegramId; // Handle both field names
            const telegramId = userData?.telegramId;

            if (!telegramChatId) {
                console.log(`User ${employeeId} has no telegramChatId, skipping notification.`);
                return;
            }

            // 2. Get Bot Token
            const token = process.env.TELEGRAM_TOKEN || safeConfig().telegram?.token;
            if (!token) {
                console.error("Missing TELEGRAM_TOKEN, cannot send notification.");
                return;
            }

            // 3. Send Message
            const messageText = `▶️ *Task Started via Web*\n\n📝 Title: ${description}${clientName}`;

            await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                chat_id: telegramChatId,
                text: messageText,
                parse_mode: 'Markdown'
            });

            console.log(`✅ Notification sent to Telegram ID ${telegramChatId} for session ${context.params.sessionId}`);

            // 4. Force Update Telegram Keyboard for this User to "Pause/Stop"
            await sendMainMenu(telegramChatId, telegramId);

        } catch (error) {
            console.error("Error sending Telegram notification:", error);
        }
    });
