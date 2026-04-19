/**
 * Warehouse Core — canonical types.
 *
 * Spec reference: docs/warehouse/core/01_data_model/SPEC.md
 *
 * These types represent the new ledger-based inventory model. They are the
 * single source of truth for the backend warehouse module; backend-facing
 * timestamps use admin SDK types. Frontend will re-export simplified versions
 * without Timestamp dependency.
 */

import type * as admin from 'firebase-admin';

type FbTimestamp = admin.firestore.Timestamp;

// ═══════════════════════════════════════════════════════════════════
//  Shared base
// ═══════════════════════════════════════════════════════════════════

/**
 * Every entity carries these fields. schemaVersion exists from day 1 so we
 * can migrate without guesswork later.
 */
export interface EntityBase {
  id: string;
  schemaVersion: number;
  createdAt: FbTimestamp;
  updatedAt: FbTimestamp;
  createdBy: string;
  createdByType: CreatedByType;
  createdByAgentId?: string;
}

export type CreatedByType = 'human' | 'ai_agent' | 'system';

// ═══════════════════════════════════════════════════════════════════
//  Items (catalog)
// ═══════════════════════════════════════════════════════════════════

export type ItemCategory = 'materials' | 'tools' | 'consumables' | 'equipment';

/**
 * Conversion record from a purchase UOM to the item's baseUOM.
 * Example: { uom: 'roll_250ft', factor: 250 } means 1 roll_250ft = 250 ft.
 */
export interface PurchaseUOM {
  uom: string;
  factor: number;
  isDefault: boolean;
}

export interface WhItem extends EntityBase {
  sku: string;
  name: string;
  category: string; // references wh_categories.id
  baseUOM: string;
  purchaseUOMs: PurchaseUOM[];
  allowedIssueUOMs: string[];
  lastPurchasePrice: number;
  averageCost: number;
  defaultPurchasePrice?: number;
  minStock?: number;
  reorderPoint?: number;
  allowNegativeStock?: boolean;
  isTrackable: boolean;
  isActive: boolean;
  archivedAt?: FbTimestamp;
  archivedBy?: string;
  archiveReason?: string;
  requiresSerialNumber?: boolean;
  notes?: string;
}

// ═══════════════════════════════════════════════════════════════════
//  Categories (catalog taxonomy)
// ═══════════════════════════════════════════════════════════════════

export interface WhCategory extends EntityBase {
  name: string;
  slug: string;
  parentId?: string;
  displayOrder: number;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  Locations
// ═══════════════════════════════════════════════════════════════════

export type LocationType = 'warehouse' | 'van' | 'site' | 'quarantine';

export type NegativeStockPolicy = 'blocked' | 'allowed' | 'allowed_with_alert';

export interface WhLocation extends EntityBase {
  name: string;
  locationType: LocationType;
  ownerEmployeeId?: string;
  licensePlate?: string;
  relatedClientId?: string;
  relatedProjectId?: string;
  address?: string;
  negativeStockOverride?: NegativeStockPolicy;
  twoPhaseTransferEnabled: boolean;
  needsReconciliation?: boolean;
  isActive: boolean;
  archivedAt?: FbTimestamp;
  archivedBy?: string;
}

// ═══════════════════════════════════════════════════════════════════
//  Documents (5 canonical types + reversal)
// ═══════════════════════════════════════════════════════════════════

export type DocType = 'receipt' | 'issue' | 'transfer' | 'count' | 'adjustment' | 'reversal';

export type DocStatus = 'draft' | 'ready_for_review' | 'posted' | 'voided' | 'expired';

export type TransferStatus = 'shipped' | 'received';

export type IssueReason =
  | 'project_installation'
  | 'project_service_call'
  | 'project_warranty'
  | 'internal_shop_use'
  | 'damage_warehouse'
  | 'damage_transit'
  | 'loss_theft'
  | 'return_to_vendor';

export type PhaseCode =
  | 'rough_in'
  | 'trim'
  | 'service'
  | 'service_call'
  | 'change_order'
  | 'warranty';

export type CostCategory = 'materials' | 'equipment' | 'consumables';

export type DocSource = 'ui' | 'api' | 'ai' | 'import';

export interface WhDocumentTotals {
  subtotal: number;
  tax?: number;
  total: number;
  currency: string;
}

export interface WhDocument extends EntityBase {
  docNumber: string;
  docType: DocType;
  status: DocStatus;
  eventDate: FbTimestamp;

