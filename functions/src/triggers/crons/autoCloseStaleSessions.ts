import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

/**
 * Periodic Cleanup of Stale Data
 *
 * NOTE: Session auto-stop (12h threshold) is handled exclusively by
 * `scheduledAutoStopStaleTimers` in scheduled/autoStopStaleTimers.ts.
 * This function only handles cleanup of stale data:
 * - pending_starts (zombie docs > 1h)
 * - processed_messages (> 24h)
 * - expired idempotency keys (24h TTL)
 * - stale rate limit entries (> 1 day)
 * - old activityLog entries (> 90 days)
 */
export const autoCloseStaleSessions = functions.pubsub
    .schedule('every 1 hours')
    .onRun(async (context) => {
        const db = admin.firestore();

        // Cleanup stale pending_starts (zombie docs older than 1 hour)
        try {
            const oneHourAgo = admin.firestore.Timestamp.fromDate(
                new Date(Date.now() - 60 * 60 * 1000)
            );
            const stalePending = await db.collection('pending_starts')
                .where('createdAt', '<=', oneHourAgo)
                .get();

            if (!stalePending.empty) {
                const cleanupBatch = db.batch();
                stalePending.docs.forEach(doc => cleanupBatch.delete(doc.ref));
                await cleanupBatch.commit();
                console.log(`Cleaned up ${stalePending.size} stale pending_starts.`);
            }
        } catch (cleanupErr) {
            console.error('Error cleaning pending_starts:', cleanupErr);
        }

        // Cleanup processed_messages older than 24 hours
        try {
            const oneDayAgo = admin.firestore.Timestamp.fromDate(
                new Date(Date.now() - 24 * 60 * 60 * 1000)
            );
            const staleMessages = await db.collection('processed_messages')
                .where('processedAt', '<=', oneDayAgo)
                .limit(500)
                .get();

            if (!staleMessages.empty) {
                const msgBatch = db.batch();
                staleMessages.docs.forEach(doc => msgBatch.delete(doc.ref));
                await msgBatch.commit();
                console.log(`Cleaned up ${staleMessages.size} stale processed_messages.`);
            }
        } catch (msgCleanupErr) {
            console.error('Error cleaning processed_messages:', msgCleanupErr);
        }

        // Cleanup expired idempotency keys (24h TTL)
        try {
            const nowMs = Date.now();
            const expiredKeys = await db.collection('_idempotency')
                .where('expiresAt', '<', nowMs)
                .limit(500)
                .get();

            if (!expiredKeys.empty) {
                const idempBatch = db.batch();
                expiredKeys.docs.forEach(doc => idempBatch.delete(doc.ref));
                await idempBatch.commit();
                console.log(`Cleaned up ${expiredKeys.size} expired idempotency keys.`);
            }
        } catch (idempErr) {
            console.error('Error cleaning _idempotency:', idempErr);
        }

        // Cleanup stale rate limit docs (older than 1 day)
        try {
            const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
            const staleRateLimits = await db.collection('_rate_limits')
                .where('resetAt', '<', oneDayAgoMs)
                .limit(100)
                .get();

            if (!staleRateLimits.empty) {
                const rlBatch = db.batch();
                staleRateLimits.docs.forEach(doc => rlBatch.delete(doc.ref));
                await rlBatch.commit();
                console.log(`Cleaned up ${staleRateLimits.size} stale rate limit entries.`);
            }
        } catch (rlErr) {
            console.error('Error cleaning _rate_limits:', rlErr);
        }

        // Rotate activityLog (older than 90 days)
        try {
            const ninetyDaysAgo = admin.firestore.Timestamp.fromDate(
                new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            );
            const oldLogs = await db.collection('activityLog')
                .where('timestamp', '<=', ninetyDaysAgo)
                .limit(500)
                .get();

            if (!oldLogs.empty) {
                const logBatch = db.batch();
                oldLogs.docs.forEach(doc => logBatch.delete(doc.ref));
                await logBatch.commit();
                console.log(`Rotated ${oldLogs.size} old activityLog entries (>90 days).`);
            }
        } catch (logErr) {
            console.error('Error rotating activityLog:', logErr);
        }

        return null;
    });
