import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendMainMenu, sendMessage } from '../telegram/telegramUtils';

const db = admin.firestore();

export const onWorkSessionCreate = functions.firestore
    .document('work_sessions/{sessionId}')
    .onCreate(async (snap, context) => {
        const sessionData = snap.data();
        const employeeId = sessionData.employeeId;
        const description = sessionData.description || 'No description';

        // Only notify if status is 'active' (in case we create completed sessions for history)
        if (sessionData.status !== 'active') {
            return;
        }

        // 🛡️ ЗАЩИТА ОТ ЭХА: telegram_bot пропускаем, openclaw показываем с пометкой Jarvis
        if (sessionData.source === 'telegram_bot') {
            console.log(`⏭️ Source is ${sessionData.source}, skipping echo notification.`);
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
            const telegramChatId = userData?.telegramChatId || userData?.telegramId;
            const telegramId = userData?.telegramId;

            if (!telegramChatId) {
                console.log(`User ${employeeId} has no telegramChatId, skipping notification.`);
                return;
            }

            // 3. Send Message
            const startSourceLabel = sessionData.source === 'openclaw' ? 'Jarvis 🤖' : 'Web CRM 💻';
            const msg = `▶️ <b>Рабочая сессия начата (${startSourceLabel})</b>\n` +
                        `🏢 Объект: ${sessionData.clientName || 'Не указан'}\n` +
                        `📝 Задача: ${sessionData.relatedTaskTitle || description}`;

            await sendMessage(telegramChatId, msg, { parse_mode: 'HTML' });

            console.log(`✅ Notification sent to Telegram ID ${telegramChatId} for session ${context.params.sessionId}`);

            // 4. Force Update Telegram Keyboard for this User to "Pause/Stop"
            if (telegramId) {
                await sendMainMenu(telegramChatId, telegramId);
            }

        } catch (error) {
            functions.logger.error("Error sending Telegram notification:", error);
        }
    });
