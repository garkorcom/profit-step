/**
 * UC4 — Estimate → procurement plan.
 *
 * Given an estimate's lines + live inventory + vendor directory, compute
 * a 4-bucket procurement plan:
 *
 *   internalAllocation  — items on hand; caller creates reservations
 *   buyFromVendor       — known item with a preferred vendor → Draft PO
 *   needsQuote          — known item, no preferred vendor → RFQ email
 *   needsWebSearch      — item not in catalog → web search to find it
 *   unmatched           — web search failed / user must create item
 *
 * Pure function — no Firestore I/O, no HTTP. External integrations (web
 * search, RFQ email) are separate capabilities and run AFTER the plan is
 * built. Reference: docs/warehouse/improvements/08_estimate_procurement/SPEC.md.
 */

import type { WhBalance, WhItem, WhVendor } from '../../core/types';
import { fuzzyMatchItem, type FuzzyCandidate, type FuzzyMatch } from '../fuzzy';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface EstimateLine {
  /** Estimate-side line id — preserved through buckets for UI threading. */
  id: string;
  /** Human-provided item description, e.g. "Outlet 15A Duplex" */
  itemHint: string;
  qty: number;
  unit: string;
  unitCost: number;
}

export interface BuildProcurementPlanInput {
  estimateId: string;
  projectId: string;
  /** Estimate lines (already parsed by the estimate agent). */
  estimateLines: EstimateLine[];
  /** Full catalog, used for fuzzy match. */
  catalog: WhItem[];
  /** Global balances keyed `${locationId}__${itemId}`. */
  balances: Map<string, WhBalance>;
  /** Active vendor directory. */
  vendors: WhVendor[];
}

export interface InternalAllocationEntry {
  estimateLineId: string;
  itemHint: string;
  itemId: string;
  itemName: string;
  qtyAllocated: number;
  qtyShortfall: number; // remainder that needs external sourcing
  onHandBefore: Array<{ locationId: string; qty: number }>; // for UI transparency
  estimatedValue: number; // qtyAllocated × item.averageCost
}

export interface BuyFromVendorEntry {
  estimateLineId: string;
  itemHint: string;
  itemId: string;
  itemName: string;
  vendorId: string;
  vendorName: string;
  qtyToBuy: number;
  estimatedUnitCost: number;
  estimatedTotalCost: number;
}

export interface NeedsQuoteEntry {
  estimateLineId: string;
  itemHint: string;
  itemId: string;
  itemName: string;
  qtyNeeded: number;
  possibleVendors: Array<{ id: string; name: string }>;
  reason: 'no_preferred_vendor' | 'special_order' | 'ambiguous_match';
}

export interface NeedsWebSearchEntry {
  estimateLineId: string;
  itemHint: string;
  qtyNeeded: number;
  alternatives: FuzzyMatch[]; // best-effort catalog suggestions (top 3)
}

