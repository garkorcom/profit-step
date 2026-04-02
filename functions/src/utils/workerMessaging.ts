import * as admin from 'firebase-admin';
/**
 * Utility to find a user's Telegram ID from either 'employees' or 'users' collection 
 * and send them a message via the Worker Bot.
 */
export async function sendMessageToWorker(userIdOrEmployeeId: string, text: string): Promise<boolean> {
    const db = admin.firestore();
    let telegramId: number | string | undefined;

    try {
        // 1. Try 'employees' collection first (legacy numeric IDs or string IDs)
        const empDoc = await db.collection('employees').doc(String(userIdOrEmployeeId)).get();
        if (empDoc.exists && empDoc.data()?.telegramId) {
            telegramId = empDoc.data()?.telegramId;
        } else {
            // 2. Try 'users' collection (platform IDs)
            const userDoc = await db.collection('users').doc(String(userIdOrEmployeeId)).get();
            if (userDoc.exists && userDoc.data()?.telegramId) {
                telegramId = userDoc.data()?.telegramId;
            }
        }

        if (!telegramId) {
            console.warn(`[sendMessageToWorker] No Telegram ID found for user ${userIdOrEmployeeId}`);
            return false;
        }

        // 3. Send via Telegram API
        const token = process.env.WORKER_BOT_TOKEN || '';
        if (!token) {
            console.error(`[sendMessageToWorker] Missing WORKER_BOT_TOKEN`);
            return false;
        }

        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramId,
                text: text,
                parse_mode: 'HTML' // Use HTML as it's less prone to escaping errors than MarkdownV2
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            console.error(`[sendMessageToWorker] Telegram API Error for chat ${telegramId}:`, errData);
            return false;
        }

        return true;

    } catch (error) {
        console.error(`[sendMessageToWorker] Failed to send message to ${userIdOrEmployeeId}:`, error);
        return false;
    }
}

/**
 * Escapes characters that have special meaning in HTML, preventing formatting errors 
 * when sending messages via Telegram API with parse_mode: 'HTML'.
 */
export function escapeHTML(text: string): string {
    if (!text) return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
