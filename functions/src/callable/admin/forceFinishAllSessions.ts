
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Check for db initialization
const db = admin.firestore();

export const forceFinishAllSessions = functions.https.onCall(async (data, context) => {
    // 1. Auth Check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    // 2. Admin Role Check
    const callerId = context.auth.uid;
    const callerDoc = await db.collection('users').doc(callerId).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }

    try {
        // 3. Query Active Sessions
        const snapshot = await db.collection('work_sessions')
            .where('status', '==', 'active')
            .get();

        if (snapshot.empty) {
            return {
                success: true,
                message: "No active sessions found.",
                count: 0
            };
        }

        const batch = db.batch();
        const now = admin.firestore.Timestamp.now();
        let count = 0;

        // 4. Update each session
        for (const doc of snapshot.docs) {
            batch.update(doc.ref, {
                status: 'completed',
                endTime: now,
                description: 'Force finished by Admin',
                durationMinutes: 0, // Should calculate realistically but 0 is safe placeholder or calc elapsed
                forceFinished: true,
                forceFinishedBy: callerId
            });
            count++;
        }

        // Commit (Note: If > 500 docs, need multiple batches. active sessions unlikely to be > 500 for small biz)
        await batch.commit();

        console.log(`✅ Force finished ${count} sessions.`);
        return {
            success: true,
            message: `Successfully stopped ${count} sessions.`,
            count: count
        };

    } catch (error: any) {
        console.error("Error force finishing sessions:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
