/**
 * Unit tests for warehouse core pure helpers.
 *
 * Strategy: cover the pure functions in warehouse/core/types.ts (compound
 * key helpers, availableQty derivation, UOM conversion) without Firestore.
 */

import {
  BALANCE_KEY_SEPARATOR,
  computeAvailableQty,
  convertToBaseQty,
  convertToBaseUnitCost,
  DEFAULT_NEGATIVE_STOCK_POLICY,
  makeBalanceKey,
  parseBalanceKey,
} from '../src/warehouse/core/types';

describe('balance key helpers', () => {
  it('makeBalanceKey joins with separator', () => {
    expect(makeBalanceKey('loc_van_denis', 'item_wire_12_2_nmb')).toBe(
      `loc_van_denis${BALANCE_KEY_SEPARATOR}item_wire_12_2_nmb`,
    );
  });

  it('parseBalanceKey round-trips', () => {
    const key = makeBalanceKey('loc_A', 'item_B');
    expect(parseBalanceKey(key)).toEqual({ locationId: 'loc_A', itemId: 'item_B' });
  });

  it('parseBalanceKey returns null for malformed keys', () => {
    expect(parseBalanceKey('no-separator')).toBeNull();
    expect(parseBalanceKey('__item_only')).toBeNull();
    expect(parseBalanceKey('loc_only__')).toBeNull();
  });
});

describe('computeAvailableQty', () => {
  it('subtracts reserved from on-hand', () => {
    expect(computeAvailableQty(100, 30)).toBe(70);
  });

  it('allows negative when reserved exceeds on-hand', () => {
    expect(computeAvailableQty(5, 8)).toBe(-3);
  });
});

describe('default negative-stock policy', () => {
  it('blocks warehouse', () => {
    expect(DEFAULT_NEGATIVE_STOCK_POLICY.warehouse).toBe('blocked');
  });
  it('warns on van', () => {
    expect(DEFAULT_NEGATIVE_STOCK_POLICY.van).toBe('allowed_with_alert');
  });
  it('allows site', () => {
    expect(DEFAULT_NEGATIVE_STOCK_POLICY.site).toBe('allowed');
  });
  it('blocks quarantine', () => {
    expect(DEFAULT_NEGATIVE_STOCK_POLICY.quarantine).toBe('blocked');
  });
});

describe('UOM conversion', () => {
  const item = {
    baseUOM: 'ft',
    purchaseUOMs: [
      { uom: 'ft', factor: 1, isDefault: false },
      { uom: 'roll_250ft', factor: 250, isDefault: true },
      { uom: 'roll_500ft', factor: 500, isDefault: false },
    ],
  };

  it('returns qty unchanged if sourceUOM equals baseUOM', () => {
    expect(convertToBaseQty(item, 'ft', 15)).toBe(15);
  });

  it('multiplies by factor for purchase UOM', () => {
    expect(convertToBaseQty(item, 'roll_250ft', 2)).toBe(500);
    expect(convertToBaseQty(item, 'roll_500ft', 1)).toBe(500);
  });

  it('throws on unknown UOM', () => {
    expect(() => convertToBaseQty(item, 'roll_100ft', 1)).toThrow(/INVALID_UOM/);
  });

  it('converts unit cost inversely (per-base-unit price)', () => {
    expect(convertToBaseUnitCost(item, 'roll_250ft', 90)).toBeCloseTo(0.36, 5);
    expect(convertToBaseUnitCost(item, 'ft', 0.4)).toBe(0.4);
  });

  it('throws when converting unit cost with unknown UOM', () => {
    expect(() => convertToBaseUnitCost(item, 'box', 10)).toThrow(/INVALID_UOM/);
  });
});
