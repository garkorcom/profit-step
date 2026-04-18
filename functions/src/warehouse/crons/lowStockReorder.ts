/**
 * UC6 — Weekly Low-Stock Reorder.
 *
 * Scans all active items, aggregates current availability across
 * locations, and flags items whose totalAvailable falls below `minStock`.
 * Groups proposed purchases by preferred vendor so the output is
 * directly usable by the UC4 Draft PO path.
 *
 * Scheduled Friday 09:00 local; pure function is tested in isolation.
 *
 * Reference: docs/warehouse/MAIN_SPEC.md §UC6 +
 *            docs/warehouse/core/02_posting_engine/SPEC.md.
 */

import type { WhBalance, WhItem, WhVendor } from '../core/types';

export interface LowStockReorderInput {
  items: WhItem[];
  balances: Map<string, WhBalance>; // keyed `${locationId}__${itemId}`
  vendors: WhVendor[];
}

export interface ReorderLine {
  itemId: string;
  itemName: string;
  baseUOM: string;
  totalAvailable: number;
  minStock: number;
  qtyToOrder: number; // = max(0, reorderPoint|minStock*2 - totalAvailable)
  estimatedUnitCost: number;
  estimatedTotalCost: number;
  preferredVendorId?: string;
  preferredVendorName?: string;
}

export interface LowStockReorderReport {
  generatedAt: string;
  lines: ReorderLine[];
  byVendor: Array<{
    vendorId: string | null;
    vendorName: string | null;
    lines: ReorderLine[];
    subtotal: number;
  }>;
  grandTotalEstimated: number;
}

function roundTo(n: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function findPreferredVendor(item: WhItem, vendors: WhVendor[]): WhVendor | null {
  const candidates = vendors.filter(
    (v) => v.isActive && v.preferredForCategories?.some((cat) => item.category === cat),
  );
  if (candidates.length === 0) return null;
  const order = { big_box: 0, local_supply: 1, subcontractor_proxy: 2, online: 3 };
  candidates.sort((a, b) => (order[a.vendorType] ?? 99) - (order[b.vendorType] ?? 99));
  return candidates[0];
}

function totalAvailableAcrossLocations(balances: Map<string, WhBalance>, itemId: string): number {
  let total = 0;
  for (const balance of balances.values()) {
    if (balance.itemId === itemId) total += balance.availableQty ?? 0;
  }
  return total;
}

export function buildLowStockReorder(input: LowStockReorderInput): LowStockReorderReport {
  const lines: ReorderLine[] = [];

  for (const item of input.items) {
    if (!item.isActive) continue;
    if (item.minStock === undefined || item.minStock === null) continue;

    const totalAvailable = totalAvailableAcrossLocations(input.balances, item.id);
    if (totalAvailable >= item.minStock) continue;

    // Order enough to reach reorderPoint (if set) or 2× minStock.
    const target = item.reorderPoint ?? item.minStock * 2;
    const qtyToOrder = Math.max(0, Math.ceil(target - totalAvailable));
    if (qtyToOrder === 0) continue;

    const unitCost = item.lastPurchasePrice || item.averageCost || 0;
    const totalCost = roundTo(qtyToOrder * unitCost, 2);

    const vendor = findPreferredVendor(item, input.vendors);

    lines.push({
      itemId: item.id,
      itemName: item.name,
      baseUOM: item.baseUOM,
      totalAvailable,
      minStock: item.minStock,
      qtyToOrder,
      estimatedUnitCost: roundTo(unitCost, 4),
      estimatedTotalCost: totalCost,
      preferredVendorId: vendor?.id,
      preferredVendorName: vendor?.name,
    });
  }

  // Group by vendor
  const vendorBuckets = new Map<string, ReorderLine[]>();
  for (const line of lines) {
    const key = line.preferredVendorId ?? '__no_vendor__';
    const existing = vendorBuckets.get(key) ?? [];
    existing.push(line);
    vendorBuckets.set(key, existing);
  }

  const byVendor = Array.from(vendorBuckets.entries()).map(([key, linesForVendor]) => ({
    vendorId: key === '__no_vendor__' ? null : key,
    vendorName: key === '__no_vendor__' ? null : linesForVendor[0].preferredVendorName ?? null,
    lines: linesForVendor,
    subtotal: roundTo(
      linesForVendor.reduce((a, l) => a + l.estimatedTotalCost, 0),
      2,
    ),
  }));

  // Sort groups: bigger subtotal first
  byVendor.sort((a, b) => b.subtotal - a.subtotal);

  const grandTotalEstimated = roundTo(
    byVendor.reduce((a, b) => a + b.subtotal, 0),
    2,
  );

  return {
    generatedAt: new Date().toISOString(),
    lines,
    byVendor,
    grandTotalEstimated,
  };
}
