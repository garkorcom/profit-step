/**
 * Text Fallback Handlers for Telegram Worker Bot
 *
 * Extracted from onWorkerBotMessage.ts for modularity.
 * Handles: smart text routing when user sends text instead of expected media/location,
 * and cancel action to abort session or close sequence.
 */

import * as admin from 'firebase-admin';
import { sendMessage, getActiveSession, sendMainMenu, logBotAction } from '../telegramUtils';
import { resolveHourlyRate } from '../rateUtils';
import { finalizeSession } from './sessionManager';
import { sendAdminNotification } from './profileHandlers';
import * as ShoppingHandler from './shoppingHandler';

const db = admin.firestore();

export async function handleText(chatId: number, userId: number, text: string) {
    // Check if awaiting shopping quick add
    const wasShoppingAdd = await ShoppingHandler.handleShoppingQuickAddText(chatId, userId, text);
    if (wasShoppingAdd) return;

    // Fix 5: Check if pending_starts exists — user typed a custom client name
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    const pendingStartDoc = await pendingStartRef.get();
    if (pendingStartDoc.exists) {
        const pendingData = pendingStartDoc.data()!;
        const location = pendingData.location;
        const { hourlyRate, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

        await db.collection('work_sessions').add({
            employeeId: userId,
            employeeName: employeeName,
            platformUserId: platformUserId,
            companyId: companyId,
            clientId: 'custom',
            clientName: text,
            startTime: admin.firestore.Timestamp.now(),
            status: 'active',
            startLocation: location,
            awaitingLocation: false,
            hourlyRate: hourlyRate,
            taskId: null,
            taskTitle: null
        });

        await pendingStartRef.delete();
        await sendMessage(chatId,
            `✅ *Смена начата!*\n\n🏢 Объект: *${text}* (ручной ввод)\n⏱ Таймер запущен. Работаем!`
        );
        await sendMainMenu(chatId, userId);
        await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started (Manual)*\n📍 ${text}`);
        return;
    }

    const activeSession = await getActiveSession(userId);
    if (!activeSession) return;

    const sessionData = activeSession.data();

    // --- SMART TYPE FALLBACK (ZERO-BLOCK) ---
    // If we are expecting a photo but got text, treat the text as an explanation and skip the photo.
    if (sessionData.awaitingStartPhoto) {
        await logBotAction(userId, userId, 'smart_fallback_start_photo', { text_reason: text });
        await activeSession.ref.update({
            awaitingStartPhoto: false,
            awaitingStartVoice: true,
            skippedStartPhoto: true,
            startPhotoReason: text
        });
        await sendMessage(chatId,
            `⏩ Фото пропущено (Причина: "${text}").\n\n🎙 Запиши голосовое: что планируешь сегодня делать?`,
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
        );
        return;
    }

    if (sessionData.awaitingEndLocation) {
        if (text === '❌ Отмена' || text === '❌ Cancel') {
            await handleCancel(chatId, userId);
            return;
        }
        await logBotAction(userId, userId, 'smart_fallback_end_location', { text_reason: text });
        await activeSession.ref.update({
            awaitingEndLocation: false,
            awaitingEndPhoto: true,
            skippedEndLocation: true,
            needsAdjustment: true,
            locationMismatch: true,
            locationMismatchReason: `Пропуск локации текстом: ${text}`
        });
        await sendMessage(chatId,
            `⏩ Локация пропущена. ⚠️ Отметка о пропуске сохранена.\n\n📸 Теперь отправь **фото** выполненной работы.`,
            { keyboard: [[{ text: "⏩ Пропустить фото" }]], resize_keyboard: true }
        );
        return;
    }

    if (sessionData.awaitingEndPhoto) {
        await logBotAction(userId, userId, 'smart_fallback_end_photo', { text_reason: text });
        await activeSession.ref.update({
            awaitingEndPhoto: false,
            awaitingEndVoice: true,
            skippedEndPhoto: true,
            endPhotoReason: text
        });
        await sendMessage(chatId,
            `⏩ Фото пропущено (Причина: "${text}").\n\n🎙 Запиши голосовое: Что успел сделать?`,
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
        );
        return;
    }

    // Fix 1: Text fallback for Start Voice
    if (sessionData.awaitingStartVoice) {
        await logBotAction(userId, userId, 'smart_fallback_start_voice', { text_reason: text });
        await activeSession.ref.update({
            awaitingStartVoice: false,
            plannedTaskDescription: text,
            plannedTaskSummary: text
        });
        await sendMessage(chatId, "✅ Текст сохранен вместо голосового.\n🚀 Сессия началась, удачной работы!", { remove_keyboard: true });
        await sendMainMenu(chatId, userId);
        return;
    }

    // Fix 1: Text fallback for End Voice
    if (sessionData.awaitingEndVoice) {
        await logBotAction(userId, userId, 'smart_fallback_end_voice', { text_reason: text });
        // Since End Voice is the last step, finalize directly
        await finalizeSession(chatId, userId, activeSession, text);
        return;
    }

    if (sessionData.awaitingDescription) {
        // FINALIZE SESSION with text description
        await finalizeSession(chatId, userId, activeSession, text);
    }
}

export async function handleCancel(chatId: number, userId: number) {
    // Fix 6: Also clean up pending_starts on cancel
    await db.collection('pending_starts').doc(String(userId)).delete().catch(() => { });

    const activeSession = await getActiveSession(userId);
    if (activeSession) {
        const data = activeSession.data();
        // Only cancel if in a setup phase or stuck
        if (data.awaitingLocation || data.awaitingChecklist || data.awaitingStartPhoto) {
            await activeSession.ref.delete();
            await sendMessage(chatId, "✅ Сессия отменена.", { remove_keyboard: true });
        } else if (data.awaitingEndLocation || data.awaitingEndPhoto || data.awaitingEndVoice) {
            // Revert closing sequence
            await activeSession.ref.update({
                awaitingEndLocation: false,
                awaitingEndPhoto: false,
                awaitingEndVoice: false
            });
            await sendMessage(chatId, "✅ Завершение отменено. Продолжай работу.", { remove_keyboard: true });
        } else {
            await sendMessage(chatId, "⚠️ Нельзя отменить активную смену. Используй ⏹️ Finish Work.");
        }
    } else {
        await sendMessage(chatId, "✅ Отменено.", { remove_keyboard: true });
    }
    await sendMainMenu(chatId, userId);
}
