/**
 * Firestore JSON export — Application-layer dump for small/medium databases
 * and for inspection.
 *
 * For bulk production migration prefer `gcloud firestore export` (Firestore's
 * native managed export, see DATA_MIGRATION_RUNBOOK.md). This script is the
 * "small data" alternative when you want readable JSON you can diff, edit,
 * or cherry-pick from.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migration/export-firestore-json.ts --out=./dump
 *   GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migration/export-firestore-json.ts --out=./dump --collections=clients,gtd_tasks
 *   GOOGLE_CLOUD_PROJECT=profit-step npx ts-node scripts/migration/export-firestore-json.ts --out=./dump --dry-run
 *
 * Flags:
 *   --out=<dir>       output directory (default ./firestore-export-<timestamp>)
 *   --collections=... comma-separated list; default = all known collections
 *                     (see COLLECTIONS const)
 *   --dry-run         scan only, print counts, don't write JSON
 *   --chunk=<n>       write JSON in chunks of N documents per file (default 500)
 *
 * Auth: ADC via `gcloud auth application-default login`, or
 *       service-account-key.json at repo root / functions/.
 *
 * Output layout:
 *   <out>/manifest.json
 *   <out>/<collection>/part-0001.json
 *   <out>/<collection>/part-0002.json
 *   ...
 *
 * manifest.json records: collection → { count, parts, exportedAt }.
 * Import script (`import-firestore-json.ts`) reads manifest to know what to
 * load.
 */

import * as fs from 'fs';
import * as path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// ─── Config ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getFlag = (name: string, fallback?: string): string | undefined => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const OUT_DIR = getFlag('out', `./firestore-export-${new Date().toISOString().replace(/[:.]/g, '-')}`)!;
const CHUNK_SIZE = parseInt(getFlag('chunk', '500')!, 10);
const DRY_RUN = hasFlag('dry-run');
const EXPLICIT_COLLECTIONS = getFlag('collections')?.split(',').filter(Boolean);

/**
 * Default collection list — comprehensive; matches what the app uses on prod.
 * Override with --collections=a,b,c when testing or partial migration.
 * Keep this in sync with docs/migration/FIREBASE_TOPOLOGY.md §2.
 */
const COLLECTIONS = [
  // Business entities
  'clients',
  'companies',
  'users',
  'gtd_tasks',
  'work_sessions',
  'projects',
  'estimates',
  'saved_estimates',
  'meetings',
  'sites',
  'punch_lists',
  'warranty_tasks',
  'work_acts',
  // Finance
  'bank_transactions',
  'bank_statements',
  'project_ledger',
  'costs',
  // Warehouse V3
  'inventory_catalog',
  'inventory_transactions_v2',
  // Legacy warehouse (V1, kept during overlap)
  'warehouses',
  'inventory_items',
  'inventory_transactions',
  'inventory_norms',
  'inventory_locations',
  // Blueprint AI
  'blueprint_jobs',
  'blueprint_batches',
  'blueprint_v3_sessions',
  // Operational
  'files',
  'invitations',
  'client_portal_tokens',
  'dev_logs',
  'notifications',
  'agent_feedbacks',
  'agent_tokens',
  '_admin_activity_logs',
  '_audit_logs',
];

// ─── Helpers ────────────────────────────────────────────────────────

function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (v instanceof Timestamp) {
    return { __timestamp: v.toMillis() };
  }
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === 'object') {
    if ((v as { _latitude?: number; _longitude?: number })._latitude !== undefined) {
      return { __geopoint: [(v as { _latitude: number })._latitude, (v as { _longitude: number })._longitude] };
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = serializeValue(val);
    return out;
  }
  return v;
}

async function initAdmin(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sa = require('../../service-account-key.json');
    initializeApp({ credential: cert(sa) });
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sa = require('../../functions/service-account-key.json');
      initializeApp({ credential: cert(sa) });
    } catch {
      initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'profit-step' });
    }
  }
}

async function exportCollection(
  name: string,
  outDir: string,
): Promise<{ count: number; parts: number }> {
  const db = getFirestore();
  const snap = await db.collection(name).get();
  const count = snap.size;

  if (count === 0) return { count: 0, parts: 0 };
  if (DRY_RUN) return { count, parts: Math.ceil(count / CHUNK_SIZE) };

  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });

  let part = 0;
  for (let i = 0; i < snap.docs.length; i += CHUNK_SIZE) {
    part++;
    const chunk = snap.docs.slice(i, i + CHUNK_SIZE).map(doc => ({
      id: doc.id,
      data: serializeValue(doc.data()),
    }));
    const file = path.join(dir, `part-${String(part).padStart(4, '0')}.json`);
    fs.writeFileSync(file, JSON.stringify(chunk, null, 2));
  }

  return { count, parts: part };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await initAdmin();

  const collections = EXPLICIT_COLLECTIONS ?? COLLECTIONS;
  if (!DRY_RUN) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const manifest: Record<string, { count: number; parts: number; exportedAt: string }> = {};
  const startedAt = Date.now();

  console.log(`🚀 ${DRY_RUN ? '[DRY RUN] ' : ''}exporting ${collections.length} collections → ${OUT_DIR}`);

  for (const col of collections) {
    process.stdout.write(`  ${col.padEnd(30)}`);
    try {
      const { count, parts } = await exportCollection(col, OUT_DIR);
      manifest[col] = { count, parts, exportedAt: new Date().toISOString() };
      console.log(`${count.toString().padStart(6)} docs  ${parts} part(s)`);
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`);
      manifest[col] = { count: -1, parts: 0, exportedAt: new Date().toISOString() };
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(
      path.join(OUT_DIR, 'manifest.json'),
      JSON.stringify(
        {
          sourceProject: process.env.GOOGLE_CLOUD_PROJECT ?? 'profit-step',
          exportedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          chunkSize: CHUNK_SIZE,
          collections: manifest,
        },
        null,
        2,
      ),
    );
  }

  const totalDocs = Object.values(manifest).reduce((s, m) => s + Math.max(0, m.count), 0);
  console.log(`\n✅ ${DRY_RUN ? 'would export' : 'exported'} ${totalDocs} docs total in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main().catch(e => {
  console.error('❌ export failed:', e);
  process.exit(1);
});
