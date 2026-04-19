/**
 * InventoryService — unified write path for inventory mutations (Warehouse V3 §4.1).
 *
 * Single source of truth for stock changes. Callers (route handlers, telegram
 * bot handlers, cron jobs, SDK) all route writes through commitTransaction()
 * so that:
 *   1. `inventory_transactions_v2` (immutable journal) stays authoritative
 *   2. `inventory_catalog.stockByLocation` cache stays consistent with the journal
 *   3. Atomicity is enforced (Firestore transaction wraps journal write + cache update)
 *   4. Idempotency keys are respected
 *
 * Everything a direct `.update({stockByLocation: {...}})` used to do must go
 * through here instead — see spec §4.1 "Прямой PATCH /catalog/:id { stock: 100 } — запрещён".
 */

import * as admin from 'firebase-admin';

export type InventoryCategory = 'materials' | 'tools' | 'consumables' | 'equipment';

export type InventoryUnit = 'шт' | 'кг' | 'л' | 'м' | 'м²' | 'упак' | 'рул';

export type TransactionType =
  | 'purchase'
  | 'return_in'
  | 'adjustment_in'
  | 'write_off'
  | 'transfer'
  | 'loss'
  | 'adjustment_out'
  | 'tool_issue'
  | 'tool_return';

export const INBOUND_TYPES: readonly TransactionType[] = [
  'purchase',
  'return_in',
  'adjustment_in',
  'tool_return',
] as const;

export const OUTBOUND_TYPES: readonly TransactionType[] = [
  'write_off',
  'transfer',
  'loss',
  'adjustment_out',
  'tool_issue',
] as const;

/**
 * Types for which we tolerate stock going to zero and skip the "not enough"
 * check (adjustment_out reconciles to reality; loss acknowledges reality that
 * the stuff is gone). All other outbound types require sufficient stock.
 */
const STOCK_CHECK_BYPASS: readonly TransactionType[] = ['adjustment_out', 'loss'] as const;

export interface CommitTransactionInput {
  /** Catalog item being moved */
  catalogItemId: string;
  /** Movement type — determines direction and side-effects */
  type: TransactionType;
  /** Quantity in the item's native unit (positive number) */
  qty: number;

  /** Source location — required for all outbound types */
  fromLocation?: string;
  /** Destination location — required for inbound types and transfer */
  toLocation?: string;

  /** Optional pricing for purchase (drives moving-avg calc) */
  unitPrice?: number;

  /** Who initiated (user uid or bot id) */
  performedBy: string;
  performedByName?: string;

  /** Links for project P&L and audit */
  relatedTaskId?: string;
  relatedTaskTitle?: string;
  relatedClientId?: string;
  relatedClientName?: string;
  relatedCostId?: string;
  relatedReceiptId?: string;
  relatedEstimateId?: string;
  relatedShoppingListId?: string;
  relatedNormId?: string;

  /** For transfer pairs (out + in share the same group id) */
  transactionGroupId?: string;
  /** Ref to a transfer_request doc (if this commit fulfills one) */
  transferRequestId?: string;

  /** Idempotency key — if seen before, return prior result */
  idempotencyKey?: string;

  /** Free-form note */
  note?: string;

  /** Who/what API surface triggered this (for audit trail) */
  source?: 'api' | 'bot' | 'ui' | 'cron' | 'migration';
}

export interface CommitTransactionResult {
  transactionId: string;
  catalogItemId: string;
  type: TransactionType;
  qty: number;
  stockBefore: number;
  stockAfter: number;
  stockByLocationAfter: Record<string, number>;
  deduplicated?: boolean;
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly itemName: string,
    public readonly available: number,
    public readonly requested: number,
    public readonly location: string,
  ) {
    super(
      `Недостаточно "${itemName}" на "${location}": есть ${available}, нужно ${requested}`,
    );
    this.name = 'InsufficientStockError';
  }
}

export class CatalogItemNotFoundError extends Error {
  constructor(public readonly catalogItemId: string) {
    super(`Товар не найден в каталоге: ${catalogItemId}`);
    this.name = 'CatalogItemNotFoundError';
  }
}

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryValidationError';
  }
}

/**
 * Stateless service — takes a Firestore instance on construction so tests can
 * inject a mock. Production code calls `new InventoryService(db)` where `db`
 * is the shared `admin.firestore()` singleton from `routeContext`.
 */
