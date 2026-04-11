/**
 * @fileoverview Smart Start & End-of-Day Handlers
 *
 * Case 1:  Smart quick-start — suggest yesterday's project
 * Case 9:  Auto-show project tasks at clock-in
 * Case 10: Link task to work session timer
 * Case 31: One-tap end day with auto-summary
 * Case 43: Context-aware greeting (morning / afternoon)
 *
 * Reference: BOT_UX_50_CASES.md Phase 1
 */

import * as admin from 'firebase-admin';
import { sendMessage, getActiveSession } from '../telegramUtils';

const db = admin.firestore();

// ──────────────────────────────────────────────
// Case 1 + 43: Smart Quick-Start Suggestion
// ──────────────────────────────────────────────

/**
 * Called when user hits /start with NO active session.
 * Looks at yesterday's (or most recent) project and offers one-tap restart.
 * Returns true if suggestion was shown, false if no smart-start available.
 */
export async function suggestQuickStart(chatId: number, userId: number): Promise<boolean> {
    try {
        // Find last completed session (within past 7 days)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const recentSnap = await db.collection('work_sessions')
            .where('employeeId', 'in', [userId, String(userId)])
            .where('status', '==', 'completed')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(weekAgo))
            .orderBy('endTime', 'desc')
            .limit(3)
            .get();

        if (recentSnap.empty) return false;

        const lastSession = recentSnap.docs[0].data();
        const clientId = lastSession.clientId;
        const clientName = lastSession.clientName || 'Unknown';

        // Skip if the project is "no_project" or done
        if (clientId === 'no_project') return false;

        // Check project still active
        const clientDoc = await db.collection('clients').doc(clientId).get();
        if (!clientDoc.exists || clientDoc.data()?.status === 'done') return false;

        // Time-aware greeting
        const hour = new Date().getHours();
        let greeting: string;
        if (hour < 12) greeting = '☀️ Доброе утро';
        else if (hour < 17) greeting = '👋 Добрый день';
        else greeting = '🌆 Добрый вечер';

        // Build recent projects list (unique, up to 3)
        const uniqueProjects: { id: string; name: string }[] = [];
        const seenIds = new Set<string>();
        for (const doc of recentSnap.docs) {
            const d = doc.data();
            if (d.clientId && !seenIds.has(d.clientId) && d.clientId !== 'no_project') {
                uniqueProjects.push({ id: d.clientId, name: d.clientName || d.clientId });
                seenIds.add(d.clientId);
            }
        }

        // Resolve employee name
        let employeeName = '';
        try {
            const empDoc = await db.collection('employees').doc(String(userId)).get();
            if (empDoc.exists) employeeName = empDoc.data()?.name?.split(' ')[0] || '';
        } catch (_) { /* ignore */ }

        const nameGreeting = employeeName ? `, ${employeeName}` : '';

        // Build inline keyboard — primary suggestion + alternatives
        const buttons: any[][] = [];

        // Main suggestion: last project
        buttons.push([{
            text: `▶️ Начать: ${clientName}`,
            callback_data: `quick_start:${clientId}`,
        }]);

        // Other recent projects (if any)
        for (let i = 1; i < uniqueProjects.length; i++) {
            buttons.push([{
                text: `📍 ${uniqueProjects[i].name}`,
                callback_data: `quick_start:${uniqueProjects[i].id}`,
            }]);
        }

        buttons.push([{
            text: '🏢 Другой проект',
            callback_data: 'quick_start:other',
        }]);

        await sendMessage(chatId,
            `${greeting}${nameGreeting}!\n\n` +
            `Начинаем на *${clientName}*?`,
            { inline_keyboard: buttons }
        );

        return true;
    } catch (error) {
        console.error('[smartStartHandler] suggestQuickStart error:', error);
        return false;
    }
}

/**
 * Handle quick_start callback
 */
export async function handleQuickStartCallback(
    chatId: number,
    userId: number,
    clientId: string,
): Promise<'started' | 'show_list' | 'error'> {
    if (clientId === 'other') {
        return 'show_list';
    }

    try {
        // Check no active session
        const active = await getActiveSession(userId);
        if (active) {
            await sendMessage(chatId, '⚠️ У тебя уже есть активная смена.');
            return 'error';
        }

        // This returns 'started' — the actual initWorkSession is called by the main bot
        // We just return the signal so the main handler can call initWorkSession
        return 'started';
    } catch (error) {
        console.error('[smartStartHandler] quickStartCallback error:', error);
        return 'error';
    }
}

// ──────────────────────────────────────────────
// Case 9: Auto-Show Project Tasks at Clock-In
// ──────────────────────────────────────────────

/**
 * After a session starts, show tasks for the current project.
 * Called after initWorkSession or handleLocationConfirmStart.
 */
