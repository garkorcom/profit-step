/**
 * Core posting engine.
 *
 * Single entry point for turning a draft document into ledger entries +
 * balance updates. All inventory state mutations flow through here.
 *
 * Algorithm reference: docs/warehouse/core/02_posting_engine/SPEC.md §3.
 *
 * This function is designed around the "tx" contract exposed by Firestore's
 * runTransaction — each caller (production vs. tests) provides a compatible
 * implementation. See postDocument's signature for the exact shape.
 */

import {
  convertToBaseQty,
  convertToBaseUnitCost,
  computeAvailableQty,
  DEFAULT_NEGATIVE_STOCK_POLICY,
  makeBalanceKey,
  type LocationType,
  type NegativeStockPolicy,
  type WhBalance,
  type WhDocument,
  type WhDocumentLine,
  type WhItem,
  type WhLedgerEntry,
  type WhLocation,
} from '../types';
import { WH_COLLECTIONS } from '../../database/collections';
import { WarehouseError } from './errors';

// ═══════════════════════════════════════════════════════════════════
//  Transaction abstraction — used by both admin SDK and tests
// ═══════════════════════════════════════════════════════════════════

export interface PostTx {
  /** Read a single doc (returns undefined if missing). */
  get<T = any>(collection: string, id: string): Promise<T | undefined>;
  /** Query the subcollection `lines` under a document. */
  getLines<T = any>(parentCollection: string, parentId: string, linesSub: string): Promise<T[]>;
  /** Set (full write) a doc. */
  set(collection: string, id: string, data: Record<string, unknown>): void;
  /** Merge-set a doc (partial). */
  merge(collection: string, id: string, data: Record<string, unknown>): void;
  /** Create a doc with generated id. Returns the id. */
  create(collection: string, data: Record<string, unknown>): string;
  /** Optional: current server timestamp sentinel to embed in writes. */
  serverTimestamp(): unknown;
}

// ═══════════════════════════════════════════════════════════════════
//  Inputs & outputs
// ═══════════════════════════════════════════════════════════════════

export interface PostDocumentOptions {
  userId: string;
  idempotencyKey?: string;
  now?: Date;
}

export interface PostedBalanceDelta {
  locationId: string;
  itemId: string;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  alert?: 'negative_stock' | 'low_stock';
}

export interface PostDocumentResult {
  documentId: string;
  status: 'posted';
  postedAt: string;
  postedBy: string;
  ledgerEntryIds: string[];
  alreadyPosted: boolean;
  balanceDelta: PostedBalanceDelta[];
  events: string[]; // event types to publish after commit (e.g. 'warehouse.document.posted')
}

// ═══════════════════════════════════════════════════════════════════
//  Public entry point
// ═══════════════════════════════════════════════════════════════════

/**
 * Post a draft document.
 *
 * The caller wraps this in a Firestore transaction, passing a PostTx that
 * forwards to the transaction's read/write primitives. Tests pass a
 * FakeTx that simulates the same shape in-memory.
 */
