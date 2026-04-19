/**
 * Unit tests for UC3 proposeTaskWriteoff + detectTaskOverrun.
 *
 * Reference: docs/warehouse/improvements/07_auto_writeoff/SPEC.md + TESTS.md.
 */

import {
  detectTaskOverrun,
  proposeTaskWriteoff,
  type ProposeTaskWriteoffInput,
} from '../src/warehouse/agent/capabilities/proposeTaskWriteoff';
import type { WhBalance, WhItem, WhNorm } from '../src/warehouse/core/types';
import { makeBalanceKey } from '../src/warehouse/core/types';

// ═══════════════════════════════════════════════════════════════════
//  Fixtures
// ═══════════════════════════════════════════════════════════════════

const LOC = 'loc_van_denis';

const OUTLET_NORM: WhNorm = {
  id: 'norm_install_outlet',
  schemaVersion: 1,
  taskType: 'install_outlet',
  name: 'Install outlet',
  items: [
    { itemId: 'item_outlet', qtyPerUnit: 1 },
    { itemId: 'item_wire', qtyPerUnit: 5 },
    { itemId: 'item_box', qtyPerUnit: 1 },
    { itemId: 'item_wirenut', qtyPerUnit: 3 },
  ],
  estimatedLaborHours: 0.5,
  isActive: true,
  createdAt: null as any,
  updatedAt: null as any,
  createdBy: 'system',
  createdByType: 'system',
};

const EMPTY_NORM: WhNorm = { ...OUTLET_NORM, id: 'norm_empty', taskType: 'empty_task', items: [] };

function mkItem(id: string, name: string, baseUOM: string, averageCost: number): WhItem {
  return {
    id,
    schemaVersion: 1,
    sku: id.toUpperCase(),
    name,
    category: 'cat_electrical_device',
    baseUOM,
    purchaseUOMs: [{ uom: baseUOM, factor: 1, isDefault: true }],
    allowedIssueUOMs: [baseUOM],
    lastPurchasePrice: averageCost,
    averageCost,
    isTrackable: false,
    isActive: true,
    createdAt: null as any,
    updatedAt: null as any,
    createdBy: 'system',
    createdByType: 'system',
  };
}

function mkBalance(locationId: string, itemId: string, onHand: number): WhBalance {
  return {
    id: makeBalanceKey(locationId, itemId),
    schemaVersion: 1,
    locationId,
    itemId,
    onHandQty: onHand,
    reservedQty: 0,
    availableQty: onHand,
    updatedAt: null as any,
  };
}

