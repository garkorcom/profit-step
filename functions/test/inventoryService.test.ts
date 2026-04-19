/**
 * Unit tests for InventoryService — the unified write path.
 *
 * No emulator: we inject a hand-rolled in-memory Firestore mock that supports
 * the small subset of the API the service uses (collection, doc, get, set,
 * update, runTransaction, where, orderBy). Faster & reproducible.
 *
 * Coverage:
 *   - validate(): required fields, positive qty, known type, from/to requirements
 *   - commit: inbound types (purchase/return/adjustment_in/tool_return)
 *   - commit: outbound types (write_off/transfer/loss/adjustment_out/tool_issue)
 *   - stock check: insufficient stock error, bypass for adjustment_out/loss
 *   - transfer moves qty from fromLocation to toLocation in one atomic step
 *   - moving-average price calculation on purchase
 *   - tool_issue assigns to user; tool_return clears assignment
 *   - idempotency: same key → deduplicated result
 *   - recalculateStock: replays journal to rebuild cache
 *
 * See WAREHOUSE_SPEC_V3.md §12.1 for the testing strategy this implements.
 */

import * as admin from 'firebase-admin';
import {
  InventoryService,
  InsufficientStockError,
  CatalogItemNotFoundError,
  InventoryValidationError,
  CommitTransactionInput,
} from '../src/agent/services/inventoryService';

// ──────────────────────────────────────────────────────────────────────
//  Minimal Firestore mock
// ──────────────────────────────────────────────────────────────────────

interface MockDoc {
  data: Record<string, unknown> | null;
}

class MockTimestamp {
  constructor(private readonly ms: number) {}
  static now(): MockTimestamp {
    return new MockTimestamp(Date.now());
  }
  toMillis(): number {
    return this.ms;
  }
}

class MockFirestore {
  private readonly store = new Map<string, Map<string, MockDoc>>();
  private idCounter = 1;

  collection(name: string): MockCollection {
    if (!this.store.has(name)) this.store.set(name, new Map());
    return new MockCollection(this, name, this.store.get(name)!);
  }

  async runTransaction<T>(
    fn: (tx: MockTransaction) => Promise<T>,
  ): Promise<T> {
    const tx = new MockTransaction(this);
    const result = await fn(tx);
    tx.commit();
    return result;
  }

  nextId(): string {
    return `id_${this.idCounter++}`;
  }

  // Test helpers
  _get(collection: string, id: string): Record<string, unknown> | null {
    return this.store.get(collection)?.get(id)?.data ?? null;
  }

  _seed(collection: string, id: string, data: Record<string, unknown>): void {
    if (!this.store.has(collection)) this.store.set(collection, new Map());
    this.store.get(collection)!.set(id, { data: { ...data } });
  }

  _listIds(collection: string): string[] {
    return Array.from(this.store.get(collection)?.keys() ?? []);
  }

  _count(collection: string): number {
    return this.store.get(collection)?.size ?? 0;
  }
}

class MockCollection {
  constructor(
    private readonly fs: MockFirestore,
    private readonly name: string,
    private readonly store: Map<string, MockDoc>,
    private readonly filters: Array<[string, FirebaseFirestore.WhereFilterOp, unknown]> = [],
    private readonly orders: Array<[string, 'asc' | 'desc' | undefined]> = [],
  ) {}

  doc(id?: string): MockDocRef {
    const docId = id ?? this.fs.nextId();
    if (!this.store.has(docId)) this.store.set(docId, { data: null });
    return new MockDocRef(this.name, docId, this.store);
  }

  where(
    field: string,
    op: FirebaseFirestore.WhereFilterOp,
    value: unknown,
  ): MockCollection {
    return new MockCollection(
      this.fs,
      this.name,
      this.store,
      [...this.filters, [field, op, value]],
      this.orders,
    );
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): MockCollection {
    return new MockCollection(
      this.fs,
      this.name,
      this.store,
      this.filters,
      [...this.orders, [field, dir]],
    );
  }