export interface ProcurementPlan {
  estimateId: string;
  projectId: string;
  generatedAt: string;
  buckets: {
    internalAllocation: InternalAllocationEntry[];
    buyFromVendor: BuyFromVendorEntry[];
    needsQuote: NeedsQuoteEntry[];
    needsWebSearch: NeedsWebSearchEntry[];
  };
  summary: {
    totalLines: number;
    totalEstimateValue: number;
    internallyAllocatedValue: number;
    externalPurchaseValue: number;
    quoteNeededCount: number;
    webSearchNeededCount: number;
    /** `true` when no external sourcing is required. */
    allInternallyAvailable: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════

const AUTO_MATCH_THRESHOLD = 0.7;
const WEAK_MATCH_THRESHOLD = 0.4;

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function catalogAsCandidates(catalog: WhItem[]): FuzzyCandidate[] {
  return catalog.map((item) => ({ id: item.id, name: item.name, sku: item.sku }));
}

function sumOnHandAcrossLocations(
  balances: Map<string, WhBalance>,
  itemId: string,
): { total: number; byLocation: Array<{ locationId: string; qty: number }> } {
  let total = 0;
  const byLocation: Array<{ locationId: string; qty: number }> = [];
  for (const balance of balances.values()) {
    if (balance.itemId === itemId && balance.availableQty > 0) {
      total += balance.availableQty;
      byLocation.push({ locationId: balance.locationId, qty: balance.availableQty });
    }
  }
  byLocation.sort((a, b) => b.qty - a.qty);
  return { total, byLocation };
}

function findPreferredVendor(item: WhItem, vendors: WhVendor[]): WhVendor | null {
  if (!vendors.length) return null;
  // Match by preferredForCategories
  const matches = vendors.filter(
    (v) => v.isActive && v.preferredForCategories?.some((cat) => item.category === cat),
  );
  if (matches.length === 0) return null;
  // Deterministic: prefer 'big_box' first (HD, Lowe's), then 'local_supply'
  const order = { big_box: 0, local_supply: 1, subcontractor_proxy: 2, online: 3 };
  matches.sort((a, b) => (order[a.vendorType] ?? 99) - (order[b.vendorType] ?? 99));
  return matches[0];
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ═══════════════════════════════════════════════════════════════════
//  Main entry
// ═══════════════════════════════════════════════════════════════════

export function buildProcurementPlan(input: BuildProcurementPlanInput): ProcurementPlan {
  const plan: ProcurementPlan = {
    estimateId: input.estimateId,
    projectId: input.projectId,
    generatedAt: new Date().toISOString(),
    buckets: {
      internalAllocation: [],
      buyFromVendor: [],
      needsQuote: [],
      needsWebSearch: [],
    },
    summary: {
      totalLines: input.estimateLines.length,
      totalEstimateValue: 0,
      internallyAllocatedValue: 0,
      externalPurchaseValue: 0,
      quoteNeededCount: 0,
      webSearchNeededCount: 0,
      allInternallyAvailable: false,
    },
  };

  const candidates = catalogAsCandidates(input.catalog);
  const itemsById = new Map(input.catalog.map((i) => [i.id, i]));

  for (const line of input.estimateLines) {
    plan.summary.totalEstimateValue += line.qty * line.unitCost;

    const topMatches = fuzzyMatchItem(line.itemHint, candidates, 3);

    // No catalog match — web search (improvement 09 will actually run this)
    if (topMatches.length === 0 || topMatches[0].score < WEAK_MATCH_THRESHOLD) {
      plan.buckets.needsWebSearch.push({
        estimateLineId: line.id,
        itemHint: line.itemHint,
        qtyNeeded: line.qty,
        alternatives: topMatches,
      });
      plan.summary.webSearchNeededCount += 1;
      continue;
    }

    // Ambiguous match (< AUTO_MATCH) — let the caller clarify via RFQ path
    const bestMatch = topMatches[0];
    const item = itemsById.get(bestMatch.id);
    if (!item || !item.isActive || bestMatch.score < AUTO_MATCH_THRESHOLD) {
      plan.buckets.needsQuote.push({
        estimateLineId: line.id,
        itemHint: line.itemHint,
        itemId: bestMatch.id,
        itemName: bestMatch.name,
        qtyNeeded: line.qty,
        possibleVendors: input.vendors
          .filter((v) => v.isActive)
          .map((v) => ({ id: v.id, name: v.name })),
        reason: 'ambiguous_match',
      });
      plan.summary.quoteNeededCount += 1;
      continue;
    }

    // Solid match — figure out allocation vs sourcing
    const { total: onHand, byLocation } = sumOnHandAcrossLocations(input.balances, item.id);
    const qtyToAllocate = Math.min(onHand, line.qty);
    const qtyShortfall = Math.max(0, line.qty - onHand);

    if (qtyToAllocate > 0) {
      const value = roundTo(qtyToAllocate * (item.averageCost ?? 0), 2);
      plan.buckets.internalAllocation.push({
        estimateLineId: line.id,
        itemHint: line.itemHint,
        itemId: item.id,
        itemName: item.name,
        qtyAllocated: qtyToAllocate,
        qtyShortfall,
        onHandBefore: byLocation,
        estimatedValue: value,
      });
      plan.summary.internallyAllocatedValue += value;
    }

    if (qtyShortfall > 0) {
      const preferred = findPreferredVendor(item, input.vendors);
      if (preferred) {
        const unitCost = item.lastPurchasePrice || item.averageCost || line.unitCost;
        const totalCost = roundTo(qtyShortfall * unitCost, 2);
        plan.buckets.buyFromVendor.push({
          estimateLineId: line.id,
          itemHint: line.itemHint,
          itemId: item.id,
          itemName: item.name,
          vendorId: preferred.id,
          vendorName: preferred.name,
          qtyToBuy: qtyShortfall,
          estimatedUnitCost: roundTo(unitCost, 4),
          estimatedTotalCost: totalCost,
        });
        plan.summary.externalPurchaseValue += totalCost;
      } else {
        plan.buckets.needsQuote.push({
          estimateLineId: line.id,
          itemHint: line.itemHint,
          itemId: item.id,
          itemName: item.name,
          qtyNeeded: qtyShortfall,
          possibleVendors: input.vendors
            .filter((v) => v.isActive)
            .map((v) => ({ id: v.id, name: v.name })),
          reason: 'no_preferred_vendor',
        });
        plan.summary.quoteNeededCount += 1;
      }
    }
  }

  plan.summary.totalEstimateValue = roundTo(plan.summary.totalEstimateValue, 2);
  plan.summary.internallyAllocatedValue = roundTo(plan.summary.internallyAllocatedValue, 2);
  plan.summary.externalPurchaseValue = roundTo(plan.summary.externalPurchaseValue, 2);
  plan.summary.allInternallyAvailable =
    plan.buckets.buyFromVendor.length === 0 &&
    plan.buckets.needsQuote.length === 0 &&
    plan.buckets.needsWebSearch.length === 0 &&
    plan.buckets.internalAllocation.length > 0;

  return plan;
}

// ═══════════════════════════════════════════════════════════════════
//  Reservation builder — converts an internalAllocation bucket into
//  Draft transfer document payloads (one per location).
// ═══════════════════════════════════════════════════════════════════

export interface ReservationDraftPayload {
  docType: 'transfer';
  sourceLocationId: string;
  destinationLocationId: string;
  projectId: string;
  source: 'ai';
  relatedEstimateId: string;
  reservationExpiresAt: string;
  lines: Array<{ itemId: string; uom: string; qty: number }>;
}

/**
 * Convert internalAllocation bucket entries into one transfer draft per
 * source location. Caller POSTs each via /api/warehouse/documents.
 */
export function buildReservationDrafts(
  plan: ProcurementPlan,
  options: {
    destinationLocationId: string;
    catalog: WhItem[];
    reservationDays?: number;
  },
): ReservationDraftPayload[] {
  const days = options.reservationDays ?? 7;
  const expires = new Date(Date.now() + days * 24 * 3600_000).toISOString();

  const itemsById = new Map(options.catalog.map((i) => [i.id, i]));

  // Group allocations by source location
  const bySource = new Map<string, Array<{ itemId: string; qty: number }>>();

  for (const entry of plan.buckets.internalAllocation) {
    let remaining = entry.qtyAllocated;
    for (const loc of entry.onHandBefore) {
      if (remaining <= 0) break;
      const take = Math.min(loc.qty, remaining);
      remaining -= take;
      const existing = bySource.get(loc.locationId) ?? [];
      existing.push({ itemId: entry.itemId, qty: take });
      bySource.set(loc.locationId, existing);
    }
  }

  const drafts: ReservationDraftPayload[] = [];
  for (const [sourceLocationId, entries] of bySource) {
    if (sourceLocationId === options.destinationLocationId) continue; // same location, no transfer needed
    drafts.push({
      docType: 'transfer',
      sourceLocationId,
      destinationLocationId: options.destinationLocationId,
      projectId: plan.projectId,
      source: 'ai',
      relatedEstimateId: plan.estimateId,
      reservationExpiresAt: expires,
      lines: entries.map((e) => ({
        itemId: e.itemId,
        uom: itemsById.get(e.itemId)?.baseUOM ?? 'each',
        qty: e.qty,
      })),
    });
  }

  return drafts;
}
