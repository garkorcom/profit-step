/**
 * Firestore loaders — small helpers that fetch the state AI capabilities
 * need and return it in the shape those capabilities expect.
 *
 * Kept separate from route handlers so they stay unit-testable against a
 * FakeDb (see test/warehouse-loaders.test.ts).
 */

import type * as admin from 'firebase-admin';
import type { FuzzyCandidate } from '../agent';
import type { WhBalance, WhItem, WhNorm } from '../core/types';
import { makeBalanceKey } from '../core/types';
import { WH_COLLECTIONS } from '../database/collections';

// ═══════════════════════════════════════════════════════════════════
//  Catalog
// ═══════════════════════════════════════════════════════════════════

/**
 * Load active items from the catalog as FuzzyCandidate rows.
 * Used by UC1 and UC2 to match free-text/OCR lines.
 */
export async function loadCatalog(
  db: admin.firestore.Firestore,
  options: { limit?: number } = {},
): Promise<FuzzyCandidate[]> {
  const snap = await db
    .collection(WH_COLLECTIONS.items)
    .where('isActive', '==', true)
    .limit(options.limit ?? 500)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as Partial<WhItem>;
    return {
      id: d.id,
      name: data.name ?? '',
      sku: data.sku,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
//  Clients
// ═══════════════════════════════════════════════════════════════════

/**
 * Load known clients. Reads from the existing `clients` collection (not
 * inside wh_*) to reuse the master customer list.
 */
export async function loadClients(
  db: admin.firestore.Firestore,
  options: { limit?: number } = {},
): Promise<Array<{ id: string; name: string }>> {
  const snap = await db.collection('clients').limit(options.limit ?? 500).get();
  return snap.docs
    .map((d) => ({ id: d.id, name: String((d.data() as any)?.name ?? '') }))
    .filter((c) => !!c.name);
}

// ═══════════════════════════════════════════════════════════════════
//  Vendors
// ═══════════════════════════════════════════════════════════════════

export async function loadVendors(
  db: admin.firestore.Firestore,
): Promise<Array<{ id: string; name: string }>> {
  const snap = await db.collection(WH_COLLECTIONS.vendors).where('isActive', '==', true).get();
  return snap.docs.map((d) => ({ id: d.id, name: String((d.data() as any)?.name ?? '') }));
}

// ═══════════════════════════════════════════════════════════════════
//  Norm + referenced items + balances (for UC3)
// ═══════════════════════════════════════════════════════════════════

export interface WriteoffContext {
  norm: WhNorm | null;
  items: Map<string, WhItem>;
  balances: Map<string, WhBalance>;
}

/**
 * One round-trip helper: given a taskType + locationId, load everything
 * proposeTaskWriteoff needs. Returns norm=null if the taskType is unknown;
 * the capability will surface `no_norm` in that case.
 */
export async function loadWriteoffContext(
  db: admin.firestore.Firestore,
  params: { taskType: string; locationId: string },
): Promise<WriteoffContext> {
  // 1. Find norm by taskType
  const normSnap = await db
    .collection(WH_COLLECTIONS.norms)
    .where('taskType', '==', params.taskType)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (normSnap.empty) {
    return { norm: null, items: new Map(), balances: new Map() };
  }

  const normDoc = normSnap.docs[0];
  const norm = { id: normDoc.id, ...(normDoc.data() as any) } as WhNorm;

  const itemIds = Array.from(new Set((norm.items ?? []).map((i) => i.itemId)));
  if (itemIds.length === 0) {
    return { norm, items: new Map(), balances: new Map() };
  }

  // 2. Load referenced items in parallel
  const itemDocs = await Promise.all(
    itemIds.map((id) => db.collection(WH_COLLECTIONS.items).doc(id).get()),
  );
  const items = new Map<string, WhItem>();
  for (const d of itemDocs) {
    if (d.exists) items.set(d.id, { id: d.id, ...(d.data() as any) } as WhItem);
  }

  // 3. Load balances at locationId in parallel (compound key lookup — O(1))
  const balanceDocs = await Promise.all(
    itemIds.map((id) => db.collection(WH_COLLECTIONS.balances).doc(makeBalanceKey(params.locationId, id)).get()),
  );
  const balances = new Map<string, WhBalance>();
  for (const d of balanceDocs) {
    if (d.exists) balances.set(d.id, { id: d.id, ...(d.data() as any) } as WhBalance);
  }

  return { norm, items, balances };
}
