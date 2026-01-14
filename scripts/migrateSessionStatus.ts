/**
 * Migration Script: Set finalizationStatus on existing work_sessions
 * 
 * Run this script once after deploying the new session correction feature.
 * 
 * Usage:
 *   1. Deploy functions: firebase deploy --only functions
 *   2. Run this script: npx ts-node scripts/migrateSessionStatus.ts
 *   
 * Or run via Firebase Admin SDK in a Cloud Function (one-time callable).
 */

import * as admin from 'firebase-admin';

// Initialize Firebase Admin
const serviceAccount = require('../serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/**
 * Gets the start of a day (midnight)
 */
const getStartOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

async function migrateSessionStatus() {
    console.log('🚀 Starting migration: Set finalizationStatus on work_sessions...');

    const today = getStartOfDay(new Date());
    const dayBeforeYesterday = new Date(today);
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
    dayBeforeYesterday.setHours(23, 59, 59, 999);

    console.log(`📅 Cutoff date: ${dayBeforeYesterday.toISOString()}`);
    console.log('   - Sessions on or before this date will be set to "finalized"');
    console.log('   - Sessions after this date will be set to "pending"');

    try {
        const snapshot = await db.collection('work_sessions').get();

        if (snapshot.empty) {
            console.log('✅ No sessions to migrate.');
            return;
        }

        console.log(`📊 Found ${snapshot.size} sessions to process...`);

        // Process in batches of 500 (Firestore limit)
        const BATCH_SIZE = 500;
        let processed = 0;
        let finalized = 0;
        let pending = 0;
        let skipped = 0;

        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const batchDocs = docs.slice(i, i + BATCH_SIZE);

            for (const doc of batchDocs) {
                const session = doc.data();

                // Skip if already has finalizationStatus
                if (session.finalizationStatus) {
                    skipped++;
                    continue;
                }

                // Skip corrections and manual adjustments
                if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    skipped++;
                    continue;
                }

                const startTime = session.startTime?.toDate();
                if (!startTime) {
                    skipped++;
                    continue;
                }

                // Determine status based on date
                const status = startTime <= dayBeforeYesterday ? 'finalized' : 'pending';

                const updates: any = {
                    finalizationStatus: status
                };

                // Add finalizedAt timestamp for finalized sessions
                if (status === 'finalized') {
                    updates.finalizedAt = admin.firestore.Timestamp.now();
                    finalized++;
                } else {
                    pending++;
                }

                batch.update(doc.ref, updates);
                processed++;
            }

            await batch.commit();
            console.log(`   Processed ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}...`);
        }

        console.log('\n✅ Migration complete!');
        console.log(`   Total sessions: ${snapshot.size}`);
        console.log(`   Updated: ${processed}`);
        console.log(`   - Finalized: ${finalized}`);
        console.log(`   - Pending: ${pending}`);
        console.log(`   Skipped: ${skipped}`);

    } catch (error) {
        console.error('❌ Migration error:', error);
        process.exit(1);
    }

    process.exit(0);
}

// Run migration
migrateSessionStatus();
