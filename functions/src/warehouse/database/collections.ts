/**
 * Firestore collection names for the warehouse module.
 *
 * Single source of truth — import from here, never hardcode collection
 * strings in service/route code. Makes renaming + grep-ability trivial.
 */

export const WH_COLLECTIONS = {
  items: 'wh_items',
  categories: 'wh_categories',
  locations: 'wh_locations',
  documents: 'wh_documents',
  documentLinesSub: 'lines', // subcollection under wh_documents/{id}
  ledger: 'wh_ledger',
  balances: 'wh_balances',
  countSessions: 'wh_count_sessions',
  countLinesSub: 'lines', // subcollection under wh_count_sessions/{id}
  norms: 'wh_norms',
  vendors: 'wh_vendors',
  events: 'wh_events',
  auditLog: 'wh_audit_log',
  idempotencyKeys: 'wh_idempotency_keys',
  migrationsApplied: 'wh_migrations_applied',
  counters: 'wh_counters',
} as const;

export type WhCollectionName = (typeof WH_COLLECTIONS)[keyof typeof WH_COLLECTIONS];

/**
 * Legacy collections that the clean-slate migration wipes. Kept as a named
 * list so the drop script and tests reference the same source.
 */
export const LEGACY_INVENTORY_COLLECTIONS = [
  'warehouses',
  'inventory_items',
  'inventory_catalog',
  'inventory_transactions',
  'inventory_transactions_v2',
  'inventory_locations',
  'inventory_reservations',
] as const;

export type LegacyInventoryCollection = (typeof LEGACY_INVENTORY_COLLECTIONS)[number];
