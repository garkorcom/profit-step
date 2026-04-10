/**
 * @fileoverview Daily Task Digest — sends morning summary to workers via Telegram
 *
 * Runs at 7:00 AM ET. For each user with open tasks:
 * - Shows top 3 tasks for today (overdue first, then by priority)
 * - Total counts by status
 * - Quick /plan command hint
 *
 * Spec: Phase 1.3 of Tasks v2 plan
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';

const PRIORITY_EMOJI: Record<string, string> = {
    high: '🔴',
    medium: '🟠',
    low: '🔵',
    none: '⚪',
};

/**
 * Scheduled function — runs daily at 07:00 ET
 */
export const sendDailyTaskDigest = functions.pubsub
    .schedule('0 7 * * *') // 7:00 AM every day
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('📋 [dailyTaskDigest] Starting morning digest...');

        try {
            // 1. Find all users with telegramId (active bot users)
            const usersSnap = await db.collection('users').get();
            let digestsSent = 0;

            for (const userDoc of usersSnap.docs) {
                const userData = userDoc.data();
                const telegramId = userData.telegramId;
                if (!telegramId) continue;

                const chatId = typeof telegramId === 'number'
                    ? telegramId
                    : parseInt(telegramId);
                if (isNaN(chatId)) continue;

                try {
                    await sendDigestForUser(chatId, userDoc.id, userData.displayName || userData.name || 'Worker');
                    digestsSent++;
                } catch (err: any) {
                    // 403 = bot blocked by user — skip silently
                    if (err?.response?.status === 403) continue;
                    logger.warn(`Digest failed for user ${userDoc.id}`, err?.message);
                }
            }

            logger.info(`✅ [dailyTaskDigest] Done: ${digestsSent} digests sent`);
        } catch (error) {
            logger.error('❌ [dailyTaskDigest] Fatal error:', error);
        }

        return null;
    });

/**
 * Build and send digest for a single user
 */
async function sendDigestForUser(chatId: number, userId: string, userName: string): Promise<void> {
    // Query active tasks (not done, not cancelled)
    const tasksSnap = await db.collection('gtd_tasks')
        .where('ownerId', '==', userId)
        .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'someday'])
        .get();

    if (tasksSnap.empty) return; // No open tasks — skip digest

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Parse and score tasks
    interface ScoredTask {
        id: string;
        title: string;
        priority: string;
        status: string;
        clientName?: string;
        isOverdue: boolean;
        isDueToday: boolean;
        dueDate?: Date;
        score: number; // lower = more urgent
    }

    const tasks: ScoredTask[] = [];
    const statusCounts: Record<string, number> = {
        inbox: 0, next_action: 0, waiting: 0, projects: 0, estimate: 0, someday: 0,
    };

    for (const doc of tasksSnap.docs) {
        const data = doc.data();
        const status = data.status || 'inbox';
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        // Parse dueDate
        let dueDate: Date | undefined;
        let isOverdue = false;
        let isDueToday = false;

        if (data.dueDate) {
            try {
                dueDate = data.dueDate.toDate ? data.dueDate.toDate() : new Date(data.dueDate);
                const dueDateOnly = new Date(dueDate!);
                dueDateOnly.setHours(0, 0, 0, 0);
                isOverdue = dueDateOnly < todayStart;
                isDueToday = dueDateOnly.getTime() === todayStart.getTime();
            } catch (_) { /* ignore bad dates */ }
        }

        // Score: lower = more urgent
        let score = 100;
        if (isOverdue) score = 0;
        if (isDueToday) score = 10;
        if (data.priority === 'high') score -= 30;
        else if (data.priority === 'medium') score -= 10;
        if (status === 'next_action') score -= 20;
        if (status === 'inbox') score -= 5;

        tasks.push({
            id: doc.id,
            title: data.title || 'Без названия',
            priority: data.priority || 'none',
            status,
            clientName: data.clientName,
            isOverdue,
            isDueToday,
            dueDate,
            score,
        });
    }

    // Sort by score (ascending = most urgent first)
    tasks.sort((a, b) => a.score - b.score);

    // Take top 3
    const top3 = tasks.slice(0, 3);
    const overdueCount = tasks.filter(t => t.isOverdue).length;
    const totalOpen = tasks.length;

    // Build message
    const hour = now.getHours();
    const greeting = hour < 12 ? '🌅 Доброе утро' : '👋 Привет';

    let msg = `${greeting}, ${userName}!\n\n`;

    if (overdueCount > 0) {
        msg += `⚠️ *${overdueCount} просроченных задач!*\n\n`;
    }

    msg += `📋 *Топ-3 на сегодня:*\n\n`;

    top3.forEach((task, idx) => {
        const emoji = PRIORITY_EMOJI[task.priority] || '⚪';
        const overdue = task.isOverdue ? ' ⚠️' : task.isDueToday ? ' 📅' : '';
        const client = task.clientName ? ` (${task.clientName})` : '';
        msg += `${idx + 1}. ${emoji} ${task.title}${client}${overdue}\n`;
    });

    // Status summary
    msg += `\n━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Всего: *${totalOpen}* открытых\n`;

    const summaryParts: string[] = [];
    if (statusCounts.next_action) summaryParts.push(`▶️ ${statusCounts.next_action} Next`);
    if (statusCounts.inbox) summaryParts.push(`📥 ${statusCounts.inbox} Inbox`);
    if (statusCounts.waiting) summaryParts.push(`⏳ ${statusCounts.waiting} Waiting`);
    if (statusCounts.projects) summaryParts.push(`📂 ${statusCounts.projects} Projects`);
    if (summaryParts.length > 0) {
        msg += summaryParts.join(' | ') + '\n';
    }

    msg += `\n💡 _/plan — полный план дня_`;

    await sendTelegramMessage(chatId, msg);
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
    if (!WORKER_BOT_TOKEN) return;
    await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
    });
}
