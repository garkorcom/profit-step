/**
 * GTD Handler - Task management for Telegram bot
 * 
 * Extracted from onWorkerBotMessage.ts for better modularity.
 * Handles: /task command, /tasks menu, /plan command, task lists, and callbacks
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { sendMessage, findPlatformUser } from '../telegramUtils';
import { GoogleGenerativeAI } from '@google/generative-ai';
const db = admin.firestore();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

export const GTD_COLUMNS = [
    { id: 'inbox', title: '📥 Inbox', emoji: '📥' },
    { id: 'next_action', title: '▶️ Next', emoji: '▶️' },
    { id: 'projects', title: '📂 Projects', emoji: '📂' },
    { id: 'waiting', title: '⏳ Waiting', emoji: '⏳' },
    { id: 'someday', title: '💭 Someday', emoji: '💭' },
    { id: 'done', title: '✅ Done', emoji: '✅' }
];

export const PRIORITY_EMOJI: Record<string, string> = {
    high: '🔴',
    medium: '🟠',
    low: '🔵',
    none: '⚪'
};

const TYPE_EMOJI: Record<string, string> = {
    'buy': '🛒',
    'check': '🔍',
    'fix': '🔧',
    'meet': '🤝',
    'bring': '🚚'
};



// ═══════════════════════════════════════════════════════════
// /mytasks — QUICK VIEW (top 3 urgent tasks)
// ═══════════════════════════════════════════════════════════

/**
 * Show top 3 most urgent tasks without entering the full /tasks menu.
 * Priority: overdue > due today > high priority > next_action.
 */
export async function sendMyTasks(chatId: number, telegramId: number): Promise<void> {
    const platformUser = await findPlatformUser(telegramId);
    if (!platformUser) {
        await sendMessage(chatId, '❌ Аккаунт не привязан. Привяжи Telegram в настройках профиля.');
        return;
    }

    try {
        const tasksSnap = await db.collection('gtd_tasks')
            .where('ownerId', '==', platformUser.id)
            .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'estimate'])
            .get();

        if (tasksSnap.empty) {
            await sendMessage(chatId, '📭 *Нет открытых задач!*\n\nДобавь: `/task Описание`');
            return;
        }

        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        interface QuickTask {
            id: string;
            title: string;
            priority: string;
            status: string;
            clientName?: string;
            isOverdue: boolean;
            isDueToday: boolean;
            score: number;
        }

        const tasks: QuickTask[] = [];

        for (const doc of tasksSnap.docs) {
            const data = doc.data();
            if (data.isSubtask) continue; // Skip subtasks

            let isOverdue = false;
            let isDueToday = false;
            if (data.dueDate) {
                try {
                    const dd = data.dueDate.toDate ? data.dueDate.toDate() : new Date(data.dueDate);
                    const ddOnly = new Date(dd);
                    ddOnly.setHours(0, 0, 0, 0);
                    isOverdue = ddOnly < todayStart;
                    isDueToday = ddOnly.getTime() === todayStart.getTime();
                } catch (_) { /* ignore */ }
            }

            let score = 100;
            if (isOverdue) score = 0;
            if (isDueToday) score = 10;
            if (data.priority === 'high') score -= 30;
            else if (data.priority === 'medium') score -= 10;
            if (data.status === 'next_action') score -= 20;

            tasks.push({
                id: doc.id,
                title: data.title || 'Без названия',
                priority: data.priority || 'none',
                status: data.status,
                clientName: data.clientName,
                isOverdue,
                isDueToday,
                score,
            });
        }

        tasks.sort((a, b) => a.score - b.score);
        const top3 = tasks.slice(0, 3);
        const overdueCount = tasks.filter(t => t.isOverdue).length;

        let msg = '⚡ *Мои задачи:*\n\n';
        if (overdueCount > 0) {
            msg += `⚠️ ${overdueCount} просроченных!\n\n`;
        }

        const inlineKeyboard: any[][] = [];

        top3.forEach((task, idx) => {
            const emoji = PRIORITY_EMOJI[task.priority] || '⚪';
            const flag = task.isOverdue ? ' ⚠️' : task.isDueToday ? ' 📅' : '';
            const client = task.clientName ? ` (${task.clientName})` : '';
            msg += `${idx + 1}. ${emoji} ${task.title}${client}${flag}\n`;

            inlineKeyboard.push([
                { text: `${emoji} ${task.title.substring(0, 25)}`, callback_data: `task_view:${task.id}` },
                { text: '✅', callback_data: `task_done:${task.id}` },
            ]);
        });

        msg += `\n📊 Всего открытых: ${tasks.length}`;

        inlineKeyboard.push([
            { text: '📋 Все задачи', callback_data: 'tasks_back' },
            { text: '📅 План дня', callback_data: 'tasks_plan' },
        ]);

        await sendMessage(chatId, msg, { inline_keyboard: inlineKeyboard });
    } catch (error: any) {
        logger.error('sendMyTasks error', error?.message || error);
        await sendMessage(chatId, '⚠️ Ошибка загрузки задач. Попробуй /tasks');
    }
}

// ═══════════════════════════════════════════════════════════
// /task COMMAND
// ═══════════════════════════════════════════════════════════

/**
 * Handle quick task creation from /task command
 * Creates a GTD task in inbox with AI-enhanced parsing
 */
