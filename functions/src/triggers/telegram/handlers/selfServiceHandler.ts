/**
 * @fileoverview Self-Service Bot Commands
 *
 * Worker self-service: /mybalance, /myhours, /mypay
 * Eliminates the #1 admin bottleneck: "how much am I owed?"
 *
 * Reference: Workyard, BusyBusy — every construction payroll app has this.
 */

import * as admin from 'firebase-admin';
import { sendMessage } from '../telegramUtils';

const db = admin.firestore();

/**
 * Resolve all employee ID variants for a Telegram user.
 * Returns [telegramIdStr, firebaseUid?]
 */
async function resolveEmployeeIds(userId: number): Promise<string[]> {
    const ids: string[] = [String(userId)];

    // Check if this telegramId maps to a Firebase UID
    const usersSnap = await db.collection('users')
        .where('telegramId', '==', String(userId))
        .limit(1)
        .get();

    if (!usersSnap.empty) {
        ids.push(usersSnap.docs[0].id);
    }

    return ids;
}

/**
 * /myweek — Weekly summary (Case 36)
 */
export async function handleMyWeek(chatId: number, userId: number): Promise<void> {
    try {
        const empIds = await resolveEmployeeIds(userId);

        // Calculate current week (Monday-Sunday)
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now);
        monday.setDate(now.getDate() - daysToMonday);
        monday.setHours(0, 0, 0, 0);

        const sessionsSnap = await db.collection('work_sessions')
            .where('startTime', '>=', admin.firestore.Timestamp.fromDate(monday))
            .get();

        let totalMinutes = 0;
        let totalEarnings = 0;
        let tasksCompleted = 0;
        const projects: Record<string, { minutes: number; earnings: number }> = {};
        const dailyHours: number[] = [0, 0, 0, 0, 0, 0, 0];

        for (const doc of sessionsSnap.docs) {
            const data = doc.data();
            if (data.isVoided) continue;
            if (data.type === 'payment' || data.type === 'correction') continue;
            if (!empIds.includes(String(data.employeeId))) continue;

            const minutes = data.durationMinutes || 0;
            const earnings = data.sessionEarnings || 0;
            totalMinutes += minutes;
            totalEarnings += earnings;

            const projName = data.clientName || 'Unknown';
            if (!projects[projName]) projects[projName] = { minutes: 0, earnings: 0 };
            projects[projName].minutes += minutes;
            projects[projName].earnings += earnings;

            const endDate = data.endTime?.toDate?.() || data.startTime?.toDate?.();
            if (endDate) {
                const idx = endDate.getDay() === 0 ? 6 : endDate.getDay() - 1;
                dailyHours[idx] += minutes / 60;
            }
        }

        // Count completed tasks this week
        try {
            const tasksSnap = await db.collection('gtd_tasks')
                .where('completedAt', '>=', admin.firestore.Timestamp.fromDate(monday))
                .where('completedBy', 'in', empIds)
                .get();
            tasksCompleted = tasksSnap.size;
        } catch (_) { /* ignore */ }

        const totalH = Math.floor(totalMinutes / 60);
        const totalM = totalMinutes % 60;

        let msg = `📊 *Итоги недели*\n\n`;

        // Daily bar chart
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        for (let i = 0; i < 7; i++) {
            const h = dailyHours[i];
            if (h > 0) {
                const bars = '█'.repeat(Math.min(Math.round(h), 12));
                msg += `${dayNames[i]}  ${bars}  ${h.toFixed(1)}h\n`;
            }
        }

        msg += `\n`;

        // Per-project breakdown
        for (const [name, data] of Object.entries(projects)) {
            const pH = Math.floor(data.minutes / 60);
            const pM = data.minutes % 60;
            msg += `📍 ${name}: ${pH}ч${pM}мин  $${data.earnings.toFixed(2)}\n`;
        }

        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `⏱ Часы: *${totalH}ч ${totalM}мин*\n`;
        msg += `💰 Заработано: *$${totalEarnings.toFixed(2)}*\n`;
        if (tasksCompleted > 0) {
            msg += `✅ Задач выполнено: *${tasksCompleted}*\n`;
        }

        const remaining = 40 * 60 - totalMinutes;
        if (remaining > 0) {
            const rH = Math.floor(remaining / 60);
            const rM = remaining % 60;
            msg += `\n⏳ До 40ч: ${rH}ч ${rM}мин`;
        }

        await sendMessage(chatId, msg);
    } catch (error) {
        console.error('[selfServiceHandler] myweek error:', error);
        await sendMessage(chatId, '❌ Ошибка загрузки итогов недели.');
    }
}