  async get(): Promise<{
    docs: Array<{ id: string; data: () => Record<string, unknown> }>;
    size: number;
  }> {
    const entries = Array.from(this.store.entries())
      .filter(([, doc]) => doc.data !== null)
      .filter(([, doc]) => {
        for (const [field, op, val] of this.filters) {
          const v = (doc.data as Record<string, unknown>)[field];
          if (op === '==' && v !== val) return false;
        }
        return true;
      })
      .map(([id, doc]) => ({ id, data: () => doc.data as Record<string, unknown> }));

    for (const [field, dir] of this.orders) {
      entries.sort((a, b) => {
        const av = a.data()[field];
        const bv = b.data()[field];
        const cmp = av instanceof MockTimestamp && bv instanceof MockTimestamp
          ? av.toMillis() - bv.toMillis()
          : String(av ?? '').localeCompare(String(bv ?? ''));
        return dir === 'desc' ? -cmp : cmp;
      });
    }

    return { docs: entries, size: entries.length };
  }
}

class MockDocRef {
  constructor(
    public readonly collectionName: string,
    public readonly id: string,
    private readonly store: Map<string, MockDoc>,
  ) {}

  async get(): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined; id: string }> {
    const doc = this.store.get(this.id);
    return {
      exists: doc?.data !== null && doc?.data !== undefined,
      data: () => doc?.data ?? undefined,
      id: this.id,
    };
  }

  async set(data: Record<string, unknown>): Promise<void> {
    this.store.set(this.id, { data: { ...data } });
  }

  async update(data: Record<string, unknown>): Promise<void> {
    const existing = this.store.get(this.id);
    if (!existing?.data) throw new Error(`update on non-existent doc: ${this.id}`);
    this.store.set(this.id, { data: { ...existing.data, ...data } });
  }
}

class MockTransaction {
  private readonly reads: Array<{ ref: MockDocRef; snap: Awaited<ReturnType<MockDocRef['get']>> }> = [];
  private readonly writes: Array<
    | { op: 'set'; ref: MockDocRef; data: Record<string, unknown> }
    | { op: 'update'; ref: MockDocRef; data: Record<string, unknown> }
  > = [];

  constructor(_fs: MockFirestore) {
    // MockFirestore reference reserved for future atomicity tests (rollback on throw)
    void _fs;
  }

  async get(ref: MockDocRef): Promise<Awaited<ReturnType<MockDocRef['get']>>> {
    const snap = await ref.get();
    this.reads.push({ ref, snap });
    return snap;
  }

  set(ref: MockDocRef, data: Record<string, unknown>): void {
    this.writes.push({ op: 'set', ref, data });
  }

  update(ref: MockDocRef, data: Record<string, unknown>): void {
    this.writes.push({ op: 'update', ref, data });
  }

  commit(): void {
    for (const w of this.writes) {
      if (w.op === 'set') void w.ref.set(w.data);
      else void w.ref.update(w.data);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
//  Shared test helpers
// ──────────────────────────────────────────────────────────────────────

function makeService(fs: MockFirestore): InventoryService {
  return new InventoryService(fs as unknown as admin.firestore.Firestore, {
    now: () => new MockTimestamp(1_700_000_000_000) as unknown as admin.firestore.Timestamp,
  });
}

function seedCatalog(
  fs: MockFirestore,
  id: string,
  overrides: Record<string, unknown> = {},
): void {
  fs._seed('inventory_catalog', id, {
    name: 'Wire 12 AWG',
    category: 'materials',
    unit: 'м',
    stockByLocation: { warehouse: 100 },
    totalStock: 100,
    minStock: 20,
    avgPrice: 10,
    lastPurchasePrice: 12,
    isTrackable: false,
    isArchived: false,
    ...overrides,
  });
}

function baseInput(
  overrides: Partial<CommitTransactionInput> = {},
): CommitTransactionInput {
  return {
    catalogItemId: 'item_1',
    type: 'purchase',
    qty: 50,
    toLocation: 'warehouse',
    performedBy: 'user_1',
    performedByName: 'Иван',
    unitPrice: 15,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────

describe('InventoryService.validate', () => {
  it('rejects missing catalogItemId', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(svc.commitTransaction(baseInput({ catalogItemId: '' }))).rejects.toThrow(
      InventoryValidationError,
    );
  });

  it('rejects missing performedBy', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(svc.commitTransaction(baseInput({ performedBy: '' }))).rejects.toThrow(
      InventoryValidationError,
    );
  });

  it('rejects zero qty', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(svc.commitTransaction(baseInput({ qty: 0 }))).rejects.toThrow(/qty/);
  });

  it('rejects negative qty', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(svc.commitTransaction(baseInput({ qty: -5 }))).rejects.toThrow(/qty/);
  });

  it('rejects unknown transaction type', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(
      svc.commitTransaction(baseInput({ type: 'bogus' as unknown as CommitTransactionInput['type'] })),
    ).rejects.toThrow(/type/);
  });

  it('requires toLocation for inbound type', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(
      svc.commitTransaction(baseInput({ type: 'purchase', toLocation: undefined })),
    ).rejects.toThrow(/toLocation/);
  });

