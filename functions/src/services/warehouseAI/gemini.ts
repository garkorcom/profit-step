/**
 * Warehouse AI — Gemini wrapper
 *
 * Mirrors the pattern used in shoppingAIService (multi-model fallback,
 * JSON mode), but scoped to warehouse-AI prompts. Exported `callGemini`
 * is easy to mock in unit tests.
 */

import { logger } from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { INTENT_PARSER_SYSTEM_PROMPT } from './prompts';
import type { IntentParseResult, ParsedIntent } from './types';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
] as const;

function getGeminiClient() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

/**
 * Low-level call used by parseIntent. Exported so tests can mock/replace.
 * Returns raw JSON text, or null if all models failed.
 */
export async function callGeminiJSON(systemPrompt: string, userText: string): Promise<string | null> {
  let client: GoogleGenerativeAI;
  try {
    client = getGeminiClient();
  } catch (e: any) {
    logger.error('WarehouseAI: Gemini client init failed', { error: e.message });
    return null;
  }

  const errors: string[] = [];

  for (const modelName of MODELS) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: systemPrompt }, { text: `INPUT:\n${userText}` }],
          },
        ],
      });
      const text = result.response.text();
      if (text) return text;
    } catch (e: any) {
      logger.warn(`WarehouseAI: model ${modelName} failed`, { error: e.message });
      errors.push(`${modelName}: ${e.message}`);
    }
  }

  logger.error('WarehouseAI: all models failed', { errors });
  return null;
}

/**
 * Parse user free-text into a structured ParsedIntent.
 * Returns a discriminated union with `ok: false` for any failure mode
 * so the caller never has to check for null.
 */
export async function parseIntent(userText: string): Promise<IntentParseResult> {
  const trimmed = (userText || '').trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'too_vague' };
  }

  const raw = await callGeminiJSON(INTENT_PARSER_SYSTEM_PROMPT, trimmed);
  if (!raw) {
    return { ok: false, reason: 'ai_unavailable' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'parse_error', raw };
  }

  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    const err = parsed.error;
    if (err === 'not_a_trip' || err === 'too_vague') {
      return { ok: false, reason: err };
    }
    return { ok: false, reason: 'parse_error', raw };
  }

  const intent = normalizeIntent(parsed);
  if (!intent) {
    return { ok: false, reason: 'parse_error', raw };
  }
  return { ok: true, intent };
}

/**
 * Defensive normalization of Gemini output. Trusts nothing; every field
 * is validated and coerced into the expected shape. If the structure is
 * too broken, returns null.
 */
export function normalizeIntent(input: unknown): ParsedIntent | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, any>;

  // destination
  const destRaw = obj.destination && typeof obj.destination === 'object' ? obj.destination : {};
  const destination = {
    clientHint: typeof destRaw.clientHint === 'string' && destRaw.clientHint.trim() ? destRaw.clientHint.trim() : null,
    addressHint: typeof destRaw.addressHint === 'string' && destRaw.addressHint.trim() ? destRaw.addressHint.trim() : null,
  };

  // plannedDate
  let plannedDate: string | null = null;
  if (typeof obj.plannedDate === 'string') {
    const v = obj.plannedDate.toLowerCase();
    if (v === 'today' || v === 'tomorrow' || /^\d{4}-\d{2}-\d{2}$/.test(obj.plannedDate)) {
      plannedDate = v === 'today' || v === 'tomorrow' ? v : obj.plannedDate;
    }
  }

  // tasks
  if (!Array.isArray(obj.tasks)) return null;
  const tasks = obj.tasks
    .map((t: any) => {
      if (!t || typeof t !== 'object') return null;
      const type = typeof t.type === 'string' ? t.type.trim() : '';
      if (!type) return null;
      const qty = typeof t.qty === 'number' && t.qty > 0 && Number.isFinite(t.qty) ? Math.floor(t.qty) : 1;
      const description = typeof t.description === 'string' ? t.description.trim() : type;
      return { type, qty, description };
    })
    .filter((t: any): t is { type: string; qty: number; description: string } => t !== null);

  if (tasks.length === 0) return null;

  return { destination, plannedDate, tasks };
}