/**
 * /mybalance — YTD salary balance
 */
export async function handleMyBalance(chatId: number, userId: number): Promise<void> {
    try {
        const empIds = await resolveEmployeeIds(userId);
        const yearStart = new Date(new Date().getFullYear(), 0, 1);

        // Query all sessions for this employee YTD
        const sessionsSnap = await db.collection('work_sessions')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(yearStart))
            .get();

        let earned = 0;
        let payments = 0;
        let lastPaymentDate = '';
        let lastPaymentMethod = '';
        let lastPaymentAmount = 0;

        for (const doc of sessionsSnap.docs) {
            const data = doc.data();
            if (data.isVoided) continue;
            if (!empIds.includes(String(data.employeeId))) continue;

            if (data.type === 'payment') {
                const amt = Math.abs(data.sessionEarnings || 0);
                payments += amt;
                // Track last payment
                const payDate = data.startTime?.toDate?.();
                if (payDate) {
                    const dateStr = payDate.toLocaleDateString('en-US');
                    if (!lastPaymentDate || payDate > new Date(lastPaymentDate)) {
                        lastPaymentDate = dateStr;
                        lastPaymentAmount = amt;
                        lastPaymentMethod = data.paymentMethod || '';
                    }
                }
            } else if (data.type !== 'correction' || !data.description?.startsWith('VOID REF:')) {
                earned += (data.sessionEarnings || 0);
            }
        }

        const balance = earned - payments;

        // Check PO balance
        let poBalance = 0;
        let openAdvances = 0;
        try {
            const advSnap = await db.collection('advance_accounts')
                .where('status', '==', 'open')
                .get();
            const myAdvances = advSnap.docs.filter(d => empIds.includes(String(d.data().employeeId)));
            openAdvances = myAdvances.length;

            if (myAdvances.length > 0) {
                const txSnap = await db.collection('advance_transactions')
                    .where('status', '==', 'active')
                    .get();
                for (const adv of myAdvances) {
                    const spent = txSnap.docs
                        .filter(t => t.data().advanceId === adv.id)
                        .reduce((sum, t) => sum + (t.data().amount || 0), 0);
                    poBalance += (adv.data().amount || 0) - spent;
                }
            }
        } catch (e) {
            // Non-fatal
        }

        const methodLabels: Record<string, string> = {
            cash: 'Cash', check: 'Check', direct_deposit: 'Direct Deposit', zelle: 'Zelle',
        };

        let msg = `💰 *Баланс ЗП*\n\n`;
        msg += `📊 Начислено (YTD):  *$${earned.toFixed(2)}*\n`;
        msg += `💸 Выплачено (YTD):  *$${payments.toFixed(2)}*\n`;
        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `💚 К выплате:  *$${balance.toFixed(2)}*\n`;

        if (lastPaymentDate) {
            msg += `\n📅 Последняя выплата: $${lastPaymentAmount.toFixed(2)}`;
            msg += ` (${lastPaymentDate}`;
            if (lastPaymentMethod) msg += `, ${methodLabels[lastPaymentMethod] || lastPaymentMethod}`;
            msg += `)`;
        }

        if (openAdvances > 0) {
            msg += `\n\n📦 Баланс ПО: *$${poBalance.toFixed(2)}* (${openAdvances} аванс${openAdvances > 1 ? 'ов' : ''})`;
        }

        await sendMessage(chatId, msg);
    } catch (error) {
        console.error('[selfServiceHandler] mybalance error:', error);
        await sendMessage(chatId, '❌ Ошибка загрузки баланса. Попробуйте позже.');
    }
}

/**
 * /myhours — Hours this week with daily breakdown
 */