  it('requires fromLocation for outbound type', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);
    await expect(
      svc.commitTransaction(
        baseInput({ type: 'write_off', toLocation: undefined, fromLocation: undefined }),
      ),
    ).rejects.toThrow(/fromLocation/);
  });

  it('requires transfer to have different from/to', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1');
    const svc = makeService(fs);
    await expect(
      svc.commitTransaction(
        baseInput({ type: 'transfer', fromLocation: 'a', toLocation: 'a' }),
      ),
    ).rejects.toThrow(/different/);
  });
});

describe('InventoryService.commitTransaction — inbound types', () => {
  it('purchase adds to toLocation and updates totalStock', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 100 }, totalStock: 100 });
    const svc = makeService(fs);

    const result = await svc.commitTransaction(baseInput({ type: 'purchase', qty: 50 }));

    expect(result.stockByLocationAfter).toEqual({ warehouse: 150 });
    expect(result.stockAfter).toBe(150);
    expect(result.stockBefore).toBe(100);
    expect(fs._get('inventory_catalog', 'item_1')).toMatchObject({
      totalStock: 150,
      stockByLocation: { warehouse: 150 },
    });
  });

  it('purchase writes journal doc with price info', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1');
    const svc = makeService(fs);

    await svc.commitTransaction(baseInput({ type: 'purchase', qty: 50, unitPrice: 15 }));

    const journalIds = fs._listIds('inventory_transactions_v2');
    expect(journalIds).toHaveLength(1);
    const journal = fs._get('inventory_transactions_v2', journalIds[0]);
    expect(journal).toMatchObject({
      catalogItemId: 'item_1',
      type: 'purchase',
      qty: 50,
      unitPrice: 15,
      totalAmount: 750,
      toLocation: 'warehouse',
    });
  });

  it('purchase updates lastPurchasePrice + moving-average avgPrice', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', {
      stockByLocation: { warehouse: 100 },
      totalStock: 100,
      avgPrice: 10,
      lastPurchasePrice: 10,
    });
    const svc = makeService(fs);

    await svc.commitTransaction(baseInput({ type: 'purchase', qty: 100, unitPrice: 20 }));

    const catalog = fs._get('inventory_catalog', 'item_1')!;
    expect(catalog.lastPurchasePrice).toBe(20);
    // 100*10 + 100*20 = 3000; 3000/200 = 15
    expect(catalog.avgPrice).toBe(15);
  });

  it('return_in routes to toLocation', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { vehicle_1: 5 }, totalStock: 5 });
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({ type: 'return_in', qty: 3, toLocation: 'vehicle_1', unitPrice: undefined }),
    );

    expect(fs._get('inventory_catalog', 'item_1')).toMatchObject({
      totalStock: 8,
      stockByLocation: { vehicle_1: 8 },
    });
  });

  it('adjustment_in increments stock at toLocation', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 10 }, totalStock: 10 });
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({ type: 'adjustment_in', qty: 5, toLocation: 'warehouse', unitPrice: undefined }),
    );

    expect(fs._get('inventory_catalog', 'item_1')).toMatchObject({ totalStock: 15 });
  });

  it('tool_return clears assignment metadata', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'drill_1', {
      isTrackable: true,
      stockByLocation: { in_use: 1 },
      totalStock: 1,
      assignedTo: 'worker_a',
      assignedToName: 'Worker A',
    });
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({
        catalogItemId: 'drill_1',
        type: 'tool_return',
        qty: 1,
        toLocation: 'warehouse',
        unitPrice: undefined,
      }),
    );

    const catalog = fs._get('inventory_catalog', 'drill_1')!;
    expect(catalog.assignedTo).toBeNull();
    expect(catalog.assignedToName).toBeNull();
  });
});

