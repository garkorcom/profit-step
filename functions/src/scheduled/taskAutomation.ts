/**
 * @fileoverview Task Automation — bundled scheduled functions for GTD
 *
 * Runs multiple automation tasks on a schedule:
 * - Stale task alerts (tasks in next_action >7 days without update)
 * - Overrun detection (tasks >2x estimated time)
 * - WIP limit warnings (>5 active tasks per person)
 * - Weekly summary (Friday 17:00 ET)
 * - Recurring task generation
 *
 * Spec: Phase 3 of Tasks v2 plan
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';

const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '';

// ─── Helpers ────────────────────────────────────────────────

async function sendTg(chatId: number, text: string): Promise<void> {
    if (!WORKER_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, {
            chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true,
        });
    } catch (err: any) {
        if (err?.response?.status !== 403) {
            logger.warn(`sendTg failed for ${chatId}`, err?.message);
        }
    }
}

async function notifyAdmin(text: string): Promise<void> {
    if (!ADMIN_GROUP_ID) return;
    await sendTg(Number(ADMIN_GROUP_ID), text);
}

async function getUserTelegramId(userId: string): Promise<number | null> {
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
            const tid = doc.data()?.telegramId;
            if (tid) return typeof tid === 'number' ? tid : parseInt(tid);
        }
    } catch (_) { /* ignore */ }
    return null;
}

// ═══════════════════════════════════════════════════════════
// Phase 3.3: Stale Task Alerts + Phase 3.5: Overrun + Phase 3.6: WIP
// Runs every 6 hours
// ═══════════════════════════════════════════════════════════

export const taskHealthCheck = functions.pubsub
    .schedule('0 */6 * * *') // Every 6 hours
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('🔄 [taskHealthCheck] Starting...');

        try {
            const snapshot = await db.collection('gtd_tasks')
                .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'pending_approval'])
                .get();

            if (snapshot.empty) return null;

            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            // Group tasks by owner for WIP check
            const tasksByOwner: Record<string, { active: number; stale: string[]; overrun: string[] }> = {};

            for (const doc of snapshot.docs) {
                const data = doc.data();
                const ownerId = data.ownerId || data.createdBy;
                if (!ownerId) continue;

                if (!tasksByOwner[ownerId]) {
                    tasksByOwner[ownerId] = { active: 0, stale: [], overrun: [] };
                }

                // Count active (next_action) tasks for WIP
                if (data.status === 'next_action') {
                    tasksByOwner[ownerId].active++;
                }

                // Stale check: in next_action >7 days without update
                if (data.status === 'next_action') {
                    const updatedAt = data.updatedAt?.toDate?.() || data.createdAt?.toDate?.();
                    if (updatedAt && updatedAt < sevenDaysAgo) {
                        // Don't re-alert if already flagged recently
                        const lastStaleAlert = data._lastStaleAlert?.toDate?.();
                        if (!lastStaleAlert || (now.getTime() - lastStaleAlert.getTime()) > 3 * 24 * 60 * 60 * 1000) {
                            tasksByOwner[ownerId].stale.push(data.title || 'Без названия');
                            await doc.ref.update({
                                _lastStaleAlert: admin.firestore.FieldValue.serverTimestamp(),
                            });
                        }
                    }
                }

                // Overrun check: actual time >2x estimated
                if (data.estimatedDurationMinutes && data.totalTimeSpentMinutes) {
                    if (data.totalTimeSpentMinutes > data.estimatedDurationMinutes * 2) {
                        const lastOverrunAlert = data._lastOverrunAlert?.toDate?.();
                        if (!lastOverrunAlert || (now.getTime() - lastOverrunAlert.getTime()) > 24 * 60 * 60 * 1000) {
                            const est = data.estimatedDurationMinutes;
                            const actual = data.totalTimeSpentMinutes;
                            tasksByOwner[ownerId].overrun.push(
                                `${data.title || 'Задача'} (est: ${Math.round(est / 60)}h, actual: ${Math.round(actual / 60)}h)`
                            );
                            await doc.ref.update({
                                _lastOverrunAlert: admin.firestore.FieldValue.serverTimestamp(),
                            });
                        }
                    }
                }
            }

            // Send notifications per user
            let totalAlerts = 0;

            for (const [ownerId, info] of Object.entries(tasksByOwner)) {
                const chatId = await getUserTelegramId(ownerId);
                if (!chatId) continue;

                const parts: string[] = [];

                // WIP warning
                if (info.active > 5) {
                    parts.push(`⚠️ *WIP перегрузка:* ${info.active} задач в Next (лимит: 5)\nПеремести менее срочные в Projects или Someday.`);
                }

                // Stale tasks
                if (info.stale.length > 0) {
                    parts.push(`🧊 *Застоявшиеся задачи* (>7 дней без обновления):\n${info.stale.map(t => `  • ${t}`).join('\n')}`);
                }

                // Overrun
                if (info.overrun.length > 0) {
                    parts.push(`⏰ *Превышение времени* (>2x оценки):\n${info.overrun.map(t => `  • ${t}`).join('\n')}`);
                }

                if (parts.length > 0) {
                    await sendTg(chatId, `🔔 *Проверка задач:*\n\n${parts.join('\n\n')}`);
                    totalAlerts++;
                }
            }

            logger.info(`✅ [taskHealthCheck] Done: ${totalAlerts} users notified`);
        } catch (error) {
            logger.error('❌ [taskHealthCheck] Error:', error);
        }

        return null;
    });

