/**
 * @fileoverview Phase 6 — Manager & Team Task Overview
 *
 * Provides:
 * - getTeamTaskOverview: manager sees all subordinates' task counts
 * - getUnassignedTasks: tasks without assignee (pool for self-assign)
 * - suggestAssignee: AI-like suggestion based on workload + department
 * - shiftHandoffSummary: what each worker did today
 *
 * Spec: Phase 6 of Tasks v2 plan
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface TeamMemberSummary {
    userId: string;
    displayName: string;
    department?: string;
    title?: string;
    taskCounts: Record<string, number>; // status → count
    overdueCount: number;
    activeCount: number;
    totalOpen: number;
}

// ═══════════════════════════════════════════════════════════
// Helper: get all subordinate IDs for a manager
// ═══════════════════════════════════════════════════════════

async function getSubordinateIds(managerId: string): Promise<string[]> {
    // Get users whose hierarchyPath includes managerId
    const usersSnap = await db.collection('users')
        .where('hierarchyPath', 'array-contains', managerId)
        .get();

    const ids: string[] = [];
    for (const doc of usersSnap.docs) {
        if (doc.id !== managerId) { // Exclude self
            ids.push(doc.id);
        }
    }
    return ids;
}

// ═══════════════════════════════════════════════════════════
// getTeamTaskOverview — for managers
// ═══════════════════════════════════════════════════════════

export const getTeamTaskOverview = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    }

    const managerId = context.auth.uid;
    const subordinateIds = await getSubordinateIds(managerId);

    if (subordinateIds.length === 0) {
        return { team: [], summary: { totalTasks: 0, totalOverdue: 0 } };
    }

    const teamMembers: TeamMemberSummary[] = [];
    let totalTasks = 0;
    let totalOverdue = 0;
    const now = new Date();

    // Process each subordinate
    for (const subId of subordinateIds) {
        const userDoc = await db.collection('users').doc(subId).get();
        if (!userDoc.exists) continue;
        const userData = userDoc.data()!;

        // Get tasks owned by or assigned to this subordinate
        const [ownedSnap, assignedSnap] = await Promise.all([
            db.collection('gtd_tasks')
                .where('ownerId', '==', subId)
                .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'pending_approval'])
                .get(),
            db.collection('gtd_tasks')
                .where('assigneeId', '==', subId)
                .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'pending_approval'])
                .get(),
        ]);

        // Merge and deduplicate
        const taskMap = new Map<string, any>();
        ownedSnap.docs.forEach(d => taskMap.set(d.id, d.data()));
        assignedSnap.docs.forEach(d => taskMap.set(d.id, d.data()));

        const taskCounts: Record<string, number> = {};
        let overdueCount = 0;
        let activeCount = 0;

        for (const [, taskData] of taskMap) {
            const status = taskData.status || 'inbox';
            taskCounts[status] = (taskCounts[status] || 0) + 1;

            if (status === 'next_action') activeCount++;

            // Check overdue
            if (taskData.dueDate) {
                try {
                    const dd = taskData.dueDate.toDate ? taskData.dueDate.toDate() : new Date(taskData.dueDate);
                    if (dd < now) overdueCount++;
                } catch (_) { /* ignore */ }
            }
        }

        const totalOpen = taskMap.size;
        totalTasks += totalOpen;
        totalOverdue += overdueCount;

        teamMembers.push({
            userId: subId,
            displayName: userData.displayName || 'Worker',
            department: userData.department,
            title: userData.title,
            taskCounts,
            overdueCount,
            activeCount,
            totalOpen,
        });
    }

    // Sort: most overdue first, then most tasks
    teamMembers.sort((a, b) => {
        if (a.overdueCount !== b.overdueCount) return b.overdueCount - a.overdueCount;
        return b.totalOpen - a.totalOpen;
    });

    return {
        team: teamMembers,
        summary: { totalTasks, totalOverdue, teamSize: teamMembers.length },
    };
});