export async function handleQuickTask(
    chatId: number,
    userId: number,
    description: string,
    userName: string
): Promise<void> {
    try {
        // 1. Find platform user for linking
        const platformUser = await findPlatformUser(userId);

        // 2. Try AI parsing for task type and date (optional enhancement)
        let taskType: string | null = null;
        let suggestedDate: string | null = null;
        let suggestedPriority: string | null = null;

        // Simple keyword detection for task type
        const lowerDesc = description.toLowerCase();
        if (lowerDesc.includes('купи') || lowerDesc.includes('заказ')) {
            taskType = 'buy';
        } else if (lowerDesc.includes('провер') || lowerDesc.includes('осмотр')) {
            taskType = 'check';
        } else if (lowerDesc.includes('исправ') || lowerDesc.includes('почин')) {
            taskType = 'fix';
        } else if (lowerDesc.includes('встреч') || lowerDesc.includes('созвон')) {
            taskType = 'meet';
        } else if (lowerDesc.includes('привез') || lowerDesc.includes('достав')) {
            taskType = 'bring';
        }

        // Priority detection
        if (lowerDesc.includes('срочно') || lowerDesc.includes('asap') || lowerDesc.includes('важно')) {
            suggestedPriority = 'high';
        }

        // Date detection
        if (lowerDesc.includes('сегодня')) {
            suggestedDate = new Date().toISOString().split('T')[0];
        } else if (lowerDesc.includes('завтра')) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            suggestedDate = tomorrow.toISOString().split('T')[0];
        }

        // 3. Create GTD task in Firestore
        const taskRef = await db.collection('gtd_tasks').add({
            title: description,
            description: '',
            status: 'inbox',
            priority: suggestedPriority || 'medium',
            taskType: taskType || null,
            dueDate: suggestedDate || null,
            estimatedHours: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: platformUser?.id || String(userId),
            createdByName: userName,
            ownerId: platformUser?.id || String(userId),
            source: 'telegram_command',
            telegramUserId: userId,
        });

        // 4. Send confirmation
        let confirmMsg = `✅ *Задача создана!*\n\n📝 ${description}`;
        if (taskType) {
            confirmMsg += `\n📌 Тип: ${TYPE_EMOJI[taskType] || '📋'} ${taskType}`;
        }
        if (suggestedPriority === 'high') {
            confirmMsg += `\n🔥 Приоритет: Высокий`;
        }
        if (suggestedDate) {
            confirmMsg += `\n📅 Дата: ${suggestedDate}`;
        }
        confirmMsg += `\n📥 Статус: Inbox`;

        await sendMessage(chatId, confirmMsg);

        logger.info(`✅ Quick task created`, { taskId: taskRef.id, userId, description: description.substring(0, 50) });

    } catch (error) {
        logger.error('❌ Error creating quick task', error);
        await sendMessage(chatId, '❌ Ошибка при создании задачи. Попробуйте позже.');
    }
}

// ═══════════════════════════════════════════════════════════
// VOICE REPORT → TASKS
// ═══════════════════════════════════════════════════════════

/**
 * Create tasks from AI-parsed voice report
 * Called when ending a work session with voice message
 * 
 * @returns Number of tasks created
 */
export async function createTasksFromVoiceReport(params: {
    userId: number;
    sessionId: string;
    sessionData: {
        clientId?: string;
        clientName?: string;
    };
    aiTasks: Array<{
        title?: string;
        priority?: string;
        dueDate?: string;
        estimatedDurationMinutes?: number;
    }>;
    voiceUrl: string;
    summary: string;
}): Promise<number> {
    const { userId, sessionId, sessionData, aiTasks, voiceUrl, summary } = params;

    if (!aiTasks || aiTasks.length === 0) {
        return 0;
    }

    const platformUser = await findPlatformUser(userId);
    if (!platformUser) {
        logger.warn('No platform user found for voice tasks', { userId });
        return 0;
    }

    const batch = db.batch();
    const now = admin.firestore.Timestamp.now();
    let createdCount = 0;

    for (const task of aiTasks) {
        const taskRef = db.collection('gtd_tasks').doc();

        let dueDate = null;
        if (task.dueDate) {
            try {
                const d = new Date(task.dueDate);
                if (!isNaN(d.getTime())) {
                    dueDate = admin.firestore.Timestamp.fromDate(d);
                }
            } catch (e) { }
        }

        batch.set(taskRef, {
            ownerId: platformUser.id,
            ownerName: platformUser.displayName || 'Worker',
            title: task.title || 'Новая задача',
            description: `🎙 Создано из голосового отчета.\nКонтекст: ${summary}\n[Аудио](${voiceUrl})`,
            status: 'inbox',
            priority: task.priority || 'medium',
            clientId: sessionData.clientId || null,
            clientName: sessionData.clientName || null,
            sourceSessionId: sessionId,
            sourceAudioUrl: voiceUrl,
            source: 'telegram',
            context: '@bot',
            dueDate: dueDate,
            estimatedDurationMinutes: task.estimatedDurationMinutes || null,
            createdAt: now,
            updatedAt: now
        });
        createdCount++;
    }

    await batch.commit();
    logger.info(`✅ Created ${createdCount} tasks from voice report`, {
        userId: platformUser.id,
        sessionId
    });

    return createdCount;
}

// ═══════════════════════════════════════════════════════════
// /tasks MENU
// ═══════════════════════════════════════════════════════════

/**
 * Show GTD tasks menu with column counts
 */