export async function showProjectTasks(chatId: number, userId: number, clientId: string): Promise<void> {
    try {
        if (!clientId || clientId === 'no_project') return;

        // Query tasks assigned to this user for this project
        const tasksSnap = await db.collection('gtd_tasks')
            .where('clientId', '==', clientId)
            .where('status', 'in', ['next', 'in_progress'])
            .limit(10)
            .get();

        if (tasksSnap.empty) return;

        // Filter to user's tasks or unassigned
        const userIdStr = String(userId);
        const myTasks = tasksSnap.docs.filter(d => {
            const data = d.data();
            return !data.assigneeId ||
                data.assigneeId === userIdStr ||
                data.assigneeId === userId;
        });

        if (myTasks.length === 0) return;

        // Build task list with inline start buttons
        let msg = `\n📋 *Задачи на объекте:*\n\n`;
        const buttons: any[][] = [];

        myTasks.slice(0, 5).forEach((doc, idx) => {
            const task = doc.data();
            const title = task.title || task.description || 'Без названия';
            const priority = task.priority === 'high' ? '🔴' :
                task.priority === 'medium' ? '🟡' : '🟢';
            const status = task.status === 'in_progress' ? '🔨' : '';

            msg += `${idx + 1}. ${priority}${status} ${title}\n`;
            buttons.push([{
                text: `▶️ ${idx + 1}. ${title.substring(0, 30)}`,
                callback_data: `start_task:${doc.id}`,
            }]);
        });

        if (myTasks.length > 5) {
            msg += `\n_...и ещё ${myTasks.length - 5}_`;
        }

        buttons.push([{ text: '➕ Новая задача', callback_data: 'start_task:new' }]);
        buttons.push([{ text: '⏭ Пропустить', callback_data: 'start_task:skip' }]);

        await sendMessage(chatId, msg, { inline_keyboard: buttons });
    } catch (error) {
        console.error('[smartStartHandler] showProjectTasks error:', error);
        // Non-fatal — don't break clock-in flow
    }
}

// ──────────────────────────────────────────────
// Case 10: Link Task to Work Session Timer
// ──────────────────────────────────────────────

/**
 * Handle start_task callback — link a task to the active work session
 */
