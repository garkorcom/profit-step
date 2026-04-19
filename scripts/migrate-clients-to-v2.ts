/**
 * Migration: Client Card V2 — backfill lifecycleStage / segment / defaults
 * for existing clients.
 *
 * See docs/tasks/CLIENT_CARD_V2_SPEC.md §4.2 for the `status` →
 * `lifecycleStage` mapping table and §10 for the migration plan.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migrate-clients-to-v2.ts --dry-run
 *   GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migrate-clients-to-v2.ts --commit
 *   GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migrate-clients-to-v2.ts --rollback
 *
 * Flags:
 *   --dry-run     (default): read only, print plan
 *   --commit      write backfilled fields
 *   --rollback    unset lifecycleStage/segment/isFavorite on clients that
 *                 have `migratedV2At` (undo the migration)
 *
 * Idempotent — clients with `migratedV2At` are skipped on re-run.
 * Legacy `status` field is NEVER modified (backward compat).
 *
 * Auth: ADC via `gcloud auth application-default login` or
 *       service-account-key.json at repo root / functions/.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const MODE: 'dry-run' | 'commit' | 'rollback' =
  args.includes('--commit') ? 'commit'
  : args.includes('--rollback') ? 'rollback'
  : 'dry-run';

// ─── Mapping (spec §4.2) ────────────────────────────────────────────

function mapStatusToLifecycle(status: string | undefined, hasProjects: boolean, tags: string[] = []): string {
  if (tags?.map(t => t.toLowerCase()).includes('vip')) return 'vip';
  switch (status) {
    case 'new':
    case 'contacted':
      return 'lead';
    case 'qualified':
      return 'prospect';
    case 'customer':
    case 'active':
      return 'active';
    case 'done':
      return hasProjects ? 'repeat' : 'churned';
    case 'churned':
      return 'churned';
    default:
      return 'lead'; // safest default — won't auto-flag as active
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

async function initAdmin(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sa = require('../service-account-key.json');
    initializeApp({ credential: cert(sa) });
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sa = require('../functions/service-account-key.json');
      initializeApp({ credential: cert(sa) });
    } catch {
      initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'profit-step' });
    }
  }
}

function log(msg: string, data?: unknown): void {
  console.log(`[${MODE}] ${msg}${data ? ` ${JSON.stringify(data)}` : ''}`);
}

// ─── Main ───────────────────────────────────────────────────────────

interface Stats {
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  rolledBack: number;
  errors: number;
  stageBreakdown: Record<string, number>;
}

async function migrate(): Promise<Stats> {
  const db = getFirestore();
  const stats: Stats = {
    scanned: 0,
    migrated: 0,
    alreadyMigrated: 0,
    rolledBack: 0,
    errors: 0,
    stageBreakdown: {},
  };

  log('🚀 starting client v2 migration');

  const snap = await db.collection('clients').get();
  stats.scanned = snap.size;
  log(`found ${snap.size} clients`);

  for (const doc of snap.docs) {
    const client = doc.data();

    if (MODE === 'rollback') {
      if (!client.migratedV2At) continue;
      if (MODE !== 'rollback') continue; // TS narrowing
      log(`rollback client ${doc.id}`);
      // Note: we only unset V2-specific fields that the script SET.
      // Manager-added fields (e.g. if they manually set segment='VIP' later)
      // will revert too — this is intentional for a clean rollback.
      await doc.ref.update({
        lifecycleStage: FieldValue.delete(),
        segment: FieldValue.delete(),
        migratedV2At: FieldValue.delete(),
      });
      stats.rolledBack++;
      continue;
    }

    if (client.migratedV2At) {
      stats.alreadyMigrated++;
      continue;
    }

    // Count projects for 'done' → 'repeat' vs 'churned' decision
    const projectsSnap = await db
      .collection('projects')
      .where('clientId', '==', doc.id)
      .limit(2)
      .get();
    const hasProjects = projectsSnap.size >= 2; // threshold from spec

    const lifecycleStage = mapStatusToLifecycle(client.status, hasProjects, client.tags);
    const segment = 'B'; // default per spec §12 open question #2

    stats.stageBreakdown[lifecycleStage] = (stats.stageBreakdown[lifecycleStage] ?? 0) + 1;

    if (MODE === 'commit') {
      await doc.ref.update({
        lifecycleStage,
        segment,
        migratedV2At: Timestamp.now(),
      });
      log(`migrated ${doc.id} (${client.name}) → stage=${lifecycleStage} segment=${segment}`);
    } else {
      log(`would migrate ${doc.id} (${client.name}) → stage=${lifecycleStage} segment=${segment}`);
    }
    stats.migrated++;
  }

  return stats;
}

async function main(): Promise<void> {
  await initAdmin();
  const stats = await migrate();
  console.log('\n📊 summary', stats);

  if (MODE === 'dry-run') {
    console.log('\nℹ️  dry run. Re-run with --commit to apply.');
  } else if (MODE === 'rollback') {
    console.log('\n↩️  rollback complete.');
  } else {
    console.log('\n✅ migration complete.');
  }
}

main().catch(e => {
  console.error('❌ failed:', e);
  process.exit(1);
});