  sourceLocationId?: string;
  destinationLocationId?: string;
  locationId?: string; // for count + adjustment (single location)

  reason?: IssueReason | string;
  projectId?: string;
  phaseCode?: PhaseCode;
  costCategory?: CostCategory;

  vendorId?: string;
  vendorReceiptNumber?: string;

  transferStatus?: TransferStatus;
  reversalOf?: string;

  postedAt?: FbTimestamp;
  postedBy?: string;
  ledgerEntryIds?: string[];

  voidedAt?: FbTimestamp;
  voidedBy?: string;
  voidReason?: string;

  reservationExpiresAt?: FbTimestamp;
  aiSessionId?: string;
  idempotencyKey?: string;

  note?: string;
  attachmentUrls?: string[];
  source: DocSource;
  totals?: WhDocumentTotals;

  // Backref for tasks-agent integration (UC3)
  relatedTaskId?: string;
}

/**
 * Line item inside a document (stored as subcollection).
 */
export interface WhDocumentLine {
  id: string;
  lineNumber: number;
  itemId: string;
  uom: string;
  qty: number;
  baseQty?: number;
  unitCost?: number;
  baseUnitCost?: number;
  totalCost?: number;
  systemQty?: number;
  countedQty?: number;
  variance?: number;
  projectId?: string;
  phaseCode?: PhaseCode;
  costCategory?: CostCategory;
  note?: string;
  rawText?: string;
  matchConfidence?: number;
}

// ═══════════════════════════════════════════════════════════════════
//  Ledger (immutable journal)
// ═══════════════════════════════════════════════════════════════════

export type LedgerDirection = 'in' | 'out';

/**
 * An immutable ledger entry. Created only via postDocument(); never updated.
 * Reversal creates a NEW entry with reversalOf pointing at the original.
 */
export interface WhLedgerEntry {
  id: string;
  schemaVersion: number;

  documentId: string;
  lineId: string;

  itemId: string;
  locationId: string;
  deltaQty: number; // signed
  direction: LedgerDirection;

  unitCostAtPosting: number; // in baseUOM

  projectId?: string;
  phaseCode?: PhaseCode;
  costCategory?: CostCategory;

  reversalOf?: string;

