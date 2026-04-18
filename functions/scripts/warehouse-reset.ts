/**
 * CLI: warehouse clean-slate reset + bootstrap.
 *
 * Usage:
 *   # Dry run (always start here, no writes)
 *   npx ts-node scripts/warehouse-reset.ts --phase drop --dry-run
 *   npx ts-node scripts/warehouse-reset.ts --phase bootstrap --dry-run
 *   npx ts-node scripts/warehouse-reset.ts --phase all --dry-run
 *
 *   # Live (actually writes/deletes)
 *   npx ts-node scripts/warehouse-reset.ts --phase drop
 *   npx ts-node scripts/warehouse-reset.ts --phase bootstrap
 *   npx ts-node scripts/warehouse-reset.ts --phase all
 *
 * The script uses Firebase Admin with default creds. Point at the emulator
 * via FIRESTORE_EMULATOR_HOST=localhost:8080 for safe local testing.
 *
 * Safety: in LIVE mode on drop phase, script refuses to run unless the
 * env var WAREHOUSE_RESET_CONFIRM=yes is set. This is intentional friction.
 */

import * as admin from 'firebase-admin';
import {
  BootstrapWarehouseMigration,
  DropLegacyInventoryMigration,
  runMigration,
} from '../src/warehouse/database/migrations';

type Phase = 'drop' | 'bootstrap' | 'all';

function parseArgs(argv: string[]): { phase: Phase; dryRun: boolean; verbose: boolean } {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args.set(a.slice(2), true);
      } else {
        args.set(a.slice(2), next);
        i++;
      }
    }
  }
  const phaseRaw = (args.get('phase') as string) || 'all';
  if (phaseRaw !== 'drop' && phaseRaw !== 'bootstrap' && phaseRaw !== 'all') {
    throw new Error(`Unknown --phase: ${phaseRaw}`);
  }
  return {
    phase: phaseRaw,
    dryRun: args.get('dry-run') === true,
    verbose: args.get('verbose') === true,
  };
}

async function main() {
  const { phase, dryRun, verbose } = parseArgs(process.argv.slice(2));

  // Safety gate on destructive drops
  if (!dryRun && (phase === 'drop' || phase === 'all') && process.env.WAREHOUSE_RESET_CONFIRM !== 'yes') {
    console.error('❌ Refusing to run LIVE drop without WAREHOUSE_RESET_CONFIRM=yes env var.');
    console.error('   Example: WAREHOUSE_RESET_CONFIRM=yes npx ts-node scripts/warehouse-reset.ts --phase drop');
    process.exit(2);
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  console.log(`▶ warehouse-reset phase=${phase} dryRun=${dryRun} emulator=${!!process.env.FIRESTORE_EMULATOR_HOST}`);

  if (phase === 'drop' || phase === 'all') {
    const res = await runMigration(db, DropLegacyInventoryMigration, { dryRun, verbose });
    console.log('▸ drop result:', JSON.stringify(res.summary, null, 2));
  }

  if (phase === 'bootstrap' || phase === 'all') {
    const res = await runMigration(db, BootstrapWarehouseMigration, { dryRun, verbose });
    console.log('▸ bootstrap result:', JSON.stringify(res.summary, null, 2));
  }

  console.log('✓ done');
}

main().catch((err) => {
  console.error('✗ warehouse-reset failed:', err);
  process.exit(1);
});
