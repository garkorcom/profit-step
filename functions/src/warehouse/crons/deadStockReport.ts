/**
 * UC8 — Dead Stock Report.
 *
 * Finds items with positive on-hand inventory that haven't been touched
 * (no ledger entries) for N days. Output is a proposal the owner can
 * action: return to vendor / clearance sale / write off.
 *
 * Runs monthly. Pure function first — tests use a Map of last-ledger
 * timestamps so they stay sync + deterministic.
 *
 * Reference: docs/warehouse/MAIN_SPEC.md §UC8.
 */

import type { WhBalance, WhItem } from '../core/types';

export interface DeadStockInput {
  items: WhItem[];
  balances: Map<string, WhBalance>; // keyed `${locationId}__${itemId}`
  /**
   * Last ledger activity timestamp (as epoch ms) per itemId. Caller loads
   * this with one aggregation query. Items missing from this map are
   * treated as "no activity forever" — probably fresh seeds.
   */
  lastLedgerActivityMs: Map<string, number>;
  /** Reference "now" for test determinism. */
  nowMs: number;
  /** Items with zero activity past this age are flagged. Default 90 days. */
  inactivityDays?: number;
}

export interface DeadStockLine {
  itemId: string;
  itemName: string;
  category: string;
  totalOnHand: number;
  totalValue: number; // at averageCost
  daysSinceLastActivity: number; // Number.POSITIVE_INFINITY if unknown
  suggestion: 'return_to_vendor' | 'clearance' | 'write_off';
}

export interface DeadStockReport {
  generatedAt: string;
  thresholdDays: number;
  totalItems: number;
  totalValue: number;
  lines: DeadStockLine[];
}

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function totalOnHandAcrossLocations(balances: Map<string, WhBalance>, itemId: string): number {
  let total = 0;
  for (const balance of balances.values()) {
    if (balance.itemId === itemId) total += balance.onHandQty ?? 0;
  }
  return total;
}

function suggestDisposition(totalValue: number, daysSince: number): DeadStockLine['suggestion'] {
  if (totalValue >= 500 && daysSince >= 180) return 'return_to_vendor';
  if (totalValue >= 50) return 'clearance';
  return 'write_off';
}

export function findDeadStock(input: DeadStockInput): DeadStockReport {
  const threshold = input.inactivityDays ?? 90;
  const thresholdMs = threshold * 24 * 3600_000;

  const lines: DeadStockLine[] = [];

  for (const item of input.items) {
    if (!item.isActive) continue;

    const totalOnHand = totalOnHandAcrossLocations(input.balances, item.id);
    if (totalOnHand <= 0) continue;

    const lastActivityMs = input.lastLedgerActivityMs.get(item.id);
    const daysSince =
      typeof lastActivityMs === 'number'
        ? Math.floor((input.nowMs - lastActivityMs) / (24 * 3600_000))
        : Number.POSITIVE_INFINITY;

    if (
      typeof lastActivityMs === 'number' &&
      input.nowMs - lastActivityMs < thresholdMs
    ) {
      continue; // recent activity — not dead
    }

    const unitCost = item.averageCost ?? item.lastPurchasePrice ?? 0;
    const totalValue = roundTo(totalOnHand * unitCost, 2);

    lines.push({
      itemId: item.id,
      itemName: item.name,
      category: item.category,
      totalOnHand,
      totalValue,
      daysSinceLastActivity: daysSince,
      suggestion: suggestDisposition(totalValue, daysSince === Number.POSITIVE_INFINITY ? threshold : daysSince),
    });
  }

  // Sort by value desc — highest-value dead stock bubbles to the top
  lines.sort((a, b) => b.totalValue - a.totalValue);

  return {
    generatedAt: new Date(input.nowMs).toISOString(),
    thresholdDays: threshold,
    totalItems: lines.length,
    totalValue: roundTo(
      lines.reduce((a, b) => a + b.totalValue, 0),
      2,
    ),
    lines,
  };
}