  eventDate: FbTimestamp;
  postedAt: FbTimestamp;
  postedBy: string;
}

// ═══════════════════════════════════════════════════════════════════
//  Balances (materialized projection)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compound key: `${locationId}__${itemId}` — O(1) lookup without composite index.
 */
export interface WhBalance {
  id: string;
  schemaVersion: number;
  locationId: string;
  itemId: string;
  onHandQty: number; // baseUOM
  reservedQty: number; // baseUOM
  availableQty: number; // computed: onHandQty - reservedQty
  lastLedgerEntryId?: string;
  lastEventDate?: FbTimestamp;
  updatedAt: FbTimestamp;
  needsReconciliation?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  Norms (consumption standards for tasks)
// ═══════════════════════════════════════════════════════════════════

export interface WhNormItem {
  itemId: string;
  qtyPerUnit: number;
  note?: string;
}

export interface WhNorm extends EntityBase {
  taskType: string; // matches GTDTask.templateType
  name: string;
  description?: string;
  items: WhNormItem[];
  estimatedLaborHours?: number;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  Vendors
// ═══════════════════════════════════════════════════════════════════

export type VendorType = 'big_box' | 'local_supply' | 'subcontractor_proxy' | 'online';

export interface WhVendor extends EntityBase {
  name: string;
  vendorType: VendorType;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  defaultPaymentTerms?: string;
  preferredForCategories?: string[];
  apiEndpoint?: string;
  apiCredentialsKey?: string;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════
//  Count sessions (two-step inventory)
// ═══════════════════════════════════════════════════════════════════

export type CountSessionStatus = 'counting' | 'review' | 'posted' | 'voided';

export interface WhCountSession extends EntityBase {
  sessionNumber: string;
  status: CountSessionStatus;
  locationId: string;
  startedAt: FbTimestamp;
  completedAt?: FbTimestamp;
  generatedAdjustmentDocIds?: string[];
  note?: string;
}

export interface WhCountLine {
  id: string;
  itemId: string;
  systemQty: number;
  countedQty: number;
  variance: number;
  note?: string;
  countedBy: string;
  countedAt: FbTimestamp;
}

// ═══════════════════════════════════════════════════════════════════
//  Events + audit log
// ═══════════════════════════════════════════════════════════════════

export interface WhEvent {
  id: string;
  schemaVersion: number;
  eventType: string; // "warehouse.document.posted" etc.
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  occurredAt: FbTimestamp;
  publishedAt?: FbTimestamp;
  subscribers?: string[];
  deliveryStatus?: Record<string, 'pending' | 'delivered' | 'failed'>;
}

export interface WhAuditActor {
  userId: string;
  actorType: CreatedByType;
  agentId?: string;
  ip?: string;
  userAgent?: string;
}

export interface WhAuditLog {
  id: string;
  schemaVersion: number;
  actionType: string;
  endpoint?: string;
  actor: WhAuditActor;
  target: { entityType: string; entityId: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId?: string;
  occurredAt: FbTimestamp;
}

// ═══════════════════════════════════════════════════════════════════
//  Idempotency
// ═══════════════════════════════════════════════════════════════════

export interface WhIdempotencyKey {
  id: string;
  key: string;
  endpoint: string;
  userId: string;
  payloadHash: string;
  result: {
    statusCode: number;
    body: Record<string, unknown>;
  };
  createdAt: FbTimestamp;
  expiresAt: FbTimestamp;
}

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

export const BALANCE_KEY_SEPARATOR = '__';

/**
 * Build the deterministic balance doc id.
 */
export function makeBalanceKey(locationId: string, itemId: string): string {
  return `${locationId}${BALANCE_KEY_SEPARATOR}${itemId}`;
}

/**
 * Parse a balance doc id back into its parts. Returns null if malformed.
 */
export function parseBalanceKey(key: string): { locationId: string; itemId: string } | null {
  const idx = key.indexOf(BALANCE_KEY_SEPARATOR);
  if (idx <= 0 || idx === key.length - BALANCE_KEY_SEPARATOR.length) return null;
  return {
    locationId: key.slice(0, idx),
    itemId: key.slice(idx + BALANCE_KEY_SEPARATOR.length),
  };
}

/**
 * Compute availableQty — the only place this derivation lives.
 */
export function computeAvailableQty(onHand: number, reserved: number): number {
  return onHand - reserved;
}

/**
 * Default negative-stock policy by locationType (see core/02 §7).
 */
export const DEFAULT_NEGATIVE_STOCK_POLICY: Record<LocationType, NegativeStockPolicy> = {
  warehouse: 'blocked',
  van: 'allowed_with_alert',
  site: 'allowed',
  quarantine: 'blocked',
};

/**
 * Convert a qty from a purchase UOM into the item's baseUOM.
 * Throws if the UOM isn't declared on the item.
 */
export function convertToBaseQty(item: Pick<WhItem, 'baseUOM' | 'purchaseUOMs'>, sourceUOM: string, qty: number): number {
  if (sourceUOM === item.baseUOM) return qty;
  const purchase = item.purchaseUOMs.find((p) => p.uom === sourceUOM);
  if (!purchase) throw new Error(`INVALID_UOM: ${sourceUOM} not declared on item`);
  return qty * purchase.factor;
}

/**
 * Convert a unit price from purchase UOM to baseUOM price.
 */
export function convertToBaseUnitCost(item: Pick<WhItem, 'baseUOM' | 'purchaseUOMs'>, sourceUOM: string, unitCost: number): number {
  if (sourceUOM === item.baseUOM) return unitCost;
  const purchase = item.purchaseUOMs.find((p) => p.uom === sourceUOM);
  if (!purchase) throw new Error(`INVALID_UOM: ${sourceUOM} not declared on item`);
  return unitCost / purchase.factor;
}
