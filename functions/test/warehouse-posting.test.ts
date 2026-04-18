/**
 * Integration-style unit tests for the posting engine.
 *
 * Uses a FakeTx implementation of PostTx that simulates Firestore transaction
 * semantics in-memory: reads see the pre-transaction state, writes are
 * buffered and applied atomically on commit. This lets us test concurrency
 * + idempotency without the emulator.
 *
 * Matrix: docs/warehouse/core/02_posting_engine/TESTS.md.
 */

import {
  postDocument,
  voidDocument,
  WarehouseError,
  type PostTx,
  buildBalanceOps,
  collectLocationIds,
  computeLine,
  effectiveNegativeStockPolicy,
  shouldReleaseReservation,
} from '../src/warehouse/core';
import { WH_COLLECTIONS } from '../src/warehouse/database/collections';
import { makeBalanceKey } from '../src/warehouse/core/types';

// ═══════════════════════════════════════════════════════════════════
//  FakeTx — in-memory transaction
// ═══════════════════════════════════════════════════════════════════

class FakeStore {
  data = new Map<string, Map<string, any>>();
  // `lines` subcollection keyed by `${parentColl}:${parentId}`
  lines = new Map<string, any[]>();
  // Ledger entries indexed additionally by documentId for easy reverse lookup
  ledgerByDocument = new Map<string, any[]>();
  idSeq = 0;

  coll(name: string) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name)!;
  }
  seed(coll: string, id: string, value: any) {
    this.coll(coll).set(id, { id, ...value });
  }
  seedLines(parentColl: string, parentId: string, rows: any[]) {
    this.lines.set(`${parentColl}:${parentId}`, rows);
  }
  seedLedgerForDoc(docId: string, entries: any[]) {
    this.ledgerByDocument.set(docId, entries);
  }
  nextId(coll: string) {
    return `${coll}_${++this.idSeq}`;
  }
}

class FakeTx implements PostTx {
  private writes: Array<() => void> = [];

  constructor(private store: FakeStore) {}

  async get<T = any>(collection: string, id: string): Promise<T | undefined> {
    return this.store.coll(collection).get(id);
  }

  async getLines<T = any>(
    parentCollection: string,
    parentId: string,
    linesSub: string,
  ): Promise<T[]> {
    // For ledger "sibling" use case (reversal original-entries lookup), the
    // second param is the original documentId and linesSub is 'original_entries'.
    if (parentCollection === WH_COLLECTIONS.ledger) {
      return (this.store.ledgerByDocument.get(parentId) ?? []) as T[];
    }
    return (this.store.lines.get(`${parentCollection}:${parentId}`) ?? []) as T[];
  }

  set(collection: string, id: string, data: Record<string, unknown>): void {
    this.writes.push(() => {
      this.store.coll(collection).set(id, { id, ...data });
    });
  }

  merge(collection: string, id: string, data: Record<string, unknown>): void {
    this.writes.push(() => {
      const existing = this.store.coll(collection).get(id) ?? { id };
      this.store.coll(collection).set(id, { ...existing, ...data });
      // Keep ledger-by-document index in sync when merging wh_ledger entries
      if (collection === WH_COLLECTIONS.ledger && data.documentId) {
        const arr = this.store.ledgerByDocument.get(data.documentId as string) ?? [];
        arr.push({ ...existing, ...data });
        this.store.ledgerByDocument.set(data.documentId as string, arr);
      }
    });
  }

  create(collection: string, data: Record<string, unknown>): string {
    const id = this.store.nextId(collection);
    this.writes.push(() => {
      this.store.coll(collection).set(id, { id, ...data });
      if (collection === WH_COLLECTIONS.ledger && data.documentId) {
        const arr = this.store.ledgerByDocument.get(data.documentId as string) ?? [];
        arr.push({ id, ...data });
        this.store.ledgerByDocument.set(data.documentId as string, arr);
      }
    });
    return id;
  }

  serverTimestamp() {
    return '__SERVER_TS__';
  }

