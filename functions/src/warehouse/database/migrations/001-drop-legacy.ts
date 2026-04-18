/**
 * Migration 001 — drop legacy inventory collections.
 *
 * The old test-data-only inventory (warehouses, inventory_items,
 * inventory_catalog, inventory_transactions, inventory_transactions_v2,
 * inventory_locations, inventory_reservations) is wiped to make room for
 * the new ledger-based model.
 *
 * Safety: callers are responsible for export/backup before running this.
 * The migration itself only deletes; it does not back up.
 */

import type * as admin from 'firebase-admin';
import type { Migration, MigrationOptions, MigrationResult } from './_runner';
import { LEGACY_INVENTORY_COLLECTIONS } from '../collections';

const BATCH_SIZE = 400; // under Firestore's 500-writes-per-batch limit

async function deleteCollectionInBatches(
  db: admin.firestore.Firestore,
  name: string,
  dryRun: boolean,
  verbose: boolean,
): Promise<number> {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db.collection(name).limit(BATCH_SIZE).get();
    if (snap.empty) break;

    if (!dryRun) {
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
    }

    deleted += snap.size;
    if (verbose) {
      // eslint-disable-next-line no-console
      console.log(`  [${dryRun ? 'DRY' : 'LIVE'}] ${name}: removed batch of ${snap.size} (running total ${deleted})`);
    }

    // For a dry run we cannot "consume" documents, so bail out after first
    // page to avoid an infinite loop; the count below reflects a single
    // page when dryRun=true, which the caller compensates for.
    if (dryRun) break;
  }

  return deleted;
}

async function countCollection(db: admin.firestore.Firestore, name: string): Promise<number> {
  // Firestore doesn't expose a cheap count; fetch all doc ids.
  const snap = await db.collection(name).select().get();
  return snap.size;
}

export const DropLegacyInventoryMigration: Migration = {
  id: '001-drop-legacy',
  description: 'Drop legacy inventory collections prior to warehouse rewrite',

  async run(db: admin.firestore.Firestore, options: MigrationOptions): Promise<MigrationResult> {
    const verbose = !!options.verbose;
    const dryRun = options.dryRun;

    const preCounts: Record<string, number> = {};
    const postDeleted: Record<string, number> = {};

    for (const coll of LEGACY_INVENTORY_COLLECTIONS) {
      preCounts[coll] = await countCollection(db, coll);
    }

    if (verbose) {
      // eslint-disable-next-line no-console
      console.log(`[001-drop-legacy] mode=${dryRun ? 'DRY' : 'LIVE'} pre-counts:`, preCounts);
    }

    for (const coll of LEGACY_INVENTORY_COLLECTIONS) {
      if (preCounts[coll] === 0) {
        postDeleted[coll] = 0;
        continue;
      }
      postDeleted[coll] = await deleteCollectionInBatches(db, coll, dryRun, verbose);
    }

    return {
      id: this.id,
      dryRun,
      appliedAt: new Date().toISOString(),
      summary: {
        preCounts,
        deleted: postDeleted,
        totalDeleted: Object.values(postDeleted).reduce((a, b) => a + b, 0),
      },
    };
  },
};
