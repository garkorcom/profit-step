/**
 * UC2 — Parse photo of a receipt into a structured draft receipt proposal.
 *
 * The capability runs Gemini Vision on the uploaded image, fuzzy-matches
 * each line to the catalog, and returns a proposal the UI can show for
 * confirmation. The actual Firestore write happens via the standard
 * POST /api/warehouse/documents endpoint after the user approves.
 *
 * Reference: docs/warehouse/improvements/05_receipt_vision/SPEC.md.
 */

import { RECEIPT_VISION_SYSTEM_PROMPT } from '../prompts/receiptVision';
import { fuzzyMatchItem, type FuzzyCandidate, type FuzzyMatch } from '../fuzzy';
import { callGeminiJSON } from '../gemini';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface ParseReceiptInput {
  userId: string;
  /** Base64-encoded image (caller is responsible for fetching / normalizing). */
  imageBase64: string;
  imageMimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  /** Optional content-addressable hash for idempotency. */
  photoHash?: string;
  /** Where the purchase should be posted (typically user's van). */
  targetLocationId?: string;
  /** Optional: if the user has an active trip, attribute purchase to its project. */
  activeProjectId?: string;
  activePhaseCode?: string;
  catalog: FuzzyCandidate[];
  vendors?: Array<{ id: string; name: string }>;
}

export interface ParsedReceiptLine {
  rawText: string;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  confidence: number;
  catalogItemId?: string;
  catalogItemName?: string;
  matchScore?: number;
  alternatives?: FuzzyMatch[];
  needsReview: boolean;
}

export interface ParseReceiptOk {
  ok: true;
  vendor: {
    name: string;
    resolvedVendorId?: string;
    storeNumber?: string;
  };
  date?: string;
  time?: string;
  totals: {
    subtotal?: number;
    tax?: number;
    total?: number;
    currency: string;
  };
  items: ParsedReceiptLine[];
  /** Payload ready to POST /api/warehouse/documents after user confirms. */
  draftPayload: {
    docType: 'receipt';
    destinationLocationId?: string;
    vendorId?: string;
    vendorReceiptNumber?: string;
    eventDate?: string;
    projectId?: string;
    phaseCode?: string;
    costCategory: 'materials';
    totals?: { subtotal?: number; tax?: number; total?: number; currency: string };
    idempotencyKey?: string;
    source: 'ai';
    lines: Array<{ itemId: string; uom: string; qty: number; unitCost?: number; rawText: string; matchConfidence?: number }>;
    /** Lines that could not be matched — UI prompts to create catalog items. */
    unmatched: ParsedReceiptLine[];
  };
}

export type ParseReceiptResult =
  | ParseReceiptOk
  | { ok: false; reason: 'not_a_receipt' | 'receipt_unreadable' | 'no_items' | 'ai_unavailable' | 'parse_error'; raw?: string };

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

const AUTO_MATCH_THRESHOLD = 0.7;

function normalizeGemini(raw: unknown): ParseReceiptOk | { error: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;

  if (typeof obj.error === 'string') return { error: obj.error };

  const vendorName = typeof obj.vendor === 'string' ? obj.vendor.trim() : '';
  if (!vendorName) return null;

  if (!Array.isArray(obj.items)) return null;
  const items: ParsedReceiptLine[] = [];
  for (const row of obj.items) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const qty = typeof row.qty === 'number' && row.qty > 0 ? row.qty : 1;
    const unit = typeof row.unit === 'string' ? row.unit.trim() : 'each';
    const confidence =
      typeof row.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : 0.5;
    items.push({
      rawText: typeof row.rawText === 'string' ? row.rawText.trim() : name,
      name,
      qty,
      unit,
      unitPrice: typeof row.unitPrice === 'number' ? row.unitPrice : null,
      totalPrice: typeof row.totalPrice === 'number' ? row.totalPrice : null,
      confidence,
      needsReview: confidence < AUTO_MATCH_THRESHOLD,
    });
  }
  if (items.length === 0) return null;

  const totalsRaw = obj.totals && typeof obj.totals === 'object' ? obj.totals : {};

  return {
    ok: true,
    vendor: {
      name: vendorName,
      storeNumber: typeof obj.vendorStoreNumber === 'string' ? obj.vendorStoreNumber : undefined,
    },
    date: typeof obj.date === 'string' ? obj.date : undefined,
    time: typeof obj.time === 'string' ? obj.time : undefined,
    totals: {
      subtotal: typeof totalsRaw.subtotal === 'number' ? totalsRaw.subtotal : undefined,
      tax: typeof totalsRaw.tax === 'number' ? totalsRaw.tax : undefined,
      total: typeof totalsRaw.total === 'number' ? totalsRaw.total : undefined,
      currency: typeof totalsRaw.currency === 'string' ? totalsRaw.currency : 'USD',
    },
    items,
    draftPayload: {
      docType: 'receipt',
      costCategory: 'materials',
      source: 'ai',
      lines: [],
      unmatched: [],
    },
  };
}

