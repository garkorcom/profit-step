/**
 * Migration Script: Move GTD tasks from users/{uid}/gtd_tasks to global gtd_tasks
 * 
 * This script migrates existing personal GTD tasks to the new global collection
 * that supports assignee visibility.
 * 
 * Run with: npx ts-node scripts/migrateGTDToGlobal.ts
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
const serviceAccount = require('../service-account-key.json');
initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

interface MigrationStats {
    usersProcessed: number;
    tasksProcessed: number;
    tasksMigrated: number;
    errors: number;
}

async function migrateGTDTasks(): Promise<MigrationStats> {
    const stats: MigrationStats = {
        usersProcessed: 0,
        tasksProcessed: 0,
        tasksMigrated: 0,
        errors: 0
    };

    console.log('🚀 Starting GTD tasks migration...\n');

    try {
        // Get all users
        const usersSnapshot = await db.collection('users').get();
        console.log(`Found ${usersSnapshot.size} users to process\n`);

        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const userName = userData.displayName || 'Unknown';

            console.log(`Processing user: ${userName} (${userId})`);

            // Get all GTD tasks for this user
            const tasksRef = db.collection('users').doc(userId).collection('gtd_tasks');
            const tasksSnapshot = await tasksRef.get();

            if (tasksSnapshot.empty) {
                console.log(`  - No tasks found, skipping\n`);
                stats.usersProcessed++;
                continue;
            }

            console.log(`  - Found ${tasksSnapshot.size} tasks`);

            const batch = db.batch();
            let batchCount = 0;

            for (const taskDoc of tasksSnapshot.docs) {
                const taskData = taskDoc.data();
                stats.tasksProcessed++;

                // Check if already migrated (skip if exists in global collection)
                const existingTask = await db.collection('gtd_tasks').doc(taskDoc.id).get();
                if (existingTask.exists) {
                    console.log(`  - Task ${taskDoc.id} already exists in global collection, skipping`);
                    continue;
                }

                // Map old userId to new ownerId
                const migratedTask = {
                    ...taskData,
                    ownerId: userId,
                    ownerName: userName,
                    // Remove old userId field if exists
                };
                delete migratedTask.userId;
                delete migratedTask.projectId; // Remove deprecated projectId

                // Add to global collection with same ID
                const globalTaskRef = db.collection('gtd_tasks').doc(taskDoc.id);
                batch.set(globalTaskRef, migratedTask);
                batchCount++;
                stats.tasksMigrated++;

                // Commit batch every 400 operations
                if (batchCount >= 400) {
                    await batch.commit();
                    console.log(`  - Committed batch of ${batchCount} tasks`);
                    batchCount = 0;
                }
            }

            // Commit remaining batch
            if (batchCount > 0) {
                await batch.commit();
                console.log(`  - Committed final batch of ${batchCount} tasks`);
            }

            stats.usersProcessed++;
            console.log(`  - User ${userName} complete\n`);
        }

    } catch (error) {
        console.error('Migration error:', error);
        stats.errors++;
    }

    return stats;
}

// Run migration
migrateGTDTasks()
    .then((stats) => {
        console.log('\n✅ Migration complete!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Users processed: ${stats.usersProcessed}`);
        console.log(`Tasks processed: ${stats.tasksProcessed}`);
        console.log(`Tasks migrated:  ${stats.tasksMigrated}`);
        console.log(`Errors:          ${stats.errors}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
