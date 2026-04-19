/**
 * Firestore JSON import — counterpart to export-firestore-json.ts.
 *
 * Reads a dump directory (with `manifest.json` + per-collection `part-*.json`
 * files) and writes it into the **currently-configured** Firebase project.
 *
 * Usage:
 *   GOOGLE_CLOUD_PROJECT=new-project-id npx ts-node scripts/migration/import-firestore-json.ts --in=./dump --dry-run
 *   GOOGLE_CLOUD_PROJECT=new-project-id npx ts-node scripts/migration/import-firestore-json.ts --in=./dump --commit
 *   GOOGLE_CLOUD_PROJECT=new-project-id npx ts-node scripts/migration/import-firestore-json.ts --in=./dump --commit --collections=clients
 *
 * Flags:
 *   --in=<dir>         required, output of export-firestore-json.ts
 *   --dry-run          default; reads files, validates, prints plan, no writes
 *   --commit           actually writes
 *   --collections=...  limit to subset
 *   --batch=<n>        Firestore batch size (default 400, max 500)
 *
 * Safety:
 *   - Refuses to run against `profit-step` unless --force flag is present.
 *     This script is designed for IMPORTING INTO a new project. Protection
 *     against accidentally overwriting prod.
 *   - Pre-existing documents with the same ID are overwritten with
 *     `{ merge: false }`. If --merge flag is set, existing docs get merged.
 *
 * Auth: ADC via `gcloud auth application-default login`, pointed at the
 *       target project via GOOGLE_CLOUD_PROJECT env var.
 */

import * as fs from 'fs';
import * as path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, WriteBatch } from 'firebase-admin/firestore';

// ─── Flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getFlag = (name: string, fallback?: string): string | undefined => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const IN_DIR = getFlag('in');
if (!IN_DIR) {
  console.error('❌ --in=<dump-dir> is required');
  process.exit(1);
}
const BATCH_SIZE = Math.min(parseInt(getFlag('batch', '400')!, 10), 500);
const MODE: 'dry-run' | 'commit' = hasFlag('commit') ? 'commit' : 'dry-run';
const MERGE = hasFlag('merge');
const EXPLICIT_COLLECTIONS = getFlag('collections')?.split(',').filter(Boolean);
const FORCE = hasFlag('force');

// ─── Helpers ────────────────────────────────────────────────────────

function deserializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(deserializeValue);
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.__timestamp === 'number') {
      return Timestamp.fromMillis(obj.__timestamp);
    }
    if (Array.isArray(obj.__geopoint)) {
      // firebase-admin exposes GeoPoint; use plain object fallback if not available
      const [lat, lng] = obj.__geopoint as [number, number];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GeoPoint } = require('firebase-admin/firestore');
      return new GeoPoint(lat, lng);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) out[k] = deserializeValue(val);
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
    initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
}

interface ManifestEntry {
  count: number;
  parts: number;
  exportedAt: string;
}

interface Manifest {
  sourceProject: string;
  exportedAt: string;
  durationMs: number;
  chunkSize: number;
  collections: Record<string, ManifestEntry>;
}

async function importCollection(
  col: string,
  entry: ManifestEntry,
): Promise<{ written: number }> {
  if (entry.parts === 0) return { written: 0 };

  const db = getFirestore();
  let written = 0;
  let batch: WriteBatch | null = MODE === 'commit' ? db.batch() : null;
  let batchOps = 0;

  for (let p = 1; p <= entry.parts; p++) {
    const file = path.join(IN_DIR!, col, `part-${String(p).padStart(4, '0')}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  ⚠️  missing ${file}, skipping`);
      continue;
    }
    const docs = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{ id: string; data: unknown }>;

    for (const doc of docs) {
      const data = deserializeValue(doc.data) as Record<string, unknown>;
      if (MODE === 'commit' && batch) {
        const ref = db.collection(col).doc(doc.id);
        if (MERGE) {
          batch.set(ref, data, { merge: true });
        } else {
          batch.set(ref, data);
        }
        batchOps++;
        if (batchOps >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          batchOps = 0;
        }
      }
      written++;
    }
  }

  if (batch && batchOps > 0) {
    await batch.commit();
  }

  return { written };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await initAdmin();

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!FORCE && (projectId === 'profit-step' || !projectId)) {
    console.error(
      `❌ refusing to import into ${projectId ?? '<unset>'} without --force.\n` +
      `   This script is meant for NEW Firebase projects. Set GOOGLE_CLOUD_PROJECT\n` +
      `   to the migration target and re-run. Use --force only if you really\n` +
      `   intend to overwrite data in the production project.`,
    );
    process.exit(1);
  }

  const manifestPath = path.join(IN_DIR!, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ manifest.json not found at ${manifestPath}`);
    process.exit(1);
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  console.log(`\n🎯 target project: ${projectId}`);
  console.log(`📦 source dump: ${IN_DIR} (exported ${manifest.exportedAt} from ${manifest.sourceProject})`);
  console.log(`🚦 mode: ${MODE}${MERGE ? ' (merge)' : ''}\n`);

  const collections = EXPLICIT_COLLECTIONS ?? Object.keys(manifest.collections);
  const startedAt = Date.now();
  let totalWritten = 0;

  for (const col of collections) {
    const entry = manifest.collections[col];
    if (!entry) {
      console.log(`  ${col.padEnd(30)} ⚠️  not in manifest`);
      continue;
    }
    process.stdout.write(`  ${col.padEnd(30)}`);
    const { written } = await importCollection(col, entry);
    totalWritten += written;
    console.log(`${written.toString().padStart(6)} docs ${MODE === 'dry-run' ? '(would write)' : 'written'}`);
  }

  console.log(
    `\n✅ ${MODE === 'dry-run' ? 'would write' : 'wrote'} ${totalWritten} docs in ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );

  if (MODE === 'dry-run') {
    console.log('\nℹ️  this was a dry run. Re-run with --commit to actually write.');
  }
}

main().catch(e => {
  console.error('❌ import failed:', e);
  process.exit(1);
});
