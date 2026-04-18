/**
 * Parse a vendor's inbound RFQ reply email into structured quote data.
 *
 * Pure function — Gemini caller is injected so tests run without network.
 * The route layer threads this into an inbound webhook and writes the
 * result to `wh_vendor_quotes` (see warehouse/api/routes/rfqInbound.ts).
 *
 * Reference: docs/warehouse/improvements/10_vendor_email/SPEC.md.
 */

import { RFQ_RESPONSE_PARSER_SYSTEM_PROMPT } from '../prompts/rfqResponse';
import { callGeminiJSON } from '../gemini';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface ParseRfqReplyInput {
  /** The email body text (plain). */
  emailBody: string;
  /** Original RFQ id we correlated via In-Reply-To / subject / custom-args. */
  rfqId?: string;
  /** Vendor id known from the rfq record (for audit; capability doesn't use it). */
  vendorId?: string;
}

export interface QuoteLine {
  itemHint: string;
  qty: number | null;
  unit: string | null;
  unitCost: number | null;
  totalCost: number | null;
  leadTimeDays: number | null;
  availability: 'in_stock' | 'backordered' | 'out_of_stock' | null;
  note: string | null;
}

export interface QuoteOverall {
  paymentTerms: string | null;
  validUntil: string | null;
  shippingCost: number | null;
  currency: 'USD';
}

export interface ParsedRfqReplyOk {
  ok: true;
  rfqId?: string;
  vendorId?: string;
  items: QuoteLine[];
  overall: QuoteOverall;
}

export type ParseRfqReplyResult =
  | ParsedRfqReplyOk
  | { ok: false; reason: 'not_a_quote' | 'unreadable' | 'ai_unavailable' | 'parse_error'; raw?: string };

export type RfqReplyGeminiCaller = (systemPrompt: string, userText: string) => Promise<string | null>;

// ═══════════════════════════════════════════════════════════════════
//  Normalization
// ═══════════════════════════════════════════════════════════════════

function normalize(raw: unknown): ParsedRfqReplyOk | { error: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;
  if (typeof obj.error === 'string') return { error: obj.error };

  if (!Array.isArray(obj.items)) return null;
  const items: QuoteLine[] = [];
  for (const row of obj.items) {
    if (!row || typeof row !== 'object') continue;
    const itemHint = typeof row.itemHint === 'string' ? row.itemHint.trim() : '';
    if (!itemHint) continue;
    const availability =
      row.availability === 'in_stock' || row.availability === 'backordered' || row.availability === 'out_of_stock'
        ? row.availability
        : null;
    items.push({
      itemHint,
      qty: typeof row.qty === 'number' && row.qty > 0 ? row.qty : null,
      unit: typeof row.unit === 'string' ? row.unit.trim() : null,
      unitCost: typeof row.unitCost === 'number' ? row.unitCost : null,
      totalCost: typeof row.totalCost === 'number' ? row.totalCost : null,
      leadTimeDays: typeof row.leadTimeDays === 'number' ? row.leadTimeDays : null,
      availability,
      note: typeof row.note === 'string' ? row.note.trim() : null,
    });
  }

  if (items.length === 0) return null;

  const overallRaw = obj.overall && typeof obj.overall === 'object' ? obj.overall : {};
  const overall: QuoteOverall = {
    paymentTerms: typeof overallRaw.paymentTerms === 'string' ? overallRaw.paymentTerms : null,
    validUntil: typeof overallRaw.validUntil === 'string' ? overallRaw.validUntil : null,
    shippingCost: typeof overallRaw.shippingCost === 'number' ? overallRaw.shippingCost : null,
    currency: 'USD',
  };

  return { ok: true, items, overall };
}

// ═══════════════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════════════

export async function parseRfqReply(
  input: ParseRfqReplyInput,
  caller?: RfqReplyGeminiCaller,
): Promise<ParseRfqReplyResult> {
  const body = (input.emailBody || '').trim();
  if (body.length < 20) return { ok: false, reason: 'unreadable' };

  const gemini =
    caller ?? ((sys, txt) => callGeminiJSON({ systemPrompt: sys, userText: txt }));
  const raw = await gemini(RFQ_RESPONSE_PARSER_SYSTEM_PROMPT, body);
  if (!raw) return { ok: false, reason: 'ai_unavailable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'parse_error', raw };
  }

  const n = normalize(parsed);
  if (!n) return { ok: false, reason: 'parse_error', raw };
  if ('error' in n) {
    if (n.error === 'not_a_quote' || n.error === 'unreadable') return { ok: false, reason: n.error };
    return { ok: false, reason: 'parse_error', raw };
  }

  return { ...n, rfqId: input.rfqId, vendorId: input.vendorId };
}

// ═══════════════════════════════════════════════════════════════════
//  RFQ id correlation from inbound email envelope
// ═══════════════════════════════════════════════════════════════════

export interface InboundEnvelopeFields {
  /** Raw subject; we look for "RFQ ref: rfq_..." fragment. */
  subject?: string;
  /** Body often echoes "RFQ ref: rfq_..." from our outgoing template. */
  body?: string;
  /** SendGrid Inbound Parse includes custom args only on outgoing — inbound maps through the
   *  reply headers. We accept an optional In-Reply-To / Message-Id for future use. */
  inReplyTo?: string;
  /** SendGrid Inbound sends the raw email; sometimes our rfqId is in References. */
  references?: string;
}

const RFQ_ID_REGEX = /\b(rfq_[a-z0-9_]+)\b/i;

export function correlateRfqId(env: InboundEnvelopeFields): string | null {
  const candidates = [env.subject, env.body, env.inReplyTo, env.references].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  for (const c of candidates) {
    const m = c.match(RFQ_ID_REGEX);
    if (m) return m[1];
  }
  return null;
}
