/**
 * @fileoverview Inventory Module Types
 * 
 * Central type definitions for the inventory/warehouse system.
 * Uses journal-based accounting (transaction log) with cached stock levels.
 */

import { Timestamp } from 'firebase/firestore';

// ═══════════════════════════════════════
// CATALOG
// ═══════════════════════════════════════

export type InventoryCategory = 'materials' | 'tools' | 'consumables' | 'equipment';
export type InventoryUnit = 'шт' | 'кг' | 'л' | 'м' | 'м²' | 'упак' | 'рул';

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
    materials: '🧱 Материалы',
    tools: '🔧 Инструменты',
    consumables: '🧴 Расходники',
    equipment: '⚙️ Оборудование',
};

export const INVENTORY_UNITS: InventoryUnit[] = ['шт', 'кг', 'л', 'м', 'м²', 'упак', 'рул'];

export const INVENTORY_UNIT_LABELS: Record<InventoryUnit, string> = {
    'шт': 'штуки',
    'кг': 'килограммы',
    'л': 'литры',
    'м': 'метры',
    'м²': 'кв. метры',
    'упак': 'упаковки',
    'рул': 'рулоны',
};

export interface InventoryCatalogItem {
    id: string;
    name: string;
    sku?: string;
    category: InventoryCategory;
    unit: InventoryUnit;

    // Pricing
    lastPurchasePrice: number;
    avgPrice: number;
    clientMarkupPercent: number; // default 20%

    // Stock (cache — source of truth is transactions)
    stockByLocation: Record<string, number>;
    totalStock: number;
    minStock: number;

    // Tool tracking
    isTrackable: boolean;
    assignedTo?: string;
    assignedToName?: string;
    assignedAt?: Timestamp;
    condition?: 'good' | 'worn' | 'broken' | 'lost';

    // Meta
    createdAt: Timestamp;
    updatedAt: Timestamp;
    createdBy: string;
    isArchived: boolean;
}

// ═══════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════

export type TransactionType =
    | 'purchase'
    | 'return_in'
    | 'adjustment_in'
    | 'write_off'
    | 'transfer'
    | 'loss'
    | 'adjustment_out'
    | 'tool_issue'
    | 'tool_return';

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
    purchase: '📥 Закупка',
    return_in: '📥 Возврат на склад',
    adjustment_in: '📥 Инвентаризация +',
    write_off: '📤 Списание',
    transfer: '🔄 Перемещение',
    loss: '📤 Утеря/порча',
    adjustment_out: '📤 Инвентаризация −',
    tool_issue: '🔧 Выдача инструмента',
    tool_return: '🔧 Возврат инструмента',
};

export const INBOUND_TYPES: TransactionType[] = ['purchase', 'return_in', 'adjustment_in', 'tool_return'];
export const OUTBOUND_TYPES: TransactionType[] = ['write_off', 'transfer', 'loss', 'adjustment_out', 'tool_issue'];

export interface InventoryTransaction {
    id: string;

    catalogItemId: string;
    catalogItemName: string;
    category: InventoryCategory;

    type: TransactionType;
    qty: number;
    unitPrice: number;
    totalAmount: number;

    fromLocation?: string;
    toLocation?: string;

    // Relations
    relatedTaskId?: string;
    relatedTaskTitle?: string;
    relatedClientId?: string;
    relatedClientName?: string;
    relatedShoppingListId?: string;
    relatedCostId?: string;
    relatedReceiptId?: string;
    relatedEstimateId?: string;

    performedBy: string;
    performedByName: string;
    timestamp: Timestamp;
    note?: string;

    stockAfter: number;
}

// ═══════════════════════════════════════
// LOCATIONS
// ═══════════════════════════════════════

export type LocationType = 'warehouse' | 'vehicle' | 'jobsite';

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
    warehouse: '🏭 Склад',
    vehicle: '🚐 Транспорт',
    jobsite: '🏗️ Объект',
};

export interface InventoryLocation {
    id: string;
    name: string;
    type: LocationType;
    relatedClientId?: string;
    address?: string;
    isActive: boolean;
    createdAt: Timestamp;
}

// ═══════════════════════════════════════
// RESERVATIONS
// ═══════════════════════════════════════

export type ReservationStatus = 'reserved' | 'issued' | 'cancelled';

export interface InventoryReservation {
    id: string;
    catalogItemId: string;
    catalogItemName: string;
    qty: number;
    location: string;

    relatedTaskId: string;
    relatedTaskTitle: string;
    plannedDate?: Timestamp;

    status: ReservationStatus;
    reservedBy: string;
    reservedByName: string;
    reservedAt: Timestamp;
    issuedAt?: Timestamp;
}

// ═══════════════════════════════════════
// TASK MATERIALS (for GTDTask)
// ═══════════════════════════════════════

export type TaskMaterialStatus = 'planned' | 'reserved' | 'issued' | 'need_purchase' | 'purchased';
export type TaskMaterialSource = 'manual' | 'ai' | 'estimate';

export const TASK_MATERIAL_STATUS_LABELS: Record<TaskMaterialStatus, string> = {
    planned: '📋 Запланировано',
    reserved: '📌 Зарезервировано',
    issued: '✅ Выдано',
    need_purchase: '🛒 Нужна закупка',
    purchased: '📦 Куплено',
};

export const TASK_MATERIAL_STATUS_COLORS: Record<TaskMaterialStatus, string> = {
    planned: '#9e9e9e',
    reserved: '#ff9800',
    issued: '#4caf50',
    need_purchase: '#f44336',
    purchased: '#2196f3',
};

export interface TaskMaterial {
    id: string;
    catalogItemId?: string;
    name: string;
    qty: number;
    unit: string;

    plannedPrice: number;
    actualPrice?: number;
    clientPrice?: number;

    status: TaskMaterialStatus;
    source: TaskMaterialSource;

    transactionId?: string;
    reservationId?: string;
    shoppingListId?: string;
}
