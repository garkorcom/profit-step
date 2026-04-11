import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface LockPayrollPeriodRequest {
    periodId: string; // "2026-01"
}

interface LockPayrollPeriodResponse {
    success: boolean;
    message: string;
}

/**
 * Callable function to lock a payroll period.
 *
 * Locked periods prevent ANY changes:
 * - No new sessions can be attributed to this period
 * - No corrections or adjustments
 * - Only an explicit admin "unlock" can revert (not implemented yet — by design)
 *
 * Flow: open → closed → locked → paid
 * Can only lock periods that are already 'closed'.
 */
export const lockPayrollPeriod = functions.https.onCall(
    async (data: LockPayrollPeriodRequest, context): Promise<LockPayrollPeriodResponse> => {
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

        console.log(`[lockPayrollPeriod] Admin ${adminUid} locking period ${periodId}...`);

        try {
            // 2. Check admin role
            const adminDoc = await db.collection('users').doc(adminUid).get();
            if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
                throw new functions.https.HttpsError('permission-denied', 'Only admins can lock payroll periods');
            }

            // 3. Check period exists and is in 'closed' status
            const periodRef = db.collection('payroll_periods').doc(periodId);
            const periodDoc = await periodRef.get();

            if (!periodDoc.exists) {
                throw new functions.https.HttpsError('not-found', `Period ${periodId} not found`);
            }

            const periodData = periodDoc.data();

            if (periodData?.status === 'locked') {
                throw new functions.https.HttpsError('failed-precondition', `Period ${periodId} is already locked`);
            }

            if (periodData?.status === 'paid') {
                throw new functions.https.HttpsError('failed-precondition', `Period ${periodId} is already paid (implicitly locked)`);
            }

            if (periodData?.status !== 'closed') {
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    `Period ${periodId} must be closed before it can be locked. Current status: ${periodData?.status}`
                );
            }

            // 4. Lock the period
            await periodRef.update({
                status: 'locked',
                lockedAt: admin.firestore.Timestamp.now(),
                lockedBy: adminUid,
            });

            console.log(`[lockPayrollPeriod] Period ${periodId} locked by ${adminUid}`);

            return {
                success: true,
                message: `Period ${periodId} locked successfully. No further changes allowed.`,
            };

        } catch (error: any) {
            console.error(`[lockPayrollPeriod] Error:`, error);

            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            throw new functions.https.HttpsError('internal', `Failed to lock period: ${error.message}`);
        }
    }
);