// ═══════════════════════════════════════════════════════════
// Bot helper: format team overview for Telegram
// ═══════════════════════════════════════════════════════════

export async function getTeamOverviewForBot(managerId: string): Promise<{
    text: string;
    teamMembers: Array<{ userId: string; name: string; totalOpen: number; overdue: number }>;
}> {
    const subordinateIds = await getSubordinateIds(managerId);

    if (subordinateIds.length === 0) {
        return { text: '👥 *Команда:*\n\n_Нет подчинённых в системе._\n\nНастройте иерархию в CRM.', teamMembers: [] };
    }

    const now = new Date();
    let totalTasks = 0;
    let totalOverdue = 0;
    const lines: string[] = ['👥 *Обзор команды:*\n'];
    const teamMembers: Array<{ userId: string; name: string; totalOpen: number; overdue: number }> = [];

    for (const subId of subordinateIds) {
        const userDoc = await db.collection('users').doc(subId).get();
        if (!userDoc.exists) continue;
        const userData = userDoc.data()!;

        const tasksSnap = await db.collection('gtd_tasks')
            .where('ownerId', '==', subId)
            .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'pending_approval'])
            .get();

        let overdue = 0;
        let nextAction = 0;

        for (const doc of tasksSnap.docs) {
            const task = doc.data();
            if (task.status === 'next_action') nextAction++;
            if (task.dueDate) {
                try {
                    const dd = task.dueDate.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
                    if (dd < now) overdue++;
                } catch (_) { /* ignore */ }
            }
        }

        totalTasks += tasksSnap.size;
        totalOverdue += overdue;

        const name = userData.displayName || 'Worker';
        const overdueStr = overdue > 0 ? ` ⚠️${overdue}` : '';
        const wip = nextAction > 5 ? ' 🔴WIP' : '';

        lines.push(`👤 *${name}*: ${tasksSnap.size} задач (▶️${nextAction})${overdueStr}${wip}`);

        teamMembers.push({ userId: subId, name, totalOpen: tasksSnap.size, overdue });
    }

    lines.push(`\n📊 Всего: ${totalTasks} задач | ⚠️ ${totalOverdue} просрочено`);

    return { text: lines.join('\n'), teamMembers };
}

// ═══════════════════════════════════════════════════════════
// getUnassignedTasks — tasks without assignee (for self-assign pool)
// ═══════════════════════════════════════════════════════════

export async function getUnassignedTasksForBot(userId: string): Promise<{
    text: string;
    tasks: Array<{ id: string; title: string; priority: string }>;
}> {
    // Get tasks in next_action or inbox without assignee, in same company
    const userDoc = await db.collection('users').doc(userId).get();
    const companyId = userDoc.data()?.companyId;

    if (!companyId) {
        return { text: '❌ Компания не найдена.', tasks: [] };
    }

    // Query unassigned tasks (where assigneeId is null and status is active)
    const tasksSnap = await db.collection('gtd_tasks')
        .where('status', 'in', ['inbox', 'next_action'])
        .limit(20)
        .get();

    const unassigned = tasksSnap.docs
        .filter(d => !d.data().assigneeId && d.data().ownerId !== userId)
        .slice(0, 10);

    if (unassigned.length === 0) {
        return { text: '📭 *Свободных задач нет.*\n\nВсе задачи назначены.', tasks: [] };
    }

    const PRIORITY_EMOJI: Record<string, string> = { high: '🔴', medium: '🟠', low: '🔵', none: '⚪' };

    let msg = '📋 *Свободные задачи (без исполнителя):*\n\n';
    const tasks: Array<{ id: string; title: string; priority: string }> = [];

    for (const doc of unassigned) {
        const task = doc.data();
        const emoji = PRIORITY_EMOJI[task.priority || 'none'];
        msg += `${emoji} ${task.title}\n`;
        if (task.clientName) msg += `   🏢 ${task.clientName}\n`;
        msg += '\n';

        tasks.push({ id: doc.id, title: task.title, priority: task.priority || 'none' });
    }

    return { text: msg, tasks };
}

