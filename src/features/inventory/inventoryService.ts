/**
 * @fileoverview Inventory Service
 * 
 * Firestore operations for inventory management.
 * Uses journal-based accounting: every movement is a transaction.
 * Stock levels in catalog are cache, recalculated from transactions.
 */

import {
    collection,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    getDoc,
    Timestamp,
    orderBy,
    limit,
    runTransaction,
    onSnapshot,
    startAfter,
    QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import {
    InventoryCatalogItem,
    InventoryTransaction,
    InventoryLocation,
    InventoryReservation,
    TaskMaterial,
    INBOUND_TYPES,
} from '../../types/inventory.types';

// ═══════════════════════════════════════
// CATALOG CRUD
// ═══════════════════════════════════════

export async function getCatalogItems(includeArchived = false): Promise<InventoryCatalogItem[]> {
    let q;
    if (includeArchived) {
        q = query(collection(db, 'inventory_catalog'), orderBy('name'));
    } else {
        q = query(
            collection(db, 'inventory_catalog'),
            where('isArchived', '==', false),
            orderBy('name')
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryCatalogItem));
}

/**
 * Real-time subscription for catalog items.
 * Returns an unsubscribe function.
 */
export function subscribeCatalogItems(
    callback: (items: InventoryCatalogItem[]) => void,
    includeArchived = false
): () => void {
    let q;
    if (includeArchived) {
        q = query(collection(db, 'inventory_catalog'), orderBy('name'));
    } else {
        q = query(
            collection(db, 'inventory_catalog'),
            where('isArchived', '==', false),
            orderBy('name')
        );
    }
    return onSnapshot(q, (snap) => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryCatalogItem)));
    });
}

export async function getCatalogItem(id: string): Promise<InventoryCatalogItem | null> {
    const snap = await getDoc(doc(db, 'inventory_catalog', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as InventoryCatalogItem;
}

export async function createCatalogItem(
    data: Omit<InventoryCatalogItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
    const ref = await addDoc(collection(db, 'inventory_catalog'), {
        ...data,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    });
    return ref.id;
}

export async function updateCatalogItem(
    id: string,
    data: Partial<InventoryCatalogItem>
): Promise<void> {
    await updateDoc(doc(db, 'inventory_catalog', id), {
        ...data,
        updatedAt: Timestamp.now(),
    });
}

export async function archiveCatalogItem(id: string): Promise<void> {
    await updateDoc(doc(db, 'inventory_catalog', id), {
        isArchived: true,
        updatedAt: Timestamp.now(),
    });
}

// ═══════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════

export async function getTransactions(
    catalogItemId?: string,
    limitCount = 50
): Promise<InventoryTransaction[]> {
    let q;
    if (catalogItemId) {
        q = query(
            collection(db, 'inventory_transactions'),
            where('catalogItemId', '==', catalogItemId),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );
    } else {
        q = query(
            collection(db, 'inventory_transactions'),
            orderBy('timestamp', 'desc'),
            limit(limitCount)
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction));
}

/**
 * Real-time subscription for transactions.
 * Returns an unsubscribe function.
 */
export function subscribeTransactions(
    callback: (txs: InventoryTransaction[]) => void,
    limitCount = 100
): () => void {
    const q = query(
        collection(db, 'inventory_transactions'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
    );
    return onSnapshot(q, (snap) => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction)));
    });
}

/**
 * Load more transactions for pagination (cursor-based).
 */
export async function getTransactionsAfter(
    lastDoc: QueryDocumentSnapshot,
    limitCount = 50
): Promise<{ txs: InventoryTransaction[]; lastDoc: QueryDocumentSnapshot | null }> {
    const q = query(
        collection(db, 'inventory_transactions'),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(limitCount)
    );
    const snap = await getDocs(q);
    const txs = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction));
    return {
        txs,
        lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
    };
}

/**
 * Create an inventory transaction with atomic stock update.
 * This is the core operation — every stock change goes through here.
 */
