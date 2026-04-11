/**
 * @fileoverview Daily Payroll Generator
 *
 * Runs daily at 4:00 AM ET — creates payroll_ledger entries
 * from yesterday's completed work sessions.
 *
 * Fixes applied (2026-04-10):
 * - B3: Idempotency via deterministic doc ID (session_{sessionId})
 * - B4: Timezone fix — uses America/New_York, not UTC
 * - B5: Uses session's own sessionEarnings when available
 * - B9: Skips auto_closed sessions awaiting admin review
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Florida timezone — all workers are in Florida
const TIME_ZONE = 'America/New_York';

export const generateDailyPayroll = functions.pubsub.schedule('0 4 * * *')
    .timeZone(TIME_ZONE) // B4 fix: use ET, not UTC
    .onRun(async () => {
        console.log('💰 Running generateDailyPayroll...');

        // B4 fix: Calculate "yesterday" in Florida time
        // At 4:00 AM ET, "yesterday" is straightforward — no DST edge case
        const nowMs = Date.now();
        // Get current ET offset by creating a date string in ET
        const etFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: TIME_ZONE,
            year: 'numeric', month: '2-digit', day: '2-digit',
        });
        const parts = etFormatter.formatToParts(new Date(nowMs));
        const year = parseInt(parts.find(p => p.type === 'year')!.value);
        const month = parseInt(parts.find(p => p.type === 'month')!.value);
        const day = parseInt(parts.find(p => p.type === 'day')!.value);

        // Yesterday in ET
        const todayET = new Date(year, month - 1, day);
        const yesterdayET = new Date(todayET);
        yesterdayET.setDate(yesterdayET.getDate() - 1);

        // Build start/end of yesterday in ET, then convert to UTC for Firestore
        // Start: yesterday 00:00:00 ET
        const startET = new Date(yesterdayET.getFullYear(), yesterdayET.getMonth(), yesterdayET.getDate(), 0, 0, 0, 0);
        // End: yesterday 23:59:59.999 ET
        const endET = new Date(yesterdayET.getFullYear(), yesterdayET.getMonth(), yesterdayET.getDate(), 23, 59, 59, 999);

        // These Date objects are in local server time (UTC in Cloud Functions).
        // We need to adjust for ET offset. Since we extracted ET date components,
        // we construct UTC timestamps by adding the ET-to-UTC offset.
        // ET is UTC-5 (EST) or UTC-4 (EDT). Use Intl to determine offset.
        const getETOffsetMs = (date: Date): number => {
            const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
            const etStr = date.toLocaleString('en-US', { timeZone: TIME_ZONE });
            return new Date(utcStr).getTime() - new Date(etStr).getTime();
        };

        const etOffset = getETOffsetMs(new Date(nowMs));
        const startUTC = new Date(startET.getTime() + etOffset);
        const endUTC = new Date(endET.getTime() + etOffset);

        const startTimestamp = admin.firestore.Timestamp.fromDate(startUTC);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endUTC);

        console.log(`Yesterday ET: ${yesterdayET.toISOString().slice(0, 10)}`);
        console.log(`Query range (UTC): ${startUTC.toISOString()} — ${endUTC.toISOString()}`);

        try {
            // Use endTime to determine which day work belongs to (consistent with closePayrollPeriod)
            const sessionsSnapshot = await db.collection('work_sessions')
                .where('status', 'in', ['completed', 'auto_closed'])
                .where('endTime', '>=', startTimestamp)
                .where('endTime', '<=', endTimestamp)
                .get();

            if (sessionsSnapshot.empty) {
                console.log('✅ No completed sessions found for yesterday.');
                return null;
            }

            // Fetch employee hourly rates for fallback calculation
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
                    if (data.telegramId) {
                        employeeRates[String(data.telegramId)] = data.hourlyRate;
                    }
                }
            });

            // Priority 2: Employees (Legacy/Bot-only) — fallback
            employeesSnapshot.docs.forEach(doc => {
                const data = doc.data();
                const rate = data.hourlyRate || 0;
                if (data.telegramId && !employeeRates[String(data.telegramId)]) {
                    employeeRates[String(data.telegramId)] = rate;
                }
                if (!employeeRates[doc.id]) {
                    employeeRates[doc.id] = rate;
                }
            });

            const batch = db.batch();
            const now = admin.firestore.Timestamp.now();
            let operationsCount = 0;
            let skippedCount = 0;

            for (const doc of sessionsSnapshot.docs) {
                const session = doc.data();

                // B9 fix: skip auto_closed sessions awaiting admin review
                if (session.status === 'auto_closed' && session.requiresAdminReview) {
                    console.log(`Skipping auto-closed session ${doc.id} — awaiting admin review`);
                    skippedCount++;
                    continue;
                }

                // Skip voided sessions
                if (session.isVoided) {
                    skippedCount++;
                    continue;
                }

                const employeeId = String(session.employeeId);
                const rate = employeeRates[employeeId] || 0;
                const durationMinutes = session.durationMinutes || 0;
                const paidHours = parseFloat((durationMinutes / 60).toFixed(2));

                // B5 fix: use session's own earnings if available (calculated at close time with correct rate)
                // Fallback to rate * hours only if sessionEarnings is missing
                const totalAmount = (session.sessionEarnings != null && session.sessionEarnings !== 0)
                    ? parseFloat(Number(session.sessionEarnings).toFixed(2))
                    : parseFloat((paidHours * rate).toFixed(2));

                // Skip zero-amount entries (no rate, no earnings)
                if (totalAmount === 0 && rate === 0) {
                    console.log(`Skipping session ${doc.id} — no rate or earnings`);
                    skippedCount++;
                    continue;
                }

                // B3 fix: deterministic doc ID prevents duplicates on retry
                const ledgerRef = db.collection('payroll_ledger').doc(`session_${doc.id}`);
                batch.set(ledgerRef, {
                    type: 'work_session',
                    date: admin.firestore.Timestamp.fromDate(startUTC), // The day work was done (ET)
                    processedAt: now,

                    employeeId: session.employeeId,
                    employeeName: session.employeeName,

                    sessionId: doc.id,
                    clientId: session.clientId || null,
                    clientName: session.clientName || 'Unknown',

                    durationMinutes: durationMinutes,
                    hours: paidHours,
                    hourlyRate: session.hourlyRate || rate,
                    amount: totalAmount,

                    description: `Shift at ${session.clientName || 'Unknown'}`
                }, { merge: true }); // merge ensures re-runs update instead of fail

                operationsCount++;
            }

            if (operationsCount > 0) {
                await batch.commit();
            }

            // Update cached running balances on user documents
            // Aggregate earnings per employee from this batch, then increment
            const earningsByEmployee: Record<string, number> = {};
            for (const doc of sessionsSnapshot.docs) {
                const session = doc.data();
                if (session.isVoided) continue;
                if (session.status === 'auto_closed' && session.requiresAdminReview) continue;
                if (session.type === 'correction' || session.type === 'manual_adjustment' || session.type === 'payment') continue;

                const eid = String(session.employeeId);
                const rate = employeeRates[eid] || 0;
                const dm = session.durationMinutes || 0;
                const ph = parseFloat((dm / 60).toFixed(2));
                const amt = (session.sessionEarnings != null && session.sessionEarnings !== 0)
                    ? parseFloat(Number(session.sessionEarnings).toFixed(2))
                    : parseFloat((ph * rate).toFixed(2));
                if (amt === 0 && rate === 0) continue;

                earningsByEmployee[eid] = (earningsByEmployee[eid] || 0) + amt;
            }

            // Increment runningBalance for each employee (separate batches to avoid size limit)
            const balanceBatch = db.batch();
            let balanceOps = 0;
            for (const [eid, amount] of Object.entries(earningsByEmployee)) {
                // Try to find user doc by employee ID (could be telegramId)
                const userRef = db.collection('users').doc(eid);
                balanceBatch.set(userRef, {
                    runningBalance: admin.firestore.FieldValue.increment(amount),
                    runningBalanceUpdatedAt: admin.firestore.Timestamp.now(),
                }, { merge: true });
                balanceOps++;
            }
            if (balanceOps > 0) {
                await balanceBatch.commit();
                console.log(`💰 Updated running balances for ${balanceOps} employees.`);
            }

            console.log(`✅ Generated payroll: ${operationsCount} records created, ${skippedCount} skipped.`);

        } catch (error) {
            console.error('❌ Error generating payroll:', error);
        }

        return null;
    });
