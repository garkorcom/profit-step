/**
 * API для страницы управления пользователем (Admin User Detail)
 *
 * Включает:
 * - Вызовы Cloud Function admin_manageUser (пароль, logout, email, telegram)
 * - Загрузку данных активности из Firestore (сессии, задачи, сделки, закупки, заметки)
 */

import { httpsCallable } from 'firebase/functions';
import {
    collection,
    query,
    where,
    getDocs,
    orderBy,
    limit as firestoreLimit,
    Timestamp,
} from 'firebase/firestore';
import { functions, db } from '../firebase/firebase';

// ============================================
// CLOUD FUNCTION CALLS
// ============================================

interface ManageUserResponse {
    success: boolean;
    message: string;
}

/**
 * Установить новый пароль пользователю
 */
export async function adminResetPassword(
    targetUserId: string,
    newPassword: string
): Promise<ManageUserResponse> {
    const fn = httpsCallable<{ action: string; targetUserId: string; newPassword: string }, ManageUserResponse>(functions, 'admin_manageUser');
    const result = await fn({ action: 'resetPassword', targetUserId, newPassword });
    return result.data;
}

/**
 * Принудительный logout (отзыв refresh tokens)
 */
export async function adminForceLogout(targetUserId: string): Promise<ManageUserResponse> {
    const fn = httpsCallable<{ action: string; targetUserId: string }, ManageUserResponse>(functions, 'admin_manageUser');
    const result = await fn({ action: 'forceLogout', targetUserId });
    return result.data;
}

/**
 * Сменить email пользователя
 */
export async function adminChangeEmail(
    targetUserId: string,
    newEmail: string
): Promise<ManageUserResponse> {
    const fn = httpsCallable<{ action: string; targetUserId: string; newEmail: string }, ManageUserResponse>(functions, 'admin_manageUser');
    const result = await fn({ action: 'changeEmail', targetUserId, newEmail });
    return result.data;
}

/**
 * Отправить пароль через Telegram
 */
export async function adminSendPasswordViaTelegram(
    targetUserId: string,
    newPassword: string
): Promise<ManageUserResponse> {
    const fn = httpsCallable<{ action: string; targetUserId: string; newPassword: string }, ManageUserResponse>(functions, 'admin_manageUser');
    const result = await fn({ action: 'sendPasswordViaTelegram', targetUserId, newPassword });
    return result.data;
}

// ============================================
// ACTIVITY DATA FETCHING
// ============================================

export interface WorkSessionItem {
    id: string;
    projectName: string;
    startTime: Date;
    endTime: Date | null;
    duration: number; // minutes
    hourlyRate: number;
    status: string;
}

export interface TaskItem {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    createdAt: Date;
}

export interface DealItem {
    id: string;
    title: string;
    status: string;
    value: number;
    clientName: string;
}

export interface ShoppingItem {
    id: string;
    title: string;
    createdAt: Date;
    status: string;
    itemCount: number;
}

export interface NoteItem {
    id: string;
    title: string;
    content: string;
    createdAt: Date;
    type: string;
}

export interface MonthlyStats {
    totalHours: number;
    totalEarnings: number;
    sessionsCount: number;
    tasksCompleted: number;
    activityByDay: Record<string, number>; // 'YYYY-MM-DD' -> hours
}

// Utility: extract Date from Timestamp | string | Date
function toDate(val: Timestamp | string | Date | null | undefined): Date {
    if (!val) return new Date(0);
    if (val instanceof Timestamp) return val.toDate();
    if (val instanceof Date) return val;
    return new Date(val);
}

/**
 * Получить последние рабочие сессии пользователя
 */
export async function getUserWorkSessions(
    userId: string,
    maxResults = 20
): Promise<WorkSessionItem[]> {
    const q = query(
        collection(db, 'work_sessions'),
        where('userId', '==', userId),
        orderBy('startTime', 'desc'),
        firestoreLimit(maxResults)
    );

    const snap = await getDocs(q);
    return snap.docs.map((doc) => {
        const d = doc.data();
        const startTime = toDate(d.startTime);
        const endTime = d.endTime ? toDate(d.endTime) : null;
        const duration = endTime
            ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
            : 0;

        return {
            id: doc.id,
            projectName: d.projectName || d.clientName || 'Без проекта',
            startTime,
            endTime,
            duration,
            hourlyRate: d.hourlyRate || 0,
            status: d.status || 'unknown',
        };
    });
}

