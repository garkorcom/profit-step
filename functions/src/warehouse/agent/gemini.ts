/**
 * Shared Gemini wrapper for warehouse capabilities.
 *
 * Multi-model fallback + JSON mode. Thin layer — capabilities own their
 * prompts, this file only handles the HTTP + model selection.
 */

import { logger } from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const DEFAULT_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
] as const;

export interface CallGeminiOptions {
  systemPrompt: string;
  userText: string;
  models?: readonly string[];
  imageBase64?: string; // for future vision calls
  imageMimeType?: string;
}

function getClient(): GoogleGenerativeAI {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

/**
 * Returns raw JSON string from Gemini (to be parsed by caller) or null on failure.
 */
export async function callGeminiJSON(opts: CallGeminiOptions): Promise<string | null> {
  let client: GoogleGenerativeAI;
  try {
    client = getClient();
  } catch (e: any) {
    logger.error('warehouse/agent: gemini init failed', { error: e.message });
    return null;
  }

  const errors: string[] = [];
  const models = opts.models ?? DEFAULT_MODELS;

  for (const modelName of models) {
    try {
      const model = client.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' },
      });

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: opts.systemPrompt },
        { text: `INPUT:\n${opts.userText}` },
      ];
      if (opts.imageBase64 && opts.imageMimeType) {
        parts.push({
          inlineData: { mimeType: opts.imageMimeType, data: opts.imageBase64 },
        });
      }

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: parts as any }],
      });
      const text = result.response.text();
      if (text) return text;
    } catch (e: any) {
      logger.warn(`warehouse/agent: ${modelName} failed`, { error: e.message });
      errors.push(`${modelName}: ${e.message}`);
    }
  }

  logger.error('warehouse/agent: all gemini models failed', { errors });
  return null;
}
