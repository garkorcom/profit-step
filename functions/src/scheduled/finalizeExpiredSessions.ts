import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { subDays, endOfDay } from 'date-fns';


const db = admin.firestore();

// Config


// Florida timezone - all our objects are in Florida
const TIME_ZONE = 'America/New_York';

/**
 * Scheduled function that runs daily at 1:00 AM Florida time to finalize sessions.
 * 
 * TIMEZONE-AWARE LOGIC:
 * - Google Cloud servers run in UTC
 * - We calculate "end of day-before-yesterday" in Florida time
 * - Convert that to UTC for Firestore query
 * 
 * Example (Winter, EST = UTC-5):
 * - Script runs Wednesday 1:00 AM Florida = Wednesday 6:00 AM UTC
 * - Target: End of Monday in Florida = Monday 23:59:59 EST = Tuesday 04:59:59 UTC
 * - Query finds sessions started before Tuesday 05:00 UTC
 */
export const finalizeExpiredSessions = functions.pubsub
    .schedule('0 1 * * *') // Every day at 1:00 AM
    .timeZone(TIME_ZONE)
    .onRun(async (context) => {
        // 1. Get current time in UTC
        const nowUtc = new Date();

        // 2. Convert to Florida time to understand "what day is it there"
        const nowInFlorida = toZonedTime(nowUtc, TIME_ZONE);

        // 3. Go back 2 days from Florida time
        // If today is Wednesday 1:00 AM Florida, targetDate = Monday
        const twoDaysAgoFlorida = subDays(nowInFlorida, 2);

        // 4. Find END of that day (23:59:59.999) in Florida
        const endOfTwoDaysAgoFlorida = endOfDay(twoDaysAgoFlorida);

        // 5. Convert this cutoff back to UTC for Firestore query
        const cutoffTimestamp = fromZonedTime(endOfTwoDaysAgoFlorida, TIME_ZONE);

        console.log(`🔒 [finalizeExpiredSessions] Running daily finalization...`);
        console.log(`📅 Server Now (UTC): ${nowUtc.toISOString()}`);
        console.log(`📅 Florida Now: ${nowInFlorida.toString()}`);
        console.log(`📅 Cutoff Target (Florida): ${endOfTwoDaysAgoFlorida.toString()}`);
        console.log(`📅 Query Cutoff (UTC): ${cutoffTimestamp.toISOString()}`);

        try {
            // Find sessions that started BEFORE this cutoff
            const snapshot = await db.collection('work_sessions')
                .where('startTime', '<=', admin.firestore.Timestamp.fromDate(cutoffTimestamp))
                .get();

            if (snapshot.empty) {
                console.log('✅ No sessions to process.');
                return null;
            }

            const batch = db.batch();
            const notifications: Promise<void>[] = [];
            let finalizedCount = 0;
            let autoClosedCount = 0;
            let skippedCount = 0;

            for (const doc of snapshot.docs) {
                const session = doc.data();

                // Skip already finalized or processed sessions
                if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') {
                    skippedCount++;
                    continue;
                }

                // Skip correction entries and manual adjustments
                if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    skippedCount++;
                    continue;
                }

                const updates: any = {
                    finalizationStatus: 'finalized',
                    finalizedAt: admin.firestore.Timestamp.now(),
                };

                // Auto-close if still active or paused
                if (session.status === 'active' || session.status === 'paused') {
                    // IMPORTANT: Don't auto-calculate earnings! 
                    // Worker may have worked 10 hours but forgot to stop.
                    // Require admin to confirm actual duration.
                    Object.assign(updates, {
                        status: 'auto_closed',
                        autoClosed: true,
                        requiresAdminReview: true,
                        autoClosedAt: admin.firestore.FieldValue.serverTimestamp(),
                        description: (session.description || '') + ' [⚠️ Requires Admin Review]',
                    });

                    autoClosedCount++;

                    // NOTE: Removed 1 AM notification per user request.
                    // Workers won't be notified at 1 AM anymore.
                }

                batch.update(doc.ref, updates);
                finalizedCount++;
            }

            if (finalizedCount > 0) {
                await batch.commit();
            }

            await Promise.all(notifications);

            console.log(`✅ [finalizeExpiredSessions] Complete. Finalized: ${finalizedCount}, Auto-closed: ${autoClosedCount}, Skipped: ${skippedCount}`);
        } catch (error) {
            console.error('❌ [finalizeExpiredSessions] Error:', error);
        }

        return null;
    });
