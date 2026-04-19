/**
 * Warehouse AI — types
 *
 * Canonical shapes for pre-trip planning flow. Intentionally decoupled
 * from frontend InventoryCatalogItem types (those use client SDK Timestamp);
 * backend operates on plain numbers/strings and uses admin SDK timestamps
 * only inside the Firestore layer.
 */

export type TripStatus = 'draft' | 'confirmed' | 'completed' | 'cancelled';

export type ProposedItemSource = 'norm' | 'ai_suggestion' | 'manual';

/**
 * A single work task parsed from user free-text input.
 * `type` is a stable snake_case slug (install_outlet, replace_switch, ...).
 */
export interface ParsedTask {
  type: string;
  qty: number;
  description: string;
  normId?: string; // filled in after normMatcher
}

/**
 * Intent output from Gemini parser.
 */
export interface ParsedIntent {
  destination: {
    clientHint: string | null;
    addressHint: string | null;
  };
  plannedDate: string | null; // "today" | "tomorrow" | ISO date
  tasks: ParsedTask[];
}

export type IntentParseResult =
  | { ok: true; intent: ParsedIntent }
  | { ok: false; reason: 'not_a_trip' | 'too_vague' | 'ai_unavailable' | 'parse_error'; raw?: string };

/**
 * A concrete item the plan suggests (either from stock, or to buy).
 */
export interface ProposedItem {
  catalogItemId?: string; // present if matched to catalog
  name: string;
  unit: string;
  qtyNeeded: number;
  qtyOnHand: number;
  qtyToBuy: number;
  estimatedPrice?: number; // unit price × qtyToBuy
  source: ProposedItemSource;
  warning?: string; // e.g. "not in catalog — manual add needed"
}

/**
 * Result of a plan-trip call.
 */
export interface TripPlan {
  tripId: string;
  originalText: string;
  destination: {
    clientId?: string;
    clientName?: string;
    address?: string;
  };
  plannedDate: string | null;
  parsedTasks: ParsedTask[];
  proposedItems: ProposedItem[];
  suggestedVendor?: string;
  estimatedTotal?: number;
  status: TripStatus;
  warnings: string[]; // soft messages for UI
  createdAtMs: number;
}

/**
 * Persisted session shape in Firestore warehouse_ai_sessions/{userId}.
 * `createdAtMs`/`updatedAtMs` are epoch millis to keep type surface plain;
 * the route layer converts to Firestore Timestamps at write time.
 */
export interface WarehouseAISession {
  activeTrip?: TripPlan & { updatedAtMs: number };
  recentTripIds?: string[];
}

/**
 * Input to planTrip — the only entry point.
 */
export interface PlanTripInput {
  userId: string;
  text: string;
  currentLocationId?: string;
}

/**
 * What a norm looks like when we read it from inventory_norms.
 * Narrower than the full frontend Norm type (we only need items).
 */
export interface NormRecord {
  id: string;
  taskType: string; // matches ParsedTask.type slug
  items: Array<{
    catalogItemId: string;
    qtyPerUnit: number; // how many units of item per 1 unit of task
  }>;
}

/**
 * What we read out of inventory_catalog for stock computation.
 */
export interface CatalogItemSnapshot {
  id: string;
  name: string;
  unit: string;
  avgPrice: number;
  stockByLocation: Record<string, number>;
  totalStock: number;
}

/**
 * Events we publish to warehouse_ai_events for analytics/debug.
 */
export type WarehouseAIEventType =
  | 'trip_planned'
  | 'trip_confirmed'
  | 'trip_cancelled'
  | 'trip_completed'
  | 'parse_failed'
  | 'no_norm_found'
  | 'all_in_stock';

export interface WarehouseAIEvent {
  eventId: string;
  userId: string;
  type: WarehouseAIEventType;
  tripId?: string;
  payload: Record<string, unknown>;
  createdAtMs: number;
}
