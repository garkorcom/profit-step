import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

/**
 * Auto-Close Stale Work Sessions
 * Runs every hour. Finds 'active' or 'paused' sessions older than 14 hours.
 * Closes them automatically and flags them with `needsAdjustment: true`
 * so the admin knows the user forgot to press "Finish Work".
 */
export const autoCloseStaleSessions = functions.pubsub
    .schedule('every 1 hours')
    .onRun(async (context) => {
        const db = admin.firestore();
        const now = admin.firestore.Timestamp.now();
        const fourteenHoursAgo = new Date(now.toDate().getTime() - 14 * 60 * 60 * 1000);

        try {
            // Find stale active sessions
            const activeSnapshot = await db.collection('work_sessions')
                .where('status', '==', 'active')
                .where('startTime', '<=', admin.firestore.Timestamp.fromDate(fourteenHoursAgo))
                .get();

            // Find stale paused sessions
            const pausedSnapshot = await db.collection('work_sessions')
                .where('status', '==', 'paused')
                .where('startTime', '<=', admin.firestore.Timestamp.fromDate(fourteenHoursAgo))
                .get();

            const staleDocs = [...activeSnapshot.docs, ...pausedSnapshot.docs];

            if (staleDocs.length === 0) {
                console.log('No stale sessions found to auto-close.');
                return null;
            }

            const BATCH_SIZE = 250;
            let closedCount = 0;

            for (let i = 0; i < staleDocs.length; i += BATCH_SIZE) {
                const chunk = staleDocs.slice(i, i + BATCH_SIZE);
                const batch = db.batch();

                for (const doc of chunk) {
                    const sessionData = doc.data();

                    // Fix 1 (Wave 2): Race condition guard — skip if worker already closed
                    if (sessionData.status !== 'active' && sessionData.status !== 'paused') {
                        continue; // Already closed by worker between query and commit
                    }
                    if (sessionData.endTime) {
                        continue; // Worker already finalized — don't overwrite
                    }

                    // If it's been active for > 14 hours, we cap the duration 
                    // at a standard 8 hours (480 mins) for safety, and flag it.
                    // The admin can review and change it in the CRM.
                    const fallbackDurationMinutes = 480;

                    // Guard against null startTime (scenario 37)
                    if (!sessionData.startTime) {
                        console.warn(`Skipping session ${doc.id}: missing startTime`);
                        continue;
                    }

                    // Ensure an endTime exists so the CRM doesn't crash calculations
                    const autoEndTime = new Date(sessionData.startTime.toDate().getTime() + fallbackDurationMinutes * 60 * 1000);

                    batch.update(doc.ref, {
                        status: 'completed',
                        endTime: admin.firestore.Timestamp.fromDate(autoEndTime),
                        durationMinutes: fallbackDurationMinutes,
                        autoClosed: true,
                        needsAdjustment: true,
                        description: '⚠️ Автоматически закрыто системой (забыли нажать Завершить работу)',
                        // Clear any pending flags just in case
                        awaitingEndPhoto: false,
                        awaitingEndVoice: false,
                        awaitingDescription: false,
                        awaitingStartPhoto: false,
                        awaitingStartVoice: false,
                        awaitingLocation: false
                    });

                    closedCount++;
                }

                await batch.commit();
            }

            console.log(`Successfully auto-closed ${closedCount} stale sessions.`);

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

            // Fix 7 (Wave 2): Cleanup processed_messages older than 24 hours
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

            // ─── Cleanup expired idempotency keys (24h TTL) ───────────
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
                    console.log(`🧹 Cleaned up ${expiredKeys.size} expired idempotency keys.`);
                }
            } catch (idempErr) {
                console.error('Error cleaning _idempotency:', idempErr);
            }

            // ─── Cleanup stale rate limit docs (older than 1 day) ─────
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
                    console.log(`🧹 Cleaned up ${staleRateLimits.size} stale rate limit entries.`);
                }
            } catch (rlErr) {
                console.error('Error cleaning _rate_limits:', rlErr);
            }

            // ─── Rotate activityLog (older than 90 days) ──────────────
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
                    console.log(`🧹 Rotated ${oldLogs.size} old activityLog entries (>90 days).`);
                }
            } catch (logErr) {
                console.error('Error rotating activityLog:', logErr);
            }

            return null;

        } catch (error) {
            console.error('Error auto-closing stale sessions:', error);
            return null;
        }
    });