// ═══════════════════════════════════════════════════════════
// Phase 3.4: Weekly Summary (Friday 17:00 ET)
// ═══════════════════════════════════════════════════════════

export const weeklyTaskSummary = functions.pubsub
    .schedule('0 17 * * 5') // Friday 17:00
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('📊 [weeklyTaskSummary] Starting...');

        try {
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const weekTs = admin.firestore.Timestamp.fromDate(weekAgo);

            // Count completed this week
            const completedSnap = await db.collection('gtd_tasks')
                .where('status', '==', 'done')
                .where('completedAt', '>=', weekTs)
                .get();

            // Count all open
            const openSnap = await db.collection('gtd_tasks')
                .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'pending_approval'])
                .get();

            // Count overdue
            const now = new Date();
            let overdueCount = 0;
            for (const doc of openSnap.docs) {
                const dd = doc.data().dueDate;
                if (dd) {
                    try {
                        const dueDate = dd.toDate ? dd.toDate() : new Date(dd);
                        if (dueDate < now) overdueCount++;
                    } catch (_) { /* ignore */ }
                }
            }

            // Status breakdown
            const statusCounts: Record<string, number> = {};
            openSnap.docs.forEach(d => {
                const s = d.data().status || 'inbox';
                statusCounts[s] = (statusCounts[s] || 0) + 1;
            });

            const msg = `📊 *Недельный отчёт по задачам*\n\n` +
                `✅ Завершено за неделю: *${completedSnap.size}*\n` +
                `📋 Открытых: *${openSnap.size}*\n` +
                `⚠️ Просроченных: *${overdueCount}*\n\n` +
                `📊 По статусам:\n` +
                `  ▶️ Next: ${statusCounts.next_action || 0}\n` +
                `  📥 Inbox: ${statusCounts.inbox || 0}\n` +
                `  ⏳ Waiting: ${statusCounts.waiting || 0}\n` +
                `  📂 Projects: ${statusCounts.projects || 0}\n` +
                `  📐 Estimate: ${statusCounts.estimate || 0}\n\n` +
                `💡 /mytasks — ваши задачи`;

            // Send to admin group
            await notifyAdmin(msg);

            // Also send to all users with tasks
            const userIds = new Set<string>();
            openSnap.docs.forEach(d => {
                if (d.data().ownerId) userIds.add(d.data().ownerId);
            });

            for (const uid of userIds) {
                const chatId = await getUserTelegramId(uid);
                if (chatId) {
                    // Per-user summary
                    const userOpen = openSnap.docs.filter(d => d.data().ownerId === uid).length;
                    const userDone = completedSnap.docs.filter(d => d.data().ownerId === uid).length;
                    if (userOpen > 0 || userDone > 0) {
                        await sendTg(chatId, `📊 *Твоя неделя:*\n\n✅ Завершено: *${userDone}*\n📋 Открытых: *${userOpen}*\n\n💡 /plan — план на следующую неделю`);
                    }
                }
            }

            logger.info(`✅ [weeklyTaskSummary] Done: ${completedSnap.size} completed, ${openSnap.size} open`);
        } catch (error) {
            logger.error('❌ [weeklyTaskSummary] Error:', error);
        }

        return null;
    });

