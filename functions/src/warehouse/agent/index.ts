/**
 * Warehouse AI agent barrel.
 *
 * Houses prompts, fuzzy helpers, and capabilities (UC1-UC4). Does NOT
 * directly write to Firestore — capabilities return structured proposals;
 * the API layer (warehouse/api) decides when to persist.
 */

export * from './capabilities';
export { callGeminiJSON } from './gemini';
export { fuzzyMatchItem, pickBestMatch } from './fuzzy';
export type { FuzzyCandidate, FuzzyMatch } from './fuzzy';
export * from './providers';
