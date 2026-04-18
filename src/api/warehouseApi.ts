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
import { db } from '../firebase/firebase';

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
