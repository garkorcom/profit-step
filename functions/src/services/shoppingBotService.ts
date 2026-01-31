/**
 * @fileoverview Shopping Bot Service
 * 
 * Service layer for Telegram bot shopping functionality.
 * Handles list fetching, item toggling, receipt processing.
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';




// Types
export interface ShoppingItem {
    id: string;
    name: string;
    quantity: number;
    unit?: string;
    isUrgent: boolean;
    status: 'pending' | 'selected' | 'bought_pending' | 'bought_verified' | 'unavailable';
    completed: boolean; // Legacy compatibility
    receiptId?: string;
    receiptUrl?: string;
    priceEstimated?: number;
    priceActual?: number;
    selectedBy?: number; // Telegram user ID who selected
}

export interface ShoppingList {
    id: string;
    clientId: string;
    clientName: string;
    items: ShoppingItem[];
    status: 'active' | 'archived';
}

export interface ShoppingListSummary {
    id: string;
    clientName: string;
    pendingCount: number;
}

export interface Receipt {
    id: string;
    uploadedBy: number;
    uploadedByName: string;
    clientId: string;
    clientName: string;
    listId: string;
    photoUrl: string;              // Фото чека
    goodsPhotoUrl?: string;        // Фото товаров (Double Proof)
    createdAt: FieldValue;
    status: 'awaiting_goods_photo' | 'needs_review' | 'approved';
    linkedItemIds: string[];
    totalAmount?: number;

    // === FINANCIAL CONSTRUCTOR (Phase 2) ===
    paymentSource?: 'personal' | 'company_card' | 'cash_advance';
    companyCardId?: string;
    cashAdvanceId?: string;
    changeAmount?: number;
    changeAction?: 'returned' | 'kept_balance' | 'salary_deduct';

    // === ALLOCATION (Phase 3) ===
    costCenter?: 'billable' | 'internal' | 'personal';
    billingStatus?: 'pending' | 'verified' | 'invoiced' | 'paid';
    reimbursementStatus?: 'pending' | 'paid';

    // === ANTI-FRAUD ===
    uploadLocation?: { latitude: number; longitude: number };
    gpsMatch?: boolean;
    flagged?: boolean;
}

/**
 * Get active lists with pending items for bot display
 */
export async function getActiveListsForBot(): Promise<ShoppingListSummary[]> {
    const snapshot = await admin.firestore().collection('shopping_lists')
        .where('status', '==', 'active')
        .get();

    const summaries: ShoppingListSummary[] = [];

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const items = data.items || [];
        const pendingCount = items.filter((i: ShoppingItem) =>
            i.status === 'pending' || i.status === 'selected' || !i.status
        ).length;

        if (pendingCount > 0) {
            summaries.push({
                id: doc.id,
                clientName: data.clientName || 'Без клиента',
                pendingCount,
            });
        }
    });

    return summaries;
}

/**
 * Get all active clients/projects for selection
 */
export async function getAllClientsForSelection(): Promise<{ id: string; name: string }[]> {
    // Determine active clients limit (fetch more to be safe)
    const snapshot = await admin.firestore().collection('clients')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

    const clients: { id: string; name: string }[] = [];
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.status !== 'done') {
            clients.push({ id: doc.id, name: data.name });
        }
    });
    return clients;
}

/**
 * Create a new shopping list for a client/project
 */