// ═══════════════════════════════════════════════════════════
// Phase 3.2: Recurring Tasks Generator (daily at 06:00)
// ═══════════════════════════════════════════════════════════

export const generateRecurringTasks = functions.pubsub
    .schedule('0 6 * * *') // Daily 06:00
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('🔁 [generateRecurringTasks] Starting...');

        try {
            // Query recurring task templates
            const snap = await db.collection('gtd_task_templates')
                .where('isRecurring', '==', true)
                .where('isActive', '==', true)
                .get();

            if (snap.empty) {
                logger.info('✅ No recurring templates found');
                return null;
            }

            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            let created = 0;

            for (const doc of snap.docs) {
                const tmpl = doc.data();

                // Check if already generated today
                if (tmpl.lastGeneratedDate === todayStr) continue;

                // Check schedule: daily, weekly (specific day), monthly (specific date)
                const schedule = tmpl.schedule || 'daily';
                const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
                const dayOfMonth = now.getDate();

                let shouldGenerate = false;

                if (schedule === 'daily') {
                    shouldGenerate = true;
                } else if (schedule === 'weekly' && tmpl.scheduleDayOfWeek === dayOfWeek) {
                    shouldGenerate = true;
                } else if (schedule === 'monthly' && tmpl.scheduleDayOfMonth === dayOfMonth) {
                    shouldGenerate = true;
                } else if (schedule === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) {
                    shouldGenerate = true;
                }

                if (!shouldGenerate) continue;

                // Create task from template
                const dueDate = new Date(now);
                if (tmpl.dueDaysFromNow) {
                    dueDate.setDate(dueDate.getDate() + tmpl.dueDaysFromNow);
                }

                await db.collection('gtd_tasks').add({
                    title: tmpl.title,
                    description: tmpl.description || '',
                    status: tmpl.defaultStatus || 'next_action',
                    priority: tmpl.priority || 'medium',
                    ownerId: tmpl.ownerId,
                    ownerName: tmpl.ownerName || '',
                    assigneeId: tmpl.assigneeId || null,
                    assigneeName: tmpl.assigneeName || null,
                    clientId: tmpl.clientId || null,
                    clientName: tmpl.clientName || null,
                    projectId: tmpl.projectId || null,
                    projectName: tmpl.projectName || null,
                    dueDate: admin.firestore.Timestamp.fromDate(dueDate),
                    estimatedDurationMinutes: tmpl.estimatedDurationMinutes || null,
                    checklistItems: tmpl.checklistItems || [],
                    source: 'recurring',
                    sourceTemplateId: doc.id,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Update template last generated
                await doc.ref.update({ lastGeneratedDate: todayStr });
                created++;
            }

            logger.info(`✅ [generateRecurringTasks] Done: ${created} tasks created`);
        } catch (error) {
            logger.error('❌ [generateRecurringTasks] Error:', error);
        }

        return null;
    });

// ═══════════════════════════════════════════════════════════
// Phase 3.1: PO → Auto-task on advance creation
// (Firestore trigger, not scheduled)
// ═══════════════════════════════════════════════════════════

export const onAdvanceCreated = functions.firestore
    .document('advance_accounts/{advanceId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        if (!data || data.status !== 'open') return;

        try {
            // Create a "report on advance" task with 14-day deadline
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 14);

            const advanceName = data.projectName || data.description || 'Advance';

            await db.collection('gtd_tasks').add({
                title: `📦 Отчитаться по авансу: ${advanceName} ($${data.amount})`,
                description: `Аванс выдан на $${data.amount}.\nОтчитайтесь по расходам или верните остаток.\n\nID аванса: ${context.params.advanceId}`,
                status: 'next_action',
                priority: 'medium',
                ownerId: data.employeeId,
                ownerName: data.employeeName || '',
                dueDate: admin.firestore.Timestamp.fromDate(dueDate),
                source: 'auto_po',
                linkedAdvanceId: context.params.advanceId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            logger.info(`✅ Auto-task created for advance ${context.params.advanceId}`);
        } catch (error) {
            logger.error('onAdvanceCreated auto-task error:', error);
        }
    });
