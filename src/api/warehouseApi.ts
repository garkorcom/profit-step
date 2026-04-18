/**
 * Warehouse API client — Firestore read wrappers for the new ledger-based
 * warehouse module (wh_* collections).
 *
 * Reads only. Mutating operations go through the backend REST endpoints
 * (/api/warehouse/*) so the posting engine stays the single write path.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../firebase/firebase';

// ═══════════════════════════════════════════════════════════════════
//  REST API helpers (mutations go through the posting engine)
// ═══════════════════════════════════════════════════════════════════

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated. Please sign in again.');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function requestJson<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers = await authHeaders();
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const init: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(path, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.code ?? 'HTTP_' + res.status;
    const message = err?.error?.message ?? res.statusText;
    const details = err?.error?.details;
    const error = new Error(`${code}: ${message}`) as Error & { code?: string; details?: unknown; status?: number };
    error.code = code;
    error.details = details;
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'POST', body);
}

// ═══════════════════════════════════════════════════════════════════
//  Types (slim — mirrors functions/src/warehouse/core/types.ts but w/o
//  server-side Timestamp dependency)
// ═══════════════════════════════════════════════════════════════════

export type LocationType = 'warehouse' | 'van' | 'site' | 'quarantine';

export interface WhLocationClient {
  id: string;
  name: string;
  locationType: LocationType;
  ownerEmployeeId?: string;
  licensePlate?: string;
  address?: string;
  isActive: boolean;
}

export interface WhPurchaseUOMClient {
  uom: string;
  factor: number;
  isDefault: boolean;
}

export interface WhItemClient {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUOM: string;
  purchaseUOMs?: WhPurchaseUOMClient[];
  allowedIssueUOMs?: string[];
  lastPurchasePrice: number;
  averageCost: number;
  minStock?: number;
  reorderPoint?: number;
  isTrackable?: boolean;
  notes?: string;
  isActive: boolean;
}

export interface WhBalanceClient {
  id: string; // `${locationId}__${itemId}`
  locationId: string;
  itemId: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
}

// ═══════════════════════════════════════════════════════════════════
//  Locations
// ═══════════════════════════════════════════════════════════════════

export async function listLocations(options: { type?: LocationType; includeInactive?: boolean } = {}): Promise<WhLocationClient[]> {
  const coll = collection(db, 'wh_locations');
  const filters = [] as any[];
  if (!options.includeInactive) filters.push(where('isActive', '==', true));
  if (options.type) filters.push(where('locationType', '==', options.type));

  const q = filters.length > 0 ? query(coll, ...filters) : query(coll);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function getLocation(id: string): Promise<WhLocationClient | null> {
  const snap = await getDoc(doc(db, 'wh_locations', id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as WhLocationClient) : null;
}

// ═══════════════════════════════════════════════════════════════════
//  Items
// ═══════════════════════════════════════════════════════════════════

export async function listItems(options: { category?: string; max?: number } = {}): Promise<WhItemClient[]> {
  const coll = collection(db, 'wh_items');
  const filters: any[] = [where('isActive', '==', true)];
  if (options.category) filters.push(where('category', '==', options.category));
  filters.push(orderBy('name'));
  filters.push(fbLimit(options.max ?? 500));
  const q = query(coll, ...filters);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function getItem(id: string): Promise<WhItemClient | null> {
  const snap = await getDoc(doc(db, 'wh_items', id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as WhItemClient) : null;
}

// ═══════════════════════════════════════════════════════════════════
//  Balances
// ═══════════════════════════════════════════════════════════════════

export async function listBalancesByLocation(locationId: string): Promise<WhBalanceClient[]> {
  const q = query(
    collection(db, 'wh_balances'),
    where('locationId', '==', locationId),
    fbLimit(500),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as WhBalanceClient[];
}

export async function listBalancesByItem(itemId: string): Promise<WhBalanceClient[]> {
  const q = query(
    collection(db, 'wh_balances'),
    where('itemId', '==', itemId),
    fbLimit(200),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as WhBalanceClient[];
}

// ═══════════════════════════════════════════════════════════════════
//  Categories (for filter dropdown)
// ═══════════════════════════════════════════════════════════════════

export interface WhCategoryClient {
  id: string;
  name: string;
  slug: string;
  parentId?: string;
  displayOrder: number;
}

export async function listCategories(): Promise<WhCategoryClient[]> {
  const snap = await getDocs(
    query(
      collection(db, 'wh_categories'),
      where('isActive', '==', true),
      orderBy('displayOrder'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as WhCategoryClient[];
}

// ═══════════════════════════════════════════════════════════════════
//  Mutations (REST → posting engine)
// ═══════════════════════════════════════════════════════════════════

export interface CreateItemPayload {
  sku: string;
  name: string;
  category: string;
  baseUOM: string;
  purchaseUOMs: Array<{ uom: string; factor: number; isDefault: boolean }>;
  allowedIssueUOMs: string[];
  lastPurchasePrice: number;
  averageCost: number;
  minStock?: number;
  reorderPoint?: number;
  isTrackable?: boolean;
  notes?: string;
}

export interface CreateItemResponse {
  itemId: string;
  sku: string;
}

export async function createItem(payload: CreateItemPayload): Promise<CreateItemResponse> {
  return postJson<CreateItemResponse>('/api/warehouse/items', payload);
}

export interface CreateLocationPayload {
  name: string;
  locationType: 'warehouse' | 'van' | 'site' | 'quarantine';
  ownerEmployeeId?: string;
  licensePlate?: string;
  address?: string;
  twoPhaseTransferEnabled?: boolean;
}

export async function createLocation(payload: CreateLocationPayload): Promise<{ locationId: string }> {
  return postJson<{ locationId: string }>('/api/warehouse/locations', payload);
}

export interface UpdateItemPayload {
  name?: string;
  category?: string;
  minStock?: number;
  reorderPoint?: number;
  isTrackable?: boolean;
  notes?: string;
}

export async function updateItem(id: string, payload: UpdateItemPayload): Promise<void> {
  await requestJson<{ itemId: string }>(`/api/warehouse/items/${id}`, 'PATCH', payload);
}

export async function archiveItem(id: string): Promise<void> {
  await requestJson<{ itemId: string; archived: boolean }>(`/api/warehouse/items/${id}`, 'DELETE');
}

export interface UpdateLocationPayload {
  name?: string;
  ownerEmployeeId?: string;
  licensePlate?: string;
  address?: string;
  twoPhaseTransferEnabled?: boolean;
}

export async function updateLocation(id: string, payload: UpdateLocationPayload): Promise<void> {
  await requestJson<{ locationId: string }>(`/api/warehouse/locations/${id}`, 'PATCH', payload);
}

// ═══════════════════════════════════════════════════════════════════
//  Documents
// ═══════════════════════════════════════════════════════════════════

export type DocType = 'receipt' | 'issue' | 'transfer' | 'count' | 'adjustment' | 'reversal';
export type DocStatus = 'draft' | 'ready_for_review' | 'posted' | 'voided' | 'expired';
export type IssueReason =
  | 'project_installation'
  | 'project_service_call'
  | 'project_warranty'
  | 'internal_shop_use'
  | 'damage_warehouse'
  | 'damage_transit'
  | 'loss_theft'
  | 'return_to_vendor';

export interface WhDocumentLineClient {
  id?: string;
  itemId: string;
  uom: string;
  qty: number;
  unitCost?: number;
  note?: string;
  projectId?: string;
  phaseCode?: string;
  costCategory?: string;
}

export interface WhDocumentClient {
  id: string;
  docNumber: string;
  docType: DocType;
  status: DocStatus;
  eventDate: { seconds: number; nanoseconds: number } | string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  locationId?: string;
  projectId?: string;
  reason?: string;
  phaseCode?: string;
  costCategory?: string;
  vendorId?: string;
  vendorReceiptNumber?: string;
  note?: string;
  source?: string;
  createdBy?: string;
  createdAt?: { seconds: number; nanoseconds: number };
  totals?: { subtotal: number; total: number; currency: string };
  reversalOfDocumentId?: string;
  reversedByDocumentId?: string;
}

export interface ListDocumentsFilter {
  docType?: DocType;
  status?: DocStatus;
  projectId?: string;
  sourceLocationId?: string;
  destinationLocationId?: string;
  limit?: number;
}

export async function listDocuments(filter: ListDocumentsFilter = {}): Promise<{ documents: WhDocumentClient[]; total: number }> {
  const params = new URLSearchParams();
  if (filter.docType) params.set('docType', filter.docType);
  if (filter.status) params.set('status', filter.status);
  if (filter.projectId) params.set('projectId', filter.projectId);
  if (filter.sourceLocationId) params.set('sourceLocationId', filter.sourceLocationId);
  if (filter.destinationLocationId) params.set('destinationLocationId', filter.destinationLocationId);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return requestJson<{ documents: WhDocumentClient[]; total: number }>(
    `/api/warehouse/documents${qs ? `?${qs}` : ''}`,
    'GET',
  );
}

export async function getDocument(id: string): Promise<{ document: WhDocumentClient; lines: WhDocumentLineClient[] }> {
  return requestJson<{ document: WhDocumentClient; lines: WhDocumentLineClient[] }>(
    `/api/warehouse/documents/${id}`,
    'GET',
  );
}

export interface CreateDocumentPayload {
  docType: DocType;
  eventDate: string; // ISO or YYYY-MM-DD
  sourceLocationId?: string;
  destinationLocationId?: string;
  locationId?: string;
  reason?: IssueReason | string;
  projectId?: string;
  phaseCode?: string;
  costCategory?: 'materials' | 'equipment' | 'consumables';
  vendorId?: string;
  vendorReceiptNumber?: string;
  lines: WhDocumentLineClient[];
  note?: string;
  source?: 'ui' | 'api' | 'ai' | 'import';
  totals?: { subtotal: number; total: number; currency?: string };
}

export async function createDocument(payload: CreateDocumentPayload): Promise<{ documentId: string; docNumber: string; status: DocStatus }> {
  return postJson('/api/warehouse/documents', { source: 'ui', ...payload });
}

export interface PostDocumentResult {
  alreadyPosted?: boolean;
  ledgerEntryIds: string[];
  events?: string[];
}

export async function postDocument(id: string, idempotencyKey?: string): Promise<PostDocumentResult> {
  return requestJson<PostDocumentResult>(
    `/api/warehouse/documents/${id}/post`,
    'POST',
    {},
    idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
}

export interface VoidDocumentResult {
  reversalDocumentId?: string;
  events?: string[];
}

export async function voidDocument(
  id: string,
  reason: 'wrong_qty' | 'wrong_items' | 'duplicate' | 'other' | string,
  note?: string,
): Promise<VoidDocumentResult> {
  return postJson<VoidDocumentResult>(`/api/warehouse/documents/${id}/void`, { reason, note });
}
