/**
 * @fileoverview Shopping Module Types
 * 
 * Central type definitions for the shopping feature.
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Shopping item in a list
 */
export interface ShoppingItem {
    id: string;
    name: string;
    quantity: number;
    unit?: ShoppingUnit;
    isUrgent: boolean;
    completed: boolean;
}

/**
 * Available units for shopping items
 */
export type ShoppingUnit = 'шт' | 'кг' | 'л' | 'м' | 'упак' | 'рул';

/**
 * Shopping list status
 */
export type ShoppingListStatus = 'active' | 'in_progress' | 'completed';

/**
 * Shopping list document
 */
export interface ShoppingList {
    id: string;
    clientId: string;
    clientName: string;
    locationId?: string;
    locationName?: string;
    items: ShoppingItem[];
    status: ShoppingListStatus;
    createdAt: Timestamp;
    createdBy: string;
    updatedAt?: Timestamp;
    assignedTo?: string;
    assignedToName?: string;
}

/**
 * Client for selection
 */
export interface ShoppingClient {
    id: string;
    name: string;
}

/**
 * Statistics for shopping lists
 */
export interface ShoppingStats {
    totalLists: number;
    totalItems: number;
    completedItems: number;
    pendingItems: number;
}
