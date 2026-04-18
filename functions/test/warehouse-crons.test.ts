/**
 * Unit tests for the warehouse scheduled-function core logic.
 *
 * - UC5 analyzeSingleTaskUsage / detectAnomaliesBatch
 * - UC6 buildLowStockReorder
 * - UC8 findDeadStock
 */

import {
  analyzeSingleTaskUsage,
  buildLowStockReorder,
  detectAnomaliesBatch,
  findDeadStock,
} from '../src/warehouse/crons';
import type {
  WhBalance,
  WhDocument,
  WhItem,
  WhLedgerEntry,
  WhNorm,
  WhVendor,
} from '../src/warehouse/core/types';
import { makeBalanceKey } from '../src/warehouse/core/types';

// ═══════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════

function mkItem(
  id: string,
  name: string,
  category: string,
  baseUOM: string,
  avgCost: number,
  minStock?: number,
  reorderPoint?: number,
): WhItem {
  return {
    id,
    schemaVersion: 1,
    sku: id.toUpperCase(),
    name,
    category,
    baseUOM,
    purchaseUOMs: [{ uom: baseUOM, factor: 1, isDefault: true }],
    allowedIssueUOMs: [baseUOM],
    lastPurchasePrice: avgCost,
    averageCost: avgCost,
    minStock,
    reorderPoint,
    isTrackable: false,
    isActive: true,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'system',
    createdByType: 'system',
  };
}

function mkVendor(
  id: string,
  name: string,
  vendorType: WhVendor['vendorType'],
  categories: string[],
): WhVendor {
  return {
    id,
    schemaVersion: 1,
    name,
    vendorType,
    preferredForCategories: categories,
    isActive: true,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'system',
    createdByType: 'system',
  };
}

function mkBalance(locationId: string, itemId: string, onHand: number, reserved = 0): WhBalance {
  return {
    id: makeBalanceKey(locationId, itemId),
    schemaVersion: 1,
    locationId,
    itemId,
    onHandQty: onHand,
    reservedQty: reserved,
    availableQty: onHand - reserved,
    updatedAt: null as any,
  };
}

function mkDocument(id: string, relatedTaskId: string): WhDocument {
  return {
    id,
    schemaVersion: 1,
    docNumber: id,
    docType: 'issue',
    status: 'posted',
    eventDate: null as any,
    sourceLocationId: 'loc_van',
    source: 'ai',
    relatedTaskId,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'u',
    createdByType: 'human',
  };
}

function mkLedger(
  docId: string,
  itemId: string,
  qty: number,
  unitCost: number,
): WhLedgerEntry {
  return {
    id: `le_${itemId}_${docId}`,
    schemaVersion: 1,
    documentId: docId,
    lineId: 'l1',
    itemId,
    locationId: 'loc_van',
    deltaQty: -qty,
    direction: 'out',
    unitCostAtPosting: unitCost,
    eventDate: null as any,
    postedAt: null as any,
    postedBy: 'u',
  };
}

function mkNorm(taskType: string, items: Array<{ itemId: string; qtyPerUnit: number }>): WhNorm {
  return {
    id: `norm_${taskType}`,
    schemaVersion: 1,
    taskType,
    name: `Norm ${taskType}`,
    items,
    isActive: true,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'system',
    createdByType: 'system',
  };
}

// ═══════════════════════════════════════════════════════════════════
//  UC5 Anomaly Watcher
// ═══════════════════════════════════════════════════════════════════

