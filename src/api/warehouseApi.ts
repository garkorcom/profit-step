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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.code ?? 'HTTP_' + res.status;
    const message = err?.error?.message ?? res.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return res.json() as Promise<T>;
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

export interface WhItemClient {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUOM: string;
  lastPurchasePrice: number;
  averageCost: number;
  minStock?: number;
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