export class InventoryService {
  constructor(
    private readonly db: admin.firestore.Firestore,
    private readonly options: {
      /** Collection name for catalog — override for testing */
      catalogCollection?: string;
      /** Collection name for journal — override for testing */
      journalCollection?: string;
      /** Collection for idempotency keys */
      idempotencyCollection?: string;
      /** Clock for deterministic tests */
      now?: () => admin.firestore.Timestamp;
    } = {},
  ) {}

  private get catalogName(): string {
    return this.options.catalogCollection ?? 'inventory_catalog';
  }

  private get journalName(): string {
    return this.options.journalCollection ?? 'inventory_transactions_v2';
  }

  private get idempotencyName(): string {
    return this.options.idempotencyCollection ?? '_idempotency';
  }

  private now(): admin.firestore.Timestamp {
    return this.options.now ? this.options.now() : admin.firestore.Timestamp.now();
  }

  /**
   * Commit a single transaction atomically. Journal write + catalog cache
   * update happen in one Firestore transaction — no partial state possible.
   *
   * Returns the new stock levels so callers don't need a separate read.
   */
  async commitTransaction(input: CommitTransactionInput): Promise<CommitTransactionResult> {
    this.validate(input);

    if (input.idempotencyKey) {
      const cached = await this.checkIdempotency(input.idempotencyKey);
      if (cached) return cached;
    }

    const catalogRef = this.db.collection(this.catalogName).doc(input.catalogItemId);

    const result = await this.db.runTransaction(async (tx) => {
      const catalogSnap = await tx.get(catalogRef);
      if (!catalogSnap.exists) {
        throw new CatalogItemNotFoundError(input.catalogItemId);
      }

      const catalog = catalogSnap.data() as CatalogDoc;
      const stockBefore = catalog.totalStock ?? 0;
      const locationsBefore: Record<string, number> = { ...(catalog.stockByLocation ?? {}) };
      const next = this.applyMovement(input, catalog, locationsBefore);

      const journalRef = this.db.collection(this.journalName).doc();
      const txDoc = this.buildJournalDoc(input, catalog, next.stockByLocationAfter, journalRef.id);
      tx.set(journalRef, txDoc);

      const catalogUpdate = this.buildCatalogUpdate(input, catalog, next);
      tx.update(catalogRef, catalogUpdate);

      return {
        transactionId: journalRef.id,
        catalogItemId: input.catalogItemId,
        type: input.type,
        qty: input.qty,
        stockBefore,
        stockAfter: next.totalStockAfter,
        stockByLocationAfter: next.stockByLocationAfter,
      } satisfies CommitTransactionResult;
    });

    if (input.idempotencyKey) {
      await this.storeIdempotency(input.idempotencyKey, result);
    }

    return result;
  }

  /**
   * Atomic transfer — commits `transfer_out` at fromLocation and logs the
   * in-transit state. Pair with `commitTransferReceive()` when the receiver
   * acknowledges arrival (handshake — spec §4.2).
   *
   * NOTE: for single-location moves where you just want "out of A, into B"
   * in one step without a handshake, use `commitTransaction({ type:'transfer',
   * fromLocation, toLocation })` — that does both sides in one journal row.
   * Use `commitTransferOut` only when there's a real in-transit period.
   */
  async commitTransferOut(
    input: Omit<CommitTransactionInput, 'type'> & {
      fromLocation: string;
      toLocation: string;
    },
  ): Promise<CommitTransactionResult> {
    const groupId = input.transactionGroupId ?? this.db.collection('_unused').doc().id;
    return this.commitTransaction({
      ...input,
      type: 'transfer',
      transactionGroupId: groupId,
    });
  }