export async function handleStartTaskCallback(
    chatId: number,
    userId: number,
    taskId: string
): Promise<void> {
    if (taskId === 'skip') {
        await sendMessage(chatId, '👍 Работаем без привязки к задаче.');
        return;
    }

    if (taskId === 'new') {
        await sendMessage(chatId,
            '📝 Отправь описание новой задачи текстом или голосовым сообщением.\n' +
            'Пример: `/task Установить розетки в кухне`'
        );
        return;
    }

    try {
        const activeSession = await getActiveSession(userId);
        if (!activeSession) {
            await sendMessage(chatId, '⚠️ Нет активной смены.');
            return;
        }

        // Get task details
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        if (!taskDoc.exists) {
            await sendMessage(chatId, '⚠️ Задача не найдена.');
            return;
        }

        const taskData = taskDoc.data()!;
        const taskTitle = taskData.title || taskData.description || 'Задача';

        // Link task to session
        await activeSession.ref.update({
            relatedTaskId: taskId,
            relatedTaskTitle: taskTitle,
        });

        // Update task status to in_progress
        await taskDoc.ref.update({
            status: 'in_progress',
            lastWorkedBy: String(userId),
            lastWorkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await sendMessage(chatId,
            `🔨 Работаю: *${taskTitle}*\n` +
            `⏱ Таймер привязан к задаче\n\n` +
            `По завершении — нажми ✅ Задача готова`,
            {
                inline_keyboard: [
                    [{ text: '✅ Задача готова', callback_data: `done_task:${taskId}` }],
                    [{ text: '🔄 Другая задача', callback_data: 'switch_task' }],
                ]
            }
        );
    } catch (error) {
        console.error('[smartStartHandler] startTask error:', error);
        await sendMessage(chatId, '❌ Ошибка привязки задачи.');
    }
}

/**
 * Handle done_task callback — mark task complete, suggest next
 */
export async function handleDoneTaskCallback(
    chatId: number,
    userId: number,
    taskId: string
): Promise<void> {
    try {
        const activeSession = await getActiveSession(userId);

        // Complete the task
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        if (taskDoc.exists) {
            const taskTitle = taskDoc.data()?.title || 'Задача';

            // Calculate time spent on this task
            let timeSpent = '';
            if (activeSession) {
                const sessionData = activeSession.data();
                if (sessionData.relatedTaskId === taskId) {
                    const startMs = sessionData.taskStartedAt?.toMillis?.() || sessionData.startTime?.toMillis?.() || Date.now();
                    const elapsed = Math.floor((Date.now() - startMs) / 60000);
                    const h = Math.floor(elapsed / 60);
                    const m = elapsed % 60;
                    timeSpent = `\n⏱ Время: ${h > 0 ? h + 'ч ' : ''}${m}мин`;
                }

                // Unlink from session
                await activeSession.ref.update({
                    relatedTaskId: null,
                    relatedTaskTitle: null,
                });
            }

            // Mark task done
            await taskDoc.ref.update({
                status: 'done',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                completedBy: String(userId),
            });

            await sendMessage(chatId, `✅ *${taskTitle}* — готово!${timeSpent}`);

            // Show remaining tasks for this project
            if (activeSession) {
                const clientId = activeSession.data().clientId;
                if (clientId) {
                    await showProjectTasks(chatId, userId, clientId);
                }
            }
        }
    } catch (error) {
        console.error('[smartStartHandler] doneTask error:', error);
        await sendMessage(chatId, '❌ Ошибка завершения задачи.');
    }
}

/**
 * Handle switch_task callback — show task list again
 */
export async function handleSwitchTaskCallback(chatId: number, userId: number): Promise<void> {
    try {
        const activeSession = await getActiveSession(userId);
        if (!activeSession) {
            await sendMessage(chatId, '⚠️ Нет активной смены.');
            return;
        }

        const sessionData = activeSession.data();

        // Unlink current task
        if (sessionData.relatedTaskId) {
            await activeSession.ref.update({
                relatedTaskId: null,
                relatedTaskTitle: null,
            });
        }

        const clientId = sessionData.clientId;
        if (clientId) {
            await showProjectTasks(chatId, userId, clientId);
        }
    } catch (error) {
        console.error('[smartStartHandler] switchTask error:', error);
    }
}

// ──────────────────────────────────────────────
// Case 31: One-Tap End Day with Auto-Summary
// ──────────────────────────────────────────────

/**
 * End day with auto-summary across ALL today's sessions.
 * Returns the summary message. Caller handles the actual session close.
 */
export async function handleEndDay(chatId: number, userId: number): Promise<void> {
    try {
        const activeSession = await getActiveSession(userId);

        // Get all sessions for today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sessionsSnap = await db.collection('work_sessions')
            .where('employeeId', 'in', [userId, String(userId)])
            .where('startTime', '>=', admin.firestore.Timestamp.fromDate(today))
            .get();

        let totalMinutes = 0;
        let totalEarnings = 0;
        let totalBreakMinutes = 0;
        const projectSummaries: Record<string, { minutes: number; earnings: number; tasks: string[] }> = {};

        for (const doc of sessionsSnap.docs) {
            const data = doc.data();
            if (data.isVoided || data.type === 'payment' || data.type === 'correction') continue;

            let sessionMinutes: number;
            let sessionEarnings: number;

            if (data.status === 'completed') {
                sessionMinutes = data.durationMinutes || 0;
                sessionEarnings = data.sessionEarnings || 0;
            } else if (data.status === 'active' || data.status === 'paused') {
                // Active session — calculate in-progress time
                const startMs = data.startTime?.toMillis?.() || Date.now();
                const elapsed = Math.floor((Date.now() - startMs) / 60000);
                const breaks = data.totalBreakMinutes || 0;
                sessionMinutes = Math.max(0, elapsed - breaks);
                const rate = data.hourlyRate || 0;
                sessionEarnings = parseFloat(((sessionMinutes / 60) * rate).toFixed(2));
            } else {
                continue;
            }

            totalMinutes += sessionMinutes;
            totalEarnings += sessionEarnings;
            totalBreakMinutes += (data.totalBreakMinutes || 0);

            const projName = data.clientName || 'Unknown';
            if (!projectSummaries[projName]) {
                projectSummaries[projName] = { minutes: 0, earnings: 0, tasks: [] };
            }
            projectSummaries[projName].minutes += sessionMinutes;
            projectSummaries[projName].earnings += sessionEarnings;

            if (data.relatedTaskTitle && !projectSummaries[projName].tasks.includes(data.relatedTaskTitle)) {
                projectSummaries[projName].tasks.push(data.relatedTaskTitle);
            }
        }

        // Count today's photos
        let photoCount = 0;
        try {
            const mediaSnap = await db.collection('work_session_media')
                .where('employeeId', 'in', [userId, String(userId)])
                .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(today))
                .get();
            photoCount = mediaSnap.size;
        } catch (_) { /* media collection may not exist */ }

        const totalH = Math.floor(totalMinutes / 60);
        const totalM = totalMinutes % 60;

        let msg = `🌙 *Конец дня*\n\n`;

        // Per-project breakdown
        const projectNames = Object.keys(projectSummaries);
        if (projectNames.length > 0) {
            for (const name of projectNames) {
                const p = projectSummaries[name];
                const pH = Math.floor(p.minutes / 60);
                const pM = p.minutes % 60;
                msg += `📍 ${name}: ${pH}ч ${pM}мин  $${p.earnings.toFixed(2)}`;
                if (p.tasks.length > 0) {
                    msg += `\n   └─ ${p.tasks.join(', ')}`;
                }
                msg += `\n`;
            }
        }

        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `⏱ Итого: *${totalH}ч ${totalM}мин*\n`;
        msg += `💰 Заработано: *$${totalEarnings.toFixed(2)}*\n`;

        if (totalBreakMinutes > 0) {
            msg += `☕ Перерывы: ${totalBreakMinutes}мин\n`;
        }
        if (photoCount > 0) {
            msg += `📸 Фото: ${photoCount}\n`;
        }

        const hasActiveSession = activeSession && (activeSession.data().status === 'active' || activeSession.data().status === 'paused');

        if (hasActiveSession) {
            msg += `\n_Активная смена будет закрыта._`;

            await sendMessage(chatId, msg, {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить и закончить', callback_data: 'end_day:confirm' }],
                    [{ text: '🎤 Добавить заметку (голос)', callback_data: 'end_day:voice' }],
                    [{ text: '❌ Отмена', callback_data: 'end_day:cancel' }],
                ]
            });
        } else {
            msg += `\n✅ Все смены завершены. Отличный день!`;
            await sendMessage(chatId, msg);
        }
    } catch (error) {
        console.error('[smartStartHandler] endDay error:', error);
        await sendMessage(chatId, '❌ Ошибка формирования отчёта.');
    }
}

