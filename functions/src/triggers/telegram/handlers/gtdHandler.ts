/**
 * GTD Handler - Task management for Telegram bot
 * 
 * Extracted from onWorkerBotMessage.ts for better modularity.
 * Handles: /task command, /tasks menu, /plan command, task lists, and callbacks
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import { sendMessage } from '../telegramUtils';
import { findPlatformUserForInbox } from './inboxHandler';
import { GoogleGenerativeAI } from '@google/generative-ai';

const db = admin.firestore();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || functions.config().gemini?.api_key;

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
// PLATFORM USER HELPER
// ═══════════════════════════════════════════════════════════

async function findPlatformUser(telegramId: number): Promise<{ id: string;[key: string]: any } | null> {
    try {
        const snapshot = await db.collection('users')
            .where('telegramId', '==', String(telegramId))
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
        const platformUser = await findPlatformUserForInbox(userId);

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

    } catch (error) {
        console.error('Error fetching tasks:', error);
        await sendMessage(chatId, "⚠️ Error loading tasks. Please try again.");
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

    } catch (error) {
        console.error('Error fetching task list:', error);
        await sendMessage(chatId, "⚠️ Error loading tasks.", {
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

    // View task details
    if (data.startsWith('task_view:')) {
        const taskId = data.substring(10);
        await sendTaskCard(chatId, userId, taskId);
        return true;
    }

    // Mark task as done
    if (data.startsWith('task_done:')) {
        const taskId = data.substring(10);
        await markTaskDone(chatId, userId, taskId);
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

    return false;
}

// ═══════════════════════════════════════════════════════════
// TASK CARD (VIEW DETAILS)
// ═══════════════════════════════════════════════════════════

/**
 * Show detailed task card
 */
async function sendTaskCard(chatId: number, userId: number, taskId: string): Promise<void> {
    try {
        const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();

        if (!taskDoc.exists) {
            await sendMessage(chatId, "❌ Task not found.");
            return;
        }

        const task = taskDoc.data()!;
        const priority = PRIORITY_EMOJI[task.priority || 'none'];

        let cardText = `📋 *${task.title}*\n\n`;
        cardText += `${priority} Priority: ${task.priority || 'none'}\n`;
        cardText += `📁 Status: ${task.status}\n`;

        if (task.description) {
            cardText += `\n📝 ${task.description.substring(0, 200)}${task.description.length > 200 ? '...' : ''}\n`;
        }

        if (task.dueDate) {
            try {
                const dueDate = task.dueDate.toDate();
                const dateStr = dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                cardText += `\n📅 Due: ${dateStr}`;
            } catch (e) { }
        }

        if (task.clientName) {
            cardText += `\n🏢 Client: ${task.clientName}`;
        }

        if (task.estimatedHours || task.estimatedDurationMinutes) {
            const mins = task.estimatedDurationMinutes || (task.estimatedHours * 60);
            cardText += `\n⏱ Est: ${mins >= 60 ? Math.round(mins / 60) + 'h' : mins + 'm'}`;
        }

        // Build action buttons
        const keyboard: any[][] = [];

        if (task.status !== 'done') {
            keyboard.push([
                { text: '✅ Mark Done', callback_data: `task_done:${taskId}` },
                { text: '▶️ Move to Next', callback_data: `task_move:${taskId}:next_action` }
            ]);
        }

        keyboard.push([{ text: '◀️ Back', callback_data: `tasks:${task.status}` }]);

        await sendMessage(chatId, cardText, { inline_keyboard: keyboard });

    } catch (error) {
        console.error('Error fetching task:', error);
        await sendMessage(chatId, "⚠️ Error loading task.");
    }
}

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