function resolveVendor(
  hintName: string | undefined,
  vendors: Array<{ id: string; name: string }> | undefined,
): string | undefined {
  if (!hintName || !vendors) return undefined;
  const h = hintName.toLowerCase();
  const match = vendors.find((v) => v.name.toLowerCase() === h || v.name.toLowerCase().includes(h) || h.includes(v.name.toLowerCase()));
  return match?.id;
}

function enrichWithCatalogMatch(
  items: ParsedReceiptLine[],
  catalog: FuzzyCandidate[],
): { matched: ParsedReceiptLine[]; unmatched: ParsedReceiptLine[] } {
  const matched: ParsedReceiptLine[] = [];
  const unmatched: ParsedReceiptLine[] = [];

  for (const item of items) {
    const top = fuzzyMatchItem(item.name, catalog, 3);
    if (top.length === 0 || top[0].score < 0.4) {
      unmatched.push({ ...item, needsReview: true });
      continue;
    }
    const best = top[0];
    if (best.score >= AUTO_MATCH_THRESHOLD) {
      matched.push({
        ...item,
        catalogItemId: best.id,
        catalogItemName: best.name,
        matchScore: best.score,
        needsReview: item.needsReview,
      });
    } else {
      // Ambiguous — include as matched with alternatives for UI to show choices
      matched.push({
        ...item,
        catalogItemId: best.id,
        catalogItemName: best.name,
        matchScore: best.score,
        alternatives: top,
        needsReview: true,
      });
    }
  }

  return { matched, unmatched };
}

// ═══════════════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════════════

export type GeminiVisionCaller = (
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  imageMimeType: string,
) => Promise<string | null>;

export async function parseReceipt(
  input: ParseReceiptInput,
  visionCaller?: GeminiVisionCaller,
): Promise<ParseReceiptResult> {
  if (!input.imageBase64) {
    return { ok: false, reason: 'receipt_unreadable' };
  }

  const caller =
    visionCaller ??
    ((sys, txt, img, mime) =>
      callGeminiJSON({ systemPrompt: sys, userText: txt, imageBase64: img, imageMimeType: mime }));

  const raw = await caller(RECEIPT_VISION_SYSTEM_PROMPT, 'Parse this receipt.', input.imageBase64, input.imageMimeType);
  if (!raw) return { ok: false, reason: 'ai_unavailable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'parse_error', raw };
  }

  const normalized = normalizeGemini(parsed);
  if (!normalized) return { ok: false, reason: 'parse_error', raw };
  if ('error' in normalized) {
    const e = normalized.error;
    if (e === 'not_a_receipt' || e === 'receipt_unreadable' || e === 'no_items') {
      return { ok: false, reason: e };
    }
    return { ok: false, reason: 'parse_error', raw };
  }

  const { matched, unmatched } = enrichWithCatalogMatch(normalized.items, input.catalog);
  const resolvedVendorId = resolveVendor(normalized.vendor.name, input.vendors);

  // Build draftPayload (API-ready)
  const draftLines = matched
    .filter((m) => m.catalogItemId)
    .map((m) => ({
      itemId: m.catalogItemId!,
      uom: m.unit,
      qty: m.qty,
      unitCost: typeof m.unitPrice === 'number' ? m.unitPrice : undefined,
      rawText: m.rawText,
      matchConfidence: m.matchScore,
    }));

  return {
    ok: true,
    vendor: {
      name: normalized.vendor.name,
      resolvedVendorId,
      storeNumber: normalized.vendor.storeNumber,
    },
    date: normalized.date,
    time: normalized.time,
    totals: normalized.totals,
    items: matched,
    draftPayload: {
      docType: 'receipt',
      destinationLocationId: input.targetLocationId,
      vendorId: resolvedVendorId,
      vendorReceiptNumber: normalized.vendor.storeNumber,
      eventDate: normalized.date,
      projectId: input.activeProjectId,
      phaseCode: input.activePhaseCode,
      costCategory: 'materials',
      totals: normalized.totals,
      idempotencyKey: input.photoHash,
      source: 'ai',
      lines: draftLines,
      unmatched,
    },
  };
}
