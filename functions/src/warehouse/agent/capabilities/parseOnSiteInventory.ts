/**
 * UC1 — On-site voice inventory.
 *
 * Takes worker free-form text ("I'm at Dvorkin, there are 20 outlets and
 * a roll of wire"), runs it through Gemini, fuzzy-matches each item to the
 * catalog, and returns a structured proposal. Does NOT write to Firestore
 * directly — the caller presents the proposal to the user and, on confirm,
 * creates a draft document via the standard API.
 *
 * Reference: docs/warehouse/improvements/06_onsite_voice/SPEC.md.
 */

import { callGeminiJSON } from '../gemini';
import { ON_SITE_INVENTORY_SYSTEM_PROMPT } from '../prompts/onSiteInventory';
import { fuzzyMatchItem, type FuzzyCandidate, type FuzzyMatch } from '../fuzzy';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface ParseOnSiteInventoryInput {
  userId: string;
  text: string;
  /** Optional: catalog to match against. Tests pass a fixture; production passes live catalog. */
  catalog: FuzzyCandidate[];
  /** Optional: known clients for siteHint resolution. */
  clients?: Array<{ id: string; name: string }>;
}

export interface ParsedOnSiteItem {
  rawText: string;
  name: string;
  qty: number;
  unit: string;
  confidence: number;
  needsClarification: boolean;
  /** Present when fuzzy match is above threshold. */
  catalogItemId?: string;
  catalogItemName?: string;
  matchScore?: number;
  /** If multiple candidates are close, present top 2-3 for UI clarification. */
  alternatives?: FuzzyMatch[];
}

export interface ParseOnSiteInventoryOk {
  ok: true;
  siteHint: {
    clientName?: string;
    addressHint?: string;
    resolvedClientId?: string;
  };
  items: ParsedOnSiteItem[];
}

export type ParseOnSiteInventoryResult =
  | ParseOnSiteInventoryOk
  | {
      ok: false;
      reason: 'not_on_site' | 'too_vague' | 'no_items' | 'ai_unavailable' | 'parse_error';
      raw?: string;
    };

// ═══════════════════════════════════════════════════════════════════
//  Normalization of Gemini response
// ═══════════════════════════════════════════════════════════════════

function normalizeGeminiResponse(raw: unknown): ParseOnSiteInventoryOk | { error: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;

  if (typeof obj.error === 'string') {
    return { error: obj.error };
  }

  const siteHintRaw = obj.siteHint && typeof obj.siteHint === 'object' ? obj.siteHint : {};
  const siteHint = {
    clientName: typeof siteHintRaw.clientName === 'string' && siteHintRaw.clientName.trim() ? siteHintRaw.clientName.trim() : undefined,
    addressHint: typeof siteHintRaw.addressHint === 'string' && siteHintRaw.addressHint.trim() ? siteHintRaw.addressHint.trim() : undefined,
  };

  if (!Array.isArray(obj.items)) return null;
  const items: ParsedOnSiteItem[] = [];
  for (const row of obj.items) {
    if (!row || typeof row !== 'object') continue;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const qty = typeof row.qty === 'number' && Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 1;
    const unit = typeof row.unit === 'string' ? row.unit.trim() : 'each';
    const confidence =
      typeof row.confidence === 'number' && row.confidence >= 0 && row.confidence <= 1
        ? row.confidence
        : 0.5;
    const rawText = typeof row.rawText === 'string' ? row.rawText.trim() : name;
    const needsClarification =
      typeof row.needsClarification === 'boolean' ? row.needsClarification : confidence < 0.85;
    items.push({ rawText, name, qty, unit, confidence, needsClarification });
  }

  if (items.length === 0) return null;

  return {
    ok: true,
    siteHint,
    items,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Fuzzy-match + client resolution
// ═══════════════════════════════════════════════════════════════════

const MATCH_THRESHOLD = 0.5;
const AUTO_MATCH_THRESHOLD = 0.75;

function enrichWithCatalogMatch(
  items: ParsedOnSiteItem[],
  catalog: FuzzyCandidate[],
): ParsedOnSiteItem[] {
  return items.map((item) => {
    const top = fuzzyMatchItem(item.name, catalog, 3);
    if (top.length === 0 || top[0].score < MATCH_THRESHOLD) {
      return { ...item, needsClarification: true };
    }
    const best = top[0];
    if (best.score >= AUTO_MATCH_THRESHOLD) {
      return {
        ...item,
        catalogItemId: best.id,
        catalogItemName: best.name,
        matchScore: best.score,
        needsClarification: item.needsClarification || best.score < 0.9,
      };
    }
    // Ambiguous: return with top alternatives
    return {
      ...item,
      catalogItemId: best.id,
      catalogItemName: best.name,
      matchScore: best.score,
      alternatives: top.slice(0, 3),
      needsClarification: true,
    };
  });
}

function resolveClient(
  hint: string | undefined,
  clients: Array<{ id: string; name: string }> | undefined,
): { resolvedClientId?: string } {
  if (!hint || !clients || clients.length === 0) return {};
  const normalizedHint = hint.toLowerCase();
  const matches = clients.filter((c) => c.name.toLowerCase().includes(normalizedHint));
  return matches.length === 1 ? { resolvedClientId: matches[0].id } : {};
}

// ═══════════════════════════════════════════════════════════════════
//  Public entry point
// ═══════════════════════════════════════════════════════════════════

/** Injected Gemini call for tests to replace the live model. */
export type GeminiCaller = (systemPrompt: string, userText: string) => Promise<string | null>;

export async function parseOnSiteInventory(
  input: ParseOnSiteInventoryInput,
  geminiCaller?: GeminiCaller,
): Promise<ParseOnSiteInventoryResult> {
  const text = (input.text || '').trim();
  if (!text) return { ok: false, reason: 'too_vague' };

  const caller = geminiCaller ?? ((sys, txt) => callGeminiJSON({ systemPrompt: sys, userText: txt }));
  const raw = await caller(ON_SITE_INVENTORY_SYSTEM_PROMPT, text);
  if (!raw) return { ok: false, reason: 'ai_unavailable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'parse_error', raw };
  }

  const normalized = normalizeGeminiResponse(parsed);
  if (!normalized) return { ok: false, reason: 'parse_error', raw };
  if ('error' in normalized) {
    const e = normalized.error;
    if (e === 'not_on_site' || e === 'too_vague' || e === 'no_items') {
      return { ok: false, reason: e };
    }
    return { ok: false, reason: 'parse_error', raw };
  }

  const enriched = enrichWithCatalogMatch(normalized.items, input.catalog);
  const resolved = resolveClient(normalized.siteHint.clientName, input.clients);

  return {
    ok: true,
    siteHint: {
      ...normalized.siteHint,
      ...resolved,
    },
    items: enriched,
  };
}
