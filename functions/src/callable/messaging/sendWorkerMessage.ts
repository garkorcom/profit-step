import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendMessageToWorker } from '../../utils/workerMessaging';
import { WORKER_BOT_TOKEN } from '../../config';

interface SendWorkerMessageData {
    employeeId: string;
    message: string;
}

export const sendWorkerMessage = functions
    .runWith({ secrets: [WORKER_BOT_TOKEN] })
    .https.onCall(async (data: SendWorkerMessageData, context) => {
    // 1. Auth check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Обязательна авторизация');
    }

    const { employeeId, message } = data;
    if (!employeeId || !message) {
        throw new functions.https.HttpsError('invalid-argument', 'Необходимы employeeId и message');
    }

    try {
        const db = admin.firestore();

        // 2. Format message and send via utility
        const formattedMessage = `📩 <b>Сообщение от Администратора</b>\n\n${message}`;
        const sent = await sendMessageToWorker(employeeId, formattedMessage);

        if (!sent) {
            throw new functions.https.HttpsError('internal', 'Не удалось отправить сообщение. Возможно не привязан Telegram аккаунт.');
        }

        // 3. Log to Firestore
        await db.collection('worker_messages').add({
            employeeId,
            message,
            sentBy: context.auth.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'sent'
        });

        return { success: true };

    } catch (error: any) {
        console.error('Error in sendWorkerMessage:', error);
        throw new functions.https.HttpsError('internal', error.message || 'Ошибка отправки сообщения');
    }
});
