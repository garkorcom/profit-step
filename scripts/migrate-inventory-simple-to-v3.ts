/**
 * Inventory Migration: Simple API (V1) → V3 unified journal
 *
 * Copies:
 *   warehouses          → inventory_locations   (type='warehouse' or 'vehicle')
 *   inventory_items     → inventory_catalog     (with stockByLocation seeded)
 *   inventory_transactions → inventory_transactions_v2  (schema-rewritten)
 *
 * Usage:
 *   npx ts-node scripts/migrate-inventory-simple-to-v3.ts --dry-run
 *   npx ts-node scripts/migrate-inventory-simple-to-v3.ts --commit
 *   npx ts-node scripts/migrate-inventory-simple-to-v3.ts --rollback
 *
 * Safety:
 *   - --dry-run (default): reads only, logs what would change, no writes
 *   - --commit: writes V3 docs with `migratedAt` timestamp, skips any doc
 *     already marked as migrated (idempotent)
 *   - --rollback: finds V3 docs with `migratedAt` and deletes them
 *
 * Source collections are NEVER modified or deleted. Post-migration they
 * remain for 2 weeks as read-only fallback, then can be archived manually.
 *
 * Deploy workflow:
 *   1. Run --dry-run on staging, verify summary matches expectations
 *   2. Run --commit on staging, smoke-test UI + API reads
 *   3. Run --dry-run on prod (Denis approves)
 *   4. Run --commit on prod in low-traffic window
 *   5. Monitor /recalculate invocations for 48h; if any, --rollback + investigate
 *
 * WARNING: Do NOT run without service-account-key.json pointing at the right
 * project. There is no prompt / confirmation — the presence of --commit flag
 * IS the confirmation.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, WriteBatch } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const MODE: 'dry-run' | 'commit' | 'rollback' =
  args.includes('--commit') ? 'commit'
  : args.includes('--rollback') ? 'rollback'
  : 'dry-run';

type Unit = 'шт' | 'кг' | 'л' | 'м' | 'м²' | 'упак' | 'рул';
type Category = 'materials' | 'tools' | 'consumables' | 'equipment';

/**
 * Simple-API unit codes ('pcs', 'pack', ...) → V3 unit labels.
 * Unknown unit falls back to 'шт' with a warning.
 */
const UNIT_MAP: Record<string, Unit> = {
  pcs: 'шт',
  pack: 'упак',
  roll: 'рул',
  ft: 'м',
  box: 'упак',
  spool: 'рул',
  m: 'м',
  kg: 'кг',
  l: 'л',
};

/**
 * Simple-API category codes → V3 4-way classification.
 * Electrical/plumbing/hardware → materials; audio_video → equipment.
 */
const CATEGORY_MAP: Record<string, Category> = {
  electrical: 'materials',
  plumbing: 'materials',
  hardware: 'materials',
  audio_video: 'equipment',
  other: 'materials',
};

/**
 * Simple-API tx types map to V3 types. 'in' has no direction encoded; we
 * assume purchase. 'out' → write_off (most common). 'transfer' stays.
 */
const TX_TYPE_MAP: Record<string, string> = {
  in: 'purchase',
  out: 'write_off',
  transfer: 'transfer',
};

function log(msg: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`[${MODE}] ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${MODE}] ${msg}`);
  }
}

function warn(msg: string, data?: unknown): void {
  console.warn(`[${MODE}] ⚠️  ${msg}`, data ?? '');
}

interface MigrationStats {
  warehousesScanned: number;
  warehousesWouldMigrate: number;
  warehousesAlreadyMigrated: number;
  itemsScanned: number;
  itemsWouldMigrate: number;
  itemsAlreadyMigrated: number;
  transactionsScanned: number;
  transactionsWouldMigrate: number;
  transactionsAlreadyMigrated: number;
  errors: number;
}

async function initAdmin(): Promise<void> {
  // Prefer service-account-key.json when present (explicit project binding);
  // fall back to Google Application Default Credentials so `gcloud auth
  // application-default login` + `gcloud config set project profit-step`
  // is enough to run the script without handling a key file.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require('../service-account-key.json');
    initializeApp({ credential: cert(serviceAccount) });
  } catch {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? 'profit-step' });
  }
}