  commit() {
    for (const w of this.writes) w();
    this.writes = [];
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════

const ITEM_WIRE = {
  id: 'item_wire',
  schemaVersion: 1,
  sku: 'WIRE',
  name: 'Wire 12-2',
  category: 'cat_electrical_cable',
  baseUOM: 'ft',
  purchaseUOMs: [
    { uom: 'ft', factor: 1, isDefault: false },
    { uom: 'roll_250ft', factor: 250, isDefault: true },
  ],
  allowedIssueUOMs: ['ft'],
  lastPurchasePrice: 0.4,
  averageCost: 0.4,
  isTrackable: false,
  isActive: true,
};

const ITEM_OUTLET = {
  id: 'item_outlet',
  schemaVersion: 1,
  sku: 'OUTLET',
  name: 'Outlet 15A',
  category: 'cat_electrical_device',
  baseUOM: 'each',
  purchaseUOMs: [{ uom: 'each', factor: 1, isDefault: true }],
  allowedIssueUOMs: ['each'],
  lastPurchasePrice: 2.5,
  averageCost: 2.5,
  isTrackable: false,
  isActive: true,
};

const LOC_WH = {
  id: 'loc_warehouse',
  schemaVersion: 1,
  name: 'Warehouse',
  locationType: 'warehouse',
  isActive: true,
  twoPhaseTransferEnabled: false,
};

const LOC_VAN = {
  id: 'loc_van',
  schemaVersion: 1,
  name: 'Van',
  locationType: 'van',
  ownerEmployeeId: 'emp_a',
  isActive: true,
  twoPhaseTransferEnabled: false,
};

function buildStoreBasics(opts: {
  whOnHand?: Record<string, number>;
  vanOnHand?: Record<string, number>;
  reserved?: Record<string, { loc: string; item: string; qty: number }>;
} = {}): FakeStore {
  const s = new FakeStore();
  s.seed(WH_COLLECTIONS.items, ITEM_WIRE.id, ITEM_WIRE);
  s.seed(WH_COLLECTIONS.items, ITEM_OUTLET.id, ITEM_OUTLET);
  s.seed(WH_COLLECTIONS.locations, LOC_WH.id, LOC_WH);
  s.seed(WH_COLLECTIONS.locations, LOC_VAN.id, LOC_VAN);

  if (opts.whOnHand) {
    for (const [itemId, qty] of Object.entries(opts.whOnHand)) {
      const key = makeBalanceKey(LOC_WH.id, itemId);
      s.seed(WH_COLLECTIONS.balances, key, {
        id: key,
        schemaVersion: 1,
        locationId: LOC_WH.id,
        itemId,
        onHandQty: qty,
        reservedQty: 0,
        availableQty: qty,
      });
    }
  }
  if (opts.vanOnHand) {
    for (const [itemId, qty] of Object.entries(opts.vanOnHand)) {
      const key = makeBalanceKey(LOC_VAN.id, itemId);
      s.seed(WH_COLLECTIONS.balances, key, {
        id: key,
        schemaVersion: 1,
        locationId: LOC_VAN.id,
        itemId,
        onHandQty: qty,
        reservedQty: 0,
        availableQty: qty,
      });
    }
  }
  return s;
}

// ═══════════════════════════════════════════════════════════════════
//  Pure-helper tests
// ═══════════════════════════════════════════════════════════════════

describe('pure helpers', () => {
  it('collectLocationIds gathers from doc', () => {
    expect(
      collectLocationIds({
        sourceLocationId: 'a',
        destinationLocationId: 'b',
      } as any),
    ).toEqual(['a', 'b']);
    expect(collectLocationIds({ locationId: 'c' } as any)).toEqual(['c']);
  });

  it('computeLine converts purchase UOM to base', () => {
    const computed = computeLine(
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'roll_250ft', qty: 2, unitCost: 100 },
      ITEM_WIRE as any,
      { docType: 'receipt' } as any,
    );
    expect(computed.baseQtyComputed).toBe(500);
    expect(computed.baseUnitCostComputed).toBeCloseTo(0.4, 5);
  });

  it('computeLine throws on missing unitCost for receipt', () => {
    expect(() =>
      computeLine(
        { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 10 },
        ITEM_WIRE as any,
        { docType: 'receipt' } as any,
      ),
    ).toThrow(WarehouseError);
  });

  it('buildBalanceOps builds both sides for transfer', () => {
    const ops = buildBalanceOps(
      {
        docType: 'transfer',
        sourceLocationId: 'A',
        destinationLocationId: 'B',
      } as any,
      [
        {
          id: 'ln1',
          lineNumber: 1,
          itemId: 'item_wire',
          uom: 'ft',
          qty: 10,
          baseQtyComputed: 10,
          baseUnitCostComputed: 0.4,
          item: ITEM_WIRE,
        } as any,
      ],
    );
    expect(ops).toHaveLength(2);
    expect(ops[0].deltaBaseQty).toBe(-10);
    expect(ops[1].deltaBaseQty).toBe(10);
  });

  it('effectiveNegativeStockPolicy defaults to locationType', () => {
    expect(effectiveNegativeStockPolicy(LOC_WH as any, ITEM_WIRE as any)).toBe('blocked');
    expect(effectiveNegativeStockPolicy(LOC_VAN as any, ITEM_WIRE as any)).toBe('allowed_with_alert');
  });

  it('effectiveNegativeStockPolicy respects per-item override', () => {
    expect(
      effectiveNegativeStockPolicy(
        LOC_WH as any,
        { ...ITEM_WIRE, allowNegativeStock: true } as any,
      ),
    ).toBe('allowed');
  });

  it('shouldReleaseReservation only for issue/transfer with projectId', () => {
    expect(
      shouldReleaseReservation(
        { docType: 'issue', projectId: 'p1' } as any,
        { deltaBaseQty: -5 } as any,
      ),
    ).toBe(true);
    expect(
      shouldReleaseReservation(
        { docType: 'receipt', projectId: 'p1' } as any,
        { deltaBaseQty: 5 } as any,
      ),
    ).toBe(false);
    expect(shouldReleaseReservation({ docType: 'issue' } as any, { deltaBaseQty: -5 } as any)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Receipt posting
// ═══════════════════════════════════════════════════════════════════

describe('postDocument — receipt', () => {
  it('happy path creates ledger + balance updates item cost', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_rcp_1', {
      id: 'doc_rcp_1',
      docType: 'receipt',
      status: 'draft',
      eventDate: { _ts: 'event' },
      destinationLocationId: LOC_WH.id,
      source: 'ui',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_rcp_1', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'roll_250ft', qty: 2, unitCost: 90 },
      { id: 'ln2', lineNumber: 2, itemId: 'item_outlet', uom: 'each', qty: 10, unitCost: 2.49 },
    ]);

    const tx = new FakeTx(store);
    const result = await postDocument(tx, 'doc_rcp_1', { userId: 'user_a' });
    tx.commit();

    expect(result.alreadyPosted).toBe(false);
    expect(result.ledgerEntryIds.length).toBe(2);
    expect(result.balanceDelta.length).toBe(2);

    const whWire = store.coll(WH_COLLECTIONS.balances).get(makeBalanceKey(LOC_WH.id, 'item_wire'));
    expect(whWire.onHandQty).toBe(500);
    const whOutlet = store.coll(WH_COLLECTIONS.balances).get(makeBalanceKey(LOC_WH.id, 'item_outlet'));
    expect(whOutlet.onHandQty).toBe(10);

    const wireItem = store.coll(WH_COLLECTIONS.items).get('item_wire');
    expect(wireItem.lastPurchasePrice).toBeCloseTo(0.36, 5);
    const outletItem = store.coll(WH_COLLECTIONS.items).get('item_outlet');
    expect(outletItem.lastPurchasePrice).toBeCloseTo(2.49, 5);

    const doc = store.coll(WH_COLLECTIONS.documents).get('doc_rcp_1');
    expect(doc.status).toBe('posted');
    expect(doc.postedBy).toBe('user_a');

    expect(result.events).toContain('warehouse.document.posted');
  });

  it('rejects receipt without unitCost', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_rcp_bad', {
      id: 'doc_rcp_bad',
      docType: 'receipt',
      status: 'draft',
      eventDate: '2026-04-18',
      destinationLocationId: LOC_WH.id,
      source: 'ui',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_rcp_bad', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 10 }, // no unitCost
    ]);

    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'doc_rcp_bad', { userId: 'user_a' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  // Regression: Firestore admin SDK rejects `undefined` as a field value
  // unless `ignoreUndefinedProperties` is enabled. postDocument used to write
  // `needsReconciliation: undefined` for non-negative balances, which blew up
  // on the first real post from UI with an INTERNAL_ERROR.
  it('never writes `undefined` field values to balances (Firestore compat)', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_rcp_regression', {
      id: 'doc_rcp_regression',
      docType: 'receipt',
      status: 'draft',
      eventDate: { _ts: 'event' },
      destinationLocationId: LOC_WH.id,
      source: 'ui',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_rcp_regression', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_outlet', uom: 'each', qty: 3, unitCost: 2.0 },
    ]);

    const writes: Array<{ collection: string; data: Record<string, unknown> }> = [];
    const strictTx: PostTx = {
      get: async (c, id) => store.coll(c).get(id),
      getLines: async (pc, pid, _sub) => {
        if (pc === WH_COLLECTIONS.ledger) return store.ledgerByDocument.get(pid) ?? [];
        return store.lines.get(`${pc}:${pid}`) ?? [];
      },
      set: (collection, _id, data) => {
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined) {
            throw new Error(`STRICT_FAKE_TX: undefined at ${collection}.${k}`);
          }
        }
        writes.push({ collection, data });
      },
      merge: (collection, _id, data) => {
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined) {
            throw new Error(`STRICT_FAKE_TX: undefined at ${collection}.${k} (merge)`);
          }
        }
        writes.push({ collection, data });
      },
      create: (collection, data) => {
        for (const [k, v] of Object.entries(data)) {
          if (v === undefined) {
            throw new Error(`STRICT_FAKE_TX: undefined at ${collection}.${k} (create)`);
          }
        }
        writes.push({ collection, data });
        return `${collection}_seq_${writes.length}`;
      },
      serverTimestamp: () => '__TS__',
    };

    // If any write contained `undefined`, strictTx would have thrown and
    // rejected this promise. Passing = all writes are Firestore-compatible.
    await expect(
      postDocument(strictTx, 'doc_rcp_regression', { userId: 'user_a' }),
    ).resolves.toBeDefined();

    const balanceWrites = writes.filter((w) => w.collection === WH_COLLECTIONS.balances);
    expect(balanceWrites.length).toBeGreaterThan(0);
    // needsReconciliation key must be absent when onHandQty >= 0.
    for (const w of balanceWrites) {
      expect('needsReconciliation' in w.data).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Issue posting
// ═══════════════════════════════════════════════════════════════════

describe('postDocument — issue', () => {
  it('blocks issue on warehouse when insufficient stock', async () => {
    const store = buildStoreBasics({ whOnHand: { item_wire: 5 } });
    store.seed(WH_COLLECTIONS.documents, 'doc_iss_1', {
      id: 'doc_iss_1',
      docType: 'issue',
      status: 'draft',
      eventDate: '2026-04-18',
      sourceLocationId: LOC_WH.id,
      reason: 'internal_shop_use',
      source: 'ui',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_iss_1', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 10 },
    ]);

    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'doc_iss_1', { userId: 'u' })).rejects.toMatchObject({
      code: 'NEGATIVE_STOCK_BLOCKED',
    });
  });

  it('allows issue on van with alert', async () => {
    const store = buildStoreBasics({ vanOnHand: { item_wire: 5 } });
    store.seed(WH_COLLECTIONS.documents, 'doc_iss_2', {
      id: 'doc_iss_2',
      docType: 'issue',
      status: 'draft',
      eventDate: '2026-04-18',
      sourceLocationId: LOC_VAN.id,
      reason: 'internal_shop_use',
      source: 'ai',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_iss_2', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 10 },
    ]);

    const tx = new FakeTx(store);
    const result = await postDocument(tx, 'doc_iss_2', { userId: 'u' });
    tx.commit();

    expect(result.events).toContain('warehouse.negative_stock');
    expect(result.balanceDelta[0].onHandAfter).toBe(-5);

    const vanBalance = store
      .coll(WH_COLLECTIONS.balances)
      .get(makeBalanceKey(LOC_VAN.id, 'item_wire'));
    expect(vanBalance.onHandQty).toBe(-5);
    expect(vanBalance.needsReconciliation).toBe(true);
  });

  it('rejects posting an already-posted document idempotently', async () => {
    const store = buildStoreBasics({ vanOnHand: { item_wire: 100 } });
    store.seed(WH_COLLECTIONS.documents, 'doc_iss_p', {
      id: 'doc_iss_p',
      docType: 'issue',
      status: 'posted',
      eventDate: '2026-04-18',
      sourceLocationId: LOC_VAN.id,
      postedAt: 'x',
      postedBy: 'prev_user',
      ledgerEntryIds: ['le_existing'],
      source: 'ui',
    });

    const tx = new FakeTx(store);
    const result = await postDocument(tx, 'doc_iss_p', { userId: 'new_user' });
    expect(result.alreadyPosted).toBe(true);
    expect(result.ledgerEntryIds).toEqual(['le_existing']);
  });

  it('honors idempotency key — returns cached result', async () => {
    const store = buildStoreBasics({ vanOnHand: { item_wire: 100 } });
    store.seed(WH_COLLECTIONS.idempotencyKeys, 'KEY-1', {
      id: 'KEY-1',
      key: 'KEY-1',
      result: {
        documentId: 'doc_cache',
        status: 'posted',
        postedAt: 'prev',
        postedBy: 'prev',
        ledgerEntryIds: ['le_cached'],
        alreadyPosted: true,
        balanceDelta: [],
        events: [],
      },
    });
    // Even though there's no matching draft doc, the idempotency cache short-circuits.
    const tx = new FakeTx(store);
    const result = await postDocument(tx, 'whatever', { userId: 'u', idempotencyKey: 'KEY-1' });
    expect(result.alreadyPosted).toBe(true);
    expect(result.ledgerEntryIds).toEqual(['le_cached']);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Transfer posting
// ═══════════════════════════════════════════════════════════════════

describe('postDocument — transfer', () => {
  it('transfer creates symmetric ledger + balance changes', async () => {
    const store = buildStoreBasics({ whOnHand: { item_wire: 500 } });
    store.seed(WH_COLLECTIONS.documents, 'doc_trf', {
      id: 'doc_trf',
      docType: 'transfer',
      status: 'draft',
      eventDate: '2026-04-18',
      sourceLocationId: LOC_WH.id,
      destinationLocationId: LOC_VAN.id,
      source: 'ai',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_trf', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 50 },
    ]);

    const tx = new FakeTx(store);
    const result = await postDocument(tx, 'doc_trf', { userId: 'u' });
    tx.commit();

    expect(result.ledgerEntryIds).toHaveLength(2);
    const whBalance = store.coll(WH_COLLECTIONS.balances).get(makeBalanceKey(LOC_WH.id, 'item_wire'));
    const vanBalance = store.coll(WH_COLLECTIONS.balances).get(makeBalanceKey(LOC_VAN.id, 'item_wire'));
    expect(whBalance.onHandQty).toBe(450);
    expect(vanBalance.onHandQty).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Reservation release
// ═══════════════════════════════════════════════════════════════════

describe('postDocument — reservation release on post', () => {
  it('issue with projectId decrements reservedQty on source', async () => {
    const store = buildStoreBasics();
    // Pre-seed balance with reservation
    const key = makeBalanceKey(LOC_VAN.id, 'item_wire');
    store.coll(WH_COLLECTIONS.balances).set(key, {
      id: key,
      schemaVersion: 1,
      locationId: LOC_VAN.id,
      itemId: 'item_wire',
      onHandQty: 100,
      reservedQty: 20,
      availableQty: 80,
    });

    store.seed(WH_COLLECTIONS.documents, 'doc_iss_proj', {
      id: 'doc_iss_proj',
      docType: 'issue',
      status: 'draft',
      eventDate: '2026-04-18',
      sourceLocationId: LOC_VAN.id,
      reason: 'project_installation',
      projectId: 'proj_X',
      source: 'ai',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_iss_proj', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 20 },
    ]);

    const tx = new FakeTx(store);
    await postDocument(tx, 'doc_iss_proj', { userId: 'u' });
    tx.commit();

    const after = store.coll(WH_COLLECTIONS.balances).get(key);
    expect(after.onHandQty).toBe(80);
    expect(after.reservedQty).toBe(0);
    expect(after.availableQty).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Void / reversal
// ═══════════════════════════════════════════════════════════════════

describe('voidDocument', () => {
  it('voids a draft (no reversal needed)', async () => {
    const store = buildStoreBasics({ vanOnHand: { item_wire: 50 } });
    const key = makeBalanceKey(LOC_VAN.id, 'item_wire');
    // Simulate a draft that already reserved 10
    store.coll(WH_COLLECTIONS.balances).set(key, {
      id: key,
      schemaVersion: 1,
      locationId: LOC_VAN.id,
      itemId: 'item_wire',
      onHandQty: 50,
      reservedQty: 10,
      availableQty: 40,
    });
    store.seed(WH_COLLECTIONS.documents, 'doc_draft', {
      id: 'doc_draft',
      docType: 'issue',
      status: 'draft',
      sourceLocationId: LOC_VAN.id,
      projectId: 'proj_X',
      source: 'ai',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_draft', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 10, baseQty: 10 },
    ]);

    const tx = new FakeTx(store);
    const result = await voidDocument(tx, 'doc_draft', { userId: 'u', reason: 'changed_mind' });
    tx.commit();

    expect(result.reversalDocumentId).toBeNull();
    const doc = store.coll(WH_COLLECTIONS.documents).get('doc_draft');
    expect(doc.status).toBe('voided');
    const after = store.coll(WH_COLLECTIONS.balances).get(key);
    expect(after.reservedQty).toBe(0);
    expect(after.availableQty).toBe(50);
  });

  it('creates reversal for posted document with compensating ledger', async () => {
    const store = buildStoreBasics();
    // Posted issue that drained 50 wire from van
    const key = makeBalanceKey(LOC_VAN.id, 'item_wire');
    store.coll(WH_COLLECTIONS.balances).set(key, {
      id: key,
      schemaVersion: 1,
      locationId: LOC_VAN.id,
      itemId: 'item_wire',
      onHandQty: 50,
      reservedQty: 0,
      availableQty: 50,
    });
    store.seed(WH_COLLECTIONS.documents, 'doc_posted', {
      id: 'doc_posted',
      docType: 'issue',
      status: 'posted',
      sourceLocationId: LOC_VAN.id,
      source: 'ui',
      ledgerEntryIds: ['le_orig'],
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_posted', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 50, baseQty: 50 },
    ]);
    // Original ledger entry (indexed for reversal lookup)
    store.seedLedgerForDoc('doc_posted', [
      {
        id: 'le_orig',
        documentId: 'doc_posted',
        itemId: 'item_wire',
        locationId: LOC_VAN.id,
        deltaQty: -50,
        direction: 'out',
        unitCostAtPosting: 0.4,
      },
    ]);

    const tx = new FakeTx(store);
    const result = await voidDocument(tx, 'doc_posted', { userId: 'u', reason: 'wrong_qty' });
    tx.commit();

    expect(result.reversalDocumentId).toBeDefined();
    expect(result.events).toContain('warehouse.reversal.created');
    // Original marked voided
    const orig = store.coll(WH_COLLECTIONS.documents).get('doc_posted');
    expect(orig.status).toBe('voided');
    // Balance restored
    const after = store.coll(WH_COLLECTIONS.balances).get(key);
    expect(after.onHandQty).toBe(100);
    // Reversal document exists
    const reversal = store.coll(WH_COLLECTIONS.documents).get(result.reversalDocumentId!);
    expect(reversal.docType).toBe('reversal');
    expect(reversal.reversalOf).toBe('doc_posted');
  });

  it('refuses to reverse a reversal', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_rev', {
      id: 'doc_rev',
      docType: 'reversal',
      status: 'posted',
      source: 'api',
    });

    const tx = new FakeTx(store);
    await expect(
      voidDocument(tx, 'doc_rev', { userId: 'u', reason: 'oops' }),
    ).rejects.toMatchObject({ code: 'CANNOT_REVERSE_REVERSAL' });
  });

  it('refuses to void an already-voided doc', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_already_v', {
      id: 'doc_already_v',
      docType: 'issue',
      status: 'voided',
      source: 'api',
    });

    const tx = new FakeTx(store);
    await expect(
      voidDocument(tx, 'doc_already_v', { userId: 'u', reason: 'x' }),
    ).rejects.toMatchObject({ code: 'DOCUMENT_ALREADY_VOIDED' });
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Failure modes
// ═══════════════════════════════════════════════════════════════════

describe('postDocument — error paths', () => {
  it('throws DOCUMENT_NOT_FOUND for missing id', async () => {
    const store = buildStoreBasics();
    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'missing', { userId: 'u' })).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_FOUND',
    });
  });

  it('throws DOCUMENT_NOT_IN_POSTABLE_STATE for expired draft', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_x', {
      id: 'doc_x',
      docType: 'issue',
      status: 'expired',
      source: 'ai',
    });
    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'doc_x', { userId: 'u' })).rejects.toMatchObject({
      code: 'DOCUMENT_NOT_IN_POSTABLE_STATE',
    });
  });

  it('throws EMPTY_DOCUMENT if there are no lines', async () => {
    const store = buildStoreBasics({ whOnHand: { item_wire: 100 } });
    store.seed(WH_COLLECTIONS.documents, 'doc_empty', {
      id: 'doc_empty',
      docType: 'issue',
      status: 'draft',
      sourceLocationId: LOC_WH.id,
      source: 'ui',
    });
    // no lines seeded

    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'doc_empty', { userId: 'u' })).rejects.toMatchObject({
      code: 'EMPTY_DOCUMENT',
    });
  });

  it('throws ITEM_INACTIVE when line references archived item', async () => {
    const store = buildStoreBasics();
    store.coll(WH_COLLECTIONS.items).set('item_wire', { ...ITEM_WIRE, isActive: false });
    store.seed(WH_COLLECTIONS.documents, 'doc_arch', {
      id: 'doc_arch',
      docType: 'receipt',
      status: 'draft',
      destinationLocationId: LOC_WH.id,
      source: 'ui',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_arch', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'ft', qty: 10, unitCost: 0.4 },
    ]);

    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'doc_arch', { userId: 'u' })).rejects.toMatchObject({
      code: 'ITEM_INACTIVE',
    });
  });

  it('throws INVALID_UOM / UOM_CONVERSION_FAILED for unknown UOM', async () => {
    const store = buildStoreBasics();
    store.seed(WH_COLLECTIONS.documents, 'doc_uom', {
      id: 'doc_uom',
      docType: 'receipt',
      status: 'draft',
      destinationLocationId: LOC_WH.id,
      source: 'ui',
    });
    store.seedLines(WH_COLLECTIONS.documents, 'doc_uom', [
      { id: 'ln1', lineNumber: 1, itemId: 'item_wire', uom: 'roll_999ft', qty: 1, unitCost: 100 },
    ]);

    const tx = new FakeTx(store);
    await expect(postDocument(tx, 'doc_uom', { userId: 'u' })).rejects.toMatchObject({
      code: 'UOM_CONVERSION_FAILED',
    });
  });
});
