/**
 * @fileoverview Phase 5 — Task Financial Operations
 *
 * Callable functions for task-level financial tracking:
 * - getTaskFinancials: get P&L summary for a task
 * - linkCostToTask: link an existing cost/receipt to a task
 * - linkShoppingToTask: link a shopping list purchase to a task
 * - getTaskBurnRate: estimated vs actual time/cost analysis
 *
 * Spec: Phase 5 of Tasks v2 plan
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// ═══════════════════════════════════════════════════════════
// getTaskFinancials — P&L summary for a single task
// ═══════════════════════════════════════════════════════════

export const getTaskFinancials = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    }

    const { taskId } = data;
    if (!taskId) {
        throw new functions.https.HttpsError('invalid-argument', 'taskId required');
    }

    const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
    if (!taskDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Task not found');
    }

    const task = taskDoc.data()!;

    // Get linked work sessions
    const sessionsSnap = await db.collection('work_sessions')
        .where('relatedTaskId', '==', taskId)
        .get();

    let totalTimeMinutes = 0;
    let totalLaborCost = 0;
    const sessionDetails: any[] = [];

    for (const doc of sessionsSnap.docs) {
        const s = doc.data();
        if (s.status === 'completed') {
            const start = s.startTime?.toDate?.() || new Date(s.startTime);
            const end = s.endTime?.toDate?.() || new Date(s.endTime);
            const mins = Math.round((end.getTime() - start.getTime()) / 60000);
            const earnings = s.sessionEarnings || (mins / 60 * (s.hourlyRate || 0));

            totalTimeMinutes += mins;
            totalLaborCost += earnings;

            sessionDetails.push({
                sessionId: doc.id,
                employeeName: s.employeeName || 'Worker',
                minutes: mins,
                earnings: Math.round(earnings * 100) / 100,
                date: s.endTime?.toDate?.()?.toISOString(),
            });
        }
    }

    // Get linked costs/purchases
    const costsSnap = await db.collection('costs')
        .where('linkedTaskId', '==', taskId)
        .get();

    let totalMaterialsCost = 0;
    const costDetails: any[] = [];

    for (const doc of costsSnap.docs) {
        const c = doc.data();
        const amount = c.amount || c.totalPrice || 0;
        totalMaterialsCost += amount;

        costDetails.push({
            costId: doc.id,
            description: c.description || c.item || 'Cost',
            amount: Math.round(amount * 100) / 100,
            vendor: c.vendor || '',
            date: c.createdAt?.toDate?.()?.toISOString(),
        });
    }

    // Calculate P&L
    const budgetAmount = task.budgetAmount || 0;
    const totalCost = totalLaborCost + totalMaterialsCost;
    const profit = budgetAmount - totalCost;
    const budgetUsedPercent = budgetAmount > 0 ? Math.round((totalCost / budgetAmount) * 100) : 0;

    // Estimate vs actual
    const estimatedMinutes = task.estimatedDurationMinutes || 0;
    const timeOverrun = estimatedMinutes > 0
        ? Math.round(((totalTimeMinutes - estimatedMinutes) / estimatedMinutes) * 100)
        : 0;

    return {
        taskId,
        title: task.title,
        budget: {
            budgetAmount: Math.round(budgetAmount * 100) / 100,
            totalCost: Math.round(totalCost * 100) / 100,
            laborCost: Math.round(totalLaborCost * 100) / 100,
            materialsCost: Math.round(totalMaterialsCost * 100) / 100,
            profit: Math.round(profit * 100) / 100,
            budgetUsedPercent,
        },
        time: {
            estimatedMinutes,
            actualMinutes: totalTimeMinutes,
            overrunPercent: timeOverrun,
        },
        sessions: sessionDetails,
        costs: costDetails,
    };
});

// ═══════════════════════════════════════════════════════════
// linkCostToTask — associate an existing cost with a task
// ═══════════════════════════════════════════════════════════

export const linkCostToTask = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Auth required');
    }

    const { costId, taskId } = data;
    if (!costId || !taskId) {
        throw new functions.https.HttpsError('invalid-argument', 'costId and taskId required');
    }

    // Update cost document with task link
    await db.collection('costs').doc(costId).update({
        linkedTaskId: taskId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Get cost amount and update task's materialsCostActual
    const costDoc = await db.collection('costs').doc(costId).get();
    const costAmount = costDoc.data()?.amount || costDoc.data()?.totalPrice || 0;

    if (costAmount > 0) {
        await db.collection('gtd_tasks').doc(taskId).update({
            materialsCostActual: admin.firestore.FieldValue.increment(costAmount),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    return { success: true, linkedAmount: costAmount };
});

// ═══════════════════════════════════════════════════════════
// Bot helper: get task financial summary for Telegram display
// ═══════════════════════════════════════════════════════════

export async function getTaskFinancialSummary(taskId: string): Promise<string> {
    const taskDoc = await db.collection('gtd_tasks').doc(taskId).get();
    if (!taskDoc.exists) return '❌ Задача не найдена.';

    const task = taskDoc.data()!;

    // Get sessions for this task
    const sessionsSnap = await db.collection('work_sessions')
        .where('relatedTaskId', '==', taskId)
        .where('status', '==', 'completed')
        .get();

    let totalTimeMinutes = 0;
    let totalLaborCost = 0;

    for (const doc of sessionsSnap.docs) {
        const s = doc.data();
        const start = s.startTime?.toDate?.() || new Date(s.startTime);
        const end = s.endTime?.toDate?.() || new Date(s.endTime);
        const mins = Math.round((end.getTime() - start.getTime()) / 60000);
        totalTimeMinutes += mins;
        totalLaborCost += s.sessionEarnings || (mins / 60 * (s.hourlyRate || 0));
    }

    // Get linked costs
    const costsSnap = await db.collection('costs')
        .where('linkedTaskId', '==', taskId)
        .get();

    let totalMaterialsCost = 0;
    for (const doc of costsSnap.docs) {
        totalMaterialsCost += doc.data()?.amount || doc.data()?.totalPrice || 0;
    }

    // Use task-level stored values (from Phase 5 sync) or calculated
    const timeSpent = task.totalTimeSpentMinutes || totalTimeMinutes;
    const laborCost = task.totalEarnings || totalLaborCost;
    const materialsCost = task.materialsCostActual || totalMaterialsCost;
    const totalCost = laborCost + materialsCost;
    const budget = task.budgetAmount || 0;

    const timeH = Math.floor(timeSpent / 60);
    const timeM = timeSpent % 60;

    let msg = '💰 *Финансы задачи:*\n\n';

    // Time
    const estimated = task.estimatedDurationMinutes || 0;
    if (estimated > 0) {
        const estH = Math.floor(estimated / 60);
        const estM = estimated % 60;
        const ratio = timeSpent / estimated;
        const statusEmoji = ratio > 2 ? '🔴' : ratio > 1.2 ? '🟠' : '🟢';
        msg += `⏱ Время: ${timeH}ч ${timeM}м / ${estH}ч ${estM}м ${statusEmoji}\n`;
    } else {
        msg += `⏱ Время: ${timeH}ч ${timeM}м\n`;
    }

    // Costs
    if (laborCost > 0) msg += `👷 Работа: $${laborCost.toFixed(2)}\n`;
    if (materialsCost > 0) msg += `📦 Материалы: $${materialsCost.toFixed(2)}\n`;
    msg += `💵 Итого: *$${totalCost.toFixed(2)}*\n`;

    // Budget
    if (budget > 0) {
        const pct = Math.round((totalCost / budget) * 100);
        const bar = '█'.repeat(Math.min(Math.round(pct / 10), 10)) + '░'.repeat(Math.max(10 - Math.round(pct / 10), 0));
        const emoji = pct > 100 ? '🔴' : pct > 80 ? '🟠' : '🟢';
        msg += `\n📊 Бюджет: ${bar} ${pct}% ${emoji}\n`;
        msg += `💰 Бюджет: $${budget.toFixed(2)} | Остаток: $${(budget - totalCost).toFixed(2)}\n`;
    }

    if (sessionsSnap.size === 0 && costsSnap.size === 0) {
        msg += '\n_Нет записей о работе или расходах._';
    } else {
        msg += `\n📋 Сессий: ${sessionsSnap.size} | Расходов: ${costsSnap.size}`;
    }

    return msg;
}
