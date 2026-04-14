import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { subDays, startOfDay, endOfDay } from 'date-fns';

const db = admin.firestore();

// Florida timezone — all workers are in Florida
const TIME_ZONE = 'America/New_York';

export const generateDailyPayroll = functions.pubsub.schedule('0 4 * * *') // Every day at 4:00 AM Florida time
    .timeZone(TIME_ZONE)
    .onRun(async (context) => {
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

        // 2. Fetch Completed/Auto-Closed Sessions for Yesterday (Florida time)
        // We use 'endTime' to determine which day the money belongs to
        const startTimestamp = admin.firestore.Timestamp.fromDate(yesterday);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endOfYesterday);

        console.log(`📅 Server Now (UTC): ${nowUtc.toISOString()}`);
        console.log(`📅 Florida Now: ${nowInFlorida.toString()}`);
        console.log(`📅 Yesterday Florida: ${startOfYesterdayFlorida.toString()} — ${endOfYesterdayFlorida.toString()}`);
        console.log(`📅 Query Range (UTC): ${yesterday.toISOString()} — ${endOfYesterday.toISOString()}`);

        try {
            const sessionsSnapshot = await db.collection('work_sessions')
                .where('status', 'in', ['completed', 'auto_closed'])
                .where('endTime', '>=', startTimestamp)
                .where('endTime', '<=', endTimestamp)
                .get();

            if (sessionsSnapshot.empty) {
                console.log('✅ No completed sessions found for yesterday.');
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

            // 4. Calculate Paroll & Create Ledger Entries
            const batch = db.batch();
            let operationsCount = 0;

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
                    type: 'work_session', // vs 'adjustment'
                    date: admin.firestore.Timestamp.fromDate(yesterday), // The day work was done
                    processedAt: now,

                    employeeId: session.employeeId,
                    employeeName: session.employeeName,

                    sessionId: doc.id,
                    clientId: session.clientId || null,
                    clientName: session.clientName || 'Unknown',

                    durationMinutes: durationMinutes,
                    hours: paidHours,
                    hourlyRate: rate,
                    amount: totalAmount,

                    description: `Shift at ${session.clientName}`
                });

                operationsCount++;
            }

            await batch.commit();
            console.log(`✅ Generated payroll: ${operationsCount} records created.`);

        } catch (error) {
            console.error('❌ Error generating payroll:', error);
        }

        return null;
    });
