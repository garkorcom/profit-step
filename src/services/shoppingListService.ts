/**
 * @fileoverview Shopping List Service
 * 
 * Handles batch saving of shopping lists to Firestore.
 * Features:
 * - Batch items into existing active list (if exists)
 * - Create new list if no active one for location
 * - Support for urgent items
 */

import {
    collection,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    serverTimestamp,
    doc,
    getDoc,
    Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { ShoppingItem } from '../components/gtd/ShoppingListInput';

export interface ShoppingList {
    id: string;
    clientId: string;
    clientName: string;
    locationId?: string;
    locationName?: string;
    items: ShoppingItem[];
    status: 'active' | 'in_progress' | 'completed';
    createdAt: Timestamp;
    createdBy: string;
    updatedAt?: Timestamp;
    assignedTo?: string;
}

/**
 * Get client name by ID
 */
async function getClientName(clientId: string): Promise<string> {
    try {
        const clientDoc = await getDoc(doc(db, 'clients', clientId));
        if (clientDoc.exists()) {
            return clientDoc.data().name || 'Unknown Client';
        }
        return 'Unknown Client';
    } catch (error) {
        console.error('Error fetching client name:', error);
        return 'Unknown Client';
    }
}

/**
 * Save shopping list items - either append to existing or create new
 * 
 * @param clientId - Client ID
 * @param locationId - Optional location ID
 * @param items - Array of shopping items
 * @param userId - User ID who created the list
 * @param clientName - Optional client name (to avoid extra query)
 * @returns Document ID of the shopping list
 */
export async function saveShoppingList(
    clientId: string,
    locationId: string | undefined,
    items: ShoppingItem[],
    userId: string,
    clientName?: string
): Promise<string> {
    // 1. Check for existing active list for this client/location
    const existingQuery = query(
        collection(db, 'shopping_lists'),
        where('clientId', '==', clientId),
        where('status', '==', 'active')
    );

    // Filter by location if provided
    const existingDocs = await getDocs(existingQuery);
    const matchingDoc = existingDocs.docs.find(d => {
        const data = d.data();
        if (locationId) {
            return data.locationId === locationId;
        }
        return !data.locationId; // Match lists without location
    });

    if (matchingDoc) {
        // 2a. Append to existing list
        const existingItems = matchingDoc.data().items || [];

        await updateDoc(matchingDoc.ref, {
            items: [...existingItems, ...items],
            updatedAt: serverTimestamp(),
        });

        console.log(`📝 Appended ${items.length} items to existing shopping list ${matchingDoc.id}`);
        return matchingDoc.id;
    } else {
        // 2b. Create new list
        const resolvedClientName = clientName || await getClientName(clientId);

        const newDoc = await addDoc(collection(db, 'shopping_lists'), {
            clientId,
            clientName: resolvedClientName,
            locationId: locationId || null,
            items,
            status: 'active',
            createdAt: serverTimestamp(),
            createdBy: userId,
        });

        console.log(`🛒 Created new shopping list ${newDoc.id} with ${items.length} items`);
        return newDoc.id;
    }
}

/**
 * Get all active shopping lists for a user
 */
export async function getActiveShoppingLists(userId: string): Promise<ShoppingList[]> {
    const listsQuery = query(
        collection(db, 'shopping_lists'),
        where('status', '==', 'active')
    );

    const snapshot = await getDocs(listsQuery);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as ShoppingList));
}

/**
 * Mark a shopping list as completed
 */
export async function completeShoppingList(listId: string): Promise<void> {
    await updateDoc(doc(db, 'shopping_lists', listId), {
        status: 'completed',
        updatedAt: serverTimestamp(),
    });
}

/**
 * Mark individual item as completed
 */
export async function toggleItemCompleted(
    listId: string,
    itemId: string,
    completed: boolean
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    const listDoc = await getDoc(listRef);

    if (!listDoc.exists()) return;

    const items = listDoc.data().items || [];
    const updatedItems = items.map((item: ShoppingItem) =>
        item.id === itemId
            ? { ...item, completed, completedAt: completed ? new Date() : null }
            : item
    );

    await updateDoc(listRef, {
        items: updatedItems,
        updatedAt: serverTimestamp(),
    });
}
