/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 🚨 PROD-CRITICAL — time-tracking / finance module                        ║
 * ║                                                                          ║
 * ║ DO NOT MODIFY without explicit approval from Denis in chat.              ║
 * ║                                                                          ║
 * ║ This file participates in real workers' hours and money calculation.   ║
 * ║ A one-line firestore.rules tightening without code/index/backfill        ║
 * ║ companions caused the 6-hour outage of incident 2026-04-28.              ║
 * ║                                                                          ║
 * ║ Before touching this file:                                               ║
 * ║   1. Read ~/.claude/projects/-Users-denysharbuzov-Projects-profit-step/  ║
 * ║      memory/feedback_no_touch_time_finance.md                            ║
 * ║   2. Get explicit "ok" from Denis IN THE CURRENT SESSION.                ║
 * ║   3. If RLS-related: plan backfill + code-audit + indexes + deploy order ║
 * ║      together (see feedback_rls_three_part_change.md).                   ║
 * ║   4. Run functions/scripts/backup-finance-and-time.js BEFORE any write.  ║
 * ║                                                                          ║
 * ║ "Just refactoring / cleaning up / adding types" is NOT a reason to       ║
 * ║ skip step 2. Stop and ask first.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { subDays, startOfDay, endOfDay } from 'date-fns';

const db = admin.firestore();

// Florida timezone — all workers are in Florida
const TIME_ZONE = 'America/New_York';

