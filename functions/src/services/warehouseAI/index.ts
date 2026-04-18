/**
 * Warehouse AI — barrel export
 */

export * from './types';
export { parseIntent, callGeminiJSON, normalizeIntent } from './gemini';
export {
  planTrip,
  buildPlanFromIntent,
  matchNorms,
  resolveStock,
  qtyAtLocation,
  buildProposedItems,
  sumEstimatedTotal,
  resolveClient,
  persistSession,
  logWarehouseAIEvent,
  confirmTrip,
  cancelTrip,
} from './planTrip';
export { INTENT_PARSER_SYSTEM_PROMPT } from './prompts';
