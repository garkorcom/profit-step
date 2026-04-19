/**
 * Data migration for multi-user bot support.
 *
 * Two migrations:
 * 1. Add `status: 'active'` to all users missing this field
 *    (needed for bot-directory endpoint and impersonation middleware)
 * 2. Add `type: 'master'` to agent_tokens document(s)
 *    (needed for Master Token detection in authMiddleware)
 *
 * Usage:
 *   node scripts/migrate-multi-user.js [--dry-run]
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS env var or default service account.
 */

const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'profit-step';

if (!admin.apps.length) {
  // Try service account first, then fall back to gcloud ADC
  try {
    const sa = require('../serviceAccountKey.json');
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: PROJECT_ID });
    console.log('Auth: serviceAccountKey.json');
  } catch {
    admin.initializeApp({ projectId: PROJECT_ID });
    console.log('Auth: Application Default Credentials (gcloud)');
  }
}
const db = admin.firestore();

async function migrateUserStatus() {
  console.log('\n=== Migration 1: users.status ===');

  const usersSnap = await db.collection('users').get();
  let updated = 0;
  let skipped = 0;
  const batch = db.batch();

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (data.status) {
      skipped++;
      continue;
    }

    console.log(`  [${DRY_RUN ? 'DRY' : 'SET'}] ${doc.id} (${data.displayName || data.name || '?'}) → status: 'active'`);
    if (!DRY_RUN) {
      batch.update(doc.ref, { status: 'active' });
    }
    updated++;

    // Firestore batch limit is 500
    if (updated > 0 && updated % 450 === 0) {
      if (!DRY_RUN) await batch.commit();
      console.log(`  Committed batch of ${updated}`);
    }
  }

  if (!DRY_RUN && updated > 0) {
    await batch.commit();
  }

  console.log(`  Total users: ${usersSnap.size}, Updated: ${updated}, Skipped (already had status): ${skipped}`);
}

async function migrateAgentTokenType() {
  console.log('\n=== Migration 2: agent_tokens.type ===');

  const tokensSnap = await db.collection('agent_tokens').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of tokensSnap.docs) {
    const data = doc.data();
    if (data.type) {
      console.log(`  SKIP ${doc.id} — already has type: '${data.type}'`);
      skipped++;
      continue;
    }

    console.log(`  [${DRY_RUN ? 'DRY' : 'SET'}] ${doc.id} → type: 'master'`);
    if (!DRY_RUN) {
      await doc.ref.update({ type: 'master' });
    }
    updated++;
  }

  console.log(`  Total tokens: ${tokensSnap.size}, Updated: ${updated}, Skipped: ${skipped}`);
}

async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN mode — no writes will be made\n');
  } else {
    console.log('🚀 LIVE mode — writing to Firestore\n');
  }

  await migrateUserStatus();
  await migrateAgentTokenType();

  console.log('\n✅ Migration complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