describe('UC5 — analyzeSingleTaskUsage', () => {
  const outletNorm = mkNorm('install_outlet', [
    { itemId: 'item_outlet', qtyPerUnit: 1 },
    { itemId: 'item_wire', qtyPerUnit: 5 },
  ]);

  const costs = new Map<string, number>([
    ['item_outlet', 2.5],
    ['item_wire', 0.4],
  ]);

  it('reports NO anomaly when actual matches planned', () => {
    const summary = {
      document: mkDocument('doc1', 'task1'),
      ledgerEntries: [
        mkLedger('doc1', 'item_outlet', 3, 2.5),
        mkLedger('doc1', 'item_wire', 15, 0.4),
      ],
      task: { id: 'task1', templateType: 'install_outlet', qty: 3 },
      norm: outletNorm,
      averageCostByItemId: costs,
    };
    const r = analyzeSingleTaskUsage(summary);
    expect(r.isAnomaly).toBe(false);
    expect(r.overrunPercent).toBe(0);
    expect(r.plannedCost).toBeCloseTo(13.5, 2); // 3*2.5 + 15*0.4
    expect(r.actualCost).toBeCloseTo(13.5, 2);
  });

  it('flags anomaly when both % and $ thresholds exceed', () => {
    const summary = {
      document: mkDocument('doc2', 'task2'),
      ledgerEntries: [
        mkLedger('doc2', 'item_outlet', 3, 2.5), // planned
        mkLedger('doc2', 'item_wire', 100, 0.4), // 40 ft over plan → +$34
        mkLedger('doc2', 'item_outlet', 20, 2.5), // extra outlets → +$50
      ],
      task: { id: 'task2', templateType: 'install_outlet', qty: 3 },
      norm: outletNorm,
      averageCostByItemId: costs,
    };
    const r = analyzeSingleTaskUsage(summary);
    expect(r.isAnomaly).toBe(true);
    expect(r.varianceUsd).toBeGreaterThan(50);
    expect(r.overrunPercent).toBeGreaterThan(25);
  });

  it('does not flag when % over but $ under threshold', () => {
    // $15 planned, $20 actual → 33% overrun but only $5 variance
    const summary = {
      document: mkDocument('doc3', 'task3'),
      ledgerEntries: [mkLedger('doc3', 'item_outlet', 8, 2.5)],
      task: { id: 'task3', templateType: 'install_outlet', qty: 6 },
      norm: mkNorm('install_outlet', [{ itemId: 'item_outlet', qtyPerUnit: 1 }]),
      averageCostByItemId: costs,
    };
    const r = analyzeSingleTaskUsage(summary);
    expect(r.varianceUsd).toBeLessThan(50);
    expect(r.isAnomaly).toBe(false);
  });

  it('skips ledger entries from other documents', () => {
    const summary = {
      document: mkDocument('doc4', 'task4'),
      ledgerEntries: [
        mkLedger('doc4', 'item_outlet', 3, 2.5),
        { ...mkLedger('other_doc', 'item_outlet', 100, 2.5), documentId: 'other_doc' },
      ],
      task: { id: 'task4', templateType: 'install_outlet', qty: 3 },
      norm: mkNorm('install_outlet', [{ itemId: 'item_outlet', qtyPerUnit: 1 }]),
      averageCostByItemId: costs,
    };
    const r = analyzeSingleTaskUsage(summary);
    expect(r.actualCost).toBeCloseTo(7.5, 2); // only from doc4
  });

  it('handles norm=null by returning 0 planned cost, no anomaly', () => {
    const summary = {
      document: mkDocument('doc5', 'task5'),
      ledgerEntries: [mkLedger('doc5', 'item_outlet', 10, 2.5)],
      task: { id: 'task5', templateType: 'unknown', qty: 1 },
      norm: null,
      averageCostByItemId: costs,
    };
    const r = analyzeSingleTaskUsage(summary);
    expect(r.plannedCost).toBe(0);
    expect(r.isAnomaly).toBe(false);
  });

  it('respects custom thresholds', () => {
    const summary = {
      document: mkDocument('doc6', 'task6'),
      ledgerEntries: [mkLedger('doc6', 'item_outlet', 5, 2.5)],
      task: { id: 'task6', templateType: 'install_outlet', qty: 3 },
      norm: mkNorm('install_outlet', [{ itemId: 'item_outlet', qtyPerUnit: 1 }]),
      averageCostByItemId: costs,
    };
    // planned 3*2.5=7.5, actual 5*2.5=12.5, variance 5, overrun 66%
    const strict = analyzeSingleTaskUsage(summary, {
      overrunPercentThreshold: 25,
      overrunValueThreshold: 3,
    });
    expect(strict.isAnomaly).toBe(true);
    const lax = analyzeSingleTaskUsage(summary); // default $50
    expect(lax.isAnomaly).toBe(false);
  });
});