  /**
   * Recalculate stockByLocation for one catalog item by replaying the journal.
   * Admin-only repair tool — used when `/recalculate` endpoint is hit.
   *
   * This is EXPENSIVE (reads all transactions for the item). Don't call in a
   * hot path. Returns the replayed stock so caller can compare vs cache.
   */
  async recalculateStock(catalogItemId: string): Promise<{
    catalogItemId: string;
    stockByLocation: Record<string, number>;
    totalStock: number;
    transactionsReplayed: number;
  }> {
    const txSnap = await this.db
      .collection(this.journalName)
      .where('catalogItemId', '==', catalogItemId)
      .orderBy('timestamp', 'asc')
      .get();

    const stockByLocation: Record<string, number> = {};
    for (const doc of txSnap.docs) {
      const tx = doc.data() as JournalDoc;
      this.replayTransaction(tx, stockByLocation);
    }
    const totalStock = sumValues(stockByLocation);

    await this.db
      .collection(this.catalogName)
      .doc(catalogItemId)
      .update({
        stockByLocation,
        totalStock,
        updatedAt: this.now(),
      });

    return {
      catalogItemId,
      stockByLocation,
      totalStock,
      transactionsReplayed: txSnap.size,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  internals
  // ──────────────────────────────────────────────────────────────────────

  private validate(input: CommitTransactionInput): void {
    if (!input.catalogItemId) {
      throw new InventoryValidationError('catalogItemId is required');
    }
    if (!input.performedBy) {
      throw new InventoryValidationError('performedBy is required');
    }
    if (!Number.isFinite(input.qty) || input.qty <= 0) {
      throw new InventoryValidationError(`qty must be positive number, got ${input.qty}`);
    }
    const isInbound = (INBOUND_TYPES as readonly TransactionType[]).includes(input.type);
    const isOutbound = (OUTBOUND_TYPES as readonly TransactionType[]).includes(input.type);
    if (!isInbound && !isOutbound) {
      throw new InventoryValidationError(`Unknown transaction type: ${input.type}`);
    }
    if (isInbound && !input.toLocation) {
      throw new InventoryValidationError(`toLocation is required for inbound type "${input.type}"`);
    }
    if (isOutbound && !input.fromLocation) {
      throw new InventoryValidationError(`fromLocation is required for outbound type "${input.type}"`);
    }
    if (input.type === 'transfer' && !input.toLocation) {
      throw new InventoryValidationError('toLocation is required for transfer');
    }
    if (input.type === 'transfer' && input.fromLocation === input.toLocation) {
      throw new InventoryValidationError('transfer requires different from/to locations');
    }
  }

  private applyMovement(
    input: CommitTransactionInput,
    catalog: CatalogDoc,
    locations: Record<string, number>,
  ): { stockByLocationAfter: Record<string, number>; totalStockAfter: number } {
    const isInbound = (INBOUND_TYPES as readonly TransactionType[]).includes(input.type);

    if (isInbound) {
      const loc = input.toLocation!;
      locations[loc] = (locations[loc] ?? 0) + input.qty;
    } else {
      const fromLoc = input.fromLocation!;
      const current = locations[fromLoc] ?? 0;

      if (!STOCK_CHECK_BYPASS.includes(input.type) && current < input.qty) {
        throw new InsufficientStockError(catalog.name, current, input.qty, fromLoc);
      }

      locations[fromLoc] = Math.max(0, current - input.qty);

      if (input.type === 'transfer' && input.toLocation) {
        locations[input.toLocation] = (locations[input.toLocation] ?? 0) + input.qty;
      }
    }

    const totalStockAfter = sumValues(locations);
    return { stockByLocationAfter: locations, totalStockAfter };
  }

  private replayTransaction(tx: JournalDoc, stockByLocation: Record<string, number>): void {
    const isInbound = (INBOUND_TYPES as readonly TransactionType[]).includes(tx.type);
    if (isInbound) {
      const loc = tx.toLocation ?? 'warehouse';
      stockByLocation[loc] = (stockByLocation[loc] ?? 0) + tx.qty;
      return;
    }
    const fromLoc = tx.fromLocation ?? 'warehouse';
    stockByLocation[fromLoc] = Math.max(0, (stockByLocation[fromLoc] ?? 0) - tx.qty);
    if (tx.type === 'transfer' && tx.toLocation) {
      stockByLocation[tx.toLocation] = (stockByLocation[tx.toLocation] ?? 0) + tx.qty;
    }
  }

  private buildJournalDoc(
    input: CommitTransactionInput,
    catalog: CatalogDoc,
    stockByLocationAfter: Record<string, number>,
    _journalId: string,
  ): JournalDoc {
    const unitPrice = input.unitPrice ?? catalog.lastPurchasePrice ?? catalog.avgPrice ?? 0;
    const totalAmount = unitPrice * input.qty;
    const doc: JournalDoc = {
      catalogItemId: input.catalogItemId,
      catalogItemName: catalog.name,
      category: catalog.category,
      type: input.type,
      qty: input.qty,
      unitPrice,
      totalAmount,
      stockAfter: sumValues(stockByLocationAfter),
      performedBy: input.performedBy,
      performedByName: input.performedByName ?? input.performedBy,
      timestamp: this.now(),
      source: input.source ?? 'api',
    };
    if (input.fromLocation) doc.fromLocation = input.fromLocation;
    if (input.toLocation) doc.toLocation = input.toLocation;
    if (input.relatedTaskId) doc.relatedTaskId = input.relatedTaskId;
    if (input.relatedTaskTitle) doc.relatedTaskTitle = input.relatedTaskTitle;
    if (input.relatedClientId) doc.relatedClientId = input.relatedClientId;
    if (input.relatedClientName) doc.relatedClientName = input.relatedClientName;
    if (input.relatedCostId) doc.relatedCostId = input.relatedCostId;
    if (input.relatedReceiptId) doc.relatedReceiptId = input.relatedReceiptId;
    if (input.relatedEstimateId) doc.relatedEstimateId = input.relatedEstimateId;
    if (input.relatedShoppingListId) doc.relatedShoppingListId = input.relatedShoppingListId;
    if (input.relatedNormId) doc.relatedNormId = input.relatedNormId;
    if (input.transactionGroupId) doc.transactionGroupId = input.transactionGroupId;
    if (input.transferRequestId) doc.transferRequestId = input.transferRequestId;
    if (input.note) doc.note = input.note;
    return doc;
  }

  private buildCatalogUpdate(
    input: CommitTransactionInput,
    catalog: CatalogDoc,
    next: { stockByLocationAfter: Record<string, number>; totalStockAfter: number },
  ): Record<string, unknown> {
    const update: Record<string, unknown> = {
      stockByLocation: next.stockByLocationAfter,
      totalStock: next.totalStockAfter,
      updatedAt: this.now(),
    };

    if (input.type === 'purchase' && input.unitPrice && input.unitPrice > 0) {
      update.lastPurchasePrice = input.unitPrice;
      const prevAvg = catalog.avgPrice ?? 0;
      const prevStock = catalog.totalStock ?? 0;
      const denom = prevStock + input.qty;
      if (denom > 0) {
        update.avgPrice = (prevAvg * prevStock + input.unitPrice * input.qty) / denom;
      }
    }

    if (input.type === 'tool_issue') {
      update.assignedTo = input.performedBy;
      update.assignedToName = input.performedByName ?? input.performedBy;
      update.assignedAt = this.now();
    } else if (input.type === 'tool_return') {
      update.assignedTo = null;
      update.assignedToName = null;
      update.assignedAt = null;
    }

    return update;
  }

  private async checkIdempotency(
    key: string,
  ): Promise<CommitTransactionResult | null> {
    const snap = await this.db.collection(this.idempotencyName).doc(key).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data?.inventoryResult) return null;
    return { ...(data.inventoryResult as CommitTransactionResult), deduplicated: true };
  }

  private async storeIdempotency(
    key: string,
    result: CommitTransactionResult,
  ): Promise<void> {
    await this.db
      .collection(this.idempotencyName)
      .doc(key)
      .set({
        entityId: result.transactionId,
        collection: this.journalName,
        inventoryResult: result,
        expiresAt: Date.now() + 24 * 3600_000,
        createdAt: this.now(),
      });
  }
}

// ──────────────────────────────────────────────────────────────────────
//  document shapes (what InventoryService reads/writes in Firestore)
// ──────────────────────────────────────────────────────────────────────

interface CatalogDoc {
  name: string;
  category: InventoryCategory;
  unit: InventoryUnit;
  stockByLocation?: Record<string, number>;
  totalStock?: number;
  minStock?: number;
  avgPrice?: number;
  lastPurchasePrice?: number;
  isTrackable?: boolean;
  isArchived?: boolean;
}

interface JournalDoc {
  catalogItemId: string;
  catalogItemName: string;
  category: InventoryCategory;
  type: TransactionType;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  stockAfter: number;
  fromLocation?: string;
  toLocation?: string;
  performedBy: string;
  performedByName: string;
  timestamp: admin.firestore.Timestamp;
  source: 'api' | 'bot' | 'ui' | 'cron' | 'migration';
  relatedTaskId?: string;
  relatedTaskTitle?: string;
  relatedClientId?: string;
  relatedClientName?: string;
  relatedCostId?: string;
  relatedReceiptId?: string;
  relatedEstimateId?: string;
  relatedShoppingListId?: string;
  relatedNormId?: string;
  transactionGroupId?: string;
  transferRequestId?: string;
  note?: string;
}

function sumValues(obj: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(obj)) total += v;
  return total;
}