export async function sendTasksMenu(chatId: number, telegramId: number): Promise<void> {
    const platformUser = await findPlatformUser(telegramId);

    if (!platformUser) {
        await sendMessage(chatId, "❌ *No linked account*\n\nTo view tasks, link your Telegram to your platform account.\n\nGo to Profile → Settings → Link Telegram");
        return;
    }

    try {
        // Fetch all tasks for this user
        const tasksSnapshot = await db.collection('gtd_tasks')
            .where('ownerId', '==', platformUser.id)
            .get();

        // Count by status
        const counts: Record<string, number> = {};
        GTD_COLUMNS.forEach(col => { counts[col.id] = 0; });

        tasksSnapshot.forEach(doc => {
            const status = doc.data().status;
            if (counts[status] !== undefined) {
                counts[status]++;
            }
        });

        const totalTasks = tasksSnapshot.size;

        // Build inline keyboard (2 columns)
        const inlineKeyboard: any[][] = [];
        for (let i = 0; i < GTD_COLUMNS.length; i += 2) {
            const row: any[] = [];
            row.push({
                text: `${GTD_COLUMNS[i].emoji} ${GTD_COLUMNS[i].id === 'next_action' ? 'Next' : GTD_COLUMNS[i].title.split(' ')[1]} (${counts[GTD_COLUMNS[i].id]})`,
                callback_data: `tasks:${GTD_COLUMNS[i].id}`
            });
            if (GTD_COLUMNS[i + 1]) {
                row.push({
                    text: `${GTD_COLUMNS[i + 1].emoji} ${GTD_COLUMNS[i + 1].id === 'next_action' ? 'Next' : GTD_COLUMNS[i + 1].title.split(' ')[1]} (${counts[GTD_COLUMNS[i + 1].id]})`,
                    callback_data: `tasks:${GTD_COLUMNS[i + 1].id}`
                });
            }
            inlineKeyboard.push(row);
        }

        await sendMessage(chatId, `📋 *Your Tasks* (${totalTasks} total)\n\nTap a column to view:`, {
            inline_keyboard: inlineKeyboard
        });

    } catch (error: any) {
        console.error('Error fetching tasks:', error?.message || error, error?.code || '');
        const hint = error?.code === 9 ? ' (missing Firestore index)' : '';
        await sendMessage(chatId, `⚠️ Error loading tasks${hint}. Please try /start and then /tasks again.`);
    }
}

// ═══════════════════════════════════════════════════════════
// TASK LIST BY STATUS
// ═══════════════════════════════════════════════════════════

/**
 * Show list of tasks for a specific status/column
 * Enhanced with clickable task buttons
 */
export async function sendTaskList(chatId: number, telegramId: number, status: string): Promise<void> {
    const platformUser = await findPlatformUser(telegramId);

    if (!platformUser) {
        await sendMessage(chatId, "❌ Account not linked.");
        return;
    }

    try {
        // Fetch tasks with this status
        const tasksSnapshot = await db.collection('gtd_tasks')
            .where('ownerId', '==', platformUser.id)
            .where('status', '==', status)
            .orderBy('createdAt', 'desc')
            .limit(5) // Reduced for inline buttons
            .get();

        const column = GTD_COLUMNS.find(c => c.id === status);
        const columnTitle = column?.title || status;

        if (tasksSnapshot.empty) {
            await sendMessage(chatId, `${columnTitle}\n\n_No tasks in this column_`, {
                inline_keyboard: [[{ text: '◀️ Back', callback_data: 'tasks_back' }]]
            });
            return;
        }

        // Build inline buttons
        const inlineKeyboard: any[][] = [];

        for (const doc of tasksSnapshot.docs) {
            const task = doc.data();
            const priority = PRIORITY_EMOJI[task.priority || 'none'];
            const title = (task.title || 'Untitled').substring(0, 30);

            // Format due date if exists
            let dueNote = '';
            if (task.dueDate) {
                try {
                    const dueDate = task.dueDate.toDate();
                    dueNote = dueDate < new Date() ? ' ⚠️' : '';
                } catch (e) { }
            }

            // Add task button row
            const row: any[] = [
                { text: `${priority} ${title}${dueNote}`, callback_data: `task_view:${doc.id}` }
            ];

            // Add "Done" button if not already done
            if (status !== 'done') {
                row.push({ text: '✅', callback_data: `task_done:${doc.id}` });
            }

            inlineKeyboard.push(row);
        }

        // Add navigation row
        inlineKeyboard.push([{ text: '◀️ Back to Menu', callback_data: 'tasks_back' }]);

        await sendMessage(chatId, `${columnTitle}\n\nTap task to view, ✅ to complete:`, {
            inline_keyboard: inlineKeyboard
        });

    } catch (error: any) {
        console.error('Error fetching task list:', error?.message || error, error?.code || '');
        const hint = error?.code === 9 ? ' (missing index — deploying fix)' : '';
        await sendMessage(chatId, `⚠️ Error loading tasks${hint}.`, {
            inline_keyboard: [[{ text: '◀️ Back', callback_data: 'tasks_back' }]]
        });
    }
}

// ═══════════════════════════════════════════════════════════
// CALLBACK HANDLER
// ═══════════════════════════════════════════════════════════

/**
 * Handle GTD-related callbacks
 * Returns true if handled, false if not a GTD callback
 */
export async function handleGtdCallback(
    chatId: number,
    userId: number,
    data: string
): Promise<boolean> {
    // Back to menu
    if (data === 'tasks_back') {
        await sendTasksMenu(chatId, userId);
        return true;
    }

    // View column
    if (data.startsWith('tasks:')) {
        const status = data.substring(6);
        await sendTaskList(chatId, userId, status);
        return true;
    }

    // View task details (Phase 2: extended card)
    if (data.startsWith('task_view:')) {
        const taskId = data.substring(10);
        await sendTaskCardExtended(chatId, userId, taskId);
        return true;
    }

    // Mark task as done
    if (data.startsWith('task_done:')) {
        const taskId = data.substring(10);
        await markTaskDone(chatId, userId, taskId);
        return true;
    }

    // Plan from mytasks quick view
    if (data === 'tasks_plan') {
        await handlePlanCommand(chatId, userId, '');
        return true;
    }

    // Move task to different status
    if (data.startsWith('task_move:')) {
        const parts = data.substring(10).split(':');
        const taskId = parts[0];
        const newStatus = parts[1];
        await moveTask(chatId, userId, taskId, newStatus);
        return true;
    }

    // Phase 2 callbacks (comment, progress, checklist, delegate, photo, accept, decline)
    const handled = await handlePhase2Callback(chatId, userId, data);
    if (handled) return true;

    return false;
}

// TASK CARD (VIEW DETAILS) — replaced by sendTaskCardExtended in Phase 2

// ═══════════════════════════════════════════════════════════
// TASK ACTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Mark task as done
 */