export async function createShoppingList(clientId: string, clientName: string): Promise<string> {
    // Check if active list exists
    const snapshot = await admin.firestore().collection('shopping_lists')
        .where('clientId', '==', clientId)
        .where('status', '==', 'active')
        .limit(1)
        .get();

    if (!snapshot.empty) {
        return snapshot.docs[0].id;
    }

    // Create new list
    const listRef = admin.firestore().collection('shopping_lists').doc();
    await listRef.set({
        clientId,
        clientName,
        items: [],
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return listRef.id;
}

/**
 * Alias for createShoppingList - used in Smart Context flow
 * Gets existing active list or creates new one for a client
 */
export const getOrCreateListForClient = createShoppingList;

/**
 * Get list with items for display in bot
 */
export async function getListForDisplay(listId: string): Promise<ShoppingList | null> {
    const doc = await admin.firestore().collection('shopping_lists').doc(listId).get();

    if (!doc.exists) return null;

    const data = doc.data()!;
    return {
        id: doc.id,
        clientId: data.clientId,
        clientName: data.clientName || 'Без клиента',
        items: (data.items || []).map((item: any) => ({
            ...item,
            status: item.status || (item.completed ? 'bought_verified' : 'pending'),
        })),
        status: data.status,
    };
}

/**
 * Toggle item selection with transaction (race condition protection)
 */
export async function toggleItemSelection(
    listId: string,
    itemId: string,
    userId: number
): Promise<{ success: boolean; newStatus: string }> {
    const listRef = admin.firestore().collection('shopping_lists').doc(listId);

    return admin.firestore().runTransaction(async (transaction) => {
        const doc = await transaction.get(listRef);

        if (!doc.exists) {
            return { success: false, newStatus: 'error' };
        }

        const data = doc.data()!;
        const items = data.items || [];
        const itemIndex = items.findIndex((i: ShoppingItem) => i.id === itemId);

        if (itemIndex === -1) {
            return { success: false, newStatus: 'not_found' };
        }

        const item = items[itemIndex];
        const currentStatus = item.status || (item.completed ? 'bought_verified' : 'pending');

        // Can only toggle between pending <-> selected
        if (currentStatus === 'bought_pending' || currentStatus === 'bought_verified') {
            return { success: false, newStatus: currentStatus };
        }

        const newStatus = currentStatus === 'selected' ? 'pending' : 'selected';

        items[itemIndex] = {
            ...item,
            status: newStatus,
            selectedBy: newStatus === 'selected' ? userId : null,
        };

        transaction.update(listRef, {
            items,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true, newStatus };
    });
}

/**
 * Get selected items count for a user
 */
export async function getSelectedItemsCount(listId: string): Promise<number> {
    const list = await getListForDisplay(listId);
    if (!list) return 0;

    return list.items.filter(i => i.status === 'selected').length;
}

/**
 * Process receipt upload - mark selected items as bought
 */
export async function processReceipt(
    listId: string,
    photoUrl: string,
    userId: number,
    userName: string
): Promise<{ success: boolean; boughtItems: string[] }> {
    const listRef = admin.firestore().collection('shopping_lists').doc(listId);

    return admin.firestore().runTransaction(async (transaction) => {
        const doc = await transaction.get(listRef);

        if (!doc.exists) {
            return { success: false, boughtItems: [] };
        }

        const data = doc.data()!;
        const items = data.items || [];

        // Find selected items
        const selectedItems = items.filter((i: ShoppingItem) => i.status === 'selected');

        if (selectedItems.length === 0) {
            return { success: false, boughtItems: [] };
        }

        // Create receipt document (awaiting goods photo for Double Proof)
        const receiptId = nanoid(12);
        const receipt: Receipt = {
            id: receiptId,
            uploadedBy: userId,
            uploadedByName: userName,
            clientId: data.clientId,
            clientName: data.clientName,
            listId: listId,
            photoUrl: photoUrl,
            createdAt: FieldValue.serverTimestamp(),
            status: 'awaiting_goods_photo', // Double Proof: need goods photo
            linkedItemIds: selectedItems.map((i: ShoppingItem) => i.id),
        };

        // Update items to bought_pending
        const boughtItemNames: string[] = [];
        const updatedItems = items.map((item: ShoppingItem) => {
            if (item.status === 'selected') {
                boughtItemNames.push(item.name);
                return {
                    ...item,
                    status: 'bought_pending',
                    receiptId: receiptId,
                    receiptUrl: photoUrl,
                    completed: false, // Will be true after manager approval
                };
            }
            return item;
        });

        // Write receipt
        transaction.set(admin.firestore().collection('receipts').doc(receiptId), receipt);

        // Update list
        transaction.update(listRef, {
            items: updatedItems,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true, boughtItems: boughtItemNames };
    });
}

/**
 * Cancel selection (reset all selected items to pending)
 */
export async function cancelSelection(listId: string, userId: number): Promise<void> {
    const listRef = admin.firestore().collection('shopping_lists').doc(listId);
    const doc = await listRef.get();

    if (!doc.exists) return;

    const data = doc.data()!;
    const items = (data.items || []).map((item: ShoppingItem) => {
        if (item.status === 'selected' && item.selectedBy === userId) {
            return { ...item, status: 'pending', selectedBy: null };
        }
        return item;
    });

    await listRef.update({
        items,
        updatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Add goods photo to receipt (Double Proof Step 2)
 * Updates receipt status from awaiting_goods_photo to needs_review
 */
export async function addGoodsPhoto(
    receiptId: string,
    goodsPhotoUrl: string
): Promise<{ success: boolean; listId?: string }> {
    const receiptRef = admin.firestore().collection('receipts').doc(receiptId);
    const doc = await receiptRef.get();

    if (!doc.exists) {
        return { success: false };
    }

    const data = doc.data()!;

    await receiptRef.update({
        goodsPhotoUrl: goodsPhotoUrl,
        status: 'needs_review', // Double Proof complete, ready for manager review
    });

    return { success: true, listId: data.listId };
}

/**
 * Parse quick add text into shopping items
 * Format: "Название Кол-во Ед !Срочно"
 * Examples:
 *   "Гвозди 5кг" -> { name: "Гвозди", quantity: 5, unit: "кг" }
 *   "Пена монтажная 2 шт !" -> { name: "Пена монтажная", quantity: 2, unit: "шт", isUrgent: true }
 *   "Скотч" -> { name: "Скотч", quantity: 1, isUrgent: false }
 */
export function parseQuickAddText(text: string): Omit<ShoppingItem, 'id'>[] {
    const lines = text.split('\n').filter(line => line.trim());
    const items: Omit<ShoppingItem, 'id'>[] = [];

    for (const line of lines) {
        let trimmed = line.trim();

        // Check for urgent marker
        const isUrgent = trimmed.includes('!');
        trimmed = trimmed.replace(/!/g, '').trim();

        // Try to extract quantity and unit
        // Pattern: number + optional unit (шт, кг, л, м, упак, рул)
        const quantityMatch = trimmed.match(/(\d+)\s*(шт|кг|л|м|упак|рул)?$/i);

        let name = trimmed;
        let quantity = 1;
        let unit: string | undefined;

        if (quantityMatch) {
            quantity = parseInt(quantityMatch[1], 10);
            unit = quantityMatch[2]?.toLowerCase();
            name = trimmed.replace(quantityMatch[0], '').trim();
        }

        if (name) {
            items.push({
                name,
                quantity,
                unit,
                isUrgent,
                status: 'pending',
                completed: false,
            });
        }
    }

    return items;
}

/**
 * Add items to existing list
 */
export async function addItemsToList(
    listId: string,
    items: Omit<ShoppingItem, 'id'>[]
): Promise<void> {
    const listRef = admin.firestore().collection('shopping_lists').doc(listId);
    const doc = await listRef.get();

    if (!doc.exists) return;

    const data = doc.data()!;
    const existingItems = data.items || [];

    const newItems = items.map(item => ({
        ...item,
        id: nanoid(8),
    }));

    await listRef.update({
        items: [...existingItems, ...newItems],
        updatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Build inline keyboard for project list
 */
export function buildProjectListKeyboard(lists: ShoppingListSummary[]): any[][] {
    return lists.map(list => [{
        text: `🏢 ${list.clientName} (${list.pendingCount})`,
        callback_data: `shop:list:${list.id}`,
    }]);
}

/**
 * Build inline keyboard for item list with checkboxes
 */
export function buildItemListKeyboard(list: ShoppingList): any[][] {
    const keyboard: any[][] = [];

    // Item buttons
    for (const item of list.items) {
        const status = item.status || (item.completed ? 'bought_verified' : 'pending');

        let emoji: string;
        let text: string;
        let disabled = false;

        switch (status) {
            case 'pending':
                emoji = '⬜';
                text = `${emoji} ${item.name} (${item.quantity}${item.unit ? ' ' + item.unit : ''})`;
                break;
            case 'selected':
                emoji = '☑️';
                text = `${emoji} ${item.name} (${item.quantity}${item.unit ? ' ' + item.unit : ''})`;
                break;
            case 'bought_pending':
            case 'bought_verified':
                emoji = '✅';
                text = `${emoji} <s>${item.name}</s>`;
                disabled = true;
                break;
            case 'unavailable':
                emoji = '❌';
                text = `${emoji} ${item.name}`;
                disabled = true;
                break;
            default:
                emoji = '⬜';
                text = `${emoji} ${item.name}`;
        }

        if (item.isUrgent && status === 'pending') {
            text += ' ❗️';
        }

        keyboard.push([{
            text,
            callback_data: disabled ? 'shop:noop' : `shop:toggle:${list.id}:${item.id}`,
        }]);
    }

    // Action buttons
    const selectedCount = list.items.filter(i => i.status === 'selected').length;

    if (selectedCount > 0) {
        keyboard.push([{
            text: `📸 Закрыть чеком (${selectedCount})`,
            callback_data: `shop:receipt:${list.id}`,
        }]);
    }

    keyboard.push([
        { text: '➕ Добавить', callback_data: `shop:add:${list.id}` },
        { text: '⬅️ Назад', callback_data: 'shop:back' },
    ]);

    return keyboard;
}
