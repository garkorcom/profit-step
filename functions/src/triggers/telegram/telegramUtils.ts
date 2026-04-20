import * as admin from 'firebase-admin';
import axios from 'axios';
import * as ShoppingAI from '../../services/shoppingAIService';
import { WORKER_BOT_TOKEN } from '../../config';
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();

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
    const token = WORKER_BOT_TOKEN.value();
    if (!token) {
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

        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, body);
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
    // Check for active sessions first (search by telegramId)
    let qs = await admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // Check for paused sessions if no active found (search by telegramId)
    qs = await admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // Cross-lookup: search by Firebase UID if telegramId didn't match
    try {
        const userSnap = await admin.firestore().collection('users')
            .where('telegramId', '==', String(userId))
            .limit(1)
            .get();

        if (!userSnap.empty) {
            const firebaseUid = userSnap.docs[0].id;

            // Search active sessions by Firebase UID
            qs = await admin.firestore().collection('work_sessions')
                .where('employeeId', '==', firebaseUid)
                .where('status', '==', 'active')
                .orderBy('startTime', 'desc')
                .limit(1)
                .get();

            if (!qs.empty) {
                return qs.docs[0];
            }

            // Search paused sessions by Firebase UID
            qs = await admin.firestore().collection('work_sessions')
                .where('employeeId', '==', firebaseUid)
                .where('status', '==', 'paused')
                .orderBy('startTime', 'desc')
                .limit(1)
                .get();

            if (!qs.empty) {
                return qs.docs[0];
            }
        }
    } catch (error) {
        console.error('Error in cross-lookup for getActiveSession:', error);
    }

    return null;
}

/**
 * Get ONLY active session (not paused). Use when you need strictly running sessions.
 */
export async function getActiveSessionStrict(userId: number) {
    // Search by telegramId first
    let qs = await admin.firestore().collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // Cross-lookup: search by Firebase UID if telegramId didn't match
    try {
        const userSnap = await admin.firestore().collection('users')
            .where('telegramId', '==', String(userId))
            .limit(1)
            .get();

        if (!userSnap.empty) {
            const firebaseUid = userSnap.docs[0].id;

            // Search active sessions by Firebase UID
            qs = await admin.firestore().collection('work_sessions')
                .where('employeeId', '==', firebaseUid)
                .where('status', '==', 'active')
                .orderBy('startTime', 'desc')
                .limit(1)
                .get();

            if (!qs.empty) {
                return qs.docs[0];
            }
        }
    } catch (error) {
        console.error('Error in cross-lookup for getActiveSessionStrict:', error);
    }

    return null;
}

/**
 * Build the persistent reply keyboard and status message based on current session state.
 * Returns { message, keyboard } without sending — useful for composing with other messages.
 */
export function buildStatusAndKeyboard(
    activeSession: FirebaseFirestore.QueryDocumentSnapshot | null,
    employeeName: string
): { message: string; keyboard: any[][] } {
    if (!activeSession) {
        // --- NOT WORKING ---
        // BUG-7 fix: Use ET timezone for greeting (Cloud Functions run in UTC)
        let hour: number;
        try {
            const { toZonedTime } = require('date-fns-tz');
            hour = toZonedTime(new Date(), 'America/New_York').getHours();
        } catch (_) {
            hour = new Date().getHours(); // fallback to UTC if date-fns-tz unavailable
        }
        let greeting = '👋';
        if (hour >= 5 && hour < 12) greeting = '🌅 Доброе утро';
        else if (hour >= 12 && hour < 18) greeting = '👋 Привет';
        else greeting = '🌙 Добрый вечер';

        return {
            message: `${greeting}, ${employeeName}! Ты сейчас не на смене.`,
            keyboard: [
                [{ text: '▶️ Начать смену' }],
                [{ text: '📊 Мой статус' }, { text: '❓ Помощь' }],
                [{ text: '🛒 Shopping' }, { text: '📥 Inbox' }],
                [{ text: '📋 Tasks' }]
            ]
        };
    }

    const data = activeSession.data();
    const now = Date.now();
    const startMs = data.startTime?.toMillis?.() || now;
    const totalBreaks = data.totalBreakMinutes || 0;

    if (data.status === 'paused') {
        // --- ON BREAK ---
        let breakMin = 0;
        if (data.lastBreakStart) {
            breakMin = Math.floor((now - data.lastBreakStart.toMillis()) / 60000);
        }
        let msg = breakMin > 0
            ? `☕ ${employeeName}, перерыв ${breakMin} мин.`
            : `☕ ${employeeName}, перерыв начат!`;
        if (breakMin > 60) {
            msg += `\n⚠️ Перерыв длится уже больше часа. Продолжить работу?`;
        }
        return {
            message: msg,
            keyboard: [
                [{ text: '▶️ Продолжить работу' }],
                [{ text: '⏹ Завершить смену' }],
                [{ text: '📊 Мой статус' }, { text: '❓ Помощь' }]
            ]
        };
    }

    // --- WORKING ---
    let ongoingBreak = 0;
    const elapsedTotal = Math.floor((now - startMs) / 60000);
    const workMinutes = Math.max(0, elapsedTotal - totalBreaks - ongoingBreak);
    const hourlyRate = data.hourlyRate || 0;
    const clientName = data.clientName || 'Неизвестный объект';

    let msg: string;
    // Fix #1: Show friendly message for newly started sessions (< 1 minute)
    if (workMinutes < 1) {
        msg = `👷 ${employeeName}, ты на *${clientName}*.\n✨ Смена начата! Работаем...`;
    } else {
        const hours = Math.floor(workMinutes / 60);
        const mins = workMinutes % 60;
        const earned = ((workMinutes / 60) * hourlyRate).toFixed(2);
        msg = `👷 ${employeeName}, ты на *${clientName}*.\nВремя: ${hours}ч ${mins}мин. Заработано: $${earned}`;
    }

    // Forgotten timer warning
    if (elapsedTotal > 720) { // > 12 hours
        const longHours = Math.floor(elapsedTotal / 60);
        msg += `\n\n⚠️ Смена длится уже ${longHours}ч! Забыли завершить?`;
    }

    return {
        message: msg,
        keyboard: [
            [{ text: '⏹ Завершить смену' }, { text: '⏸ Перерыв' }],
            [{ text: '📊 Мой статус' }, { text: '❓ Помощь' }],
            [{ text: '🛒 Shopping' }, { text: '📥 Inbox' }]
        ]
    };
}

export async function sendMainMenu(chatId: number, userId: number = chatId) {
    const activeSession = await getActiveSession(userId);

    // Resolve employee name
    let employeeName = 'Работник';
    try {
        const empDoc = await db.collection('employees').doc(String(userId)).get();
        if (empDoc.exists) employeeName = empDoc.data()?.name || employeeName;
    } catch (_) { /* ignore */ }

    const { message, keyboard } = buildStatusAndKeyboard(activeSession, employeeName);

    await sendMessage(chatId, message, {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
    });
}

/**
 * Edit an existing message (FIX #4: UX "presence effect")
 */
export async function editMessage(chatId: number, messageId: number, text: string): Promise<boolean> {
    const token = WORKER_BOT_TOKEN.value();
    if (!token) {
        console.error("Missing WORKER_BOT_TOKEN");
        return false;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${token}/editMessageText`, {
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