/**
 * Handle end_day callbacks
 */
export async function handleEndDayCallback(
    chatId: number,
    userId: number,
    action: string
): Promise<'confirm' | 'voice' | 'cancel'> {
    if (action === 'cancel') {
        await sendMessage(chatId, '✅ Отменено. Продолжай работу!');
        return 'cancel';
    }

    if (action === 'voice') {
        const activeSession = await getActiveSession(userId);
        if (activeSession) {
            await activeSession.ref.update({ awaitingEndDayVoice: true });
        }
        await sendMessage(chatId, '🎤 Отправь голосовое сообщение — итоги дня.');
        return 'voice';
    }

    // 'confirm' — close active session, skip all the location/photo/voice flow
    return 'confirm';
}

/**
 * Quick-close active session (for end-day flow).
 * Skips location/photo/voice — just closes with calculated earnings.
 */
export async function quickCloseSession(chatId: number, userId: number): Promise<void> {
    try {
        const activeSession = await getActiveSession(userId);
        if (!activeSession) {
            await sendMessage(chatId, '⚠️ Нет активной смены.');
            return;
        }

        const data = activeSession.data();
        const now = admin.firestore.Timestamp.now();
        const nowDate = new Date();

        const startMs = data.startTime?.toMillis?.() || nowDate.getTime();
        let totalMinutes = Math.floor((nowDate.getTime() - startMs) / 60000);
        totalMinutes -= (data.totalBreakMinutes || 0);
        if (totalMinutes < 0) totalMinutes = 0;

        const rate = data.hourlyRate || 0;
        const hours = totalMinutes / 60;
        const earnings = parseFloat((hours * rate).toFixed(2));

        await activeSession.ref.update({
            status: 'completed',
            endTime: now,
            durationMinutes: totalMinutes,
            sessionEarnings: earnings,
            description: 'End of day (quick close)',
            // Clear all awaiting flags
            awaitingLocation: false,
            awaitingChecklist: false,
            awaitingStartPhoto: false,
            awaitingStartVoice: false,
            awaitingEndLocation: false,
            awaitingEndPhoto: false,
            awaitingEndVoice: false,
            awaitingDescription: false,
        });

        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;

        await sendMessage(chatId,
            `✅ Смена закрыта!\n` +
            `📍 ${data.clientName}: ${h}ч ${m}мин, $${earnings.toFixed(2)}\n\n` +
            `До завтра! 👋`
        );

        // Send admin notification
        try {
            const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '';
            if (ADMIN_GROUP_ID) {
                await sendMessage(Number(ADMIN_GROUP_ID),
                    `🌙 *${data.employeeName}* закончил день\n` +
                    `📍 ${data.clientName}: ${h}ч ${m}мин, $${earnings.toFixed(2)}`
                );
            }
        } catch (_) { /* ignore */ }

    } catch (error) {
        console.error('[smartStartHandler] quickCloseSession error:', error);
        await sendMessage(chatId, '❌ Ошибка закрытия смены.');
    }
}
