/**
 * Integrity tests for the seed data.
 *
 * These are pure structural tests — no Firestore required. They ensure that
 * every norm references an existing item, that SKUs are unique, that each
 * item's baseUOM is either declared in purchaseUOMs or allowedIssueUOMs,
 * and that category references are valid.
 */

import {
  SEED_CATEGORIES,
  SEED_ITEMS,
  SEED_LOCATIONS,
  SEED_NORMS,
  SEED_VENDORS,
} from '../src/warehouse/database/seed';

describe('seed counts', () => {
  it('categories has ≥ 8 entries', () => {
    expect(SEED_CATEGORIES.length).toBeGreaterThanOrEqual(8);
  });
  it('items has ≥ 40 entries', () => {
    expect(SEED_ITEMS.length).toBeGreaterThanOrEqual(40);
  });
  it('norms has ≥ 18 entries', () => {
    expect(SEED_NORMS.length).toBeGreaterThanOrEqual(18);
  });
  it('locations has exactly 5 (1 wh + 3 vans + 1 quarantine)', () => {
    expect(SEED_LOCATIONS.length).toBe(5);
    expect(SEED_LOCATIONS.filter((l) => l.locationType === 'warehouse').length).toBe(1);
    expect(SEED_LOCATIONS.filter((l) => l.locationType === 'van').length).toBe(3);
    expect(SEED_LOCATIONS.filter((l) => l.locationType === 'quarantine').length).toBe(1);
  });
  it('vendors has ≥ 3 entries', () => {
    expect(SEED_VENDORS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('uniqueness', () => {
  it('item SKUs are unique', () => {
    const skus = SEED_ITEMS.map((i) => i.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });
  it('item ids are unique', () => {
    const ids = SEED_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('category ids are unique', () => {
    const ids = SEED_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('norm taskTypes are unique', () => {
    const tt = SEED_NORMS.map((n) => n.taskType);
    expect(new Set(tt).size).toBe(tt.length);
  });
});

describe('referential integrity', () => {
  const itemIds = new Set(SEED_ITEMS.map((i) => i.id));
  const categoryIds = new Set(SEED_CATEGORIES.map((c) => c.id));

  it('every item.category references a real category', () => {
    for (const item of SEED_ITEMS) {
      expect(categoryIds.has(item.category)).toBe(true);
    }
  });

  it('every norm.items[].itemId references a real item', () => {
    for (const norm of SEED_NORMS) {
      for (const ni of norm.items) {
        expect(itemIds.has(ni.itemId)).toBe(true);
      }
    }
  });

  it('every van location has ownerEmployeeId', () => {
    for (const loc of SEED_LOCATIONS) {
      if (loc.locationType === 'van') {
        expect(loc.ownerEmployeeId).toBeDefined();
      }
    }
  });
});

describe('UOM consistency', () => {
  it('every item declares exactly one default purchase UOM', () => {
    for (const item of SEED_ITEMS) {
      const defaults = item.purchaseUOMs.filter((p) => p.isDefault);
      expect(defaults.length).toBe(1);
    }
  });

  it('every baseUOM is present in either purchaseUOMs or allowedIssueUOMs', () => {
    for (const item of SEED_ITEMS) {
      const knownUOMs = new Set([...item.purchaseUOMs.map((p) => p.uom), ...item.allowedIssueUOMs]);
      expect(knownUOMs.has(item.baseUOM)).toBe(true);
    }
  });

  it('all purchaseUOM factors are positive numbers', () => {
    for (const item of SEED_ITEMS) {
      for (const p of item.purchaseUOMs) {
        expect(p.factor).toBeGreaterThan(0);
      }
    }
  });
});

describe('norm quantities', () => {
  it('all qtyPerUnit are positive', () => {
    for (const norm of SEED_NORMS) {
      for (const ni of norm.items) {
        expect(ni.qtyPerUnit).toBeGreaterThan(0);
      }
    }
  });
});
