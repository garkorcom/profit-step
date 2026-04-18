/**
 * Unit tests for warehouse migrations (run against a minimal FakeDb — no
 * emulator required). Mirrors the test matrix in docs/warehouse/core/
 * 05_rollout_migration/TESTS.md.
 */

import {
  BootstrapWarehouseMigration,
  DropLegacyInventoryMigration,
  runMigration,
} from '../src/warehouse/database/migrations';
import { LEGACY_INVENTORY_COLLECTIONS, WH_COLLECTIONS } from '../src/warehouse/database/collections';

// ═══════════════════════════════════════════════════════════════════
//  FakeDb — minimal Firestore surface for migration tests
// ═══════════════════════════════════════════════════════════════════

type DocData = Record<string, any>;

class FakeBatch {
  private ops: Array<() => void> = [];
  constructor(private db: FakeDb) {}
  delete(ref: { collection: string; id: string }) {
    this.ops.push(() => this.db.collection(ref.collection).docs.delete(ref.id));
  }
  async commit() {
    for (const op of this.ops) op();
    this.ops = [];
  }
}

class FakeDocRef {
  constructor(private parent: FakeCollection, public id: string) {}
  get collection() {
    return this.parent.name;
  }
  get ref() {
    return this;
  }
  async get() {
    const data = this.parent.docs.get(this.id);
    return {
      exists: data !== undefined,
      id: this.id,
      data: () => data,
      ref: this,
    };
  }
  async set(data: DocData) {
    // Strip FieldValue sentinels — they resolve to Timestamps in live Firestore,
    // in tests we just drop them so the shape test doesn't break.
    const sanitized: DocData = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'constructor' in v) {
        const cn = (v as any).constructor?.name || '';
        if (cn.endsWith('Transform')) continue;
      }
      sanitized[k] = v;
    }
    this.parent.docs.set(this.id, sanitized);
  }
}

class FakeQuery {
  constructor(private parent: FakeCollection, private limitN?: number) {}
  limit(n: number) {
    return new FakeQuery(this.parent, n);
  }
  select() {
    return this;
  }
  async get() {
    let docs = Array.from(this.parent.docs.entries()).map(([id, data]) => ({
      id,
      data: () => data,
      ref: new FakeDocRef(this.parent, id),
    }));
    if (this.limitN !== undefined) docs = docs.slice(0, this.limitN);
    return {
      size: docs.length,
      empty: docs.length === 0,
      docs,
    };
  }
}

class FakeCollection {
  docs = new Map<string, DocData>();
  constructor(public name: string) {}
  doc(id: string) {
    return new FakeDocRef(this, id);
  }
  limit(n: number) {
    return new FakeQuery(this, n);
  }
  select() {
    return new FakeQuery(this);
  }
}

class FakeDb {
  collections = new Map<string, FakeCollection>();
  collection(name: string) {
    if (!this.collections.has(name)) this.collections.set(name, new FakeCollection(name));
    return this.collections.get(name)!;
  }
  batch() {
    return new FakeBatch(this);
  }
  seed(name: string, id: string, data: DocData) {
    this.collection(name).docs.set(id, data);
  }
  count(name: string) {
    return this.collections.get(name)?.docs.size ?? 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════

describe('DropLegacyInventoryMigration', () => {
  it('counts without deleting in dryRun', async () => {
    const db = new FakeDb();
    db.seed('warehouses', 'w1', { name: 'Old' });
    db.seed('inventory_items', 'i1', { name: 'X' });
    db.seed('inventory_items', 'i2', { name: 'Y' });

    const res = await runMigration(db as any, DropLegacyInventoryMigration, {
      dryRun: true,
    });

    expect(db.count('warehouses')).toBe(1);
    expect(db.count('inventory_items')).toBe(2);
    expect((res.summary as any).preCounts.warehouses).toBe(1);
    expect((res.summary as any).preCounts.inventory_items).toBe(2);
  });

  it('deletes all legacy collections in live mode', async () => {
    const db = new FakeDb();
    db.seed('warehouses', 'w1', { name: 'Old' });
    db.seed('inventory_items', 'i1', {});
    db.seed('inventory_transactions', 't1', {});
    db.seed('inventory_locations', 'l1', {});

    await runMigration(db as any, DropLegacyInventoryMigration, { dryRun: false });

    for (const coll of LEGACY_INVENTORY_COLLECTIONS) {
      expect(db.count(coll)).toBe(0);
    }
  });

  it('is idempotent (second run = no-op via markApplied)', async () => {
    const db = new FakeDb();
    db.seed('inventory_items', 'i1', {});
    await runMigration(db as any, DropLegacyInventoryMigration, { dryRun: false });

    // Add data AFTER first run — second run should skip (already applied)
    db.seed('inventory_items', 'i2', {});
    const res = await runMigration(db as any, DropLegacyInventoryMigration, { dryRun: false });

    expect((res.summary as any).skipped).toBe(true);
    expect(db.count('inventory_items')).toBe(1); // not re-deleted
  });
});

describe('BootstrapWarehouseMigration', () => {
  it('seeds all 5 kinds of documents', async () => {
    const db = new FakeDb();
    const res = await runMigration(db as any, BootstrapWarehouseMigration, { dryRun: false });

    const summary = res.summary as any;
    expect(summary.locations.inserted).toBe(5);
    expect(summary.categories.inserted).toBeGreaterThanOrEqual(8);
    expect(summary.items.inserted).toBeGreaterThanOrEqual(40);
    expect(summary.norms.inserted).toBeGreaterThanOrEqual(18);
    expect(summary.vendors.inserted).toBeGreaterThanOrEqual(3);

    expect(db.count(WH_COLLECTIONS.locations)).toBe(5);
    expect(db.count(WH_COLLECTIONS.items)).toBeGreaterThanOrEqual(40);
  });

  it('skips existing documents on re-run', async () => {
    const db = new FakeDb();
    // Pre-seed one location so the migration must skip it
    db.seed(WH_COLLECTIONS.locations, 'loc_warehouse_miami', { name: 'pre-existing' });

    const res = await runMigration(db as any, BootstrapWarehouseMigration, { dryRun: false });
    const summary = res.summary as any;

    expect(summary.locations.skipped).toBeGreaterThanOrEqual(1);
    // Pre-seeded location preserved
    const preserved = await db
      .collection(WH_COLLECTIONS.locations)
      .doc('loc_warehouse_miami')
      .get();
    expect(preserved.data()?.name).toBe('pre-existing');
  });

  it('records dryRun without writing', async () => {
    const db = new FakeDb();
    const res = await runMigration(db as any, BootstrapWarehouseMigration, { dryRun: true });
    const summary = res.summary as any;

    expect(summary.items.inserted).toBeGreaterThan(0);
    // Nothing actually written
    expect(db.count(WH_COLLECTIONS.items)).toBe(0);
    expect(db.count(WH_COLLECTIONS.locations)).toBe(0);
  });
});
