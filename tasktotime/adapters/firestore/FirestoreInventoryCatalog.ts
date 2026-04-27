/**
 * FirestoreInventoryCatalog — `inventory_catalog/{itemId}` adapter.
 *
 * Implements {@link InventoryCatalogPort} on top of Firebase Admin Firestore.
 * Read-only — tasktotime never writes to `inventory_catalog/`.
 *
 * See spec/04-storage/adapter-mapping.md §11 InventoryCatalogPort.
 *
 * Snapshot semantics (CRITICAL):
 *   The caller MUST copy the returned snapshot fields into `Task.materials[i]`
 *   at add time — `catalogItemId` alone is NOT enough. Catalog price changes
 *   intentionally do NOT propagate into existing task materials. See the
 *   "Snapshot contract" example in adapter-mapping.md §11.
 *
 * Conventions:
 *   - `findById` returns `null` for not-found (per port contract).
 *   - `findByIds` chunks at the 30-id `getAll` limit.
 *   - `search` is prefix-based: `name >= q AND name < q + ''`. Real
 *     fuzzy search is reserved for a future Algolia/Typesense adapter.
 *   - All multi-doc queries scoped by `companyId` for RLS.
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  InventoryCatalogPort,
  CatalogItemSnapshot,
} from '../../ports/inventory/InventoryCatalogPort';
import {
  asCatalogItemId,
  asCompanyId,
  type CatalogItemId,
  type CompanyId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, getAllChunked, noopLogger } from './_shared';

const COLLECTION = 'inventory_catalog';
const DEFAULT_SEARCH_LIMIT = 20;
/** Unicode end-of-range sentinel for prefix queries. */
const PREFIX_END_SENTINEL = '';

export class FirestoreInventoryCatalog implements InventoryCatalogPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single catalog item by id.
   *
   * Adapter mapping: `get inventory_catalog/{id}` (§11 row 1).
   * Returns `null` if document does not exist.
   */
  async findById(id: CatalogItemId): Promise<CatalogItemSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(data, snap.id);
    } catch (err) {
      this.logger.error?.('FirestoreInventoryCatalog.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'InventoryCatalog.findById', id });
    }
  }

  /**
   * Multi-doc read using `getAll`. Chunked at the 30-id Firestore limit
   * via {@link getAllChunked}.
   *
   * Adapter mapping: §11 row 2.
   */
  async findByIds(ids: CatalogItemId[]): Promise<CatalogItemSnapshot[]> {
    if (ids.length === 0) return [];
    try {
      return await getAllChunked(this.db, COLLECTION, ids, mapToSnapshot);
    } catch (err) {
      this.logger.error?.('FirestoreInventoryCatalog.findByIds failed', {
        count: ids.length,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'InventoryCatalog.findByIds',
        count: ids.length,
      });
    }
  }

  /**
   * Prefix search by `name` within company scope.
   *
   * Adapter mapping (§11 row 3):
   *   `where companyId == X .where name >= q .where name < q+'' .limit N`.
   *
   * Composite index needed: `companyId + name`. The `` sentinel is the
   * standard Firestore trick for half-open string range queries.
   */
  async search(
    companyId: CompanyId,
    query: string,
    limit?: number,
  ): Promise<CatalogItemSnapshot[]> {
    try {
      const effectiveLimit = limit ?? DEFAULT_SEARCH_LIMIT;
      // Empty query → list first N (still companyId-scoped).
      const q = query.length === 0
        ? this.db
            .collection(COLLECTION)
            .where('companyId', '==', companyId)
            .orderBy('name')
            .limit(effectiveLimit)
        : this.db
            .collection(COLLECTION)
            .where('companyId', '==', companyId)
            .where('name', '>=', query)
            .where('name', '<', query + PREFIX_END_SENTINEL)
            .orderBy('name')
            .limit(effectiveLimit);
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(data, d.id) : null;
        })
        .filter((x): x is CatalogItemSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreInventoryCatalog.search failed', {
        companyId,
        query,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'InventoryCatalog.search',
        companyId,
        query,
      });
    }
  }
}

// ─── Internal: Firestore data → CatalogItemSnapshot ───────────────────

function mapToSnapshot(
  data: FirebaseFirestore.DocumentData,
  id: string,
): CatalogItemSnapshot {
  const result: CatalogItemSnapshot = {
    id: asCatalogItemId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    name: String(data.name ?? ''),
    category: String(data.category ?? ''),
    unit: String(data.unit ?? ''),
    lastPurchasePrice: typeof data.lastPurchasePrice === 'number'
      ? data.lastPurchasePrice
      : 0,
    avgPrice: typeof data.avgPrice === 'number' ? data.avgPrice : 0,
  };
  if (typeof data.clientMarkupPercent === 'number') {
    result.clientMarkupPercent = data.clientMarkupPercent;
  }
  if (typeof data.totalStock === 'number') {
    result.totalStock = data.totalStock;
  }
  return result;
}
