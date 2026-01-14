import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface ClosePayrollPeriodRequest {
    periodId: string; // "2026-01"
}

interface ClosePayrollPeriodResponse {
    success: boolean;
    message: string;
    period?: {
        id: string;
        totalSessions: number;
        totalHours: number;
        totalAmount: number;
        employeeCount: number;
    };
}

/**
 * Callable function to close a payroll period.
 * 
 * When closed:
 * 1. Updates all finalized sessions in the period with payrollPeriod = periodId
 * 2. Calculates aggregates (sessions, hours, amount, employees)
 * 3. Creates/updates the payroll_periods document
 * 4. Marks the period as 'closed'
 * 
 * Requirements:
 * - Only admin can close periods
 * - Cannot close a period that is already closed/paid
 * - All sessions in period must be finalized
 */
export const closePayrollPeriod = functions.https.onCall(
    async (data: ClosePayrollPeriodRequest, context): Promise<ClosePayrollPeriodResponse> => {
        // 1. Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
        }

        const adminUid = context.auth.uid;
        const { periodId } = data;

        // Validate periodId format (YYYY-MM)
        if (!periodId || !/^\d{4}-\d{2}$/.test(periodId)) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid period ID format. Expected YYYY-MM');
        }

        console.log(`📊 [closePayrollPeriod] Admin ${adminUid} closing period ${periodId}...`);

        try {
            // 2. Check admin role
            const adminDoc = await db.collection('users').doc(adminUid).get();
            if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
                throw new functions.https.HttpsError('permission-denied', 'Only admins can close payroll periods');
            }

            // 3. Check if period already exists and is closed
            const periodRef = db.collection('payroll_periods').doc(periodId);
            const periodDoc = await periodRef.get();

            if (periodDoc.exists) {
                const periodData = periodDoc.data();
                if (periodData?.status === 'closed' || periodData?.status === 'paid') {
                    throw new functions.https.HttpsError('failed-precondition', `Period ${periodId} is already ${periodData.status}`);
                }
            }

            // 4. Calculate period date range
            const [year, month] = periodId.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const endDate = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month

            // 5. Fetch all finalized sessions in this period
            const sessionsSnapshot = await db.collection('work_sessions')
                .where('startTime', '>=', admin.firestore.Timestamp.fromDate(startDate))
                .where('startTime', '<=', admin.firestore.Timestamp.fromDate(endDate))
                .get();

            if (sessionsSnapshot.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'No sessions found in this period');
            }

            // 6. Check all sessions are finalized and calculate aggregates
            let totalSessions = 0;
            let totalMinutes = 0;
            let totalAmount = 0;
            const employeeSet = new Set<string>();
            const sessionsToUpdate: FirebaseFirestore.DocumentReference[] = [];

            for (const doc of sessionsSnapshot.docs) {
                const session = doc.data();

                // Skip corrections and adjustments (they're already counted)
                if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    continue;
                }

                // Check if session is finalized
                if (session.finalizationStatus !== 'finalized' && session.finalizationStatus !== 'processed') {
                    // Check if session is old enough (fallback for legacy data)
                    const sessionDate = session.startTime?.toDate();
                    if (!sessionDate) continue;

                    const dayBeforeYesterday = new Date();
                    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
                    dayBeforeYesterday.setHours(23, 59, 59, 999);

                    if (sessionDate > dayBeforeYesterday) {
                        throw new functions.https.HttpsError(
                            'failed-precondition',
                            'Some sessions are still within edit window. Wait until all sessions are finalized.'
                        );
                    }
                }

                totalSessions++;
                totalMinutes += session.durationMinutes || 0;
                totalAmount += session.sessionEarnings || 0;
                employeeSet.add(String(session.employeeId));
                sessionsToUpdate.push(doc.ref);
            }

            const totalHours = parseFloat((totalMinutes / 60).toFixed(2));
            totalAmount = parseFloat(totalAmount.toFixed(2));

            // 7. Update sessions with payrollPeriod and mark as processed
            const batch = db.batch();

            for (const ref of sessionsToUpdate) {
                batch.update(ref, {
                    payrollPeriod: periodId,
                    finalizationStatus: 'processed',
                    processedAt: admin.firestore.Timestamp.now()
                });
            }

            // 8. Create/update period document
            const periodData = {
                id: periodId,
                year,
                month,
                status: 'closed',
                startDate: admin.firestore.Timestamp.fromDate(startDate),
                endDate: admin.firestore.Timestamp.fromDate(endDate),
                totalSessions,
                totalHours,
                totalAmount,
                employeeCount: employeeSet.size,
                closedAt: admin.firestore.Timestamp.now(),
                closedBy: adminUid,
                ...(periodDoc.exists ? {} : { createdAt: admin.firestore.Timestamp.now() })
            };

            batch.set(periodRef, periodData, { merge: true });

            await batch.commit();

            console.log(`✅ [closePayrollPeriod] Period ${periodId} closed. Sessions: ${totalSessions}, Hours: ${totalHours}, Amount: $${totalAmount}`);

            return {
                success: true,
                message: `Period ${periodId} closed successfully`,
                period: {
                    id: periodId,
                    totalSessions,
                    totalHours,
                    totalAmount,
                    employeeCount: employeeSet.size
                }
            };

        } catch (error: any) {
            console.error(`❌ [closePayrollPeriod] Error:`, error);

            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            throw new functions.https.HttpsError('internal', `Failed to close period: ${error.message}`);
        }
    }
);
