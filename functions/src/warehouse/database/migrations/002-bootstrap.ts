/**
 * Migration 002 — bootstrap the new warehouse model.
 *
 * After 001 wipes legacy collections, this seeds the new wh_* collections
 * with the minimal starting set: locations, categories, items, norms, vendors.
 *
 * Idempotent on a per-document basis: existing docs are skipped (we never
 * overwrite). If a doc was manually edited, re-running this migration will
 * not clobber those edits.
 */

import * as admin from 'firebase-admin';
import type { Migration, MigrationOptions, MigrationResult } from './_runner';
import { WH_COLLECTIONS } from '../collections';
import {
  SEED_CATEGORIES,
  SEED_ITEMS,
  SEED_LOCATIONS,
  SEED_NORMS,
  SEED_VENDORS,
} from '../seed';

type SeedCounts = { checked: number; inserted: number; skipped: number };

async function insertSeeds<T extends { id: string }>(
  db: admin.firestore.Firestore,
  collectionName: string,
  seeds: readonly T[],
  buildDoc: (seed: T) => Record<string, unknown>,
  dryRun: boolean,
): Promise<SeedCounts> {
  let inserted = 0;
  let skipped = 0;

  for (const seed of seeds) {
    const ref = db.collection(collectionName).doc(seed.id);
    const existing = await ref.get();
    if (existing.exists) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      await ref.set(buildDoc(seed));
    }
    inserted++;
  }

  return { checked: seeds.length, inserted, skipped };
}

function commonBase() {
  return {
    schemaVersion: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'system',
    createdByType: 'system' as const,
  };
}

export const BootstrapWarehouseMigration: Migration = {
  id: '002-bootstrap',
  description: 'Seed new warehouse model (locations, categories, items, norms, vendors)',

  async run(db: admin.firestore.Firestore, options: MigrationOptions): Promise<MigrationResult> {
    const { dryRun } = options;

    const locations = await insertSeeds(db, WH_COLLECTIONS.locations, SEED_LOCATIONS, (seed) => ({
      ...commonBase(),
      name: seed.name,
      locationType: seed.locationType,
      ownerEmployeeId: seed.ownerEmployeeId ?? null,
      licensePlate: seed.licensePlate ?? null,
      address: seed.address ?? null,
      twoPhaseTransferEnabled: seed.twoPhaseTransferEnabled ?? false,
      isActive: true,
    }), dryRun);

    const categories = await insertSeeds(db, WH_COLLECTIONS.categories, SEED_CATEGORIES, (seed) => ({
      ...commonBase(),
      name: seed.name,
      slug: seed.slug,
      parentId: seed.parentId ?? null,
      displayOrder: seed.displayOrder,
      isActive: true,
    }), dryRun);

    const items = await insertSeeds(db, WH_COLLECTIONS.items, SEED_ITEMS, (seed) => ({
      ...commonBase(),
      sku: seed.sku,
      name: seed.name,
      category: seed.category,
      baseUOM: seed.baseUOM,
      purchaseUOMs: seed.purchaseUOMs,
      allowedIssueUOMs: seed.allowedIssueUOMs,
      lastPurchasePrice: seed.lastPurchasePrice,
      averageCost: seed.averageCost,
      minStock: seed.minStock ?? null,
      isTrackable: seed.isTrackable ?? false,
      isActive: true,
      notes: seed.notes ?? null,
    }), dryRun);

    const norms = await insertSeeds(db, WH_COLLECTIONS.norms, SEED_NORMS, (seed) => ({
      ...commonBase(),
      taskType: seed.taskType,
      name: seed.name,
      description: seed.description ?? null,
      items: seed.items,
      estimatedLaborHours: seed.estimatedLaborHours ?? null,
      isActive: true,
    }), dryRun);

    const vendors = await insertSeeds(db, WH_COLLECTIONS.vendors, SEED_VENDORS, (seed) => ({
      ...commonBase(),
      name: seed.name,
      vendorType: seed.vendorType,
      contactEmail: seed.contactEmail ?? null,
      contactName: seed.contactName ?? null,
      preferredForCategories: seed.preferredForCategories ?? null,
      defaultPaymentTerms: seed.defaultPaymentTerms ?? null,
      isActive: true,
    }), dryRun);

    return {
      id: this.id,
      dryRun,
      appliedAt: new Date().toISOString(),
      summary: {
        locations,
        categories,
        items,
        norms,
        vendors,
      },
    };
  },
};
