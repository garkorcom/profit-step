/**
 * @fileoverview Phase 6.6 — Shift Handoff Summary
 *
 * Runs daily at 18:00 ET — sends managers a summary of what their
 * team accomplished today: hours worked, tasks completed, earnings.
 *
 * Spec: Phase 6 of Tasks v2 plan
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';

async function sendTg(chatId: number, text: string): Promise<void> {
    if (!WORKER_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
        });
    } catch (err: any) {
        if (err?.response?.status !== 403) {
            logger.warn(`sendTg failed for ${chatId}`, err?.message);
        }
    }
}

// ═══════════════════════════════════════════════════════════
// Shift Handoff — daily at 18:00 ET
// ═══════════════════════════════════════════════════════════

export const sendShiftHandoff = functions.pubsub
    .schedule('0 18 * * 1-5') // Weekdays 18:00
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('📋 [shiftHandoff] Starting...');

        try {
            // Find all managers (users with subordinates)
            const managersSnap = await db.collection('users')
                .where('role', 'in', ['admin', 'manager'])
                .get();

            if (managersSnap.empty) {
                logger.info('No managers found, skipping shift handoff');
                return null;
            }

            const now = new Date();
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);

            let sent = 0;

            for (const managerDoc of managersSnap.docs) {
                const manager = managerDoc.data();
                const managerId = managerDoc.id;
                const telegramId = manager.telegramId;

                if (!telegramId) continue;

                // Get subordinates
                const subordinatesSnap = await db.collection('users')
                    .where('hierarchyPath', 'array-contains', managerId)
                    .get();

                const subordinates = subordinatesSnap.docs.filter(d => d.id !== managerId);
                if (subordinates.length === 0) continue;

                let msg = '📋 *Итоги дня:*\n\n';
                let anyActivity = false;
                let teamHours = 0;
                let teamEarnings = 0;
                let teamTasksDone = 0;

                for (const subDoc of subordinates) {
                    const subId = subDoc.id;
                    const subName = subDoc.data().displayName || 'Worker';

                    // Get work sessions today
                    const sessionsSnap = await db.collection('work_sessions')
                        .where('employeeId', '==', subId)
                        .where('status', '==', 'completed')
                        .get();

                    const todaySessions = sessionsSnap.docs.filter(d => {
                        const start = d.data().startTime?.toDate?.();
                        return start && start >= todayStart;
                    });

                    // Get tasks completed today
                    const completedSnap = await db.collection('gtd_tasks')
                        .where('ownerId', '==', subId)
                        .where('status', '==', 'done')
                        .where('completedAt', '>=', admin.firestore.Timestamp.fromDate(todayStart))
                        .get();

                    if (todaySessions.length === 0 && completedSnap.size === 0) continue;

                    anyActivity = true;
                    let totalMinutes = 0;
                    let totalEarnings = 0;

                    for (const sDoc of todaySessions) {
                        const s = sDoc.data();
                        const start = s.startTime?.toDate?.();
                        const end = s.endTime?.toDate?.();
                        if (start && end) {
                            totalMinutes += Math.round((end.getTime() - start.getTime()) / 60000);
                        }
                        totalEarnings += s.sessionEarnings || 0;
                    }

                    const hours = Math.round(totalMinutes / 60 * 10) / 10;
                    teamHours += hours;
                    teamEarnings += totalEarnings;
                    teamTasksDone += completedSnap.size;

                    msg += `👤 *${subName}*: ⏱ ${hours}ч | ✅ ${completedSnap.size}\n`;
                }

                if (!anyActivity) continue;

                msg += `\n═══════════════════════════\n`;
                msg += `📊 Команда: ${teamHours}ч | $${teamEarnings.toFixed(0)} | ✅ ${teamTasksDone} задач`;

                const tId = typeof telegramId === 'number' ? telegramId : parseInt(telegramId);
                await sendTg(tId, msg);
                sent++;
            }

            logger.info(`✅ [shiftHandoff] Done: ${sent} managers notified`);
        } catch (error) {
            logger.error('❌ [shiftHandoff] Error:', error);
        }

        return null;
    });