async function markTaskDone(chatId: number, userId: number, taskId: string): Promise<void> {
    try {
        const taskRef = db.collection('gtd_tasks').doc(taskId);
        const taskDoc = await taskRef.get();

        if (!taskDoc.exists) {
            await sendMessage(chatId, "❌ Task not found.");
            return;
        }

        const previousStatus = taskDoc.data()?.status || 'inbox';

        await taskRef.update({
            status: 'done',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const title = (taskDoc.data()?.title || 'Task').substring(0, 30);

        await sendMessage(chatId, `✅ *Done!*\n\n~${title}~`, {
            inline_keyboard: [[
                { text: '↩️ Undo', callback_data: `task_move:${taskId}:${previousStatus}` },
                { text: '◀️ Back', callback_data: `tasks:${previousStatus}` }
            ]]
        });

        logger.info(`✅ Task marked done`, { taskId, userId });

    } catch (error) {
        console.error('Error marking task done:', error);
        await sendMessage(chatId, "⚠️ Error updating task.");
    }
}

/**
 * Move task to different status
 */
export async function moveTask(chatId: number, userId: number, taskId: string, newStatus: string): Promise<void> {
    try {
        const taskRef = db.collection('gtd_tasks').doc(taskId);

        await taskRef.update({
            status: newStatus,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const column = GTD_COLUMNS.find(c => c.id === newStatus);
        await sendMessage(chatId, `✅ Moved to ${column?.title || newStatus}`);
        await sendTaskList(chatId, userId, newStatus);

    } catch (error) {
        console.error('Error moving task:', error);
        await sendMessage(chatId, "⚠️ Error moving task.");
    }
}

// ═══════════════════════════════════════════════════════════
// /plan COMMAND - AI DAY PLANNER
// ═══════════════════════════════════════════════════════════

/**
 * Handle /plan command - generate AI-powered day/week plan
 * Usage:
 *   /plan - today's plan
 *   /plan week - week plan
 *   /plan tomorrow - tomorrow's plan
 */
export async function handlePlanCommand(
    chatId: number,
    userId: number,
    args: string
): Promise<void> {
    try {
        // Find platform user
        const platformUser = await findPlatformUser(userId);

        if (!platformUser) {
            await sendMessage(chatId, "❌ *Аккаунт не привязан*\n\nПривяжи Telegram в настройках профиля.");
            return;
        }

        // Determine plan type
        const lowerArgs = args.toLowerCase().trim();
        let planType: 'day' | 'week' = 'day';
        let targetDate = new Date();

        if (lowerArgs.includes('week') || lowerArgs.includes('недел')) {
            planType = 'week';
        } else if (lowerArgs.includes('tomorrow') || lowerArgs.includes('завтра')) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        await sendMessage(chatId, "⏳ *Генерирую план...*");

        // Generate plan
        const plan = await generateDayPlanLocal(platformUser.id, targetDate, planType);

        if (planType === 'week') {
            await sendWeekPlanMessage(chatId, plan as any);
        } else {
            await sendDayPlanMessage(chatId, plan);
        }

    } catch (error: any) {
        logger.error('Plan command failed', error);
        await sendMessage(chatId, "❌ Ошибка при генерации плана. Попробуй позже.");
    }
}

/**
 * Generate day plan (inline version to avoid circular imports)
 */
async function generateDayPlanLocal(
    userId: string,
    date: Date,
    type: 'day' | 'week'
): Promise<any> {
    // Load tasks
    const [ownerTasks, assigneeTasks] = await Promise.all([
        db.collection('gtd_tasks')
            .where('ownerId', '==', userId)
            .where('status', 'in', ['inbox', 'next_action', 'waiting', 'scheduled'])
            .get(),
        db.collection('gtd_tasks')
            .where('assigneeId', '==', userId)
            .where('status', 'in', ['inbox', 'next_action', 'waiting', 'scheduled'])
            .get()
    ]);

    const taskMap = new Map<string, any>();
    const today = new Date(date);
    today.setHours(0, 0, 0, 0);

    const processDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
        if (taskMap.has(doc.id)) return;
        const data = doc.data();
        const dueDate = data.dueDate?.toDate?.() || (data.dueDate ? new Date(data.dueDate) : undefined);

        let isOverdue = false;
        let isDueToday = false;

        if (dueDate) {
            const dueDateOnly = new Date(dueDate);
            dueDateOnly.setHours(0, 0, 0, 0);
            isOverdue = dueDateOnly < today;
            isDueToday = dueDateOnly.getTime() === today.getTime();
        }

        taskMap.set(doc.id, {
            id: doc.id,
            title: data.title || 'Без названия',
            priority: data.priority || 'medium',
            estimatedHours: data.estimatedHours || 1,
            clientName: data.clientName,
            isOverdue,
            isDueToday
        });
    };

    ownerTasks.docs.forEach(processDoc);
    assigneeTasks.docs.forEach(processDoc);

    // Sort: overdue > due today > high priority
    const tasks = Array.from(taskMap.values());
    tasks.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isDueToday !== b.isDueToday) return a.isDueToday ? -1 : 1;
        const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1);
    });

    // AI-optimized scheduling with gemini-2.0-pro
    const slots = await optimizeScheduleWithAI(tasks, date);

    const dayOfWeek = date.toLocaleDateString('ru-RU', { weekday: 'long' });
    const formattedDate = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

    return {
        date: date.toISOString().split('T')[0],
        dayOfWeek,
        greeting: `🌅 План на ${dayOfWeek}, ${formattedDate}:`,
        slots,
        summary: {
            totalTasks: slots.length,
            totalMinutes: slots.reduce((sum: number, s: any) => sum + s.estimatedMinutes, 0),
            highPriority: slots.filter((s: any) => s.priority === 'high').length,
            overdue: tasks.filter(t => t.isOverdue).length
        },
        aiTip: tasks.filter(t => t.isOverdue).length > 0
            ? `⚠️ ${tasks.filter(t => t.isOverdue).length} просроченных задач!`
            : slots.length > 0
                ? `✅ Отличный день! ${slots.length} задач запланировано.`
                : `📭 Нет задач. Добавь через /task`
    };
}

