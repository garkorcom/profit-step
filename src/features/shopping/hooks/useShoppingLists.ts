/**
 * @fileoverview useShoppingLists Hook
 * 
 * Central hook for shopping list management:
 * - Real-time subscription to lists (active or completed)
 * - CRUD operations
 * - Computed statistics
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import { ShoppingList, ShoppingItem, ShoppingStats, ShoppingListStatus } from '../types';
import {
    toggleItemCompleted as toggleItemService,
    updateShoppingItem as updateItemService,
    deleteShoppingItem as deleteItemService,
    addItemsToList as addItemsService,
    updateShoppingListClient as updateClientService,
    completeShoppingList as completeListService,
    assignShoppingList as assignListService,
} from '../services/shoppingService';

interface UseShoppingListsOptions {
    statusFilter?: ShoppingListStatus;
}

interface UseShoppingListsReturn {
    lists: ShoppingList[];
    loading: boolean;
    stats: ShoppingStats;
    // Actions
    toggleItem: (listId: string, itemId: string, currentCompleted: boolean) => Promise<void>;
    updateItem: (listId: string, itemId: string, updates: Partial<ShoppingItem>) => Promise<void>;
    deleteItem: (listId: string, itemId: string) => Promise<void>;
    addItems: (listId: string, items: ShoppingItem[]) => Promise<void>;
    updateClient: (listId: string, clientId: string, clientName: string) => Promise<void>;
    completeList: (listId: string) => Promise<void>;
    assignList: (listId: string, assigneeId: string, assigneeName?: string) => Promise<void>;
}

export function useShoppingLists(options: UseShoppingListsOptions = {}): UseShoppingListsReturn {
    const { statusFilter = 'active' } = options;
    const [lists, setLists] = useState<ShoppingList[]>([]);
    const [loading, setLoading] = useState(true);

    // Real-time subscription based on status filter
    useEffect(() => {
        setLoading(true);

        // Simple query - only filter by status, sort client-side to avoid composite index
        const q = query(
            collection(db, 'shopping_lists'),
            where('status', '==', statusFilter)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs
                .map(d => ({
                    id: d.id,
                    ...d.data()
                } as ShoppingList))
                // Sort by createdAt client-side
                .sort((a, b) => {
                    const aTime = a.createdAt?.toMillis?.() || 0;
                    const bTime = b.createdAt?.toMillis?.() || 0;
                    return bTime - aTime;
                });
            setLists(data);
            setLoading(false);
        }, (error) => {
            console.error('Error subscribing to shopping lists:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [statusFilter]);

    // Computed statistics
    const stats = useMemo<ShoppingStats>(() => {
        const totalItems = lists.reduce((acc, list) => acc + (list.items?.length || 0), 0);
        const completedItems = lists.reduce(
            (acc, list) => acc + (list.items?.filter(i => i.completed)?.length || 0),
            0
        );
        return {
            totalLists: lists.length,
            totalItems,
            completedItems,
            pendingItems: totalItems - completedItems,
        };
    }, [lists]);

    // Actions
    const toggleItem = useCallback(async (listId: string, itemId: string, currentCompleted: boolean) => {
        await toggleItemService(listId, itemId, !currentCompleted);
    }, []);

    const updateItem = useCallback(async (listId: string, itemId: string, updates: Partial<ShoppingItem>) => {
        await updateItemService(listId, itemId, updates);
    }, []);

    const deleteItem = useCallback(async (listId: string, itemId: string) => {
        await deleteItemService(listId, itemId);
    }, []);

    const addItems = useCallback(async (listId: string, items: ShoppingItem[]) => {
        await addItemsService(listId, items);
    }, []);

    const updateClient = useCallback(async (listId: string, clientId: string, clientName: string) => {
        await updateClientService(listId, clientId, clientName);
    }, []);

    const completeList = useCallback(async (listId: string) => {
        await completeListService(listId);
    }, []);

    const assignList = useCallback(async (listId: string, assigneeId: string, assigneeName?: string) => {
        await assignListService(listId, assigneeId, assigneeName);
    }, []);

    return {
        lists,
        loading,
        stats,
        toggleItem,
        updateItem,
        deleteItem,
        addItems,
        updateClient,
        completeList,
        assignList,
    };
}

