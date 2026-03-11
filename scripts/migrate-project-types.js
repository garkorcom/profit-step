/**
 * Migration: Add 'type' field to existing projects in Firestore
 * 
 * Run: node scripts/migrate-project-types.js
 * 
 * This script:
 * 1. Reads all documents from 'projects' collection
 * 2. For documents without 'type' field, sets type = 'estimate' (default)
 * 3. For documents with CRM financial fields (totalDebt, totalPaid), sets type = 'work'
 */
const admin = require('firebase-admin');

// Initialize with default credentials (run with GOOGLE_APPLICATION_CREDENTIALS set)
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

async function migrate() {
    console.log('🔄 Starting project type migration...');

    const snapshot = await db.collection('projects').get();
    console.log(`Found ${snapshot.size} projects`);

    let updated = 0;
    let skipped = 0;
    const batch = db.batch();

    for (const doc of snapshot.docs) {
        const data = doc.data();

        if (data.type) {
            skipped++;
            continue;
        }

        // Determine type based on existing fields
        const isCrmProject = !!(data.totalDebt || data.totalPaid || data.dueDate);
        const isEstimate = !!(data.files && Array.isArray(data.files));

        const type = isCrmProject ? 'work' : (isEstimate ? 'estimate' : 'estimate');

        batch.update(doc.ref, { type });
        updated++;
        console.log(`  📝 ${doc.id}: ${data.name || 'unnamed'} → type: ${type}`);
    }

    if (updated > 0) {
        await batch.commit();
        console.log(`\\n✅ Migration complete: ${updated} updated, ${skipped} already had type`);
    } else {
        console.log(`\\n✅ Nothing to migrate: all ${skipped} projects already have type`);
    }
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