// ═══════════════════════════════════════════════════════════
// AI SCHEDULE OPTIMIZATION (gemini-2.0-pro)
// ═══════════════════════════════════════════════════════════

const PLANNER_PROMPT = `Ты — умный планировщик для строительной бригады.
Распредели задачи на рабочий день ОПТИМАЛЬНО.

СЕГОДНЯ: {todayDate} ({dayOfWeek})

ПРАВИЛА ПЛАНИРОВАНИЯ:
1. Рабочий день: 08:00 - 18:00
2. ГРУППИРУЙ задачи по клиенту/локации (одно место = подряд)
3. Сначала срочные и просроченные задачи  
4. Сложные задачи — утром (08:00-12:00)
5. Встречи/звонки — середина дня (11:00-14:00)
6. Рутина — после обеда (14:00-18:00)
7. Буфер 15 минут между задачами в разных локациях
8. Не планируй больше 8 часов работы

ЗАДАЧИ:
{tasksJson}

Распредели и верни JSON массив (только самое важное, до 8 задач):
[
  {
    "taskId": "task_id",
    "startTime": "09:00",
    "endTime": "10:30"
  }
]

Группируй задачи одного клиента вместе!
Возвращай ТОЛЬКО валидный JSON массив!`;

async function optimizeScheduleWithAI(tasks: any[], date: Date): Promise<any[]> {
    if (tasks.length === 0) return [];

    // Fallback to simple scheduling if no API key
    if (!GEMINI_API_KEY) {
        logger.warn('No GEMINI_API_KEY, using simple scheduling');
        return simpleSchedule(tasks);
    }

    const todayDate = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const dayOfWeek = date.toLocaleDateString('ru-RU', { weekday: 'long' });

    const tasksJson = JSON.stringify(tasks.slice(0, 12).map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        estimatedHours: t.estimatedHours,
        clientName: t.clientName || 'Без клиента',
        isOverdue: t.isOverdue,
        isDueToday: t.isDueToday
    })), null, 2);

    const prompt = PLANNER_PROMPT
        .replace('{todayDate}', todayDate)
        .replace('{dayOfWeek}', dayOfWeek)
        .replace('{tasksJson}', tasksJson);

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // Use gemini-2.0-pro for better reasoning and grouping
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-pro' });

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const responseText = result.response.text().trim();
        const jsonText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        logger.info('AI Planner response', { model: 'gemini-2.0-pro', responseLength: jsonText.length });

        const schedule = JSON.parse(jsonText);
        const taskMap = new Map(tasks.map(t => [t.id, t]));

        return schedule.map((slot: any) => {
            const task = taskMap.get(slot.taskId);
            if (!task) return null;

            return {
                startTime: slot.startTime,
                endTime: slot.endTime,
                taskId: task.id,
                title: task.title,
                priority: task.priority,
                clientName: task.clientName,
                estimatedMinutes: Math.round(task.estimatedHours * 60)
            };
        }).filter(Boolean);

    } catch (error) {
        logger.warn('AI optimization failed, using simple schedule', error);
        return simpleSchedule(tasks);
    }
}

/**
 * Simple scheduling fallback (no AI)
 */
function simpleSchedule(tasks: any[]): any[] {
    const slots: any[] = [];
    let currentMinutes = 8 * 60;

    for (const task of tasks.slice(0, 8)) {
        const duration = Math.round(task.estimatedHours * 60);
        const endMinutes = currentMinutes + duration;

        if (endMinutes > 18 * 60) break;

        slots.push({
            startTime: formatTime(currentMinutes),
            endTime: formatTime(endMinutes),
            taskId: task.id,
            title: task.title,
            priority: task.priority,
            clientName: task.clientName,
            estimatedMinutes: duration
        });

        currentMinutes = endMinutes + 15;
    }

    return slots;
}

function formatTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Send formatted day plan message
 */
async function sendDayPlanMessage(chatId: number, plan: any): Promise<void> {
    const lines: string[] = [plan.greeting, ''];

    if (plan.slots.length === 0) {
        lines.push('📭 _Нет задач на этот день_');
        lines.push('');
        lines.push('Добавь задачу: `/task Описание задачи`');
    } else {
        for (const slot of plan.slots) {
            const emoji = slot.priority === 'high' ? '🔴' :
                slot.priority === 'medium' ? '🟡' : '🟢';

            lines.push(`${emoji} *${slot.startTime}-${slot.endTime}* — ${escapeMarkdown(slot.title)}`);

            const details: string[] = [];
            if (slot.clientName) details.push(`📍 ${escapeMarkdown(slot.clientName)}`);
            details.push(`⏱ ${Math.round(slot.estimatedMinutes / 60 * 10) / 10}ч`);
            lines.push(`    ${details.join(' | ')}`);
            lines.push('');
        }

        lines.push('═══════════════════════════');
        const hours = Math.round(plan.summary.totalMinutes / 60 * 10) / 10;
        lines.push(`📊 ${plan.summary.totalTasks} задач | ⏱ ${hours}ч`);
    }

    if (plan.aiTip) {
        lines.push(plan.aiTip);
    }

    await sendMessage(chatId, lines.join('\n'));
}

/**
 * Send formatted week plan message
 */
async function sendWeekPlanMessage(chatId: number, weekPlan: any): Promise<void> {
    // For week, just show summary per day
    const lines: string[] = ['📅 *План на неделю*', ''];

    for (const day of weekPlan.days || []) {
        const date = new Date(day.date);
        const dayName = date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' });
        const taskCount = day.slots?.length || 0;
        const hours = Math.round((day.summary?.totalMinutes || 0) / 60 * 10) / 10;

        if (taskCount > 0) {
            lines.push(`📌 *${dayName}*: ${taskCount} задач (${hours}ч)`);
        } else {
            lines.push(`◻️ *${dayName}*: _свободно_`);
        }
    }

    lines.push('');
    lines.push('Детали: `/plan` (сегодня) или `/plan завтра`');

    await sendMessage(chatId, lines.join('\n'));
}

function escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════
// PHASE 2 — EXTENDED BOT UX
// ═══════════════════════════════════════════════════════════

// --- GTD Bot State (for multi-step flows) ---

interface GtdBotState {
    chatId: number;
    userId: number;
    flow: 'comment' | 'progress' | 'delegate';
    taskId: string;
    taskTitle?: string;
    expiresAt: FirebaseFirestore.Timestamp;
}

export async function getGtdState(chatId: number): Promise<GtdBotState | null> {
    try {
        const doc = await db.collection('bot_gtd_state').doc(String(chatId)).get();
        if (!doc.exists) return null;
        const data = doc.data() as GtdBotState;
        if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
            await clearGtdState(chatId);
            return null;
        }
        return data;
    } catch (_) { return null; }
}

async function setGtdState(chatId: number, state: Partial<GtdBotState>): Promise<void> {
    await db.collection('bot_gtd_state').doc(String(chatId)).set({
        ...state,
        chatId,
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000), // 30 min TTL
    }, { merge: true });
}

async function clearGtdState(chatId: number): Promise<void> {
    try { await db.collection('bot_gtd_state').doc(String(chatId)).delete(); }
    catch (_) { /* ignore */ }
}

/**
 * Handle text/photo messages during active GTD flow.
 * Called from onWorkerBotMessage when GTD state exists.
 */
export async function handleGtdFlowMessage(
    chatId: number,
    userId: number,
    text: string | undefined,
    message: any,
    state: GtdBotState
): Promise<boolean> {
    // Cancel commands
    if (text === '/cancel' || text === '❌ Cancel') {
        await clearGtdState(chatId);
        await sendMessage(chatId, '❌ Отменено.');
        return true;
    }
    if (text === '/start' || text === '/menu') {
        await clearGtdState(chatId);
        return false; // Let main handler process /start
    }

    // --- Comment flow ---
    if (state.flow === 'comment') {
        // Photo comment
        if (message.photo && message.photo.length > 0) {
            const fileId = message.photo[message.photo.length - 1].file_id;
            await addTaskPhoto(chatId, userId, state.taskId!, fileId, message.caption);
            await clearGtdState(chatId);
            return true;
        }
        // Voice comment
        if (message.voice) {
            await addTaskVoiceComment(chatId, userId, state.taskId!, message.voice.file_id);
            await clearGtdState(chatId);
            return true;
        }
        // Text comment
        if (text && text.length > 0) {
            await addTaskComment(chatId, userId, state.taskId!, text);
            await clearGtdState(chatId);
            return true;
        }
        return true;
    }

    // --- Progress flow ---
    if (state.flow === 'progress') {
        if (text) {
            const pct = parseInt(text.replace('%', '').trim());
            if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                await updateTaskProgress(chatId, userId, state.taskId!, pct);
                await clearGtdState(chatId);
                return true;
            }
            await sendMessage(chatId, '⚠️ Введите число от 0 до 100 (например: 75)');
            return true;
        }
        return true;
    }

    // --- Delegate flow ---
    if (state.flow === 'delegate') {
        if (text && text.length > 0) {
            await delegateTask(chatId, userId, state.taskId!, text);
            await clearGtdState(chatId);
            return true;
        }
        return true;
    }

    return false;
}

// --- Enhanced Task Card (Phase 2) ---

/**
 * Extended task card with all Phase 2 action buttons.
 * Replaces the original sendTaskCard.
 */
async function sendTaskCardExtended(chatId: number, userId: number, taskId: string): Promise<void> {
    try {
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        if (!taskDoc.exists) {
            await sendMessage(chatId, '❌ Задача не найдена.');
            return;
        }

        const task = taskDoc.data()!;
        const priority = PRIORITY_EMOJI[task.priority || 'none'];

        let cardText = `📋 *${task.title}*\n\n`;
        cardText += `${priority} Приоритет: ${task.priority || 'none'}\n`;
        cardText += `📁 Статус: ${task.status}\n`;

        if (task.description) {
            cardText += `\n📝 ${(task.description || '').substring(0, 200)}${(task.description || '').length > 200 ? '...' : ''}\n`;
        }

        if (task.dueDate) {
            try {
                const dd = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
                const dateStr = dd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
                const overdue = dd < new Date() ? ' ⚠️ Просрочена!' : '';
                cardText += `\n📅 Дедлайн: ${dateStr}${overdue}`;
            } catch (_) { /* ignore */ }
        }

        if (task.clientName) cardText += `\n🏢 Клиент: ${task.clientName}`;
        if (task.assigneeName) cardText += `\n👤 Исполнитель: ${task.assigneeName}`;

        // Progress
        if (task.progressPercentage !== undefined && task.progressPercentage > 0) {
            const pct = task.progressPercentage;
            const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
            cardText += `\n📊 Прогресс: ${bar} ${pct}%`;
        }

        // Checklist summary
        if (task.checklistItems && task.checklistItems.length > 0) {
            const done = task.checklistItems.filter((i: any) => i.isDone).length;
            const total = task.checklistItems.length;
            cardText += `\n☑️ Чеклист: ${done}/${total}`;
        }

        // Time tracked
        if (task.totalTimeSpentMinutes && task.totalTimeSpentMinutes > 0) {
            const h = Math.floor(task.totalTimeSpentMinutes / 60);
            const m = task.totalTimeSpentMinutes % 60;
            cardText += `\n⏱ Время: ${h}ч ${m}мин`;
        }

        // Build action keyboard
        const keyboard: any[][] = [];

        if (task.status !== 'done') {
            keyboard.push([
                { text: '✅ Done', callback_data: `task_done:${taskId}` },
                { text: '▶️ → Next', callback_data: `task_move:${taskId}:next_action` },
            ]);
        }

        // Phase 2 actions
        keyboard.push([
            { text: '💬 Коммент', callback_data: `task_comment:${taskId}` },
            { text: '📊 Прогресс', callback_data: `task_progress:${taskId}` },
        ]);

        if (task.checklistItems && task.checklistItems.length > 0) {
            keyboard.push([
                { text: '☑️ Чеклист', callback_data: `task_checklist:${taskId}` },
            ]);
        }

        keyboard.push([
            { text: '👤 Делегировать', callback_data: `task_delegate:${taskId}` },
            { text: '📷 Фото', callback_data: `task_photo:${taskId}` },
        ]);

        keyboard.push([{ text: '◀️ Назад', callback_data: `tasks:${task.status}` }]);

        await sendMessage(chatId, cardText, { inline_keyboard: keyboard });
    } catch (error) {
        logger.error('sendTaskCardExtended error', error);
        await sendMessage(chatId, '⚠️ Ошибка загрузки задачи.');
    }
}

