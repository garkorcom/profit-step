/**
 * @fileoverview Scheduled Day Plan
 * 
 * CRON job that sends daily plan to users via Telegram at 7:00 AM.
 * 
 * @module scheduled/scheduledDayPlan
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;

// Import the generateDayPlan logic (we'll call it directly)
import { generateDayPlan as generatePlanFunction } from '../callable/gtd/generateDayPlan';

// ═══════════════════════════════════════════════════════════
// SCHEDULED FUNCTION - 7:00 AM EST every day
// ═══════════════════════════════════════════════════════════

export const scheduledDayPlan = functions
    .region('us-central1')
    .pubsub
    .schedule('0 7 * * *') // 7:00 AM every day
    .timeZone('America/New_York')
    .onRun(async (context) => {
        logger.info('🌅 Starting scheduled day plan distribution');

        try {
            // Get all users with Telegram linked and dayPlanEnabled
            const usersSnap = await db.collection('users')
                .where('status', '==', 'active')
                .where('telegramChatId', '!=', null)
                .get();

            let sent = 0;
            let skipped = 0;

            for (const userDoc of usersSnap.docs) {
                const userData = userDoc.data();
                const telegramChatId = userData.telegramChatId;

                // Skip if user disabled daily plans
                if (userData.dayPlanEnabled === false) {
                    skipped++;
                    continue;
                }

                try {
                    // Generate plan for this user
                    const plan = await generateDayPlanForUser(userDoc.id);

                    if (plan.slots.length === 0) {
                        // Skip if no tasks
                        skipped++;
                        continue;
                    }

                    // Format and send Telegram message
                    const message = formatPlanMessage(plan);
                    await sendTelegramMessage(telegramChatId, message);

                    sent++;
                    logger.info(`Sent day plan to user ${userDoc.id}`);

                } catch (userError: any) {
                    logger.error(`Failed to send plan to user ${userDoc.id}`, userError);
                }
            }

            logger.info(`✅ Day plan distribution complete: ${sent} sent, ${skipped} skipped`);

        } catch (error: any) {
            logger.error('Scheduled day plan failed', error);
        }
    });

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

interface DayPlan {
    date: string;
    dayOfWeek: string;
    greeting: string;
    slots: Array<{
        startTime: string;
        endTime: string;
        taskId: string;
        title: string;
        priority: 'high' | 'medium' | 'low';
        clientName?: string;
        estimatedMinutes: number;
    }>;
    summary: {
        totalTasks: number;
        totalMinutes: number;
        highPriority: number;
        overdue: number;
    };
    aiTip?: string;
}

/**
 * Generate day plan for a specific user
 * Calls the same logic as the callable function
 */
async function generateDayPlanForUser(userId: string): Promise<DayPlan> {
    // We reuse the callable function logic by calling it directly
    // This is a bit of a workaround - ideally we'd extract shared logic
    const mockContext = { auth: { uid: userId } };
    const result = await (generatePlanFunction as any).run(
        { type: 'day', userId },
        mockContext
    );
    return result;
}

/**
 * Format plan as Telegram message
 */
function formatPlanMessage(plan: DayPlan): string {
    const lines: string[] = [];

    lines.push(plan.greeting);
    lines.push('');

    // Add each slot
    for (const slot of plan.slots) {
        const priorityEmoji = slot.priority === 'high' ? '🔴' :
            slot.priority === 'medium' ? '🟡' : '🟢';

        lines.push(`${priorityEmoji} *${slot.startTime}-${slot.endTime}* — ${escapeMarkdown(slot.title)}`);

        const details: string[] = [];
        if (slot.clientName) {
            details.push(`📍 ${escapeMarkdown(slot.clientName)}`);
        }
        details.push(`⏱ ${Math.round(slot.estimatedMinutes / 60 * 10) / 10}ч`);

        lines.push(`    ${details.join(' | ')}`);
        lines.push('');
    }

    // Summary
    lines.push('═══════════════════════════');
    const hours = Math.round(plan.summary.totalMinutes / 60 * 10) / 10;
    lines.push(`📊 ${plan.summary.totalTasks} задач | ⏱ ${hours}ч`);

    if (plan.aiTip) {
        lines.push(plan.aiTip);
    }

    return lines.join('\n');
}

/**
 * Send message via Telegram Bot API
 */
async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
    if (!WORKER_BOT_TOKEN) {
        logger.warn('WORKER_BOT_TOKEN not configured');
        return;
    }

    await axios.post(
        `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`,
        {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown'
        }
    );
}

/**
 * Escape special Markdown characters
 */
function escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