export async function createTransaction(
    data: Omit<InventoryTransaction, 'id' | 'stockAfter'>
): Promise<string> {
    const catalogRef = doc(db, 'inventory_catalog', data.catalogItemId);

    let txId = '';

    await runTransaction(db, async (transaction) => {
        const catalogDoc = await transaction.get(catalogRef);
        if (!catalogDoc.exists()) {
            throw new Error('Товар не найден в каталоге');
        }

        const catalogData = catalogDoc.data() as InventoryCatalogItem;
        const isInbound = INBOUND_TYPES.includes(data.type);
        const stockByLocation: Record<string, number> = { ...catalogData.stockByLocation };

        // Update stock by location
        if (isInbound) {
            const loc = data.toLocation || 'warehouse';
            stockByLocation[loc] = (stockByLocation[loc] || 0) + data.qty;
        } else {
            const loc = data.fromLocation || 'warehouse';
            const current = stockByLocation[loc] || 0;

            // For transfers, also add to destination
            if (data.type === 'transfer' && data.toLocation) {
                stockByLocation[data.toLocation] = (stockByLocation[data.toLocation] || 0) + data.qty;
            }

            // Check stock (allow override for adjustments)
            if (data.type !== 'adjustment_out' && data.type !== 'loss' && current < data.qty) {
                throw new Error(`Недостаточно на складе "${loc}": есть ${current}, нужно ${data.qty}`);
            }

            stockByLocation[loc] = Math.max(0, current - data.qty);
        }

        const totalStock = Object.values(stockByLocation).reduce((sum, v) => sum + v, 0);

        // Update catalog
        const catalogUpdate: any = {
            stockByLocation,
            totalStock,
            updatedAt: Timestamp.now(),
        };

        // Update price on purchase
        if (data.type === 'purchase' && data.unitPrice > 0) {
            catalogUpdate.lastPurchasePrice = data.unitPrice;
            // Moving average
            const prevAvg = catalogData.avgPrice || 0;
            const prevStock = catalogData.totalStock || 0;
            if (prevStock + data.qty > 0) {
                catalogUpdate.avgPrice = ((prevAvg * prevStock) + (data.unitPrice * data.qty)) / (prevStock + data.qty);
            }
        }

        // Tool tracking
        if (data.type === 'tool_issue') {
            catalogUpdate.assignedTo = data.performedBy;
            catalogUpdate.assignedToName = data.performedByName;
            catalogUpdate.assignedAt = Timestamp.now();
        } else if (data.type === 'tool_return') {
            catalogUpdate.assignedTo = null;
            catalogUpdate.assignedToName = null;
            catalogUpdate.assignedAt = null;
        }

        transaction.update(catalogRef, catalogUpdate);

        // Create transaction document
        const txRef = doc(collection(db, 'inventory_transactions'));
        txId = txRef.id;
        transaction.set(txRef, {
            ...data,
            stockAfter: totalStock,
            timestamp: data.timestamp || Timestamp.now(),
        });
    });

    return txId;
}

// ═══════════════════════════════════════
// LOCATIONS
// ═══════════════════════════════════════

export async function getLocations(onlyActive = false): Promise<InventoryLocation[]> {
    let q;
    if (onlyActive) {
        q = query(
            collection(db, 'inventory_locations'),
            where('isActive', '==', true),
            orderBy('name')
        );
    } else {
        q = query(
            collection(db, 'inventory_locations'),
            orderBy('name')
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryLocation));
}

/**
 * Real-time subscription for locations.
 * Returns an unsubscribe function.
 */
export function subscribeLocations(
    callback: (locs: InventoryLocation[]) => void
): () => void {
    const q = query(
        collection(db, 'inventory_locations'),
        orderBy('name')
    );
    return onSnapshot(q, (snap) => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryLocation)));
    });
}

export async function createLocation(
    data: Omit<InventoryLocation, 'id' | 'createdAt'>
): Promise<string> {
    const ref = await addDoc(collection(db, 'inventory_locations'), {
        ...data,
        createdAt: Timestamp.now(),
    });
    return ref.id;
}

export async function updateLocation(id: string, data: Partial<InventoryLocation>): Promise<void> {
    await updateDoc(doc(db, 'inventory_locations', id), data);
}

// ═══════════════════════════════════════
// RESERVATIONS
// ═══════════════════════════════════════