export async function postDocument(
  tx: PostTx,
  documentId: string,
  options: PostDocumentOptions,
): Promise<PostDocumentResult> {
  const now = options.now ?? new Date();

  // 1. Idempotency
  if (options.idempotencyKey) {
    const cached = await tx.get<{ result: PostDocumentResult }>(
      WH_COLLECTIONS.idempotencyKeys,
      options.idempotencyKey,
    );
    if (cached?.result) {
      return { ...cached.result, alreadyPosted: true };
    }
  }

  // 2. Load document
  const doc = await tx.get<WhDocument>(WH_COLLECTIONS.documents, documentId);
  if (!doc) {
    throw new WarehouseError('DOCUMENT_NOT_FOUND', `Document ${documentId} not found`);
  }

  // Idempotent repost: posted → return existing
  if (doc.status === 'posted') {
    return {
      documentId,
      status: 'posted',
      postedAt: (doc.postedAt as any)?.toDate?.()?.toISOString?.() ?? now.toISOString(),
      postedBy: doc.postedBy ?? options.userId,
      ledgerEntryIds: doc.ledgerEntryIds ?? [],
      alreadyPosted: true,
      balanceDelta: [],
      events: [],
    };
  }

  if (doc.status !== 'draft' && doc.status !== 'ready_for_review') {
    throw new WarehouseError(
      'DOCUMENT_NOT_IN_POSTABLE_STATE',
      `Cannot post document in status: ${doc.status}`,
      { currentStatus: doc.status },
    );
  }

  // 3. Load lines
  const lines = await tx.getLines<WhDocumentLine>(
    WH_COLLECTIONS.documents,
    documentId,
    WH_COLLECTIONS.documentLinesSub,
  );
  if (lines.length === 0) {
    throw new WarehouseError('EMPTY_DOCUMENT', 'Cannot post a document with no lines');
  }

  // 4. Load items (deduped) + verify isActive
  const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
  const items = new Map<string, WhItem>();
  for (const id of itemIds) {
    const it = await tx.get<WhItem>(WH_COLLECTIONS.items, id);
    if (!it) throw new WarehouseError('ITEM_NOT_FOUND', `Item ${id} not found`, { itemId: id });
    if (!it.isActive) {
      throw new WarehouseError('ITEM_INACTIVE', `Item ${id} is archived`, { itemId: id });
    }
    items.set(id, it);
  }

  // 5. Load locations touched by this doc
  const locationIds = collectLocationIds(doc);
  const locations = new Map<string, WhLocation>();
  for (const locId of locationIds) {
    const loc = await tx.get<WhLocation>(WH_COLLECTIONS.locations, locId);
    if (!loc) {
      throw new WarehouseError('LOCATION_NOT_FOUND', `Location ${locId} not found`, { locationId: locId });
    }
    if (!loc.isActive) {
      throw new WarehouseError('LOCATION_INACTIVE', `Location ${locId} is archived`, { locationId: locId });
    }
    locations.set(locId, loc);
  }

  // 6. Compute per-line base conversions + unit-cost snapshots
  const computedLines = lines.map((line) => computeLine(line, items.get(line.itemId)!, doc));

  // 7. Build balance change set
  const balanceOps = buildBalanceOps(doc, computedLines);

  // 8. Load current balances
  const balances = new Map<string, WhBalance>();
  for (const op of balanceOps) {
    const key = makeBalanceKey(op.locationId, op.itemId);
    if (balances.has(key)) continue;
    const existing = await tx.get<WhBalance>(WH_COLLECTIONS.balances, key);
    balances.set(key, existing ?? createEmptyBalance(op.locationId, op.itemId, now));
  }

  // 9. Validate availability + negative-stock policy
  const balanceDeltas: PostedBalanceDelta[] = [];
  const alerts: string[] = [];
  for (const op of balanceOps) {
    const key = makeBalanceKey(op.locationId, op.itemId);
    const balance = balances.get(key)!;
    const location = locations.get(op.locationId)!;
    const item = items.get(op.itemId)!;

    const onHandBefore = balance.onHandQty;
    const reservedBefore = balance.reservedQty;

    const newOnHand = onHandBefore + op.deltaBaseQty;
    // Reservation release logic:
    // If the draft was an issue/transfer with a projectId AND source side AND deltaBaseQty < 0,
    // the reservation was created at draft time and should now be released.
    const releaseReservation = shouldReleaseReservation(doc, op);
    const absLine = Math.abs(op.deltaBaseQty);
    const newReserved = Math.max(0, reservedBefore - (releaseReservation ? absLine : 0));

    if (op.deltaBaseQty < 0 && newOnHand < 0) {
      const policy = effectiveNegativeStockPolicy(location, item);
      if (policy === 'blocked') {
        throw new WarehouseError(
          'NEGATIVE_STOCK_BLOCKED',
          `Posting would leave ${op.itemId} at ${newOnHand} on ${location.name} (policy: blocked)`,
          {
            locationId: op.locationId,
            itemId: op.itemId,
            locationType: location.locationType,
            requested: Math.abs(op.deltaBaseQty),
            available: onHandBefore,
          },
        );
      }
      if (policy === 'allowed_with_alert') {
        alerts.push('warehouse.negative_stock');
      }
    }

    // Update in-memory balance for subsequent ops on the same key
    balance.onHandQty = newOnHand;
    balance.reservedQty = newReserved;
    balance.availableQty = computeAvailableQty(newOnHand, newReserved);

    balanceDeltas.push({
      locationId: op.locationId,
      itemId: op.itemId,
      onHandBefore,
      onHandAfter: newOnHand,
      reservedBefore,
      reservedAfter: newReserved,
      alert: newOnHand < 0 ? 'negative_stock' : undefined,
    });
  }

  // 10. Create ledger entries
  const ledgerEntryIds: string[] = [];
  for (const op of balanceOps) {
    const entryData: Record<string, unknown> = {
      documentId,
      lineId: op.lineId,
      itemId: op.itemId,
      locationId: op.locationId,
      deltaQty: op.deltaBaseQty,
      direction: op.deltaBaseQty > 0 ? 'in' : 'out',
      unitCostAtPosting: op.unitCostAtPosting,
      eventDate: doc.eventDate,
      postedAt: tx.serverTimestamp(),
      postedBy: options.userId,
      schemaVersion: 1,
    };
    if (doc.projectId) entryData.projectId = doc.projectId;
    if (doc.phaseCode) entryData.phaseCode = doc.phaseCode;
    if (doc.costCategory) entryData.costCategory = doc.costCategory;
    const id = tx.create(WH_COLLECTIONS.ledger, entryData);
    ledgerEntryIds.push(id);
  }

  // 11. Write balances
  for (const op of balanceOps) {
    const key = makeBalanceKey(op.locationId, op.itemId);
    const balance = balances.get(key)!;
    tx.set(WH_COLLECTIONS.balances, key, {
      id: key,
      schemaVersion: 1,
      locationId: op.locationId,
      itemId: op.itemId,
      onHandQty: balance.onHandQty,
      reservedQty: balance.reservedQty,
      availableQty: balance.availableQty,
      lastLedgerEntryId: ledgerEntryIds[ledgerEntryIds.length - 1],
      lastEventDate: doc.eventDate,
      updatedAt: tx.serverTimestamp(),
      needsReconciliation: balance.onHandQty < 0 ? true : undefined,
    });
  }

  // 12. Update item.lastPurchasePrice + averageCost for receipt
  if (doc.docType === 'receipt') {
    updateItemCostsOnReceipt(tx, doc, computedLines, items, balances);
  }

  // 13. Mark document posted
  tx.merge(WH_COLLECTIONS.documents, documentId, {
    status: 'posted',
    postedAt: tx.serverTimestamp(),
    postedBy: options.userId,
    ledgerEntryIds,
  });

  // 14. Save idempotency key (if provided)
  const result: PostDocumentResult = {
    documentId,
    status: 'posted',
    postedAt: now.toISOString(),
    postedBy: options.userId,
    ledgerEntryIds,
    alreadyPosted: false,
    balanceDelta: balanceDeltas,
    events: ['warehouse.document.posted', ...alerts],
  };
  if (options.idempotencyKey) {
    const expires = new Date(now.getTime() + 24 * 3600_000);
    tx.set(WH_COLLECTIONS.idempotencyKeys, options.idempotencyKey, {
      key: options.idempotencyKey,
      endpoint: `/documents/${documentId}/post`,
      userId: options.userId,
      payloadHash: options.idempotencyKey, // client-supplied key is already stable
      result,
      createdAt: tx.serverTimestamp(),
      expiresAt: expires.toISOString(),
    });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers (exported for unit tests)
// ═══════════════════════════════════════════════════════════════════

interface BalanceOp {
  locationId: string;
  itemId: string;
  lineId: string;
  deltaBaseQty: number; // signed
  unitCostAtPosting: number; // in baseUOM
}

interface ComputedLine extends WhDocumentLine {
  item: WhItem;
  baseQtyComputed: number;
  baseUnitCostComputed: number;
}

export function collectLocationIds(doc: WhDocument): string[] {
  const ids = new Set<string>();
  if (doc.sourceLocationId) ids.add(doc.sourceLocationId);
  if (doc.destinationLocationId) ids.add(doc.destinationLocationId);
  if (doc.locationId) ids.add(doc.locationId);
  return Array.from(ids);
}

export function computeLine(line: WhDocumentLine, item: WhItem, doc: WhDocument): ComputedLine {
  let baseQty: number;
  try {
    baseQty = convertToBaseQty(item, line.uom, line.qty);
  } catch (e: any) {
    throw new WarehouseError('UOM_CONVERSION_FAILED', e.message, { lineId: line.id, itemId: line.itemId });
  }

  let baseUnitCost = item.averageCost || item.lastPurchasePrice || 0;
  if (typeof line.unitCost === 'number') {
    try {
      baseUnitCost = convertToBaseUnitCost(item, line.uom, line.unitCost);
    } catch (e: any) {
      throw new WarehouseError('UOM_CONVERSION_FAILED', e.message, { lineId: line.id, itemId: line.itemId });
    }
  }
  if (doc.docType === 'receipt' && typeof line.unitCost !== 'number') {
    throw new WarehouseError('VALIDATION_ERROR', `Receipt line ${line.id} requires unitCost`, { lineId: line.id });
  }

  return { ...line, item, baseQtyComputed: baseQty, baseUnitCostComputed: baseUnitCost };
}

export function buildBalanceOps(doc: WhDocument, lines: ComputedLine[]): BalanceOp[] {
  const ops: BalanceOp[] = [];
  for (const line of lines) {
    switch (doc.docType) {
      case 'receipt':
        ops.push({
          locationId: doc.destinationLocationId!,
          itemId: line.itemId,
          lineId: line.id,
          deltaBaseQty: +line.baseQtyComputed,
          unitCostAtPosting: line.baseUnitCostComputed,
        });
        break;

      case 'issue':
        ops.push({
          locationId: doc.sourceLocationId!,
          itemId: line.itemId,
          lineId: line.id,
          deltaBaseQty: -line.baseQtyComputed,
          unitCostAtPosting: line.baseUnitCostComputed,
        });
        break;

      case 'transfer': {
        const cost = line.baseUnitCostComputed;
        ops.push({
          locationId: doc.sourceLocationId!,
          itemId: line.itemId,
          lineId: line.id,
          deltaBaseQty: -line.baseQtyComputed,
          unitCostAtPosting: cost,
        });
        ops.push({
          locationId: doc.destinationLocationId!,
          itemId: line.itemId,
          lineId: line.id,
          deltaBaseQty: +line.baseQtyComputed,
          unitCostAtPosting: cost,
        });
        break;
      }

      case 'adjustment': {
        const direction = (line.qty >= 0 ? 1 : -1) * (line.variance !== undefined ? Math.sign(line.variance) : 1);
        // For adjustment, callers can encode direction via signed line.qty or use variance.
        // Simpler rule: use variance if present (from count), otherwise use signed qty.
        const signed =
          line.variance !== undefined ? line.variance : line.qty * (direction >= 0 ? 1 : -1);
        const baseSigned = signed >= 0 ? +line.baseQtyComputed : -line.baseQtyComputed;
        ops.push({
          locationId: doc.locationId!,
          itemId: line.itemId,
          lineId: line.id,
          deltaBaseQty: baseSigned,
          unitCostAtPosting: line.baseUnitCostComputed,
        });
        break;
      }

      case 'count': {
        // Count itself doesn't mutate balance — it generates adjustment docs on post.
        // Handled upstream; postDocument for docType='count' should route to a dedicated path.
        throw new WarehouseError(
          'VALIDATION_ERROR',
          'Count sessions are posted by generating adjustments, not via postDocument',
        );
      }

      case 'reversal': {
        // Reversal entries are created by voidDocument — postDocument does not build them.
        throw new WarehouseError(
          'VALIDATION_ERROR',
          'Reversal documents are created by voidDocument, not postDocument',
        );
      }
    }
  }
  return ops;
}

export function effectiveNegativeStockPolicy(
  location: WhLocation,
  item: WhItem,
): NegativeStockPolicy {
  if (item.allowNegativeStock === true) return 'allowed';
  if (item.allowNegativeStock === false) return 'blocked';
  if (location.negativeStockOverride) return location.negativeStockOverride;
  return DEFAULT_NEGATIVE_STOCK_POLICY[location.locationType as LocationType];
}

export function shouldReleaseReservation(doc: WhDocument, op: BalanceOp): boolean {
  if (!doc.projectId) return false;
  if (doc.docType === 'issue' && op.deltaBaseQty < 0) return true;
  if (doc.docType === 'transfer' && op.locationId === doc.sourceLocationId) return true;
  return false;
}

function createEmptyBalance(locationId: string, itemId: string, now: Date): WhBalance {
  return {
    id: makeBalanceKey(locationId, itemId),
    schemaVersion: 1,
    locationId,
    itemId,
    onHandQty: 0,
    reservedQty: 0,
    availableQty: 0,
    updatedAt: now as any,
  };
}

function updateItemCostsOnReceipt(
  tx: PostTx,
  doc: WhDocument,
  lines: ComputedLine[],
  items: Map<string, WhItem>,
  balances: Map<string, WhBalance>,
): void {
  const byItem = new Map<string, { addedQty: number; addedCost: number }>();
  for (const line of lines) {
    const existing = byItem.get(line.itemId) ?? { addedQty: 0, addedCost: 0 };
    existing.addedQty += line.baseQtyComputed;
    existing.addedCost += line.baseQtyComputed * line.baseUnitCostComputed;
    byItem.set(line.itemId, existing);
  }

  for (const [itemId, add] of byItem) {
    const item = items.get(itemId)!;
    // Compute total on-hand across all known balances for this item (after this receipt).
    let totalOnHand = 0;
    for (const balance of balances.values()) {
      if (balance.itemId === itemId) totalOnHand += balance.onHandQty;
    }
    // Prior on-hand (before receipt) for that item across touched locations.
    const priorOnHand = totalOnHand - add.addedQty;
    const oldAvg = item.averageCost ?? item.lastPurchasePrice ?? 0;
    const newAverage =
      priorOnHand + add.addedQty <= 0
        ? add.addedCost / Math.max(add.addedQty, 1e-9)
        : (oldAvg * priorOnHand + add.addedCost) / (priorOnHand + add.addedQty);

    tx.merge(WH_COLLECTIONS.items, itemId, {
      lastPurchasePrice: add.addedCost / Math.max(add.addedQty, 1e-9),
      averageCost: roundTo(newAverage, 6),
      updatedAt: tx.serverTimestamp(),
    });
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export type { WhLedgerEntry, BalanceOp };
