/**
 * Unit tests for the Firestore loaders used by the agent capability routes.
 *
 * Uses a minimal FakeDb — the same one pattern we use across the module —
 * so tests run without the emulator.
 */

import {
  loadCatalog,
  loadClients,
  loadVendors,
  loadWriteoffContext,
} from '../src/warehouse/api/loaders';
import { WH_COLLECTIONS } from '../src/warehouse/database/collections';
import { makeBalanceKey } from '../src/warehouse/core/types';

// ═══════════════════════════════════════════════════════════════════
//  FakeDb
// ═══════════════════════════════════════════════════════════════════

class FakeDocRef {
  constructor(private coll: FakeCollection, public readonly id: string) {}
  async get() {
    const data = this.coll.docs.get(this.id);
    return { exists: data !== undefined, id: this.id, data: () => data };
  }
}

class FakeQuery {
  constructor(
    private coll: FakeCollection,
    private filters: Array<{ field: string; op: string; value: any }> = [],
    private limitN?: number,
  ) {}
  where(field: string, op: string, value: any) {
    return new FakeQuery(this.coll, [...this.filters, { field, op, value }], this.limitN);
  }
  limit(n: number) {
    return new FakeQuery(this.coll, this.filters, n);
  }
  async get() {
    let docs = Array.from(this.coll.docs.entries()).map(([id, data]) => ({ id, data }));
    for (const f of this.filters) {
      docs = docs.filter((d) => {
        const v = (d.data as any)?.[f.field];
        return f.op === '==' ? v === f.value : true;
      });
    }
    if (this.limitN !== undefined) docs = docs.slice(0, this.limitN);
    return {
      empty: docs.length === 0,
      size: docs.length,
      docs: docs.map(({ id, data }) => ({ id, data: () => data })),
    };
  }
}

class FakeCollection {
  docs = new Map<string, any>();
  constructor(public readonly name: string) {}
  doc(id: string) {
    return new FakeDocRef(this, id);
  }
  where(field: string, op: string, value: any) {
    return new FakeQuery(this, [{ field, op, value }]);
  }
  limit(n: number) {
    return new FakeQuery(this, [], n);
  }
}

class FakeDb {
  collections = new Map<string, FakeCollection>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection(name));
    return this.collections.get(name)!;
  }
  seed(coll: string, id: string, data: any) {
    this.collection(coll).docs.set(id, { id, ...data });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════

describe('loadCatalog', () => {
  it('returns active items as FuzzyCandidate', async () => {
    const db = new FakeDb();
    db.seed(WH_COLLECTIONS.items, 'item_a', { name: 'Outlet 15A', sku: 'OUTLET-15A', isActive: true });
    db.seed(WH_COLLECTIONS.items, 'item_b', { name: 'Archived', sku: 'X', isActive: false });

    const catalog = await loadCatalog(db as any);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe('item_a');
    expect(catalog[0].sku).toBe('OUTLET-15A');
  });

  it('respects limit', async () => {
    const db = new FakeDb();
    for (let i = 0; i < 50; i++) {
      db.seed(WH_COLLECTIONS.items, `item_${i}`, { name: `Item ${i}`, sku: `SKU-${i}`, isActive: true });
    }
    const catalog = await loadCatalog(db as any, { limit: 10 });
    expect(catalog.length).toBe(10);
  });
});

describe('loadClients', () => {
  it('returns clients with names', async () => {
    const db = new FakeDb();
    db.seed('clients', 'c1', { name: 'Jim Dvorkin' });
    db.seed('clients', 'c2', { name: 'Sarah' });
    db.seed('clients', 'c3', {}); // missing name — dropped

    const clients = await loadClients(db as any);
    expect(clients).toHaveLength(2);
    expect(clients[0].name).toBe('Jim Dvorkin');
  });
});

describe('loadVendors', () => {
  it('returns active vendors only', async () => {
    const db = new FakeDb();
    db.seed(WH_COLLECTIONS.vendors, 'v1', { name: 'Home Depot', isActive: true });
    db.seed(WH_COLLECTIONS.vendors, 'v2', { name: 'Inactive', isActive: false });
    const vendors = await loadVendors(db as any);
    expect(vendors).toHaveLength(1);
    expect(vendors[0].name).toBe('Home Depot');
  });
});

describe('loadWriteoffContext', () => {
  it('returns norm + items + balances in one call', async () => {
    const db = new FakeDb();
    db.seed(WH_COLLECTIONS.norms, 'norm1', {
      taskType: 'install_outlet',
      name: 'Install outlet',
      isActive: true,
      items: [
        { itemId: 'item_outlet', qtyPerUnit: 1 },
        { itemId: 'item_wire', qtyPerUnit: 5 },
      ],
    });
    db.seed(WH_COLLECTIONS.items, 'item_outlet', { name: 'Outlet 15A', baseUOM: 'each', averageCost: 2.5, isActive: true });
    db.seed(WH_COLLECTIONS.items, 'item_wire', { name: 'Wire 12-2', baseUOM: 'ft', averageCost: 0.4, isActive: true });
    db.seed(WH_COLLECTIONS.balances, makeBalanceKey('loc_van', 'item_outlet'), {
      locationId: 'loc_van',
      itemId: 'item_outlet',
      onHandQty: 5,
      reservedQty: 0,
      availableQty: 5,
    });
    // intentionally no balance for item_wire — should be absent from the map

    const ctx = await loadWriteoffContext(db as any, { taskType: 'install_outlet', locationId: 'loc_van' });
    expect(ctx.norm?.id).toBe('norm1');
    expect(ctx.items.size).toBe(2);
    expect(ctx.items.get('item_outlet')?.name).toBe('Outlet 15A');
    expect(ctx.balances.size).toBe(1);
    expect(ctx.balances.get(makeBalanceKey('loc_van', 'item_outlet'))?.onHandQty).toBe(5);
  });

  it('returns null norm when taskType unknown', async () => {
    const db = new FakeDb();
    const ctx = await loadWriteoffContext(db as any, { taskType: 'unknown', locationId: 'loc_van' });
    expect(ctx.norm).toBeNull();
    expect(ctx.items.size).toBe(0);
  });

  it('handles norm with zero items', async () => {
    const db = new FakeDb();
    db.seed(WH_COLLECTIONS.norms, 'empty', { taskType: 'empty_task', isActive: true, items: [] });
    const ctx = await loadWriteoffContext(db as any, { taskType: 'empty_task', locationId: 'loc_van' });
    expect(ctx.norm?.id).toBe('empty');
    expect(ctx.items.size).toBe(0);
    expect(ctx.balances.size).toBe(0);
  });
});