export const generateDailyPayroll = functions.pubsub.schedule('0 4 * * *') // Every day at 4:00 AM Florida time
    .timeZone(TIME_ZONE)
    .onRun(async (_context) => {
        console.log('💰 Running generateDailyPayroll...');

        const now = admin.firestore.Timestamp.now();

        // 1. Determine "Yesterday" range in Florida time
        const nowUtc = new Date();
        const nowInFlorida = toZonedTime(nowUtc, TIME_ZONE);
        const yesterdayFlorida = subDays(nowInFlorida, 1);

        // Start and end of yesterday in Florida time
        const startOfYesterdayFlorida = startOfDay(yesterdayFlorida);
        const endOfYesterdayFlorida = endOfDay(yesterdayFlorida);

        // Convert back to UTC for Firestore query
        const yesterday = fromZonedTime(startOfYesterdayFlorida, TIME_ZONE);
        const endOfYesterday = fromZonedTime(endOfYesterdayFlorida, TIME_ZONE);

        // Idempotency key: one payroll run per calendar day (Florida)
        const y = yesterdayFlorida.getFullYear();
        const m = String(yesterdayFlorida.getMonth() + 1).padStart(2, '0');
        const d = String(yesterdayFlorida.getDate()).padStart(2, '0');
        const payrollDateKey = `${y}-${m}-${d}`;

        // 2. Fetch Completed/Auto-Closed Sessions for Yesterday (Florida time)
        // We use 'endTime' to determine which day the money belongs to
        const startTimestamp = admin.firestore.Timestamp.fromDate(yesterday);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endOfYesterday);

        console.log(`📅 Server Now (UTC): ${nowUtc.toISOString()}`);
        console.log(`📅 Florida Now: ${nowInFlorida.toString()}`);
        console.log(`📅 Yesterday Florida: ${startOfYesterdayFlorida.toString()} — ${endOfYesterdayFlorida.toString()}`);
        console.log(`📅 Query Range (UTC): ${yesterday.toISOString()} — ${endOfYesterday.toISOString()}`);
        console.log(`📅 Payroll date key: ${payrollDateKey}`);

        try {
            // ── Idempotency guard ────────────────────────────────────
            const idempRef = db.collection('payroll_runs').doc(payrollDateKey);
            const idempSnap = await idempRef.get();

            if (idempSnap.exists) {
                console.log(`⚠️ Payroll for ${payrollDateKey} already processed. Skipping.`);
                return null;
            }

            // ── Query sessions ───────────────────────────────────────
            const sessionsSnapshot = await db.collection('work_sessions')
                .where('status', 'in', ['completed', 'auto_closed'])
                .where('endTime', '>=', startTimestamp)
                .where('endTime', '<=', endTimestamp)
                .get();

            if (sessionsSnapshot.empty) {
                console.log('✅ No completed sessions found for yesterday.');
                // Still mark as processed so we don't retry
                await idempRef.set({
                    date: payrollDateKey,
                    processedAt: now,
                    sessionsProcessed: 0,
                    ledgerEntriesCreated: 0,
                    sessionEarningsUpdated: 0,
                });
                return null;
            }

            // 3. Fetch All Employees & Users to get Hourly Rates
            // MERGE: We check 'users' collection first, then fallback to 'employees' (legacy)
            const [usersSnapshot, employeesSnapshot] = await Promise.all([
                db.collection('users').get(),
                db.collection('employees').get()
            ]);

            const employeeRates: Record<string, number> = {};

            // Priority 1: Users (Platform Profiles)
            usersSnapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.hourlyRate) {
                    employeeRates[doc.id] = data.hourlyRate;
                    // Map by telegramId if exists to support linking
                    if (data.telegramId) {
                        employeeRates[data.telegramId] = data.hourlyRate;
                    }
                }
            });

            // Priority 2: Employees (Legacy/Bot-only) - Only set if not already set
            employeesSnapshot.docs.forEach(doc => {
                const data = doc.data();
                const rate = data.hourlyRate || 0;

                // Key by Telegram ID
                if (!employeeRates[data.telegramId]) {
                    employeeRates[data.telegramId] = rate;
                }
                // Key by Doc ID
                if (!employeeRates[doc.id]) {
                    employeeRates[doc.id] = rate;
                }
            });

            // 4. Calculate Payroll & Create Ledger Entries
            // Firestore batch limit = 500 operations. Split if needed.
            const MAX_BATCH_OPS = 450; // leave headroom
            let batch = db.batch();
            let batchOps = 0;
            let ledgerCount = 0;
            let earningsUpdated = 0;

            for (const doc of sessionsSnapshot.docs) {
                const session = doc.data();
                const employeeId = String(session.employeeId);
                const rate = employeeRates[employeeId] || 0;

                // Calculate Hours
                const durationMinutes = session.durationMinutes || 0;
                const paidHours = parseFloat((durationMinutes / 60).toFixed(2));
                const totalAmount = parseFloat((paidHours * rate).toFixed(2));

                // Create Ledger Entry
                const ledgerRef = db.collection('payroll_ledger').doc();
                batch.set(ledgerRef, {
                    type: 'work_session',
                    date: admin.firestore.Timestamp.fromDate(yesterday),
                    processedAt: now,
                    payrollDate: payrollDateKey,

                    employeeId: session.employeeId,
                    employeeName: session.employeeName,

                    sessionId: doc.id,
                    clientId: session.clientId || null,
                    clientName: session.clientName || 'Unknown',

                    durationMinutes: durationMinutes,
                    hours: paidHours,
                    hourlyRate: rate,
                    amount: totalAmount,

                    description: `Shift at ${session.clientName || 'Unknown'}`,
                });
                batchOps++;
                ledgerCount++;

                // Safety net: update sessionEarnings on the work_session if it's
                // missing or zero (e.g., auto_closed sessions, or sessions where
                // the bot failed to calculate earnings).
                const existingEarnings = session.sessionEarnings || 0;
                if (existingEarnings === 0 && totalAmount > 0) {
                    batch.update(doc.ref, {
                        sessionEarnings: totalAmount,
                        sessionEarningsSource: 'payroll_backfill',
                    });
                    batchOps++;
                    earningsUpdated++;
                }

                // Commit batch if approaching limit
                if (batchOps >= MAX_BATCH_OPS) {
                    await batch.commit();
                    batch = db.batch();
                    batchOps = 0;
                }
            }

            // Commit remaining operations
            if (batchOps > 0) {
                await batch.commit();
            }

            // 5. Mark payroll run as completed (idempotency)
            await idempRef.set({
                date: payrollDateKey,
                processedAt: now,
                sessionsProcessed: sessionsSnapshot.size,
                ledgerEntriesCreated: ledgerCount,
                sessionEarningsUpdated: earningsUpdated,
            });

            console.log(`✅ Generated payroll for ${payrollDateKey}: ${ledgerCount} ledger records, ${earningsUpdated} sessionEarnings backfilled.`);

        } catch (error) {
            console.error('❌ Error generating payroll:', error);
        }

        return null;
    });
