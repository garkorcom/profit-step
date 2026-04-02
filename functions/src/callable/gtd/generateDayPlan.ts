/**
 * @fileoverview Generate AI Day Plan
 * 
 * Callable function that analyzes GTD tasks and creates an optimized
 * daily or weekly plan using AI.
 * 
 * @module callable/gtd/generateDayPlan
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

interface GeneratePlanRequest {
    userId?: string;
    type: 'day' | 'week';
    date?: string; // ISO date, defaults to today
}

interface TaskSlot {
    startTime: string;
    endTime: string;
    taskId: string;
    title: string;
    priority: 'high' | 'medium' | 'low';
    clientName?: string;
    estimatedMinutes: number;
}

interface DayPlan {
    date: string;
    dayOfWeek: string;
    greeting: string;
    slots: TaskSlot[];
    summary: {
        totalTasks: number;
        totalMinutes: number;
        highPriority: number;
        overdue: number;
    };
    aiTip?: string;
}

interface WeekPlan {
    weekStart: string;
    days: DayPlan[];
    weekSummary: string;
}

// ═══════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════

export const generateDayPlan = functions
    .region('us-central1')
    .https.onCall(async (data: GeneratePlanRequest, context) => {
        const userId = data.userId || context.auth?.uid;

        if (!userId) {
            throw new functions.https.HttpsError('unauthenticated', 'User not authenticated');
        }

        const type = data.type || 'day';
        const targetDate = data.date ? new Date(data.date) : new Date();

        logger.info(`Generating ${type} plan for user ${userId}`, { date: targetDate.toISOString() });

        try {
            if (type === 'week') {
                return await generateWeekPlan(userId, targetDate);
            } else {
                return await generateSingleDayPlan(userId, targetDate);
            }
        } catch (error: any) {
            logger.error('Failed to generate plan', error);
            throw new functions.https.HttpsError('internal', error.message);
        }
    });

// ═══════════════════════════════════════════════════════════
// PLAN GENERATION
// ═══════════════════════════════════════════════════════════

/**
 * Generate plan for a single day
 */
async function generateSingleDayPlan(userId: string, date: Date): Promise<DayPlan> {
    // 1. Load tasks for this user
    const tasks = await loadUserTasks(userId, date);

    if (tasks.length === 0) {
        return createEmptyPlan(date);
    }

    // 2. Use AI to optimize schedule
    const optimizedSlots = await optimizeWithAI(tasks, date);

    // 3. Build response
    const dayOfWeek = date.toLocaleDateString('ru-RU', { weekday: 'long' });

    const summary = {
        totalTasks: optimizedSlots.length,
        totalMinutes: optimizedSlots.reduce((sum, s) => sum + s.estimatedMinutes, 0),
        highPriority: optimizedSlots.filter(s => s.priority === 'high').length,
        overdue: tasks.filter(t => t.isOverdue).length
    };

    return {
        date: date.toISOString().split('T')[0],
        dayOfWeek,
        greeting: getGreeting(date),
        slots: optimizedSlots,
        summary,
        aiTip: generateTip(optimizedSlots, tasks)
    };
}

/**
 * Generate week plan
 */
async function generateWeekPlan(userId: string, startDate: Date): Promise<WeekPlan> {
    const days: DayPlan[] = [];

    for (let i = 0; i < 7; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);
        const dayPlan = await generateSingleDayPlan(userId, date);
        days.push(dayPlan);
    }

    const totalTasks = days.reduce((sum, d) => sum + d.summary.totalTasks, 0);
    const totalHours = Math.round(days.reduce((sum, d) => sum + d.summary.totalMinutes, 0) / 60);

    return {
        weekStart: startDate.toISOString().split('T')[0],
        days,
        weekSummary: `📅 ${totalTasks} задач на неделю (~${totalHours}ч)`
    };
}

// ═══════════════════════════════════════════════════════════
// TASK LOADING
// ═══════════════════════════════════════════════════════════

interface LoadedTask {
    id: string;
    title: string;
    priority: 'high' | 'medium' | 'low';
    status: string;
    estimatedHours: number;
    dueDate?: Date;
    clientName?: string;
    isOverdue: boolean;
    isDueToday: boolean;
}

async function loadUserTasks(userId: string, targetDate: Date): Promise<LoadedTask[]> {
    // Get tasks where user is owner or assignee
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

    const taskMap = new Map<string, LoadedTask>();
    const today = new Date(targetDate);
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
            status: data.status,
            estimatedHours: data.estimatedHours || 1,
            dueDate,
            clientName: data.clientName,
            isOverdue,
            isDueToday
        });
    };

    ownerTasks.docs.forEach(processDoc);
    assigneeTasks.docs.forEach(processDoc);

    // Filter and sort tasks relevant for target date
    const tasks = Array.from(taskMap.values());

    // Priority sort: overdue > due today > high priority > others
    tasks.sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isDueToday !== b.isDueToday) return a.isDueToday ? -1 : 1;
        if (a.priority !== b.priority) {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return 0;
    });

    return tasks;
}

