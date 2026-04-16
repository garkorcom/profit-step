/**
 * Profile Handlers for Telegram Worker Bot
 *
 * Extracted from onWorkerBotMessage.ts for modularity.
 * Handles: /me, /name, /timezone, status, help, admin notifications.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { sendMessage, getActiveSession, sendMainMenu, findPlatformUser } from '../telegramUtils';
import { resolveHourlyRate } from '../rateUtils';
import { calculateDailyStats } from './sessionManager';

const db = admin.firestore();
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '';

/**
 * 📊 Мой статус — show current session details + daily/weekly stats
 */
export async function handleStatusRequest(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    const { hourlyRate, employeeName } = await resolveHourlyRate(userId);
    const now = Date.now();

    let statusMsg = `📊 *Статус: ${employeeName}*\n\n`;

    if (activeSession) {
        const sd = activeSession.data();
        const startMs = sd.startTime?.toMillis?.() || now;
        const totalBreaks = sd.totalBreakMinutes || 0;
        let ongoingBreak = 0;
        if (sd.status === 'paused' && sd.lastBreakStart) {
            ongoingBreak = Math.floor((now - sd.lastBreakStart.toMillis()) / 60000);
        }
        const elapsedTotal = Math.floor((now - startMs) / 60000);
        const workMinutes = Math.max(0, elapsedTotal - totalBreaks - ongoingBreak);
        const h = Math.floor(workMinutes / 60);
        const m = workMinutes % 60;
        const rate = sd.hourlyRate || hourlyRate || 0;
        const earned = ((workMinutes / 60) * rate).toFixed(2);

        statusMsg += `🏢 Объект: *${sd.clientName}*\n`;
        statusMsg += sd.status === 'paused' ? `☕ Статус: На перерыве\n` : `✅ Статус: Работает\n`;
        statusMsg += `⏱ Время работы: ${h}ч ${m}мин\n`;
        statusMsg += `💰 Заработано: $${earned}\n`;
        statusMsg += `💵 Ставка: $${rate}/ч\n`;
        if (totalBreaks > 0 || ongoingBreak > 0) {
            statusMsg += `☕ Перерывы: ${totalBreaks + ongoingBreak} мин\n`;
        }
    } else {
        statusMsg += `📭 Нет активной смены.\n`;
    }

    // Daily stats
    const dailyStats = await calculateDailyStats(userId);
    const dH = Math.floor(dailyStats.minutes / 60);
    const dM = dailyStats.minutes % 60;
    statusMsg += `\n📅 *Сегодня:* ${dH}ч ${dM}мин | $${dailyStats.earnings.toFixed(2)}`;

    await sendMessage(chatId, statusMsg);
    await sendMainMenu(chatId, userId);
}

/**
 * ❓ Помощь — user-friendly instructions
 */
export async function handleHelpRequest(chatId: number, userId: number) {
    await sendMessage(chatId, `❓ *Как пользоваться ботом*

*📍 Начать смену:*
1. Нажми 📎 (скрепку) внизу
2. Отправь 📍 Геопозицию
3. Бот определит объект автоматически
4. Сделай 📸 селфи на объекте
5. Запиши 🎙 голосовое (план работ)

*⏹ Завершить смену:*
1. Нажми "⏹ Завершить смену"
2. Отправь 📍 геопозицию
3. Сделай 📸 фото результата
4. Запиши 🎙 голосовое (что сделал)

*☕ Перерыв:*
Нажми "⏸ Перерыв" → "▶️ Продолжить работу"

*📊 Статус:*
Нажми "📊 Мой статус" — время, заработок

*📋 Задачи / 🛒 Закупки:*
Доступны через меню

*💡 Подсказки:*
• Можно отправить голосовое в любой момент
• Текст сохраняется в Inbox
• Фото пропускается кнопкой "Пропустить"`);
    await sendMainMenu(chatId, userId);
}

export async function handleMe(chatId: number, userId: number) {
    const doc = await db.collection('employees').doc(String(userId)).get();
    if (!doc.exists) return;
    const data = doc.data();
    await sendMessage(chatId, `👤 *Your Profile*\n\nName: **${data?.name}**\nRole: ${data?.role}\nID: \`${userId}\`\n\nTo change name, type:\n\`/name New Name\``);
}

export async function handleNameChange(chatId: number, userId: number, newName: string) {
    if (!newName || newName.length < 2) {
        await sendMessage(chatId, "⚠️ Name must be at least 2 characters.");
        return;
    }
    await db.collection('employees').doc(String(userId)).update({
        name: newName
    });
    await sendMessage(chatId, `✅ Name updated to: **${newName}**`);
}

/**
 * Sets or updates user's timezone preference.
 * Used for accurate daily statistics calculation.
 *
 * @param chatId - Telegram chat ID for responses
 * @param userId - Telegram user ID
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 */
export async function handleTimezone(chatId: number, userId: number, timezone: string) {
    if (!timezone) {
        await sendMessage(chatId, "⚠️ Usage: /timezone [Timezone]\nExample: `/timezone America/New_York`");
        return;
    }

    // Validate timezone string
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (e) {
        await sendMessage(chatId, "⚠️ Invalid timezone. Try 'America/New_York' or 'Europe/Kyiv'.");
        return;
    }

    const platformUser = await findPlatformUser(userId);
    if (platformUser) {
        await db.collection('users').doc(platformUser.id).update({ timezone: timezone });
    }
    // Also update local employee record as backup/primary for unlinked
    await db.collection('employees').doc(String(userId)).set({ timezone: timezone }, { merge: true });

    await sendMessage(chatId, `✅ Timezone set to: **${timezone}**`);
}

export async function sendAdminNotification(text: string) {
    if (!ADMIN_GROUP_ID) return;
    try {
        await sendMessage(Number(ADMIN_GROUP_ID), text);
    } catch (error) {
        logger.error('Failed to notify admin group', error);
        // Do not throw, so user flow is not interrupted
    }
}
