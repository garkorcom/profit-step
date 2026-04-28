/**
 * Session Manager for Telegram Worker Bot
 *
 * Extracted from onWorkerBotMessage.ts for modularity.
 * Handles: session init, finalize, pause/resume, extend, auto-finish, daily stats.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import { sendMessage, getActiveSession, sendMainMenu, findPlatformUser, logBotAction, dedupeEmployeeIdVariants } from '../telegramUtils';
import { resolveHourlyRate } from '../rateUtils';
import { sendAdminNotification } from './profileHandlers';
import {
    calculatePayrollBuckets,
    isReportableSession,
} from '../../../modules/finance';

const db = admin.firestore();

export async function initWorkSession(chatId: number, userId: number, clientId: string, serviceName?: string) {
    // 1. Check if already active
    const activeSession = await getActiveSession(userId);
    let autoSwitchMsg = '';

    if (activeSession) {
        // AUTO-SWITCH: Finish the active session automatically
        autoSwitchMsg = await autoFinishActiveSession(activeSession, chatId, userId);
    }

    // 2. Get Client Name
    const clientDoc = await db.collection('clients').doc(clientId).get();
    let clientName = clientDoc.exists ? clientDoc.data()?.name : 'Unknown Client';

    if (serviceName) {
        clientName = `${clientName} - ${serviceName}`;
    }

    // 3. Identity Sync & Rate Resolution
    const { hourlyRate, platformUser, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

    if (platformUser) {
        // Sync local employee record to match platform name
        await db.collection('employees').doc(String(userId)).set({
            name: employeeName,
            telegramId: userId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    // 4. Create Session (Pending Location)
    // Use Timestamp.now() instead of serverTimestamp() to avoid race condition:
    // getActiveSession() queries with orderBy('startTime') — serverTimestamp sentinel
    // value may not be resolved yet, causing "Ты не на смене" ghost message.
    const sessionRef = await db.collection('work_sessions').add({
        employeeId: userId,
        employeeName: employeeName,
        platformUserId: platformUserId, // Link to platform user
        companyId: companyId,           // Link to company
        clientId: clientId,
        clientName: clientName,
        startTime: admin.firestore.Timestamp.now(),
        status: 'active',
        service: serviceName || null,
        awaitingLocation: true,
        hourlyRate: hourlyRate, // Snapshot rate
        taskId: null,
        taskTitle: null
    });

    await logBotAction(userId, userId, 'session_created', { sessionId: sessionRef.id, clientId, clientName });
    logger.info(`[${employeeName}] ▶️ Work Started — ${clientName}`);

    // ─── hourlyRate = 0 warning ───
    if (!hourlyRate) {
        await sendMessage(chatId, '⚠️ Внимание! Ваша почасовая ставка не установлена ($0/ч). Пожалуйста, свяжитесь с руководителем для уточнения.');
    }

    // ZERO-BLOCK: Immediately send the main menu keyboard (Break / Finish Work)
    // so the user is never blocked, even while waiting for location.
    await sendMainMenu(chatId, userId);

    await sendMessage(chatId, `${autoSwitchMsg}📍 Client selected: *${clientName}*\n\nPlease share your **Live Location** or current **Location** to verify attendance.\n(Click the 📎 attachment icon -> Location)`,
        {
            keyboard: [[{ text: "📍 Send Location", request_location: true }], [{ text: "⏩ Пропустить (Слабый интернет)" }, { text: "❌ Cancel" }]],
            resize_keyboard: true
        }
    );
    await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started*\n📍 ${clientName}`);
}

export async function finalizeSession(chatId: number, userId: number, activeSession: any, description: string) {
    const sessionData = activeSession.data();
    let endTime = admin.firestore.Timestamp.now();
    const startTime = sessionData.startTime;

    let hourlyRate = sessionData.hourlyRate;

    // FAILSAFE: If no snapshot rate (old session), resolve from profile
    // Fix 2 (Wave 2): Guard against $0/hr when profile is deleted
    let rateWarning = '';
    if (hourlyRate === undefined || hourlyRate === null || hourlyRate === 0) {
        const rateResult = await resolveHourlyRate(userId);
        hourlyRate = rateResult.hourlyRate;

        if (hourlyRate === 0 || isNaN(hourlyRate) || hourlyRate < 0) {
            hourlyRate = 0;
            rateWarning = 'Ставка $0 — профиль не найден или некорректная ставка';
        }

        // Update the session with this rate so we have it for history
        await activeSession.ref.update({ hourlyRate: hourlyRate });
    }

    // Calculate duration (minus breaks if any)
    let totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);

    // --- HANDLE OPEN BREAK (Finish while Paused) ---
    let currentBreakMinutes = 0;
    let adjustmentApplied = false;

    if (sessionData.status === 'paused' && sessionData.lastBreakStart) {
        const breakStart = sessionData.lastBreakStart;

        // FIX (Anti-Gamble): If finishing while paused, actual work ended when the break started.
        // We rollback endTime to lastBreakStart and don't count the inactive period.
        endTime = breakStart;

        // Recalculate total elapsed time since endTime was modified
        totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);

        // We do not add actualBreakMinutes because the shift officially ends at breakStart
        currentBreakMinutes = 0;
    }

    let existingBreaks = sessionData.totalBreakMinutes || 0;
    let totalDeductibleBreak = existingBreaks + currentBreakMinutes;

    totalMinutes -= totalDeductibleBreak;

    // --- Message Customization ---
    let extraMessage = "";
    if (adjustmentApplied) {
        extraMessage = `\n⚠️ **Авто-коррекция**: Перерыв был ограничен 1ч (вместо ${Math.floor((sessionData.lastBreakStart ? (endTime.toMillis() - sessionData.lastBreakStart.toMillis()) / 60000 : 0) / 60)}ч).`;
    }

    // Prepare Update Data
    // Fix 4 (Wave 2): Limit description length to prevent Firestore bloat
    const safeDescription = description.substring(0, 2000);

    const updateData: any = {
        description: safeDescription,
        endTime: endTime,
        durationMinutes: totalMinutes,
        sessionEarnings: 0, // calc below
        status: 'completed',
        updatedBySource: 'telegram_bot', // Prevents duplicate notification from onWorkSessionUpdate trigger
        awaitingDescription: false,
        totalBreakMinutes: totalDeductibleBreak // Update this to reflect the final break
    };

    // Fix 2 (Wave 2): Flag zero-rate sessions for admin review
    if (rateWarning) {
        updateData.needsAdjustment = true;
        updateData.rateWarning = rateWarning;
    }

    if (adjustmentApplied) {
        updateData.needsAdjustment = true;
        updateData.autoCorrectedBreak = true;

        // Also add the break record
        updateData.breaks = admin.firestore.FieldValue.arrayUnion({
            start: sessionData.lastBreakStart,
            end: endTime,
            durationMinutes: currentBreakMinutes,
            autoAdjusted: true,
            note: "Closed on finish"
        });
    } else if (currentBreakMinutes > 0) {
        // Normal break close
        updateData.breaks = admin.firestore.FieldValue.arrayUnion({
            start: sessionData.lastBreakStart,
            end: endTime,
            durationMinutes: currentBreakMinutes,
            note: "Closed on finish"
        });
    }

    // Flag cleared
    updateData.lastBreakStart = admin.firestore.FieldValue.delete();
    updateData.breakNotificationSent = admin.firestore.FieldValue.delete();

    // ... continue calculation

    // Sanity check
    if (totalMinutes < 0) totalMinutes = 0;

    // --- Calculate Earnings ---
    const hours = parseFloat((totalMinutes / 60).toFixed(2));
    const sessionEarnings = parseFloat((hours * hourlyRate).toFixed(2));

    // Update earnings in updateData
    updateData.sessionEarnings = sessionEarnings;

    // --- Calculate Daily Totals ---
    const dailyStats = await calculateDailyStats(userId, totalMinutes, sessionEarnings);
    const dailyHours = Math.floor(dailyStats.minutes / 60);
    const dailyMins = dailyStats.minutes % 60;

    // Fix 1 (Deep Testing): Use Firestore Transaction to prevent cron vs worker race condition
    // If cron has already closed this session, abort gracefully instead of overwriting
    try {
        await admin.firestore().runTransaction(async (transaction) => {
            const sessionRef = admin.firestore().collection('work_sessions').doc(activeSession.id);
            const freshDoc = await transaction.get(sessionRef);
            if (!freshDoc.exists) {
                throw new Error('SESSION_DELETED');
            }
            const freshData = freshDoc.data()!;
            if (freshData.status === 'completed') {
                throw new Error('SESSION_ALREADY_CLOSED');
            }
            transaction.update(sessionRef, updateData);
        });
    } catch (txError: any) {
        if (txError.message === 'SESSION_ALREADY_CLOSED' || txError.message === 'SESSION_DELETED') {
            logger.warn(`⚠️ Session ${activeSession.id} was already closed (cron race). User ${userId} notified.`);
            await sendMessage(chatId, '⚠️ Эта смена уже была автоматически закрыта системой. Данные отчёта сохранены. Обратись к админу, если нужна корректировка.');
            await sendMainMenu(chatId, userId);
            return;
        }
        throw txError; // Re-throw unexpected errors
    }

    // BUG-6 fix: Calculate salary balance from work_sessions (3 buckets: earned/paid/adjustments)
    // BUG-6b fix: Query by BOTH Telegram ID and platform UID to catch
    // payments/adjustments created from Web CRM (which uses platform UID).
    //
    // 2026-04-20: switched from inline calculation to the shared helpers in
    // `functions/src/modules/finance`. These mirror the web UI's
    // `src/modules/finance/services/payroll.ts` — so the bot and the
    // FinancePage show IDENTICAL numbers for the same worker (previously
    // drifted, see safety matrix #23/32/33 and the Алексей screenshot).
    //
    // Also changed: the query used to filter `status == 'completed'` which
    // silently dropped `auto_closed` sessions (worker walked off without
    // pressing Finish, cron auto-closes at 48h). Now fetch ALL sessions
    // since yearStart and filter in-memory via `isReportableSession` — one
    // code path, zero drift.
    let balanceInfo = '';
    try {
        const yearStart = new Date(new Date().getFullYear(), 0, 1);
        const yearStartTs = admin.firestore.Timestamp.fromDate(yearStart);

        // Bot writes employeeId as a NUMBER (Telegram chat id); Web / agent-API
        // writes it as a STRING (Firebase UID). Both coexist in prod and Firestore
        // is type-strict on equality. A naive `.map(String)` dedupe drops the
        // numeric variant — see calculateDailyStats below for the same dual-type
        // pattern that already worked. dedupeEmployeeIdVariants preserves type.
        const idVariants: (string | number)[] = [userId, String(userId)];
        const platformUser = await findPlatformUser(userId);
        if (platformUser?.id) {
            idVariants.push(platformUser.id);
        }
        const uniqueIds = dedupeEmployeeIdVariants(idVariants);

        const queries = uniqueIds.map(id =>
            admin.firestore().collection('work_sessions')
                .where('employeeId', '==', id)
                .where('startTime', '>=', yearStartTs)
                .get()
        );
        const snapshots = await Promise.all(queries);

        // Dedup by doc id — same worker may appear under Telegram id and UID
        // during the migration window; their sessions are distinct docs.
        const docsMap = new Map<string, any>();
        snapshots.forEach(snap => {
            snap.docs.forEach(d => {
                if (!docsMap.has(d.id)) docsMap.set(d.id, d.data());
            });
        });

        // Use the canonical filter + bucket calc that the Web UI uses.
        // See `functions/src/modules/finance/services/payroll.ts`.
        const reportable = Array.from(docsMap.values()).filter(data =>
            isReportableSession({ type: data.type, status: data.status })
        );
        const buckets = calculatePayrollBuckets(reportable);

        // NOTE: Legacy 'payments' collection is NOT queried here. Payments
        // are stored as work_sessions with type='payment'. Querying both
        // caused double-counting (BUG fix 2026-04-15).

        balanceInfo =
            `\n💚 Баланс ЗП: $${buckets.balance.toFixed(2)}` +
            `\n📊 Начислено с начала года: $${buckets.salary.toFixed(2)}` +
            `\nВыплачено: $${buckets.payments.toFixed(2)}`;
    } catch (e) {
        console.error('Balance calc error:', e);
    }

    // V2: Time-of-day flavor + Russian (BUG-7 fix: use ET timezone)
    const { toZonedTime } = require('date-fns-tz');
    const localNow = toZonedTime(new Date(), 'America/New_York');
    const finishHour = localNow.getHours();
    const finishGreeting = finishHour >= 17 ? '🌙 Отличная работа!' : '🏁 Смена завершена!';

    // BUG-1 fix: Don't show "Описание не указано" in summary
    const descDisplay = safeDescription === 'Описание не указано' ? '' : `\n📝 ${safeDescription}`;
    await sendMessage(chatId, `${finishGreeting}\n\n⏱ Сессия: ${Math.floor(totalMinutes / 60)}ч ${totalMinutes % 60}мин\n💰 Заработано: $${sessionEarnings}\n💵 Ставка: $${hourlyRate}/ч\n📅 *За сегодня: ${dailyHours}ч ${dailyMins}мин ($${dailyStats.earnings.toFixed(2)})*\n📍 Объект: ${sessionData.clientName}${descDisplay}${extraMessage}\n\n${balanceInfo}`);

    logger.info(`[${sessionData.employeeName}] 🏁 Work Finished — ${sessionData.clientName} (${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m, $${sessionEarnings})`);

    // Fix 8 (Wave 2): Sanitize user-generated text in admin notifications
    const sanitizedDesc = safeDescription.replace(/[*_`\[\]()~>#+\-=|{}.!]/g, '').substring(0, 500);
    await sendAdminNotification(`👤 *${sessionData.employeeName}:*\n🏁 *Work Finished*\n📍 ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}\n📝 ${sanitizedDesc}`);

    // BUG-2 fix: Send keyboard without "ты не на смене" ghost message
    await sendMessage(chatId, "👇 Главное меню:", {
        keyboard: [
            [{ text: '▶️ Начать смену' }],
            [{ text: '📊 Мой статус' }, { text: '❓ Помощь' }],
            [{ text: '🛒 Shopping' }, { text: '📥 Inbox' }],
            [{ text: '📋 Tasks' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    });
}

export async function pauseWorkSession(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены для паузы.");
        await sendMainMenu(chatId, userId);
        return;
    }

    // Add a break entry
    const now = admin.firestore.Timestamp.now();
    await activeSession.ref.update({
        status: 'paused',
        lastBreakStart: now
    });

    await sendMessage(chatId, "☕ Перерыв начат! Нажми «▶️ Продолжить работу» когда вернёшься.");
    await sendMainMenu(chatId, userId); // Update buttons
}

export async function resumeWorkSession(chatId: number, userId: number) {
    // Use getActiveSession with cross-lookup (checks both telegramId and Firebase UID)
    // This matches pauseWorkSession which also uses getActiveSession
    const session = await getActiveSession(userId);

    if (!session || session.data()?.status !== 'paused') {
        await sendMessage(chatId, "⚠️ Нет смены на паузе.");
        await sendMainMenu(chatId, userId);
        return;
    }

    const data = session.data();
    const now = admin.firestore.Timestamp.now();

    // Calculate break duration
    const breakStart = data.lastBreakStart;
    let breakDurationMinutes = 0;
    if (breakStart) {
        breakDurationMinutes = Math.round((now.toMillis() - breakStart.toMillis()) / 60000);
    }

    // --- AUTO-CORRECTION LOGIC ---
    let adjustedBreakMinutes = breakDurationMinutes;
    let adjustmentApplied = false;
    const BREAK_LIMIT = 60; // Configurable limit

    if (breakDurationMinutes > BREAK_LIMIT) {
        // User forgot to resume? Cap at limit, count rest as work.
        adjustedBreakMinutes = BREAK_LIMIT;
        adjustmentApplied = true;
    }

    const updateData: any = {
        status: 'active',
        lastBreakStart: admin.firestore.FieldValue.delete(), // Remove temp field
        breakNotificationSent: admin.firestore.FieldValue.delete(), // clear flag
        breaks: admin.firestore.FieldValue.arrayUnion({
            start: breakStart,
            end: now,
            durationMinutes: adjustedBreakMinutes, // Use adjusted
            originalDuration: breakDurationMinutes,
            autoAdjusted: adjustmentApplied
        }),
        totalBreakMinutes: admin.firestore.FieldValue.increment(adjustedBreakMinutes)
    };

    if (adjustmentApplied) {
        updateData.needsAdjustment = true; // Flag for admin
        updateData.autoCorrectedBreak = true;
    }

    await session.ref.update(updateData);

    if (adjustmentApplied) {
        await sendMessage(chatId, `⚠️ **Корректировка перерыва**\nВаш перерыв длился ${Math.floor(breakDurationMinutes / 60)}ч ${breakDurationMinutes % 60}м.\nМы засчитали стандартный перерыв (1ч), остальное время пошло в работу.\n\n▶️ Работа возобновлена.`);
    } else {
        await sendMessage(chatId, `▶️ Работа возобновлена. Перерыв: ${breakDurationMinutes}м.`);
    }

    await sendMainMenu(chatId, userId);
}

export async function extendSession(chatId: number, userId: number, minutes: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) return;

    const snoozeUntil = admin.firestore.Timestamp.fromMillis(Date.now() + (minutes * 60000));

    await activeSession.ref.update({
        reminderCount: 0, // Reset counter
        snoozeUntil: snoozeUntil
    });

    await sendMessage(chatId, `✅ Reminder snoozed for ${minutes} minutes.`);
}

export async function autoFinishActiveSession(activeSession: FirebaseFirestore.QueryDocumentSnapshot, chatId: number, userId: number): Promise<string> {
    const sessionData = activeSession.data();
    const endTime = admin.firestore.Timestamp.now();
    const startTime = sessionData.startTime;

    // Determine hourly rate (snapshot or full resolution)
    let hourlyRate = sessionData.hourlyRate;
    if (hourlyRate === undefined || hourlyRate === null || hourlyRate === 0) {
        const rateResult = await resolveHourlyRate(userId);
        hourlyRate = rateResult.hourlyRate;
        await activeSession.ref.update({ hourlyRate: hourlyRate });
    }

    // Calculate duration
    let totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);
    if (sessionData.totalBreakMinutes) {
        totalMinutes -= sessionData.totalBreakMinutes;
    }
    // Safety check just in case
    if (totalMinutes < 0) totalMinutes = 0;

    // Calculate Earnings
    const hours = parseFloat((totalMinutes / 60).toFixed(2));
    const sessionEarnings = parseFloat((hours * hourlyRate).toFixed(2));

    await activeSession.ref.update({
        description: `Auto-switched to new task (Bot)`,
        endTime: endTime,
        durationMinutes: totalMinutes,
        sessionEarnings: sessionEarnings,
        status: 'completed',
        awaitingDescription: false,
        awaitingEndPhoto: false,
        awaitingLocation: false
    });

    // Notify admin
    await sendAdminNotification(`👤 *${sessionData.employeeName}:*\n🔄 *Auto-Switch*\n📍 Closed: ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}`);

    return `⚠️ Previous session closed (${sessionData.clientName}).\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m  |  💵 Earned: $${sessionEarnings}\n\n`;
}

/**
 * Calculates daily work statistics for a user.
 *
 * Searches for completed sessions using BOTH:
 * - Telegram ID (number) - for bot-created sessions
 * - Firebase UID (string) - for Web UI-created sessions
 *
 * Uses user's configured timezone to determine "today" boundaries.
 * Falls back to UTC if timezone not configured.
 *
 * @param userId - Telegram user ID
 * @param currentSessionMinutes - Minutes from currently active session (if any)
 * @param currentSessionEarnings - Earnings from currently active session (if any)
 * @param chatId - Chat ID for error messages (optional)
 * @returns Object with total minutes and earnings for today
 */