export async function handleMyHours(chatId: number, userId: number): Promise<void> {
    try {
        const empIds = await resolveEmployeeIds(userId);

        // Calculate current week (Monday-Sunday)
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now);
        monday.setDate(now.getDate() - daysToMonday);
        monday.setHours(0, 0, 0, 0);

        const sessionsSnap = await db.collection('work_sessions')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(monday))
            .get();

        // Aggregate by day
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const dailyHours: number[] = [0, 0, 0, 0, 0, 0, 0];
        const dailyProjects: string[][] = [[], [], [], [], [], [], []];
        let weekTotal = 0;

        for (const doc of sessionsSnap.docs) {
            const data = doc.data();
            if (data.isVoided) continue;
            if (data.type === 'payment' || data.type === 'correction') continue;
            if (!empIds.includes(String(data.employeeId))) continue;

            const endDate = data.endTime?.toDate?.();
            if (!endDate) continue;

            const dayIdx = endDate.getDay() === 0 ? 6 : endDate.getDay() - 1; // Mon=0, Sun=6
            const hours = (data.durationMinutes || 0) / 60;

            dailyHours[dayIdx] += hours;
            weekTotal += hours;

            const proj = data.clientName || 'Unknown';
            if (!dailyProjects[dayIdx].includes(proj)) {
                dailyProjects[dayIdx].push(proj);
            }
        }

        let msg = `⏱ *Часы за неделю*\n\n`;

        for (let i = 0; i < 7; i++) {
            const isToday = i === (now.getDay() === 0 ? 6 : now.getDay() - 1);
            const hours = dailyHours[i];
            const projects = dailyProjects[i].join(', ');

            if (hours > 0) {
                msg += `${isToday ? '➡️' : '  '} ${dayNames[i]}:  *${hours.toFixed(1)}h*`;
                if (projects) msg += `  _${projects}_`;
                msg += `\n`;
            } else if (isToday) {
                msg += `➡️ ${dayNames[i]}:  (сегодня)\n`;
            }
        }

        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 Итого:  *${weekTotal.toFixed(1)}h*\n`;

        const remaining = 40 - weekTotal;
        if (remaining > 0) {
            msg += `⏳ До 40h:  ${remaining.toFixed(1)}h`;
        } else {
            msg += `⚠️ Сверх 40h:  ${Math.abs(remaining).toFixed(1)}h`;
        }

        await sendMessage(chatId, msg);
    } catch (error) {
        console.error('[selfServiceHandler] myhours error:', error);
        await sendMessage(chatId, '❌ Ошибка загрузки часов. Попробуйте позже.');
    }
}

/**
 * /mypay — Last period pay stub (text format)
 */
export async function handleMyPay(chatId: number, userId: number): Promise<void> {
    try {
        const empIds = await resolveEmployeeIds(userId);

        // Last closed period
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const periodStart = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
        const periodEnd = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59, 999);

        const sessionsSnap = await db.collection('work_sessions')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(periodStart))
            .where('endTime', '<=', admin.firestore.Timestamp.fromDate(periodEnd))
            .get();

        // Aggregate
        let gross = 0;
        let totalHours = 0;
        let totalPaid = 0;
        let deductions = 0;
        const projects: Record<string, { hours: number; amount: number; rate: number }> = {};
        const paymentsList: { date: string; amount: number; method: string }[] = [];

        for (const doc of sessionsSnap.docs) {
            const data = doc.data();
            if (data.isVoided) continue;
            if (!empIds.includes(String(data.employeeId))) continue;

            if (data.type === 'payment') {
                const amt = Math.abs(data.sessionEarnings || 0);
                totalPaid += amt;
                const d = data.startTime?.toDate?.();
                paymentsList.push({
                    date: d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?',
                    amount: amt,
                    method: data.paymentMethod || '',
                });
            } else if (data.type === 'manual_adjustment' && data.clientId === 'advance_deduction') {
                deductions += Math.abs(data.sessionEarnings || 0);
            } else if (data.type !== 'correction' || !data.description?.startsWith('VOID REF:')) {
                const earnings = data.sessionEarnings || 0;
                const hours = (data.durationMinutes || 0) / 60;
                gross += earnings;
                totalHours += hours;

                const proj = data.clientName || 'Unknown';
                if (!projects[proj]) projects[proj] = { hours: 0, amount: 0, rate: data.hourlyRate || 0 };
                projects[proj].hours += hours;
                projects[proj].amount += earnings;
            }
        }

        const netPay = gross - deductions;
        const balance = netPay - totalPaid;

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthLabel = `${monthNames[lastMonth.getMonth()]} ${lastMonth.getFullYear()}`;

        let msg = `📃 *Расчётный лист: ${monthLabel}*\n\n`;
        msg += `*НАЧИСЛЕНИЯ:*\n`;

        for (const [name, data] of Object.entries(projects)) {
            msg += `  ${name}: ${data.hours.toFixed(1)}h × $${data.rate} = $${data.amount.toFixed(2)}\n`;
        }

        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `💰 GROSS:  *$${gross.toFixed(2)}*\n`;

        if (deductions > 0) {
            msg += `\n*ВЫЧЕТЫ:*\n`;
            msg += `  Аванс (PO):  -$${deductions.toFixed(2)}\n`;
            msg += `━━━━━━━━━━━━━━━━━━\n`;
            msg += `💵 NET:  *$${netPay.toFixed(2)}*\n`;
        }

        if (paymentsList.length > 0) {
            msg += `\n*ВЫПЛАТЫ:*\n`;
            const methodLabels: Record<string, string> = {
                cash: 'Cash', check: 'Check', direct_deposit: 'DD', zelle: 'Zelle',
            };
            for (const p of paymentsList) {
                msg += `  ${p.date}: -$${p.amount.toFixed(2)}`;
                if (p.method) msg += ` (${methodLabels[p.method] || p.method})`;
                msg += `\n`;
            }
        }

        msg += `━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 Остаток: *$${balance.toFixed(2)}*`;

        await sendMessage(chatId, msg);
    } catch (error) {
        console.error('[selfServiceHandler] mypay error:', error);
        await sendMessage(chatId, '❌ Ошибка загрузки расчётного листа. Попробуйте позже.');
    }
}

/**
 * /switchproject — Switch to different project without full stop/start cycle
 */
export async function handleSwitchProject(chatId: number, userId: number): Promise<void> {
    try {
        // Check active session
        const sessionsSnap = await db.collection('work_sessions')
            .where('employeeId', '==', userId)
            .where('status', 'in', ['active', 'paused'])
            .limit(1)
            .get();

        // Also check by string ID
        let activeSession = sessionsSnap.empty ? null : sessionsSnap.docs[0];
        if (!activeSession) {
            const sessionsSnap2 = await db.collection('work_sessions')
                .where('employeeId', '==', String(userId))
                .where('status', 'in', ['active', 'paused'])
                .limit(1)
                .get();
            activeSession = sessionsSnap2.empty ? null : sessionsSnap2.docs[0];
        }

        if (!activeSession) {
            await sendMessage(chatId, '⚠️ У вас нет активной смены. Начните смену сначала.');
            return;
        }

        const sessionData = activeSession.data();
        const elapsed = Math.floor((Date.now() - (sessionData.startTime?.toMillis?.() || Date.now())) / 60000);
        const h = Math.floor(elapsed / 60);
        const m = elapsed % 60;

        // Fetch available clients
        const clientsSnap = await db.collection('clients')
            .where('status', '==', 'active')
            .orderBy('name')
            .limit(15)
            .get();

        if (clientsSnap.empty) {
            await sendMessage(chatId, '❌ Нет доступных проектов.');
            return;
        }

        const buttons = clientsSnap.docs
            .filter(d => d.id !== sessionData.clientId) // Exclude current project
            .map(d => ([{
                text: d.data().name || d.id,
                callback_data: `switch_project:${d.id}`,
            }]));

        buttons.push([{ text: '❌ Отмена', callback_data: 'switch_project:cancel' }]);

        await sendMessage(chatId,
            `🔄 *Переключить проект*\n\n` +
            `Текущий: *${sessionData.clientName}* (${h}ч ${m}мин)\n\n` +
            `Выбери новый проект:`,
            { inline_keyboard: buttons }
        );
    } catch (error) {
        console.error('[selfServiceHandler] switchProject error:', error);
        await sendMessage(chatId, '❌ Ошибка. Попробуйте позже.');
    }
}

/**
 * Handle switch_project callback
 */
export async function handleSwitchProjectCallback(
    chatId: number,
    userId: number,
    clientId: string,
    callbackQueryId: string
): Promise<void> {
    if (clientId === 'cancel') {
        await sendMessage(chatId, '✅ Отменено. Продолжай работу.');
        return;
    }

    try {
        // Find active session
        const sessionsSnap = await db.collection('work_sessions')
            .where('employeeId', 'in', [userId, String(userId)])
            .where('status', 'in', ['active', 'paused'])
            .limit(1)
            .get();

        if (sessionsSnap.empty) {
            await sendMessage(chatId, '⚠️ Активная сессия не найдена.');
            return;
        }

        const oldSession = sessionsSnap.docs[0];
        const oldData = oldSession.data();
        const now = admin.firestore.Timestamp.now();
        const nowDate = new Date();

        // Calculate old session duration
        const startMs = oldData.startTime?.toMillis?.() || nowDate.getTime();
        let totalMinutes = Math.floor((nowDate.getTime() - startMs) / 60000);
        totalMinutes -= (oldData.totalBreakMinutes || 0);
        if (totalMinutes < 0) totalMinutes = 0;

        const rate = oldData.hourlyRate || 0;
        const hours = totalMinutes / 60;
        const earnings = parseFloat((hours * rate).toFixed(2));

        // Close old session
        await oldSession.ref.update({
            status: 'completed',
            endTime: now,
            durationMinutes: totalMinutes,
            sessionEarnings: earnings,
            description: `Switched to another project (auto-closed)`,
            switchedToProject: clientId,
        });

        // Get new client info
        const clientDoc = await db.collection('clients').doc(clientId).get();
        const clientName = clientDoc.exists ? (clientDoc.data()?.name || clientId) : clientId;

        // Create new session (skip checklist, photo, voice — worker is already on-site)
        const newSessionRef = db.collection('work_sessions').doc();
        await newSessionRef.set({
            employeeId: oldData.employeeId,
            employeeName: oldData.employeeName,
            platformUserId: oldData.platformUserId || null,
            companyId: oldData.companyId || null,
            clientId: clientId,
            clientName: clientName,
            startTime: now,
            status: 'active',
            hourlyRate: rate,
            source: 'telegram_bot',
            // Skip all setup steps — worker already verified
            awaitingLocation: false,
            awaitingChecklist: false,
            awaitingStartPhoto: false,
            awaitingStartVoice: false,
            switchedFromProject: oldData.clientId,
            switchedFromSessionId: oldSession.id,
        });

        const oldH = Math.floor(totalMinutes / 60);
        const oldM = totalMinutes % 60;

        await sendMessage(chatId,
            `🔄 *Проект переключён!*\n\n` +
            `✅ ${oldData.clientName}: ${oldH}ч ${oldM}мин ($${earnings.toFixed(2)})\n` +
            `▶️ *${clientName}*: таймер запущен\n\n` +
            `Удачной работы!`
        );

        // Case 22: Offer travel time logging if switching to different project
        if (oldData.clientId !== clientId) {
            await sendMessage(chatId,
                `🚗 Время в пути?`,
                {
                    inline_keyboard: [
                        [
                            { text: '15мин', callback_data: `log_travel:${oldData.clientId}:${clientId}:15` },
                            { text: '30мин', callback_data: `log_travel:${oldData.clientId}:${clientId}:30` },
                            { text: '45мин', callback_data: `log_travel:${oldData.clientId}:${clientId}:45` },
                        ],
                        [{ text: '⏭ Пропустить', callback_data: 'log_travel:skip' }],
                    ]
                }
            );
        }

    } catch (error) {
        console.error('[selfServiceHandler] switchProjectCallback error:', error);
        await sendMessage(chatId, '❌ Ошибка переключения проекта.');
    }
}

/**
 * Case 22: Log travel time between projects
 */
export async function handleLogTravelCallback(
    chatId: number,
    userId: number,
    data: string
): Promise<void> {
    if (data === 'skip') {
        await sendMessage(chatId, '⏭ Принято.');
        return;
    }

    try {
        const parts = data.split(':');
        const fromClientId = parts[0];
        const toClientId = parts[1];
        const travelMinutes = parseInt(parts[2]);

        // Resolve names
        const fromDoc = await db.collection('clients').doc(fromClientId).get();
        const toDoc = await db.collection('clients').doc(toClientId).get();
        const fromName = fromDoc.data()?.name || fromClientId;
        const toName = toDoc.data()?.name || toClientId;

        // Resolve employee info
        let empName = 'Worker';
        let empRate = 0;
        try {
            const empDoc = await db.collection('employees').doc(String(userId)).get();
            if (empDoc.exists) empName = empDoc.data()?.name || empName;
        } catch (_) { /* ignore */ }

        // Get rate from latest session
        const latestSnap = await db.collection('work_sessions')
            .where('employeeId', 'in', [userId, String(userId)])
            .where('status', '==', 'active')
            .limit(1)
            .get();
        if (!latestSnap.empty) {
            empRate = latestSnap.docs[0].data().hourlyRate || 0;
        }

        const earnings = parseFloat(((travelMinutes / 60) * empRate).toFixed(2));

        // Create travel session
        const now = admin.firestore.Timestamp.now();
        const startTime = new admin.firestore.Timestamp(
            now.seconds - (travelMinutes * 60), now.nanoseconds
        );

        await db.collection('work_sessions').add({
            employeeId: userId,
            employeeName: empName,
            clientId: 'travel',
            clientName: `🚗 ${fromName} → ${toName}`,
            startTime: startTime,
            endTime: now,
            status: 'completed',
            type: 'travel',
            durationMinutes: travelMinutes,
            sessionEarnings: earnings,
            hourlyRate: empRate,
            source: 'telegram_bot',
            fromProjectId: fromClientId,
            toProjectId: toClientId,
        });

        await sendMessage(chatId,
            `🚗 Дорога: *${travelMinutes}мин* (${fromName} → ${toName})\n` +
            `💰 $${earnings.toFixed(2)}`
        );
    } catch (error) {
        console.error('[selfServiceHandler] logTravel error:', error);
        await sendMessage(chatId, '❌ Ошибка записи.');
    }
}