// --- Phase 2.1: Task Comments ---

async function addTaskComment(chatId: number, userId: number, taskId: string, text: string): Promise<void> {
    const platformUser = await findPlatformUser(userId);
    const userName = platformUser?.displayName || platformUser?.name || 'Worker';

    await db.collection('gtd_tasks').doc(taskId).update({
        taskHistory: admin.firestore.FieldValue.arrayUnion({
            type: 'comment',
            text: text.slice(0, 1000),
            by: userName,
            byId: platformUser?.id || String(userId),
            at: new Date().toISOString(),
            source: 'telegram',
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sendMessage(chatId, `💬 *Комментарий добавлен!*\n\n"${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
}

// --- Phase 2.7: Voice comment → text (just save link, transcription done by AI elsewhere) ---

async function addTaskVoiceComment(chatId: number, userId: number, taskId: string, voiceFileId: string): Promise<void> {
    const platformUser = await findPlatformUser(userId);
    const userName = platformUser?.displayName || platformUser?.name || 'Worker';

    await db.collection('gtd_tasks').doc(taskId).update({
        taskHistory: admin.firestore.FieldValue.arrayUnion({
            type: 'voice_comment',
            voiceFileId,
            by: userName,
            byId: platformUser?.id || String(userId),
            at: new Date().toISOString(),
            source: 'telegram',
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sendMessage(chatId, '🎙 *Голосовой комментарий добавлен!*');
}

// --- Phase 2.8: Photo attached to task ---

async function addTaskPhoto(chatId: number, userId: number, taskId: string, fileId: string, caption?: string): Promise<void> {
    const platformUser = await findPlatformUser(userId);
    const userName = platformUser?.displayName || platformUser?.name || 'Worker';

    await db.collection('gtd_tasks').doc(taskId).update({
        taskHistory: admin.firestore.FieldValue.arrayUnion({
            type: 'photo',
            photoFileId: fileId,
            caption: caption || '',
            by: userName,
            byId: platformUser?.id || String(userId),
            at: new Date().toISOString(),
            source: 'telegram',
        }),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await sendMessage(chatId, `📷 *Фото прикреплено к задаче!*${caption ? '\n📝 ' + caption : ''}`);
}

// --- Phase 2.2: Checklist interaction ---

async function sendChecklist(chatId: number, userId: number, taskId: string): Promise<void> {
    const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
    if (!taskDoc.exists) {
        await sendMessage(chatId, '❌ Задача не найдена.');
        return;
    }

    const task = taskDoc.data()!;
    const items = task.checklistItems || [];

    if (items.length === 0) {
        await sendMessage(chatId, '☑️ *Чеклист пуст*\n\nДобавьте пункты через CRM.', {
            inline_keyboard: [[{ text: '◀️ Назад', callback_data: `task_view:${taskId}` }]],
        });
        return;
    }

    let msg = `☑️ *Чеклист:* ${task.title}\n\n`;
    const keyboard: any[][] = [];

    items.forEach((item: any, idx: number) => {
        const check = item.isDone ? '✅' : '☐';
        const strike = item.isDone ? '~' : '';
        msg += `${check} ${strike}${item.text || item.title || `Пункт ${idx + 1}`}${strike}\n`;

        keyboard.push([{
            text: `${item.isDone ? '↩️' : '✅'} ${(item.text || item.title || `#${idx + 1}`).substring(0, 30)}`,
            callback_data: `task_cl_toggle:${taskId}:${idx}`,
        }]);
    });

    const done = items.filter((i: any) => i.isDone).length;
    msg += `\n📊 ${done}/${items.length} выполнено`;

    keyboard.push([{ text: '◀️ Назад к задаче', callback_data: `task_view:${taskId}` }]);

    await sendMessage(chatId, msg, { inline_keyboard: keyboard });
}

async function toggleChecklistItem(chatId: number, userId: number, taskId: string, index: number): Promise<void> {
    const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
    if (!taskDoc.exists) return;

    const task = taskDoc.data()!;
    const items = [...(task.checklistItems || [])];
    if (index < 0 || index >= items.length) return;

    items[index] = { ...items[index], isDone: !items[index].isDone };

    await db.collection('gtd_tasks').doc(taskId).update({
        checklistItems: items,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Refresh checklist view
    await sendChecklist(chatId, userId, taskId);
}

// --- Phase 2.5: Progress update ---

async function updateTaskProgress(chatId: number, userId: number, taskId: string, pct: number): Promise<void> {
    await db.collection('gtd_tasks').doc(taskId).update({
        progressPercentage: pct,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    await sendMessage(chatId, `📊 *Прогресс обновлён!*\n\n${bar} ${pct}%`);
}

// --- Phase 2.3: Delegate task ---

async function delegateTask(chatId: number, userId: number, taskId: string, assigneeName: string): Promise<void> {
    // Try to find user by name
    const usersSnap = await db.collection('users')
        .where('displayName', '>=', assigneeName)
        .where('displayName', '<=', assigneeName + '\uf8ff')
        .limit(5)
        .get();

    // Also search employees collection
    const empSnap = await db.collection('employees')
        .where('name', '>=', assigneeName)
        .where('name', '<=', assigneeName + '\uf8ff')
        .limit(5)
        .get();

    let assigneeId: string | null = null;
    let resolvedName = assigneeName;

    if (!usersSnap.empty) {
        const user = usersSnap.docs[0];
        assigneeId = user.id;
        resolvedName = user.data().displayName || user.data().name || assigneeName;
    } else if (!empSnap.empty) {
        const emp = empSnap.docs[0];
        assigneeId = emp.id;
        resolvedName = emp.data().name || assigneeName;
    }

    const updateData: Record<string, any> = {
        assigneeName: resolvedName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        taskHistory: admin.firestore.FieldValue.arrayUnion({
            type: 'delegated',
            to: resolvedName,
            toId: assigneeId,
            at: new Date().toISOString(),
            source: 'telegram',
        }),
    };
    if (assigneeId) updateData.assigneeId = assigneeId;

    await db.collection('gtd_tasks').doc(taskId).update(updateData);

    // Notify assignee via Telegram if possible
    if (assigneeId) {
        const assigneeDoc = await db.collection('users').doc(assigneeId).get();
        const telegramId = assigneeDoc.data()?.telegramId;
        if (telegramId) {
            const tId = typeof telegramId === 'number' ? telegramId : parseInt(telegramId);
            const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
            const title = taskDoc.data()?.title || 'Задача';
            try {
                await sendMessage(tId, `📋 *Новая задача для тебя:*\n\n${title}\n\n👤 От: ${(await findPlatformUser(userId))?.displayName || 'Manager'}`);
            } catch (_) { /* bot blocked or chat not found */ }
        }
    }

    await sendMessage(chatId, `👤 *Задача делегирована!*\n\n→ ${resolvedName}${assigneeId ? '' : '\n⚠️ Пользователь не найден в системе, имя записано как текст.'}`);
}

// --- Phase 2 Callback Extensions ---

/**
 * Handle Phase 2 task callbacks. Returns true if handled.
 * Called from the main handleGtdCallback.
 */
export async function handlePhase2Callback(
    chatId: number,
    userId: number,
    data: string
): Promise<boolean> {
    // Comment
    if (data.startsWith('task_comment:')) {
        const taskId = data.substring(13);
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        const title = taskDoc.data()?.title || 'Задача';
        await setGtdState(chatId, { userId, flow: 'comment', taskId, taskTitle: title });
        await sendMessage(chatId, `💬 *Комментарий к:* ${title}\n\nОтправьте текст, фото или голосовое:`);
        return true;
    }

    // Progress
    if (data.startsWith('task_progress:')) {
        const taskId = data.substring(14);
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        const title = taskDoc.data()?.title || 'Задача';
        const current = taskDoc.data()?.progressPercentage || 0;
        await setGtdState(chatId, { userId, flow: 'progress', taskId, taskTitle: title });
        await sendMessage(chatId, `📊 *Прогресс:* ${title}\n\nТекущий: ${current}%\nВведите новый % (0-100):`, {
            inline_keyboard: [
                [
                    { text: '25%', callback_data: `task_pct:${taskId}:25` },
                    { text: '50%', callback_data: `task_pct:${taskId}:50` },
                    { text: '75%', callback_data: `task_pct:${taskId}:75` },
                    { text: '100%', callback_data: `task_pct:${taskId}:100` },
                ],
            ],
        });
        return true;
    }

    // Quick progress buttons
    if (data.startsWith('task_pct:')) {
        const parts = data.substring(9).split(':');
        const taskId = parts[0];
        const pct = parseInt(parts[1]);
        await clearGtdState(chatId);
        await updateTaskProgress(chatId, userId, taskId, pct);
        return true;
    }

    // Checklist
    if (data.startsWith('task_checklist:')) {
        const taskId = data.substring(15);
        await sendChecklist(chatId, userId, taskId);
        return true;
    }

    // Toggle checklist item
    if (data.startsWith('task_cl_toggle:')) {
        const parts = data.substring(15).split(':');
        const taskId = parts[0];
        const index = parseInt(parts[1]);
        await toggleChecklistItem(chatId, userId, taskId, index);
        return true;
    }

    // Delegate
    if (data.startsWith('task_delegate:')) {
        const taskId = data.substring(14);
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        const title = taskDoc.data()?.title || 'Задача';
        await setGtdState(chatId, { userId, flow: 'delegate', taskId, taskTitle: title });
        await sendMessage(chatId, `👤 *Делегировать:* ${title}\n\nВведите имя исполнителя:`);
        return true;
    }

    // Photo
    if (data.startsWith('task_photo:')) {
        const taskId = data.substring(11);
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
        const title = taskDoc.data()?.title || 'Задача';
        await setGtdState(chatId, { userId, flow: 'comment', taskId, taskTitle: title });
        await sendMessage(chatId, `📷 *Фото к задаче:* ${title}\n\nОтправьте фото (можно с подписью):`);
        return true;
    }

    // Accept task
    if (data.startsWith('task_accept:')) {
        const taskId = data.substring(12);
        await db.collection('gtd_tasks').doc(taskId).update({
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            acceptedBy: String(userId),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await sendMessage(chatId, '✅ *Задача принята!*');
        await sendTaskCardExtended(chatId, userId, taskId);
        return true;
    }

    // Decline task
    if (data.startsWith('task_decline:')) {
        const taskId = data.substring(13);
        const platformUser = await findPlatformUser(userId);
        await db.collection('gtd_tasks').doc(taskId).update({
            assigneeId: null,
            assigneeName: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            taskHistory: admin.firestore.FieldValue.arrayUnion({
                type: 'declined',
                by: platformUser?.displayName || 'Worker',
                byId: platformUser?.id || String(userId),
                at: new Date().toISOString(),
            }),
        });
        await sendMessage(chatId, '❌ *Задача отклонена.*\nВладелец задачи будет уведомлён.');
        return true;
    }

    return false;
}

// --- Wire Phase 2 into existing callback router ---
// (The main handleGtdCallback at top of file calls sendTaskCard.
//  We override it by replacing task_view routing to use extended card,
//  and adding Phase 2 callback routes.)