describe('InventoryService.commitTransaction — outbound types', () => {
  it('write_off subtracts from fromLocation', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 100 }, totalStock: 100 });
    const svc = makeService(fs);

    const result = await svc.commitTransaction(
      baseInput({ type: 'write_off', qty: 30, fromLocation: 'warehouse', toLocation: undefined }),
    );

    expect(result.stockByLocationAfter).toEqual({ warehouse: 70 });
    expect(result.stockAfter).toBe(70);
  });

  it('loss bypasses the "not enough" check (acknowledges reality)', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 5 }, totalStock: 5 });
    const svc = makeService(fs);

    const result = await svc.commitTransaction(
      baseInput({ type: 'loss', qty: 100, fromLocation: 'warehouse', toLocation: undefined }),
    );

    expect(result.stockAfter).toBe(0); // clamped to zero, no throw
  });

  it('adjustment_out bypasses "not enough" check (reconciliation)', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 5 }, totalStock: 5 });
    const svc = makeService(fs);

    await expect(
      svc.commitTransaction(
        baseInput({
          type: 'adjustment_out',
          qty: 10,
          fromLocation: 'warehouse',
          toLocation: undefined,
        }),
      ),
    ).resolves.toMatchObject({ stockAfter: 0 });
  });

  it('write_off throws InsufficientStockError when below requested', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 5 }, totalStock: 5 });
    const svc = makeService(fs);

    await expect(
      svc.commitTransaction(
        baseInput({ type: 'write_off', qty: 10, fromLocation: 'warehouse', toLocation: undefined }),
      ),
    ).rejects.toThrow(InsufficientStockError);
  });

  it('tool_issue subtracts stock and assigns tool to user', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'drill_1', {
      isTrackable: true,
      stockByLocation: { warehouse: 1 },
      totalStock: 1,
    });
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({
        catalogItemId: 'drill_1',
        type: 'tool_issue',
        qty: 1,
        fromLocation: 'warehouse',
        toLocation: undefined,
        performedBy: 'worker_a',
        performedByName: 'Worker A',
      }),
    );

    const catalog = fs._get('inventory_catalog', 'drill_1')!;
    expect(catalog.totalStock).toBe(0);
    expect(catalog.assignedTo).toBe('worker_a');
    expect(catalog.assignedToName).toBe('Worker A');
  });
});

describe('InventoryService.commitTransaction — transfer', () => {
  it('moves qty from fromLocation to toLocation atomically', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', {
      stockByLocation: { warehouse: 100, vehicle_1: 0 },
      totalStock: 100,
    });
    const svc = makeService(fs);

    const result = await svc.commitTransaction(
      baseInput({
        type: 'transfer',
        qty: 40,
        fromLocation: 'warehouse',
        toLocation: 'vehicle_1',
        unitPrice: undefined,
      }),
    );

    expect(result.stockByLocationAfter).toEqual({ warehouse: 60, vehicle_1: 40 });
    expect(result.stockAfter).toBe(100); // total unchanged for transfer
  });

  it('transfer throws InsufficientStockError on shortage', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 10 }, totalStock: 10 });
    const svc = makeService(fs);

    await expect(
      svc.commitTransaction(
        baseInput({
          type: 'transfer',
          qty: 50,
          fromLocation: 'warehouse',
          toLocation: 'vehicle_1',
          unitPrice: undefined,
        }),
      ),
    ).rejects.toThrow(InsufficientStockError);
  });

  it('transfer writes single journal row with both locations', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', {
      stockByLocation: { a: 50, b: 0 },
      totalStock: 50,
    });
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({
        type: 'transfer',
        qty: 10,
        fromLocation: 'a',
        toLocation: 'b',
        unitPrice: undefined,
        transactionGroupId: 'group_xyz',
      }),
    );

    const ids = fs._listIds('inventory_transactions_v2');
    const journal = fs._get('inventory_transactions_v2', ids[0])!;
    expect(journal.fromLocation).toBe('a');
    expect(journal.toLocation).toBe('b');
    expect(journal.transactionGroupId).toBe('group_xyz');
  });
});

describe('InventoryService.commitTransaction — error cases', () => {
  it('throws CatalogItemNotFoundError for missing catalog item', async () => {
    const fs = new MockFirestore();
    const svc = makeService(fs);

    await expect(svc.commitTransaction(baseInput())).rejects.toThrow(
      CatalogItemNotFoundError,
    );
  });
});