export async function calculateDailyStats(userId: number, currentSessionMinutes = 0, currentSessionEarnings = 0, chatId: number | null = null) {
    let timezone = 'America/New_York';
    let platformUserId: string | null = null;

    // Fetch user's timezone preference
    try {
        const platformUser = await findPlatformUser(userId);
        if (platformUser) {
            platformUserId = platformUser.id;
            if (platformUser.timezone) {
                timezone = platformUser.timezone;
            }
        }

        // Fallback to employees collection for timezone
        // Fallback to employees collection if platformUser had no timezone
        if (!platformUser?.timezone) {
            const empDoc = await db.collection('employees').doc(String(userId)).get();
            if (empDoc.exists && empDoc.data()?.timezone) {
                timezone = empDoc.data()?.timezone;
            }
        }
    } catch (e) {
        console.error("Error fetching user timezone:", e);
    }

    const now = new Date();
    const searchStart = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48h lookback for timezone safety

    let dailyMinutes = currentSessionMinutes;
    let dailyEarnings = currentSessionEarnings;

    // Build array of IDs to search (supports legacy sessions with different ID types)
    const searchIds: any[] = [userId];
    if (platformUserId) searchIds.push(platformUserId);

    try {
        const potentialSessions = await db.collection('work_sessions')
            .where('employeeId', 'in', searchIds)
            .where('status', '==', 'completed')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(searchStart))
            .orderBy('endTime', 'desc')
            .get();

        // Filter sessions by "today" in user's timezone
        const todayString = now.toLocaleDateString('en-US', { timeZone: timezone });

        potentialSessions.docs.forEach(doc => {
            const d = doc.data();
            if (!d.endTime) return;

            const sDate = d.endTime.toDate();
            const sDateStr = sDate.toLocaleDateString('en-US', { timeZone: timezone });

            if (sDateStr === todayString) {
                dailyMinutes += (d.durationMinutes || 0);
                dailyEarnings += (d.sessionEarnings || 0);
            }
        });
    } catch (e: any) {
        console.error("Error calculating daily totals:", e);
        if (chatId) {
            await sendMessage(chatId, `⚠️ Daily Stats Error: ${e.message}`);
        }
    }

    return { minutes: dailyMinutes, earnings: dailyEarnings };
}