function buildInput(overrides: Partial<ProposeTaskWriteoffInput> = {}): ProposeTaskWriteoffInput {
  const items = new Map<string, WhItem>([
    ['item_outlet', mkItem('item_outlet', 'Outlet 15A', 'each', 2.5)],
    ['item_wire', mkItem('item_wire', 'Wire 12-2', 'ft', 0.4)],
    ['item_box', mkItem('item_box', 'Box 1-gang', 'each', 0.9)],
    ['item_wirenut', mkItem('item_wirenut', 'Wire Nut', 'each', 0.1)],
  ]);
  const balances = new Map<string, WhBalance>([
    [makeBalanceKey(LOC, 'item_outlet'), mkBalance(LOC, 'item_outlet', 10)],
    [makeBalanceKey(LOC, 'item_wire'), mkBalance(LOC, 'item_wire', 200)],
    [makeBalanceKey(LOC, 'item_box'), mkBalance(LOC, 'item_box', 5)],
    [makeBalanceKey(LOC, 'item_wirenut'), mkBalance(LOC, 'item_wirenut', 100)],
  ]);
  return {
    taskId: 'task_a',
    templateType: 'install_outlet',
    taskQty: 3,
    workerId: 'user_denis',
    locationId: LOC,
    norms: [OUTLET_NORM, EMPTY_NORM],
    items,
    balances,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Happy path
// ═══════════════════════════════════════════════════════════════════

describe('proposeTaskWriteoff — happy path', () => {
  it('computes writeoff proposal with 3 outlets', () => {
    const res = proposeTaskWriteoff(buildInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.lines).toHaveLength(4);
    const outlet = res.lines.find((l) => l.itemId === 'item_outlet')!;
    const wire = res.lines.find((l) => l.itemId === 'item_wire')!;
    expect(outlet.qtyRequired).toBe(3);
    expect(outlet.qtyToWriteOff).toBe(3);
    expect(outlet.qtyShortfall).toBe(0);
    expect(outlet.estimatedCost).toBeCloseTo(7.5, 2);

    expect(wire.qtyRequired).toBe(15);
    expect(wire.qtyToWriteOff).toBe(15);
    expect(wire.estimatedCost).toBeCloseTo(6, 2);

    expect(res.hasAnyShortfall).toBe(false);
    expect(res.totalEstimatedCost).toBeGreaterThan(0);
  });

  it('draftPayload is API-ready', () => {
    const res = proposeTaskWriteoff(buildInput({ projectId: 'proj_x', phaseCode: 'rough_in' as any }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const p = res.draftPayload;
    expect(p.docType).toBe('issue');
    expect(p.sourceLocationId).toBe(LOC);
    expect(p.reason).toBe('project_installation');
    expect((p as any).projectId).toBe('proj_x');
    expect((p as any).phaseCode).toBe('rough_in');
    expect(p.relatedTaskId).toBe('task_a');
    expect(p.lines).toHaveLength(4);
    expect(p.source).toBe('ai');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Shortfall handling
// ═══════════════════════════════════════════════════════════════════

describe('proposeTaskWriteoff — shortfall', () => {
  it('reports shortfall when van has only some of what is needed', () => {
    const input = buildInput();
    input.balances.set(makeBalanceKey(LOC, 'item_outlet'), mkBalance(LOC, 'item_outlet', 2));
    const res = proposeTaskWriteoff(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const outlet = res.lines.find((l) => l.itemId === 'item_outlet')!;
    expect(outlet.qtyAvailable).toBe(2);
    expect(outlet.qtyToWriteOff).toBe(2);
    expect(outlet.qtyShortfall).toBe(1);
    expect(outlet.hasShortfall).toBe(true);
    expect(res.hasAnyShortfall).toBe(true);

    // Draft payload writes off ONLY what's available
    const outletDraft = res.draftPayload.lines.find((l) => l.itemId === 'item_outlet')!;
    expect(outletDraft.qty).toBe(2);
  });

  it('marks item missing-from-catalog as full-shortfall', () => {
    const input = buildInput();
    input.items.delete('item_outlet');
    const res = proposeTaskWriteoff(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const line = res.lines.find((l) => l.itemId === 'item_outlet')!;
    expect(line.qtyShortfall).toBe(3);
    expect(line.qtyToWriteOff).toBe(0);
    expect(res.hasAnyShortfall).toBe(true);
  });

  it('empty van → full shortfall, no writeoff lines', () => {
    const input = buildInput();
    input.balances.clear();
    const res = proposeTaskWriteoff(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    for (const line of res.lines) {
      expect(line.qtyAvailable).toBe(0);
      expect(line.qtyToWriteOff).toBe(0);
      expect(line.qtyShortfall).toBe(line.qtyRequired);
    }
    expect(res.draftPayload.lines).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Failure modes
// ═══════════════════════════════════════════════════════════════════

describe('proposeTaskWriteoff — failure modes', () => {
  it('returns no_norm for unknown templateType', () => {
    const res = proposeTaskWriteoff(buildInput({ templateType: 'unknown' }));
    expect(res).toEqual({ ok: false, reason: 'no_norm' });
  });

  it('returns empty_norm for norm with 0 items', () => {
    const res = proposeTaskWriteoff(buildInput({ templateType: 'empty_task' }));
    expect(res).toEqual({ ok: false, reason: 'empty_norm' });
  });

  it('returns invalid_input for taskQty <= 0', () => {
    const res = proposeTaskWriteoff(buildInput({ taskQty: 0 }));
    expect(res).toEqual({ ok: false, reason: 'invalid_input' });
  });

  it('chooses internal_shop_use when no projectId', () => {
    const res = proposeTaskWriteoff(buildInput());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draftPayload.reason).toBe('internal_shop_use');
  });
});

// ═══════════════════════════════════════════════════════════════════
//  detectTaskOverrun
// ═══════════════════════════════════════════════════════════════════

describe('detectTaskOverrun', () => {
  it('flags overrun when both % and $ thresholds exceeded', () => {
    const r = detectTaskOverrun({ plannedCost: 100, actualCost: 160 });
    expect(r.isAnomaly).toBe(true);
    expect(r.varianceUsd).toBe(60);
    expect(r.overrunPercent).toBe(60);
  });

  it('does not flag when only percent exceeds (value below $50)', () => {
    const r = detectTaskOverrun({ plannedCost: 100, actualCost: 140 });
    // 40% overrun, but $40 < $50 threshold → not anomaly
    expect(r.isAnomaly).toBe(false);
  });

  it('does not flag when only $ exceeds ($50+ but under 25%)', () => {
    const r = detectTaskOverrun({ plannedCost: 1000, actualCost: 1080 });
    // +$80 (above $50) but only 8% — not anomaly
    expect(r.isAnomaly).toBe(false);
  });

  it('respects custom thresholds', () => {
    const r = detectTaskOverrun({
      plannedCost: 50,
      actualCost: 60,
      overrunPercentThreshold: 10,
      overrunValueThreshold: 5,
    });
    expect(r.isAnomaly).toBe(true);
  });

  it('plannedCost=0 yields 0% and no anomaly', () => {
    const r = detectTaskOverrun({ plannedCost: 0, actualCost: 100 });
    expect(r.overrunPercent).toBe(0);
    expect(r.isAnomaly).toBe(false);
  });
});