export async function getReservations(taskId?: string): Promise<InventoryReservation[]> {
    let q;
    if (taskId) {
        q = query(
            collection(db, 'inventory_reservations'),
            where('relatedTaskId', '==', taskId),
            where('status', '==', 'reserved')
        );
    } else {
        q = query(
            collection(db, 'inventory_reservations'),
            where('status', '==', 'reserved'),
            orderBy('reservedAt', 'desc')
        );
    }
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryReservation));
}

export async function createReservation(
    data: Omit<InventoryReservation, 'id' | 'reservedAt' | 'status'>
): Promise<string> {
    const ref = await addDoc(collection(db, 'inventory_reservations'), {
        ...data,
        status: 'reserved',
        reservedAt: Timestamp.now(),
    });
    return ref.id;
}

export async function cancelReservation(id: string): Promise<void> {
    await updateDoc(doc(db, 'inventory_reservations', id), {
        status: 'cancelled',
    });
}

export async function issueReservation(id: string): Promise<void> {
    await updateDoc(doc(db, 'inventory_reservations', id), {
        status: 'issued',
        issuedAt: Timestamp.now(),
    });
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

/**
 * Get available stock (total - active reservations)
 */
export async function getAvailableStock(catalogItemId: string, location?: string): Promise<number> {
    const item = await getCatalogItem(catalogItemId);
    if (!item) return 0;

    const stock = location
        ? (item.stockByLocation?.[location] || 0)
        : item.totalStock;

    // Subtract active reservations
    const reservations = await getDocs(
        query(
            collection(db, 'inventory_reservations'),
            where('catalogItemId', '==', catalogItemId),
            where('status', '==', 'reserved')
        )
    );

    const reserved = reservations.docs.reduce((sum, d) => {
        const r = d.data();
        if (!location || r.location === location) {
            return sum + (r.qty || 0);
        }
        return sum;
    }, 0);

    return Math.max(0, stock - reserved);
}

/**
 * Get low-stock items (below minStock threshold)
 */
export async function getLowStockItems(): Promise<InventoryCatalogItem[]> {
    const items = await getCatalogItems();
    return items.filter(item =>
        item.minStock > 0 && item.totalStock <= item.minStock && !item.isTrackable
    );
}

// ═══════════════════════════════════════
// COST UTILITIES
// ═══════════════════════════════════════

/**
 * Calculate materials cost totals (planned, actual).
 * Used by UnifiedCockpitPage handleSave and TaskMaterialsTab stats.
 */
export function calculateMaterialsCost(materials: TaskMaterial[]): {
    planned: number;
    actual: number;
} {
    const planned = materials.reduce((sum, m) => sum + (m.plannedPrice * m.qty), 0);
    const actual = materials.reduce((sum, m) => sum + ((m.actualPrice || m.plannedPrice) * m.qty), 0);
    return { planned, actual };
}

// ═══════════════════════════════════════
// INTEGRITY
// ═══════════════════════════════════════

/**
 * Recalculate stock for a catalog item from transactions (integrity check)
 */
export async function recalculateStock(catalogItemId: string): Promise<void> {
    const txSnap = await getDocs(
        query(
            collection(db, 'inventory_transactions'),
            where('catalogItemId', '==', catalogItemId),
            orderBy('timestamp', 'asc')
        )
    );

    const stockByLocation: Record<string, number> = {};

    txSnap.docs.forEach(d => {
        const tx = d.data() as InventoryTransaction;
        const isInbound = INBOUND_TYPES.includes(tx.type);

        if (isInbound) {
            const loc = tx.toLocation || 'warehouse';
            stockByLocation[loc] = (stockByLocation[loc] || 0) + tx.qty;
        } else {
            const loc = tx.fromLocation || 'warehouse';
            stockByLocation[loc] = Math.max(0, (stockByLocation[loc] || 0) - tx.qty);
            if (tx.type === 'transfer' && tx.toLocation) {
                stockByLocation[tx.toLocation] = (stockByLocation[tx.toLocation] || 0) + tx.qty;
            }
        }
    });

    const totalStock = Object.values(stockByLocation).reduce((sum, v) => sum + v, 0);

    await updateDoc(doc(db, 'inventory_catalog', catalogItemId), {
        stockByLocation,
        totalStock,
        updatedAt: Timestamp.now(),
    });
}
