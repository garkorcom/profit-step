/**
 * @fileoverview Shopping Service
 * 
 * Firestore operations for shopping lists.
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
    deleteDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import { ShoppingList, ShoppingItem } from '../types';

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
        console.error('Error getting client name:', error);
        return 'Unknown Client';
    }
}

/**
 * Save or append to a shopping list
 */
export async function saveShoppingList(
    items: ShoppingItem[],
    clientId: string,
    userId: string,
    locationId?: string,
    locationName?: string
): Promise<string> {
    // Check if there's an active list for this client
    const q = query(
        collection(db, 'shopping_lists'),
        where('clientId', '==', clientId),
        where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);

    const clientName = await getClientName(clientId);

    if (!snapshot.empty) {
        // Append to existing list
        const existingList = snapshot.docs[0];
        const existingItems = existingList.data().items || [];

        await updateDoc(existingList.ref, {
            items: [...existingItems, ...items],
            updatedAt: serverTimestamp(),
        });
        return existingList.id;
    } else {
        // Create new list
        const docRef = await addDoc(collection(db, 'shopping_lists'), {
            clientId,
            clientName,
            locationId: locationId || null,
            locationName: locationName || null,
            items,
            status: 'active',
            createdAt: serverTimestamp(),
            createdBy: userId,
        });
        return docRef.id;
    }
}

/**
 * Get all active shopping lists
 */
export async function getActiveShoppingLists(): Promise<ShoppingList[]> {
    const q = query(
        collection(db, 'shopping_lists'),
        where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
    } as ShoppingList));
}

/**
 * Toggle item completion
 */
export async function toggleItemCompleted(
    listId: string,
    itemId: string,
    completed: boolean
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    const listDoc = await getDoc(listRef);

    if (!listDoc.exists()) return;

    const items = listDoc.data().items.map((item: ShoppingItem) =>
        item.id === itemId ? { ...item, completed } : item
    );

    await updateDoc(listRef, {
        items,
        updatedAt: serverTimestamp(),
    });

    // Check if all items completed
    const allCompleted = items.every((i: ShoppingItem) => i.completed);
    if (allCompleted) {
        await updateDoc(listRef, { status: 'completed' });
    }
}

/**
 * Update a shopping item
 */
export async function updateShoppingItem(
    listId: string,
    itemId: string,
    updates: Partial<ShoppingItem>
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    const listDoc = await getDoc(listRef);

    if (!listDoc.exists()) return;

    const items = listDoc.data().items.map((item: ShoppingItem) =>
        item.id === itemId ? { ...item, ...updates } : item
    );

    await updateDoc(listRef, {
        items,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Delete a shopping item
 */
export async function deleteShoppingItem(
    listId: string,
    itemId: string
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    const listDoc = await getDoc(listRef);

    if (!listDoc.exists()) return;

    const items = listDoc.data().items.filter(
        (item: ShoppingItem) => item.id !== itemId
    );

    if (items.length === 0) {
        await deleteDoc(listRef);
    } else {
        await updateDoc(listRef, {
            items,
            updatedAt: serverTimestamp(),
        });
    }
}

/**
 * Add items to an existing shopping list
 */
export async function addItemsToList(
    listId: string,
    newItems: ShoppingItem[]
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    const listDoc = await getDoc(listRef);

    if (!listDoc.exists()) return;

    const existingItems = listDoc.data().items || [];

    await updateDoc(listRef, {
        items: [...existingItems, ...newItems],
        updatedAt: serverTimestamp(),
    });
}

/**
 * Update shopping list client
 */
export async function updateShoppingListClient(
    listId: string,
    clientId: string,
    clientName: string
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);

    await updateDoc(listRef, {
        clientId,
        clientName,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Mark list as completed
 */
export async function completeShoppingList(listId: string): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    await updateDoc(listRef, {
        status: 'completed',
        updatedAt: serverTimestamp(),
    });
}

/**
 * Archive a shopping list
 */
export async function archiveShoppingList(listId: string): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    await deleteDoc(listRef);
}

/**
 * Assign a shopping list to an employee
 */
export async function assignShoppingList(
    listId: string,
    assigneeId: string,
    assigneeName?: string
): Promise<void> {
    const listRef = doc(db, 'shopping_lists', listId);
    await updateDoc(listRef, {
        assignedTo: assigneeId,
        assignedToName: assigneeName || null,
        status: 'in_progress',
        updatedAt: serverTimestamp(),
    });
}