async function migrate(): Promise<MigrationStats> {
  const db = getFirestore();
  const stats: MigrationStats = {
    warehousesScanned: 0,
    warehousesWouldMigrate: 0,
    warehousesAlreadyMigrated: 0,
    itemsScanned: 0,
    itemsWouldMigrate: 0,
    itemsAlreadyMigrated: 0,
    transactionsScanned: 0,
    transactionsWouldMigrate: 0,
    transactionsAlreadyMigrated: 0,
    errors: 0,
  };

  log('🚀 starting inventory migration');

  // ── 1. Warehouses → inventory_locations ───────────────────────────

  const whSnap = await db.collection('warehouses').get();
  stats.warehousesScanned = whSnap.size;
  log(`found ${whSnap.size} warehouses`);

  const itemIdByWhName = new Map<string, string>(); // warehouseId → v3 location id

  let batch: WriteBatch | null = MODE === 'commit' ? db.batch() : null;
  let batchOps = 0;

  for (const whDoc of whSnap.docs) {
    const w = whDoc.data();
    const v3Ref = db.collection('inventory_locations').doc(whDoc.id);
    const existing = await v3Ref.get();

    if (existing.exists && existing.data()?.migratedAt) {
      stats.warehousesAlreadyMigrated++;
      itemIdByWhName.set(whDoc.id, whDoc.id);
      continue;
    }

    const v3Doc = {
      name: w.name,
      type: w.type === 'vehicle' ? 'vehicle' : 'warehouse',
      ownerEmployeeId: w.ownerEmployeeId ?? null,
      relatedClientId: w.clientId ?? null,
      address: w.address ?? w.location ?? null,
      isActive: !w.archived,
      createdAt: w.createdAt ?? Timestamp.now(),
      migratedAt: Timestamp.now(),
      migratedFrom: 'warehouses',
      migratedFromId: whDoc.id,
    };

    if (MODE === 'commit') {
      batch!.set(v3Ref, v3Doc);
      batchOps++;
    } else {
      log(`would migrate warehouse ${whDoc.id} → ${v3Doc.name}`);
    }
    stats.warehousesWouldMigrate++;
    itemIdByWhName.set(whDoc.id, whDoc.id);

    if (batchOps >= 400 && batch) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  if (batch && batchOps > 0) {
    await batch.commit();
    batch = MODE === 'commit' ? db.batch() : null;
    batchOps = 0;
  }

  // ── 2. Inventory items → inventory_catalog ────────────────────────

  const itemSnap = await db.collection('inventory_items').get();
  stats.itemsScanned = itemSnap.size;
  log(`found ${itemSnap.size} inventory_items`);

  const itemsByName = new Map<string, {
    id: string;
    name: string;
    unit: Unit;
    category: Category;
    stockByLocation: Record<string, number>;
    minStock: number;
    barcode?: string;
  }>();

  for (const itemDoc of itemSnap.docs) {
    const it = itemDoc.data();
    const v3Ref = db.collection('inventory_catalog').doc(itemDoc.id);
    const existing = await v3Ref.get();

    if (existing.exists && existing.data()?.migratedAt) {
      stats.itemsAlreadyMigrated++;
      continue;
    }

    const unit = UNIT_MAP[it.unit] ?? 'шт';
    const category = CATEGORY_MAP[it.category] ?? 'materials';
    if (!UNIT_MAP[it.unit]) {
      warn(`unknown unit "${it.unit}" on item ${itemDoc.id} — defaulting to шт`);
    }
    const locationId = it.warehouseId;
    const stockByLocation: Record<string, number> = { [locationId]: it.quantity ?? 0 };

    const v3Doc = {
      name: it.name,
      sku: it.barcode ?? null,
      category,
      unit,
      stockByLocation,
      totalStock: it.quantity ?? 0,
      minStock: it.minStock ?? 0,
      avgPrice: 0,
      lastPurchasePrice: 0,
      clientMarkupPercent: 20,
      isTrackable: category === 'tools' || category === 'equipment',
      isArchived: false,
      createdAt: it.createdAt ?? Timestamp.now(),
      updatedAt: it.updatedAt ?? Timestamp.now(),
      createdBy: it.createdBy ?? 'migration',
      migratedAt: Timestamp.now(),
      migratedFrom: 'inventory_items',
      migratedFromId: itemDoc.id,
    };

    if (MODE === 'commit' && batch) {
      batch.set(v3Ref, v3Doc);
      batchOps++;
    } else if (MODE === 'dry-run') {
      log(`would migrate item ${itemDoc.id} (${it.name}) qty=${it.quantity ?? 0}`);
    }
    stats.itemsWouldMigrate++;
    itemsByName.set(`${it.warehouseId}:${it.name}`, {
      id: itemDoc.id,
      name: it.name,
      unit,
      category,
      stockByLocation,
      minStock: it.minStock ?? 0,
      barcode: it.barcode ?? undefined,
    });

    if (batchOps >= 400 && batch) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  if (batch && batchOps > 0) {
    await batch.commit();
    batch = MODE === 'commit' ? db.batch() : null;
    batchOps = 0;
  }

  // ── 3. Transactions → inventory_transactions_v2 ───────────────────

  const txSnap = await db.collection('inventory_transactions').get();
  stats.transactionsScanned = txSnap.size;
  log(`found ${txSnap.size} inventory_transactions`);

  for (const txDoc of txSnap.docs) {
    const tx = txDoc.data();
    const v3Ref = db.collection('inventory_transactions_v2').doc(txDoc.id);
    const existing = await v3Ref.get();

    if (existing.exists && existing.data()?.migratedAt) {
      stats.transactionsAlreadyMigrated++;
      continue;
    }

    const newType = TX_TYPE_MAP[tx.type] ?? 'adjustment_out';
    const catalog = await db.collection('inventory_catalog').doc(tx.itemId).get();
    const catalogData = catalog.data();
    if (!catalogData) {
      warn(`tx ${txDoc.id} references unknown catalog item ${tx.itemId}, skipping`);
      stats.errors++;
      continue;
    }

    const v3Doc = {
      catalogItemId: tx.itemId,
      catalogItemName: tx.itemName ?? catalogData.name,
      category: catalogData.category,
      type: newType,
      qty: tx.quantity,
      unitPrice: 0,
      totalAmount: 0,
      stockAfter: tx.quantityAfter ?? 0,
      fromLocation: tx.type === 'out' || tx.type === 'transfer' ? tx.warehouseId : null,
      toLocation: tx.type === 'in' ? tx.warehouseId : (tx.toWarehouseId ?? null),
      performedBy: tx.performedBy ?? 'unknown',
      performedByName: tx.performedByName ?? tx.performedBy ?? 'unknown',
      timestamp: tx.createdAt ?? Timestamp.now(),
      relatedTaskId: tx.relatedTaskId ?? null,
      relatedNormId: tx.normId ?? null,
      note: tx.notes ?? null,
      source: 'migration',
      migratedAt: Timestamp.now(),
      migratedFrom: 'inventory_transactions',
      migratedFromId: txDoc.id,
    };

    if (MODE === 'commit' && batch) {
      batch.set(v3Ref, v3Doc);
      batchOps++;
    } else if (MODE === 'dry-run') {
      log(`would migrate tx ${txDoc.id}: ${tx.type} x${tx.quantity} ${tx.itemName}`);
    }
    stats.transactionsWouldMigrate++;

    if (batchOps >= 400 && batch) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  }

  if (batch && batchOps > 0) {
    await batch.commit();
  }

  return stats;
}

async function rollback(): Promise<{ deleted: number }> {
  const db = getFirestore();
  let deleted = 0;

  for (const col of ['inventory_locations', 'inventory_catalog', 'inventory_transactions_v2']) {
    const snap = await db.collection(col).where('migratedAt', '!=', null).get();
    log(`rolling back ${snap.size} docs from ${col}`);
    let batch = db.batch();
    let ops = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      ops++;
      deleted++;
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
  }
  return { deleted };
}

async function main(): Promise<void> {
  await initAdmin();

  if (MODE === 'rollback') {
    const result = await rollback();
    console.log('\n✅ rollback complete', result);
    return;
  }

  const stats = await migrate();
  console.log('\n📊 migration summary\n', stats);
  if (MODE === 'dry-run') {
    console.log('\nℹ️  this was a dry run. Nothing was written.');
    console.log('   Re-run with --commit to apply changes.');
  } else {
    console.log('\n✅ migration complete.');
  }
}

main().catch((err) => {
  console.error('❌ migration failed:', err);
  process.exit(1);
});
