import * as admin from 'firebase-admin';
import axios from 'axios';
import * as ShoppingAI from '../../services/shoppingAIService';
import { safeConfig } from '../../utils/safeConfig';

if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || safeConfig().worker_bot?.token;

/**
 * Find platform user by Telegram ID.
 * Tries string match first, then numeric match as fallback.
 * Single source of truth — import from here instead of duplicating.
 */
export async function findPlatformUser(telegramId: number): Promise<{ id: string;[key: string]: any } | null> {
    try {
        // Try as string first (most common storage format)
        let snapshot = await db.collection('users')
            .where('telegramId', '==', String(telegramId))
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        }

        // Fallback: try as number
        snapshot = await db.collection('users')
            .where('telegramId', '==', telegramId)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        }
    } catch (error) {
        console.error("Error finding platform user:", error);
    }
    return null;
}

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
        // Fix 10 (Deep Testing): Handle 403 "bot blocked by user" gracefully
        const status = error?.response?.status;
        if (status === 403) {
            console.warn(`⚠️ Bot blocked by user (chatId: ${chatId}). Message not delivered.`);
            return; // Silent return — don't log as error
        }
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

/**
 * Get ONLY active session (not paused). Use when you need strictly running sessions.
 */
export async function getActiveSessionStrict(userId: number) {
    const qs = await admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    return !qs.empty ? qs.docs[0] : null;
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
            [{ text: "🛒 Shopping" }, { text: "📥 Inbox" }],
            [{ text: "📋 Tasks" }]
        ];
    }

    const hintMsg = (activeSession)
        ? "👷‍♂️ *Worker Panel*\nSelect an action:"
        : "👷‍♂️ *Worker Panel*\n📎 *To start a shift, tap the attachment icon and send your Live Location.*";

    await sendMessage(chatId, hintMsg, {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
    });
}

/**
 * Edit an existing message (FIX #4: UX "presence effect")
 */
export async function editMessage(chatId: number, messageId: number, text: string): Promise<boolean> {
    if (!WORKER_BOT_TOKEN) {
        console.error("Missing WORKER_BOT_TOKEN");
        return false;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: 'Markdown'
        });
        return true;
    } catch (error: any) {
        console.error('Error editing message:', error?.response?.data || error.message);
        return false;
    }
}

/**
 * Global Bot Logger
 * Writes to 'bot_logs' to provide a unified history of bot interactions per user.
 */
export async function logBotAction(telegramId: number, userId: string | number, action: string, details?: any) {
    try {
        await db.collection('bot_logs').add({
            telegramId,
            workerId: userId, // May be platform UID or Telegram ID
            action,
            details: details || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error('Failed to write bot_log', e);
    }
}

/**
 * Calculates the great-circle distance between two points on the Earth's surface using the Haversine formula.
 * @returns Distance in meters
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const toRadians = (deg: number) => deg * (Math.PI / 180);

    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
}
