/**
 * Warehouse module — top-level barrel.
 *
 * Sub-module breakdown lives in docs/warehouse/MAIN_SPEC.md §3.
 * For Phase 0 we only expose core types + database collection names.
 */

export * from './core';
export { WH_COLLECTIONS, LEGACY_INVENTORY_COLLECTIONS } from './database/collections';
export type { WhCollectionName, LegacyInventoryCollection } from './database/collections';