describe('InventoryService.commitTransaction — idempotency', () => {
  it('returns cached result when same idempotency key is reused', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 100 }, totalStock: 100 });
    const svc = makeService(fs);

    const first = await svc.commitTransaction(
      baseInput({ type: 'purchase', qty: 10, idempotencyKey: 'key_abc' }),
    );
    const second = await svc.commitTransaction(
      baseInput({ type: 'purchase', qty: 10, idempotencyKey: 'key_abc' }),
    );

    expect(second.deduplicated).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    // Only one journal entry should have been written
    expect(fs._count('inventory_transactions_v2')).toBe(1);
    // Stock only incremented once
    expect(fs._get('inventory_catalog', 'item_1')).toMatchObject({ totalStock: 110 });
  });

  it('different keys produce different transactions (no dedup)', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 100 }, totalStock: 100 });
    const svc = makeService(fs);

    const a = await svc.commitTransaction(
      baseInput({ type: 'purchase', qty: 5, idempotencyKey: 'key_a' }),
    );
    const b = await svc.commitTransaction(
      baseInput({ type: 'purchase', qty: 5, idempotencyKey: 'key_b' }),
    );

    expect(a.transactionId).not.toBe(b.transactionId);
    expect(fs._count('inventory_transactions_v2')).toBe(2);
    expect(fs._get('inventory_catalog', 'item_1')).toMatchObject({ totalStock: 110 });
  });
});

describe('InventoryService.recalculateStock', () => {
  it('replays journal to rebuild stockByLocation cache', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', {
      stockByLocation: { warehouse: 999 }, // wrong cache
      totalStock: 999,
    });
    // Seed 3 historic transactions
    const baseTs = new MockTimestamp(1);
    fs._seed('inventory_transactions_v2', 'tx_1', {
      catalogItemId: 'item_1',
      type: 'purchase',
      qty: 100,
      toLocation: 'warehouse',
      timestamp: baseTs,
    });
    fs._seed('inventory_transactions_v2', 'tx_2', {
      catalogItemId: 'item_1',
      type: 'write_off',
      qty: 30,
      fromLocation: 'warehouse',
      timestamp: new MockTimestamp(2),
    });
    fs._seed('inventory_transactions_v2', 'tx_3', {
      catalogItemId: 'item_1',
      type: 'transfer',
      qty: 20,
      fromLocation: 'warehouse',
      toLocation: 'vehicle_1',
      timestamp: new MockTimestamp(3),
    });
    const svc = makeService(fs);

    const result = await svc.recalculateStock('item_1');

    // 100 purchased → 30 write_off → 20 transfer out (of 70 left on warehouse)
    expect(result.stockByLocation).toEqual({ warehouse: 50, vehicle_1: 20 });
    expect(result.totalStock).toBe(70);
    expect(result.transactionsReplayed).toBe(3);
    // Cache was updated
    expect(fs._get('inventory_catalog', 'item_1')).toMatchObject({
      totalStock: 70,
      stockByLocation: { warehouse: 50, vehicle_1: 20 },
    });
  });

  it('returns zero stock when journal is empty', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1', { stockByLocation: { warehouse: 100 }, totalStock: 100 });
    const svc = makeService(fs);

    const result = await svc.recalculateStock('item_1');

    expect(result.totalStock).toBe(0);
    expect(result.stockByLocation).toEqual({});
    expect(result.transactionsReplayed).toBe(0);
  });
});

describe('InventoryService.commitTransaction — audit fields', () => {
  it('journal doc captures relatedTaskId + clientId + source for project P&L', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1');
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({
        type: 'write_off',
        qty: 5,
        fromLocation: 'warehouse',
        toLocation: undefined,
        relatedTaskId: 'task_42',
        relatedTaskTitle: 'Install conduit',
        relatedClientId: 'client_7',
        relatedClientName: 'Jim D',
        relatedNormId: 'norm_electrical_basic',
        source: 'bot',
        note: 'Worker completed task',
      }),
    );

    const id = fs._listIds('inventory_transactions_v2')[0];
    expect(fs._get('inventory_transactions_v2', id)).toMatchObject({
      relatedTaskId: 'task_42',
      relatedTaskTitle: 'Install conduit',
      relatedClientId: 'client_7',
      relatedClientName: 'Jim D',
      relatedNormId: 'norm_electrical_basic',
      source: 'bot',
      note: 'Worker completed task',
    });
  });

  it('falls back to performedBy for performedByName when not provided', async () => {
    const fs = new MockFirestore();
    seedCatalog(fs, 'item_1');
    const svc = makeService(fs);

    await svc.commitTransaction(
      baseInput({ performedByName: undefined, performedBy: 'bot_telegram' }),
    );

    const id = fs._listIds('inventory_transactions_v2')[0];
    expect(fs._get('inventory_transactions_v2', id)).toMatchObject({
      performedByName: 'bot_telegram',
    });
  });
});