/**
 * Получить задачи пользователя (owner или assignee)
 */
export async function getUserTasks(userId: string, maxResults = 30): Promise<TaskItem[]> {
    // Owner tasks
    const ownerQ = query(
        collection(db, 'gtd_tasks'),
        where('ownerId', '==', userId),
        orderBy('createdAt', 'desc'),
        firestoreLimit(maxResults)
    );

    const ownerSnap = await getDocs(ownerQ);
    const tasks: TaskItem[] = ownerSnap.docs.map((doc) => {
        const d = doc.data();
        return {
            id: doc.id,
            title: d.title || 'Без названия',
            status: d.status || 'inbox',
            priority: d.priority || 'medium',
            dueDate: d.dueDate ? toDate(d.dueDate) : null,
            createdAt: toDate(d.createdAt),
        };
    });

    return tasks;
}

/**
 * Получить сделки пользователя
 */
export async function getUserDeals(userId: string): Promise<DealItem[]> {
    const q = query(collection(db, 'deals'), where('assignedTo', '==', userId));
    const snap = await getDocs(q);

    return snap.docs.map((doc) => {
        const d = doc.data();
        return {
            id: doc.id,
            title: d.title || d.name || 'Сделка',
            status: d.status || 'unknown',
            value: d.value || 0,
            clientName: d.clientName || '',
        };
    });
}

/**
 * Получить списки закупок пользователя
 */
export async function getUserShoppingActivity(
    userId: string,
    maxResults = 20
): Promise<ShoppingItem[]> {
    const q = query(
        collection(db, 'shopping_lists'),
        where('createdBy', '==', userId),
        orderBy('createdAt', 'desc'),
        firestoreLimit(maxResults)
    );

    try {
        const snap = await getDocs(q);
        return snap.docs.map((doc) => {
            const d = doc.data();
            return {
                id: doc.id,
                title: d.title || d.name || 'Список',
                createdAt: toDate(d.createdAt),
                status: d.status || 'active',
                itemCount: d.items?.length || 0,
            };
        });
    } catch {
        // Collection may not have the required index
        return [];
    }
}

/**
 * Получить заметки пользователя
 */
export async function getUserNotes(userId: string, maxResults = 20): Promise<NoteItem[]> {
    try {
        const q = query(
            collection(db, 'notes'),
            where('ownerId', '==', userId),
            orderBy('createdAt', 'desc'),
            firestoreLimit(maxResults)
        );

        const snap = await getDocs(q);
        return snap.docs.map((doc) => {
            const d = doc.data();
            return {
                id: doc.id,
                title: d.title || d.text?.substring(0, 50) || 'Заметка',
                content: d.text || d.content || '',
                createdAt: toDate(d.createdAt),
                type: d.type || 'note',
            };
        });
    } catch {
        return [];
    }
}

/**
 * Получить месячную статистику пользователя
 */
export async function getUserMonthlyStats(userId: string): Promise<MonthlyStats> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const q = query(
        collection(db, 'work_sessions'),
        where('userId', '==', userId),
        where('startTime', '>=', Timestamp.fromDate(startOfMonth)),
        orderBy('startTime', 'desc')
    );

    const snap = await getDocs(q);

    let totalMinutes = 0;
    let totalEarnings = 0;
    const activityByDay: Record<string, number> = {};

    snap.docs.forEach((doc) => {
        const d = doc.data();
        const startTime = toDate(d.startTime);
        const endTime = d.endTime ? toDate(d.endTime) : null;

        if (endTime) {
            const minutes = (endTime.getTime() - startTime.getTime()) / 60000;
            totalMinutes += minutes;

            const rate = d.hourlyRate || 0;
            totalEarnings += (minutes / 60) * rate;

            // Activity by day
            const dayKey = startTime.toISOString().split('T')[0];
            activityByDay[dayKey] = (activityByDay[dayKey] || 0) + minutes / 60;
        }
    });

    // Tasks completed this month
    let tasksCompleted = 0;
    try {
        const tasksQ = query(
            collection(db, 'gtd_tasks'),
            where('ownerId', '==', userId),
            where('status', '==', 'done'),
            where('completedAt', '>=', Timestamp.fromDate(startOfMonth))
        );
        const tasksSnap = await getDocs(tasksQ);
        tasksCompleted = tasksSnap.size;
    } catch {
        // Index may not exist
    }

    return {
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        sessionsCount: snap.size,
        tasksCompleted,
        activityByDay,
    };
}