// ═══════════════════════════════════════════════════════════
// suggestAssignee — workload-based suggestion
// ═══════════════════════════════════════════════════════════

export async function suggestAssignee(managerId: string, taskId: string): Promise<{
    suggestions: Array<{ userId: string; name: string; activeCount: number; reason: string }>;
}> {
    const subordinateIds = await getSubordinateIds(managerId);
    if (subordinateIds.length === 0) return { suggestions: [] };

    const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
    const taskData = taskDoc.data();

    const suggestions: Array<{ userId: string; name: string; activeCount: number; reason: string }> = [];

    for (const subId of subordinateIds) {
        const userDoc = await db.collection('users').doc(subId).get();
        if (!userDoc.exists) continue;
        const userData = userDoc.data()!;

        // Count active tasks for workload
        const activeSnap = await db.collection('gtd_tasks')
            .where('assigneeId', '==', subId)
            .where('status', '==', 'next_action')
            .get();

        let reason = `${activeSnap.size} задач в работе`;

        // Department match bonus
        if (taskData?.phaseTag && userData.department === 'construction') {
            reason += ' | строительство';
        }

        suggestions.push({
            userId: subId,
            name: userData.displayName || 'Worker',
            activeCount: activeSnap.size,
            reason,
        });
    }

    // Sort by least loaded
    suggestions.sort((a, b) => a.activeCount - b.activeCount);

    return { suggestions: suggestions.slice(0, 5) };
}

// ═══════════════════════════════════════════════════════════
// Shift handoff — daily summary per worker
// ═══════════════════════════════════════════════════════════

export async function getShiftHandoffSummary(managerId: string): Promise<string> {
    const subordinateIds = await getSubordinateIds(managerId);
    if (subordinateIds.length === 0) return '👥 Нет подчинённых.';

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = admin.firestore.Timestamp.fromDate(todayStart);

    let msg = '📋 *Итоги дня:*\n\n';
    let anyActivity = false;

    for (const subId of subordinateIds) {
        const userDoc = await db.collection('users').doc(subId).get();
        if (!userDoc.exists) continue;
        const name = userDoc.data()?.displayName || 'Worker';

        // Get sessions today
        const sessionsSnap = await db.collection('work_sessions')
            .where('employeeId', '==', subId)
            .where('status', '==', 'completed')
            .get();

        // Filter to today's sessions
        const todaySessions = sessionsSnap.docs.filter(d => {
            const start = d.data().startTime?.toDate?.();
            return start && start >= todayStart;
        });

        // Get tasks completed today
        const completedSnap = await db.collection('gtd_tasks')
            .where('ownerId', '==', subId)
            .where('status', '==', 'done')
            .where('completedAt', '>=', todayTimestamp)
            .get();

        if (todaySessions.length === 0 && completedSnap.size === 0) continue;

        anyActivity = true;
        let totalMinutes = 0;
        let totalEarnings = 0;

        for (const doc of todaySessions) {
            const s = doc.data();
            const start = s.startTime?.toDate?.();
            const end = s.endTime?.toDate?.();
            if (start && end) {
                totalMinutes += Math.round((end.getTime() - start.getTime()) / 60000);
            }
            totalEarnings += s.sessionEarnings || 0;
        }

        const hours = Math.round(totalMinutes / 60 * 10) / 10;
        msg += `👤 *${name}*\n`;
        msg += `   ⏱ ${hours}ч | 💰 $${totalEarnings.toFixed(0)} | ✅ ${completedSnap.size} задач\n`;

        // Show completed task titles
        if (completedSnap.size > 0) {
            const titles = completedSnap.docs.slice(0, 3).map(d => d.data().title || 'Task');
            titles.forEach(t => { msg += `   • ${t}\n`; });
        }
        msg += '\n';
    }

    if (!anyActivity) {
        msg += '_Нет активности за сегодня._';
    }

    return msg;
}
