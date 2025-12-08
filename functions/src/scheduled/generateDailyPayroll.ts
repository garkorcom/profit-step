import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const generateDailyPayroll = functions.pubsub.schedule('0 4 * * *') // Every day at 4:00 AM
    .timeZone('UTC') // UTC time (adjust to local if needed, e.g. Europe/Kiev)
    .onRun(async (context) => {
        console.log('💰 Running generateDailyPayroll...');

        // 1. Determine "Yesterday" range
        const now = admin.firestore.Timestamp.now();
        const yesterday = new Date(now.toMillis());
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0); // Start of yesterday

        const endOfYesterday = new Date(yesterday);
        endOfYesterday.setHours(23, 59, 59, 999); // End of yesterday

        // 2. Fetch Completed/Auto-Closed Sessions for Yesterday
        // We use 'endTime' to determine which day the money belongs to
        const startTimestamp = admin.firestore.Timestamp.fromDate(yesterday);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endOfYesterday);

        console.log(`Querying sessions between ${yesterday.toISOString()} and ${endOfYesterday.toISOString()}`);

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

            // 3. Fetch All Employees to get Hourly Rates
            const employeesSnapshot = await db.collection('employees').get();
            const employeeRates: Record<string, number> = {};

            employeesSnapshot.docs.forEach(doc => {
                // Default to 0 if not set
                employeeRates[doc.data().telegramId] = doc.data().hourlyRate || 0;
                // Also support referencing by doc ID if it differs
                employeeRates[doc.id] = doc.data().hourlyRate || 0;
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
