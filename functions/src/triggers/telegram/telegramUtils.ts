import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import axios from 'axios';
import * as ShoppingAI from '../../services/shoppingAIService';

if (admin.apps.length === 0) {
    admin.initializeApp();
}
// const db = admin.firestore(); // Use admin.firestore() directly
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;

/**
 * Send a message to Telegram
 */
export async function sendMessage(chatId: number, text: string, options: any = {}) {
    if (!WORKER_BOT_TOKEN) {
        console.error("Missing WORKER_BOT_TOKEN");
        return;
    }
    try {
        const body: any = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...options
        };

        if (options.keyboard) {
            body.reply_markup = { keyboard: options.keyboard, resize_keyboard: true, one_time_keyboard: false };
            delete body.keyboard;
        }
        if (options.inline_keyboard) {
            body.reply_markup = { inline_keyboard: options.inline_keyboard };
            delete body.inline_keyboard;
        }
        if (options.remove_keyboard) {
            body.reply_markup = { remove_keyboard: true };
            delete body.remove_keyboard;
        }

        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, body);
    } catch (error: any) {
        console.error('Error sending message:', error?.response?.data || error.message);
    }
}

/**
 * Show draft confirmation UI
 */
export async function showDraftConfirmation(
    chatId: number,
    draft: ShoppingAI.ParsedShoppingItem[],
    listId: string,
    clientName: string
) {
    const message = ShoppingAI.buildDraftMessage(draft, clientName);
    const keyboard = ShoppingAI.buildDraftKeyboard(draft, listId);

    await sendMessage(chatId, message, { inline_keyboard: keyboard });
}

export async function getActiveSession(userId: number) {
    // Check for active sessions first
    let qs = await admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // Check for paused sessions if no active found
    qs = await admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    return null;
}

export async function sendMainMenu(chatId: number, userId: number = chatId) {
    // Check if session is paused or active to decide generic menu
    const activeSession = await getActiveSession(userId);

    let keyboard;
    if (activeSession && activeSession.data().status === 'paused') {
        keyboard = [
            [{ text: "▶️ Resume Work" }, { text: "⏹️ Finish Work" }]
        ];
    } else if (activeSession && activeSession.data().status === 'active') {
        keyboard = [
            [{ text: "☕ Break" }, { text: "⏹️ Finish Work" }],
            [{ text: "⚠️ Finish Late" }] // New Button
        ];
    } else {
        keyboard = [
            [{ text: "▶️ Start Work" }, { text: "🛒 Shopping" }],
            [{ text: "📥 Inbox" }, { text: "📋 Tasks" }]
        ];
    }

    await sendMessage(chatId, "👷‍♂️ *Worker Panel*\nSelect an action:", {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
    });
}