describe('UC5 — detectAnomaliesBatch', () => {
  it('partitions into anomalies vs clean', () => {
    const outletNorm = mkNorm('install_outlet', [{ itemId: 'item_outlet', qtyPerUnit: 1 }]);
    const costs = new Map<string, number>([['item_outlet', 5]]);
    const good = {
      document: mkDocument('docA', 'taskA'),
      ledgerEntries: [mkLedger('docA', 'item_outlet', 3, 5)],
      task: { id: 'taskA', templateType: 'install_outlet', qty: 3 },
      norm: outletNorm,
      averageCostByItemId: costs,
    };
    const bad = {
      document: mkDocument('docB', 'taskB'),
      ledgerEntries: [mkLedger('docB', 'item_outlet', 30, 5)],
      task: { id: 'taskB', templateType: 'install_outlet', qty: 3 },
      norm: outletNorm,
      averageCostByItemId: costs,
    };
    const r = detectAnomaliesBatch([good, bad]);
    expect(r.clean.length).toBe(1);
    expect(r.anomalies.length).toBe(1);
    expect(r.anomalies[0].documentId).toBe('docB');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  UC6 Low-stock Reorder
// ═══════════════════════════════════════════════════════════════════

describe('UC6 — buildLowStockReorder', () => {
  const homeDepot = mkVendor('vendor_hd', 'Home Depot', 'big_box', [
    'cat_electrical_device',
    'cat_electrical_cable',
  ]);
  const ferguson = mkVendor('vendor_ferg', 'Ferguson', 'local_supply', ['cat_plumbing']);

  const outlet = mkItem('item_outlet', 'Outlet 15A', 'cat_electrical_device', 'each', 2.5, 20, 50);
  const wire = mkItem('item_wire', 'Wire 12-2', 'cat_electrical_cable', 'ft', 0.4, 100);
  const pipe = mkItem('item_pipe', 'PVC Pipe', 'cat_plumbing', 'ft', 0.3, 30);
  const fan = mkItem('item_fan', 'Ceiling Fan', 'cat_electrical_fixture', 'each', 89); // no minStock

  it('flags items below minStock, skips items above', () => {
    const balances = new Map<string, WhBalance>([
      [makeBalanceKey('loc_wh', 'item_outlet'), mkBalance('loc_wh', 'item_outlet', 10)],  // below
      [makeBalanceKey('loc_wh', 'item_wire'), mkBalance('loc_wh', 'item_wire', 500)],     // above
      [makeBalanceKey('loc_wh', 'item_pipe'), mkBalance('loc_wh', 'item_pipe', 5)],        // below
    ]);
    const report = buildLowStockReorder({
      items: [outlet, wire, pipe, fan],
      balances,
      vendors: [homeDepot, ferguson],
    });
    expect(report.lines.map((l) => l.itemId).sort()).toEqual(['item_outlet', 'item_pipe']);
    const outletLine = report.lines.find((l) => l.itemId === 'item_outlet')!;
    // reorderPoint = 50; onHand = 10; qtyToOrder = 40
    expect(outletLine.qtyToOrder).toBe(40);
    expect(outletLine.preferredVendorId).toBe('vendor_hd');
    const pipeLine = report.lines.find((l) => l.itemId === 'item_pipe')!;
    // no reorderPoint → 2 × minStock = 60; onHand 5; qty = 55
    expect(pipeLine.qtyToOrder).toBe(55);
    expect(pipeLine.preferredVendorId).toBe('vendor_ferg');
  });

  it('groups by vendor and computes subtotals', () => {
    const balances = new Map<string, WhBalance>([
      [makeBalanceKey('loc_wh', 'item_outlet'), mkBalance('loc_wh', 'item_outlet', 0)],
      [makeBalanceKey('loc_wh', 'item_pipe'), mkBalance('loc_wh', 'item_pipe', 0)],
    ]);
    const report = buildLowStockReorder({
      items: [outlet, pipe],
      balances,
      vendors: [homeDepot, ferguson],
    });
    expect(report.byVendor.length).toBe(2);
    const hd = report.byVendor.find((b) => b.vendorId === 'vendor_hd')!;
    const fg = report.byVendor.find((b) => b.vendorId === 'vendor_ferg')!;
    expect(hd.subtotal).toBeGreaterThan(0);
    expect(fg.subtotal).toBeGreaterThan(0);
    expect(report.grandTotalEstimated).toBeCloseTo(hd.subtotal + fg.subtotal, 2);
  });

  it('items without preferred vendor land in __no_vendor__ bucket', () => {
    const orphan = mkItem('item_orphan', 'Orphan Widget', 'cat_unknown', 'each', 10, 5);
    const balances = new Map<string, WhBalance>([
      [makeBalanceKey('loc_wh', 'item_orphan'), mkBalance('loc_wh', 'item_orphan', 0)],
    ]);
    const report = buildLowStockReorder({
      items: [orphan],
      balances,
      vendors: [homeDepot, ferguson],
    });
    expect(report.byVendor.length).toBe(1);
    expect(report.byVendor[0].vendorId).toBeNull();
  });

  it('skips items with undefined minStock', () => {
    const balances = new Map<string, WhBalance>([
      [makeBalanceKey('loc_wh', 'item_fan'), mkBalance('loc_wh', 'item_fan', 0)],
    ]);
    const report = buildLowStockReorder({
      items: [fan],
      balances,
      vendors: [homeDepot],
    });
    expect(report.lines).toHaveLength(0);
  });

  it('aggregates availability across locations', () => {
    const balances = new Map<string, WhBalance>([
      [makeBalanceKey('loc_wh', 'item_outlet'), mkBalance('loc_wh', 'item_outlet', 8)],
      [makeBalanceKey('loc_van', 'item_outlet'), mkBalance('loc_van', 'item_outlet', 6)],
      // total 14 — still below minStock=20
    ]);
    const report = buildLowStockReorder({
      items: [outlet],
      balances,
      vendors: [homeDepot],
    });
    expect(report.lines[0].totalAvailable).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  UC8 Dead Stock
// ═══════════════════════════════════════════════════════════════════

describe('UC8 — findDeadStock', () => {
  const now = new Date('2026-04-18').getTime();
  const dayMs = 24 * 3600_000;

  const outlet = mkItem('item_outlet', 'Outlet', 'cat_electrical_device', 'each', 2.5);
  const wire = mkItem('item_wire', 'Wire', 'cat_electrical_cable', 'ft', 0.4);
  const rareFan = mkItem('item_fan', 'Ceiling Fan', 'cat_electrical_fixture', 'each', 89);

  function balances(onHandByItem: Record<string, number>): Map<string, WhBalance> {
    const m = new Map<string, WhBalance>();
    for (const [itemId, qty] of Object.entries(onHandByItem)) {
      m.set(makeBalanceKey('loc_wh', itemId), mkBalance('loc_wh', itemId, qty));
    }
    return m;
  }

  it('flags item with no recent activity', () => {
    const report = findDeadStock({
      items: [outlet],
      balances: balances({ item_outlet: 5 }),
      lastLedgerActivityMs: new Map([['item_outlet', now - 120 * dayMs]]), // 120 days ago
      nowMs: now,
    });
    expect(report.lines.length).toBe(1);
    expect(report.lines[0].itemId).toBe('item_outlet');
    expect(report.lines[0].daysSinceLastActivity).toBe(120);
  });

  it('skips items with recent activity', () => {
    const report = findDeadStock({
      items: [outlet],
      balances: balances({ item_outlet: 5 }),
      lastLedgerActivityMs: new Map([['item_outlet', now - 10 * dayMs]]), // 10 days ago
      nowMs: now,
    });
    expect(report.lines.length).toBe(0);
  });

  it('uses item.inactivityDays threshold (custom)', () => {
    const report = findDeadStock({
      items: [outlet],
      balances: balances({ item_outlet: 5 }),
      lastLedgerActivityMs: new Map([['item_outlet', now - 45 * dayMs]]),
      nowMs: now,
      inactivityDays: 30,
    });
    expect(report.lines.length).toBe(1);
  });

  it('skips items with zero on-hand', () => {
    const report = findDeadStock({
      items: [outlet],
      balances: balances({ item_outlet: 0 }),
      lastLedgerActivityMs: new Map(),
      nowMs: now,
    });
    expect(report.lines.length).toBe(0);
  });

  it('items with unknown last activity counted as fully dead', () => {
    const report = findDeadStock({
      items: [rareFan],
      balances: balances({ item_fan: 2 }),
      lastLedgerActivityMs: new Map(), // no activity recorded
      nowMs: now,
    });
    expect(report.lines.length).toBe(1);
    expect(report.lines[0].daysSinceLastActivity).toBe(Number.POSITIVE_INFINITY);
  });

  it('suggests return_to_vendor for high-value long-dead items', () => {
    const report = findDeadStock({
      items: [rareFan],
      balances: balances({ item_fan: 10 }),
      lastLedgerActivityMs: new Map([['item_fan', now - 200 * dayMs]]),
      nowMs: now,
    });
    expect(report.lines[0].suggestion).toBe('return_to_vendor');
  });

  it('suggests clearance for medium-value', () => {
    const report = findDeadStock({
      items: [outlet],
      balances: balances({ item_outlet: 50 }), // 50 * $2.5 = $125
      lastLedgerActivityMs: new Map([['item_outlet', now - 120 * dayMs]]),
      nowMs: now,
    });
    expect(report.lines[0].suggestion).toBe('clearance');
  });

  it('suggests write_off for tiny-value', () => {
    const report = findDeadStock({
      items: [wire],
      balances: balances({ item_wire: 10 }), // 10 * $0.4 = $4
      lastLedgerActivityMs: new Map([['item_wire', now - 120 * dayMs]]),
      nowMs: now,
    });
    expect(report.lines[0].suggestion).toBe('write_off');
  });

  it('sorts by value descending', () => {
    const report = findDeadStock({
      items: [outlet, rareFan, wire],
      balances: balances({ item_outlet: 50, item_fan: 10, item_wire: 10 }),
      lastLedgerActivityMs: new Map([
        ['item_outlet', now - 120 * dayMs],
        ['item_fan', now - 120 * dayMs],
        ['item_wire', now - 120 * dayMs],
      ]),
      nowMs: now,
    });
    expect(report.lines[0].itemId).toBe('item_fan');
    expect(report.lines[1].itemId).toBe('item_outlet');
    expect(report.lines[2].itemId).toBe('item_wire');
  });
});