// ═══════════════════════════════════════════════════════════
// AI OPTIMIZATION
// ═══════════════════════════════════════════════════════════

const PLANNER_PROMPT = `Ты — умный планировщик для строительной бригады.
Распредели задачи на рабочий день оптимально.

СЕГОДНЯ: {todayDate} ({dayOfWeek})

ПРАВИЛА ПЛАНИРОВАНИЯ:
1. Рабочий день: 08:00 - 18:00
2. Сначала срочные и просроченные задачи
3. Сложные задачи — утром (08:00-12:00)
4. Встречи и звонки — середина дня (11:00-14:00)
5. Рутина и проверки — после обеда (14:00-18:00)
6. Группируй задачи по клиенту/локации
7. Буфер 15 минут между задачами
8. Не планируй больше 8 часов

ЗАДАЧИ НА СЕГОДНЯ:
{tasksJson}

Распредели задачи и верни JSON массив:
[
  {
    "taskId": "id",
    "startTime": "09:00",
    "endTime": "10:30"
  }
]

Если задач слишком много — включи только самые важные.
Возвращай ТОЛЬКО валидный JSON массив!`;

async function optimizeWithAI(tasks: LoadedTask[], date: Date): Promise<TaskSlot[]> {
    // If no AI key, use simple scheduling
    if (!GEMINI_API_KEY) {
        logger.warn('No GEMINI_API_KEY, using simple scheduling');
        return simpleSchedule(tasks);
    }

    const todayDate = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const dayOfWeek = date.toLocaleDateString('ru-RU', { weekday: 'long' });

    const tasksJson = JSON.stringify(tasks.slice(0, 15).map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        estimatedHours: t.estimatedHours,
        clientName: t.clientName,
        isOverdue: t.isOverdue,
        isDueToday: t.isDueToday
    })), null, 2);

    const prompt = PLANNER_PROMPT
        .replace('{todayDate}', todayDate)
        .replace('{dayOfWeek}', dayOfWeek)
        .replace('{tasksJson}', tasksJson);

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const responseText = result.response.text().trim();
        const jsonText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const schedule = JSON.parse(jsonText);

        // Map back to full TaskSlot objects
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
        }).filter(Boolean) as TaskSlot[];

    } catch (error) {
        logger.warn('AI optimization failed, using simple schedule', error);
        return simpleSchedule(tasks);
    }
}

/**
 * Simple scheduling without AI
 */
function simpleSchedule(tasks: LoadedTask[]): TaskSlot[] {
    const slots: TaskSlot[] = [];
    let currentTime = 8 * 60; // 08:00 in minutes

    for (const task of tasks.slice(0, 10)) {
        const duration = Math.round(task.estimatedHours * 60);
        const endTime = currentTime + duration;

        if (endTime > 18 * 60) break; // Don't go past 6pm

        slots.push({
            startTime: formatTime(currentTime),
            endTime: formatTime(endTime),
            taskId: task.id,
            title: task.title,
            priority: task.priority,
            clientName: task.clientName,
            estimatedMinutes: duration
        });

        currentTime = endTime + 15; // 15 min buffer
    }

    return slots;
}

function formatTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function getGreeting(date: Date): string {
    const hour = date.getHours();
    const dayName = date.toLocaleDateString('ru-RU', { weekday: 'long' });
    const formattedDate = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

    if (hour < 12) {
        return `🌅 Доброе утро! План на ${dayName}, ${formattedDate}:`;
    } else if (hour < 17) {
        return `☀️ Добрый день! План на ${dayName}, ${formattedDate}:`;
    } else {
        return `🌙 Добрый вечер! План на ${dayName}, ${formattedDate}:`;
    }
}

function createEmptyPlan(date: Date): DayPlan {
    const dayOfWeek = date.toLocaleDateString('ru-RU', { weekday: 'long' });

    return {
        date: date.toISOString().split('T')[0],
        dayOfWeek,
        greeting: getGreeting(date),
        slots: [],
        summary: { totalTasks: 0, totalMinutes: 0, highPriority: 0, overdue: 0 },
        aiTip: '✨ Нет задач на сегодня. Добавь через голос или /task!'
    };
}

function generateTip(slots: TaskSlot[], tasks: LoadedTask[]): string {
    const overdueCount = tasks.filter(t => t.isOverdue).length;
    const highPriorityFirst = slots[0]?.priority === 'high';

    if (overdueCount > 0) {
        return `⚠️ ${overdueCount} просроченных задач — начни с них!`;
    }

    if (highPriorityFirst && slots[0]?.clientName) {
        return `💡 Начни с ${slots[0].clientName} — это приоритет!`;
    }

    if (slots.length > 5) {
        return `📊 Насыщенный день! Делай перерывы.`;
    }

    return `✅ План готов. Удачного дня!`;
}
