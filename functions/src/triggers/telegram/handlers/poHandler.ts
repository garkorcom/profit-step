/**
 * PO (Podotchet / Advance Accounts) Handler for Worker Telegram Bot.
 *
 * Allows workers to manage advance accounts directly from Telegram:
 *   - View PO balance and open advances
 *   - Report expenses with photo receipts
 *   - Return unused cash
 *   - View transaction history
 *
 * Spec: docs/tasks/telegram-po-commands-spec.md
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import axios from 'axios';
import * as crypto from 'crypto';
import { sendMessage, findPlatformUser } from '../telegramUtils';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '';

// ─── Types ──────────────────────────────────────────────────────────

interface BotPOState {
    chatId: number;
    userId: number;
    flow: 'expense' | 'return';
    step: 'select_advance' | 'enter_amount' | 'enter_description' | 'upload_receipt' | 'select_category' | 'confirm';
    advanceId?: string;
    advanceName?: string;
    remaining?: number;
    amount?: number;
    description?: string;
    receiptFileId?: string;
    receiptUrl?: string;
    category?: string;
    createdAt: FirebaseFirestore.Timestamp;
    expiresAt: FirebaseFirestore.Timestamp;
}

interface AdvanceDoc {
    id: string;
    employeeId: string;
    employeeName: string;
    projectId?: string;
    projectName?: string;
    amount: number;
    status: string;
    description: string;
    issuedAt: FirebaseFirestore.Timestamp;
}

interface TxDoc {
    id: string;
    advanceId: string;
    employeeId: string;
    employeeName: string;
    type: string;
    amount: number;
    category?: string;
    description: string;
    hasReceipt: boolean;
    receiptUrl?: string;
    status: string;
    createdAt: FirebaseFirestore.Timestamp;
    source?: string;
}

// Cost categories matching CRM (src/types/finance.types.ts)
const EXPENSE_CATEGORIES = [
    { id: 'materials', label: '🧱 Materials', emoji: '🧱' },
    { id: 'tools', label: '🔧 Tools', emoji: '🔧' },
    { id: 'fuel', label: '⛽ Fuel', emoji: '⛽' },
    { id: 'food', label: '🍔 Food', emoji: '🍔' },
    { id: 'other', label: '📦 Other', emoji: '📦' },
];

// ─── State Management ───────────────────────────────────────────────

async function getPOState(chatId: number): Promise<BotPOState | null> {
    try {
        const doc = await db.collection('bot_po_state').doc(String(chatId)).get();
        if (!doc.exists) return null;
        const data = doc.data() as BotPOState;
        // Check expiry (1 hour TTL)
        if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
            await clearPOState(chatId);
            return null;
        }
        return data;
    } catch (err) {
        logger.error('getPOState error', err);
        return null;
    }
}

async function setPOState(chatId: number, state: Partial<BotPOState>): Promise<void> {
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 60 * 1000); // +1 hour
    await db.collection('bot_po_state').doc(String(chatId)).set({
        ...state,
        chatId,
        createdAt: now,
        expiresAt,
    }, { merge: true });
}

async function clearPOState(chatId: number): Promise<void> {
    try {
        await db.collection('bot_po_state').doc(String(chatId)).delete();
    } catch (_) { /* ignore */ }
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Build cross-ID search array (Telegram numeric ID + string + Firebase UID) */
async function buildSearchIds(userId: number): Promise<(string | number)[]> {
    const ids: (string | number)[] = [userId, String(userId)];
    const platformUser = await findPlatformUser(userId);
    if (platformUser) ids.push(platformUser.id);
    return ids;
}

/** Resolve employee name from platform user or employees collection */
async function resolveEmployeeName(userId: number): Promise<string> {
    try {
        const platformUser = await findPlatformUser(userId);
        if (platformUser?.name) return platformUser.name;
        if (platformUser?.displayName) return platformUser.displayName;
        const empDoc = await db.collection('employees').doc(String(userId)).get();
        if (empDoc.exists) return empDoc.data()?.name || 'Worker';
    } catch (_) { /* ignore */ }
    return 'Worker';
}

/** Get open advances + transactions for a user */
async function getOpenAdvances(userId: number): Promise<{ advances: AdvanceDoc[]; transactions: TxDoc[] }> {
    const searchIds = await buildSearchIds(userId);

    const advSnap = await db.collection('advance_accounts')
        .where('employeeId', 'in', searchIds)
        .where('status', '==', 'open')
        .get();

    if (advSnap.empty) return { advances: [], transactions: [] };

    const advances: AdvanceDoc[] = advSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
    } as AdvanceDoc));

    const txSnap = await db.collection('advance_transactions')
        .where('employeeId', 'in', searchIds)
        .where('status', '==', 'active')
        .get();

    const transactions: TxDoc[] = txSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
    } as TxDoc));

    return { advances, transactions };
}

/** Compute remaining balance for a single advance */
function computeBalance(advance: AdvanceDoc, transactions: TxDoc[]): number {
    const spent = transactions
        .filter(tx => tx.advanceId === advance.id)
        .reduce((sum, tx) => sum + tx.amount, 0);
    return Math.round((advance.amount - spent) * 100) / 100;
}

/** Format date from Firestore Timestamp */
function formatDate(ts: FirebaseFirestore.Timestamp | undefined): string {
    if (!ts || !ts.toDate) return '—';
    const d = ts.toDate();
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Send admin group notification (fire-and-forget) */
async function notifyAdmin(text: string): Promise<void> {
    if (!ADMIN_GROUP_ID) return;
    try {
        await sendMessage(Number(ADMIN_GROUP_ID), text);
    } catch (err) {
        logger.error('PO admin notification failed', err);
    }
}

/** Send photo to admin group with caption */
async function sendAdminPhoto(photoFileId: string, caption: string): Promise<void> {
    if (!ADMIN_GROUP_ID || !WORKER_BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendPhoto`, {
            chat_id: Number(ADMIN_GROUP_ID),
            photo: photoFileId,
            caption,
            parse_mode: 'Markdown',
        });
    } catch (err) {
        logger.error('PO admin photo notification failed', err);
    }
}

/** Upload Telegram file to Firebase Storage. Returns download URL or null. */
async function uploadReceiptFile(fileId: string, advanceId: string, txId: string): Promise<string | null> {
    if (!WORKER_BOT_TOKEN) return null;
    try {
        const fileRes = await axios.get(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${fileId}`);
        const filePath = fileRes.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`;

        const response = await axios({ url: fileUrl, method: 'GET', responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
        let contentType = 'image/jpeg';
        if (ext === 'png') contentType = 'image/png';

        const bucket = admin.storage().bucket();
        const destPath = `advance_receipts/${advanceId}/${txId}.${ext}`;
        const file = bucket.file(destPath);
        const token = crypto.randomUUID();

        await file.save(buffer, {
            contentType,
            metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        });

        const encodedName = encodeURIComponent(destPath);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedName}?alt=media&token=${token}`;
    } catch (err) {
        logger.error('Receipt upload failed', err);
        return null;
    }
}

// ─── Public Exports ─────────────────────────────────────────────────

/**
 * Handle /po command or "PO / Avansы" menu button press.
 * Shows PO overview with balances and action buttons.
 */
export async function handlePOCommand(chatId: number, userId: number): Promise<void> {
    try {
        // Clear any lingering PO state
        await clearPOState(chatId);

        const { advances, transactions } = await getOpenAdvances(userId);

        if (advances.length === 0) {
            await sendMessage(chatId, `📦 *Авансовые счета*\n\nУ вас нет открытых авансов.\nЕсли вам нужен аванс на материалы — обратитесь к руководителю.`, {
                inline_keyboard: [[{ text: '❌ Закрыть', callback_data: 'po_close' }]],
            });
            return;
        }

        // Build overview message
        let totalBalance = 0;
        let advanceLines = '';

        advances.forEach((adv, idx) => {
            const remaining = computeBalance(adv, transactions);
            totalBalance += remaining;
            const spent = Math.round((adv.amount - remaining) * 100) / 100;
            const name = adv.projectName || adv.description || `Advance #${idx + 1}`;

            advanceLines += `\n${idx + 1}️⃣ *${name}* — $${remaining} из $${adv.amount}`;
            advanceLines += `\n   📅 Выдан: ${formatDate(adv.issuedAt)}`;
            advanceLines += `\n   ⚡ Потрачено: $${spent}\n`;
        });

        totalBalance = Math.round(totalBalance * 100) / 100;

        const msg = `📦 *Авансовые счета*\n\n💰 Общий баланс ПО: *$${totalBalance.toFixed(2)}*\n📋 Открытых авансов: ${advances.length}\n${advanceLines}`;

        await sendMessage(chatId, msg, {
            inline_keyboard: [
                [
                    { text: '📸 Отчёт о расходе', callback_data: 'po_expense' },
                    { text: '💵 Вернуть', callback_data: 'po_return' },
                ],
                [
                    { text: '🔍 История', callback_data: 'po_history' },
                    { text: '❌ Закрыть', callback_data: 'po_close' },
                ],
            ],
        });
    } catch (err) {
        logger.error('handlePOCommand error', err);
        await sendMessage(chatId, '⚠️ Произошла ошибка. Попробуйте ещё раз: /po');
    }
}

/**
 * Handle all PO-related callback queries (po_*).
 */
export async function handlePOCallback(chatId: number, userId: number, data: string, messageId: number): Promise<void> {
    try {
        // ─── Close ────────────────────────────────────
        if (data === 'po_close') {
            await clearPOState(chatId);
            try {
                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/deleteMessage`, {
                    chat_id: chatId,
                    message_id: messageId,
                });
            } catch (_) { /* ignore if delete fails */ }
            return;
        }

        // ─── Back to overview ────────────────────────────
        if (data === 'po_back_to_overview') {
            await clearPOState(chatId);
            await handlePOCommand(chatId, userId);
            return;
        }

        // ─── Start expense flow ──────────────────────────
        if (data === 'po_expense') {
            await startExpenseFlow(chatId, userId);
            return;
        }

        // ─── Start return flow ───────────────────────────
        if (data === 'po_return') {
            await startReturnFlow(chatId, userId);
            return;
        }

        // ─── History ─────────────────────────────────────
        if (data === 'po_history') {
            await showHistory(chatId, userId);
            return;
        }

        // ─── Select advance (expense) ───────────────────
        if (data.startsWith('po_expense_adv_')) {
            const advanceId = data.replace('po_expense_adv_', '');
            await handleAdvanceSelected(chatId, userId, advanceId, 'expense');
            return;
        }

        // ─── Select advance (return) ────────────────────
        if (data.startsWith('po_return_adv_')) {
            const advanceId = data.replace('po_return_adv_', '');
            await handleAdvanceSelected(chatId, userId, advanceId, 'return');
            return;
        }

        // ─── No receipt ─────────────────────────────────
        if (data === 'po_expense_no_receipt') {
            await handleNoReceipt(chatId, userId);
            return;
        }

        // ─── Category selection ─────────────────────────
        if (data.startsWith('po_expense_cat_')) {
            const category = data.replace('po_expense_cat_', '');
            await handleCategorySelected(chatId, userId, category);
            return;
        }

        // ─── Confirm ────────────────────────────────────
        if (data === 'po_expense_confirm') {
            await handleExpenseConfirm(chatId, userId);
            return;
        }

        if (data === 'po_return_confirm') {
            await handleReturnConfirm(chatId, userId);
            return;
        }

        // ─── Cancel ─────────────────────────────────────
        if (data === 'po_expense_cancel' || data === 'po_return_cancel') {
            await clearPOState(chatId);
            await sendMessage(chatId, '❌ Операция отменена.');
            await handlePOCommand(chatId, userId);
            return;
        }

    } catch (err) {
        logger.error('handlePOCallback error', { data, err: String(err) });
        await clearPOState(chatId);
        await sendMessage(chatId, '⚠️ Произошла ошибка. Попробуйте ещё раз: /po');
    }
}

/**
 * Handle text/photo messages during an active PO flow.
 * Called from onWorkerBotMessage.ts when PO state exists.
 */
export async function handlePOFlowMessage(
    chatId: number,
    userId: number,
    text: string | undefined,
    message: any,
    state: BotPOState
): Promise<void> {
    try {
        // ─── Cancel commands always work ─────────────────
        if (text === '/start' || text === '/menu' || text === '/po') {
            await clearPOState(chatId);
            if (text === '/po') {
                await handlePOCommand(chatId, userId);
            }
            // /start and /menu will be handled by main router after we return
            // but we already cleared state, so just return if /po
            if (text === '/po') return;
            // For /start and /menu, let the main handler process them
            // This is handled by the caller checking if we consumed the message
            return;
        }

        if (text === '❌ Cancel' || text === '/cancel') {
            await clearPOState(chatId);
            await sendMessage(chatId, '❌ Операция отменена.');
            await handlePOCommand(chatId, userId);
            return;
        }

        // ─── Route by step ──────────────────────────────
        const step = state.step;

        if (step === 'enter_amount') {
            await handleAmountInput(chatId, userId, text || '', state);
            return;
        }

        if (step === 'enter_description') {
            await handleDescriptionInput(chatId, userId, text || '', state);
            return;
        }

        if (step === 'upload_receipt') {
            // Check for photo
            if (message.photo && message.photo.length > 0) {
                const largestPhoto = message.photo[message.photo.length - 1];
                await handleReceiptPhoto(chatId, userId, largestPhoto.file_id, state);
                return;
            }
            // Text input during receipt step → skip receipt
            await handleNoReceipt(chatId, userId);
            return;
        }

        // Unexpected input
        await sendMessage(chatId, '⚠️ Используйте кнопки для навигации или /po для начала заново.');

    } catch (err) {
        logger.error('handlePOFlowMessage error', { step: state.step, err: String(err) });
        await clearPOState(chatId);
        await sendMessage(chatId, '⚠️ Произошла ошибка. Начните заново: /po');
    }
}

/**
 * Check if a PO flow is active for this chat.
 * Used by onWorkerBotMessage.ts to intercept messages.
 */
export { getPOState };

// ─── Flow: Expense Report ───────────────────────────────────────────

async function startExpenseFlow(chatId: number, userId: number): Promise<void> {
    const { advances, transactions } = await getOpenAdvances(userId);

    if (advances.length === 0) {
        await sendMessage(chatId, '📦 У вас нет открытых авансов.');
        return;
    }

    // If only one advance, skip selection
    if (advances.length === 1) {
        await handleAdvanceSelected(chatId, userId, advances[0].id, 'expense');
        return;
    }

    // Multiple advances — show selection
    const buttons = advances.map(adv => {
        const remaining = computeBalance(adv, transactions);
        const name = adv.projectName || adv.description || 'Advance';
        return [{ text: `${name} — $${remaining} осталось`, callback_data: `po_expense_adv_${adv.id}` }];
    });
    buttons.push([{ text: '❌ Отмена', callback_data: 'po_expense_cancel' }]);

    await sendMessage(chatId, '📸 *Отчёт о расходе*\n\nВыберите аванс:', {
        inline_keyboard: buttons,
    });
}

async function startReturnFlow(chatId: number, userId: number): Promise<void> {
    const { advances, transactions } = await getOpenAdvances(userId);

    if (advances.length === 0) {
        await sendMessage(chatId, '📦 У вас нет открытых авансов.');
        return;
    }

    if (advances.length === 1) {
        await handleAdvanceSelected(chatId, userId, advances[0].id, 'return');
        return;
    }

    const buttons = advances.map(adv => {
        const remaining = computeBalance(adv, transactions);
        const name = adv.projectName || adv.description || 'Advance';
        return [{ text: `${name} — $${remaining} осталось`, callback_data: `po_return_adv_${adv.id}` }];
    });
    buttons.push([{ text: '❌ Отмена', callback_data: 'po_return_cancel' }]);

    await sendMessage(chatId, '💵 *Возврат средств*\n\nВыберите аванс:', {
        inline_keyboard: buttons,
    });
}

async function handleAdvanceSelected(chatId: number, userId: number, advanceId: string, flow: 'expense' | 'return'): Promise<void> {
    const { advances, transactions } = await getOpenAdvances(userId);
    const advance = advances.find(a => a.id === advanceId);

    if (!advance) {
        await sendMessage(chatId, '⚠️ Аванс не найден. Попробуйте /po');
        return;
    }

    const remaining = computeBalance(advance, transactions);
    const name = advance.projectName || advance.description || 'Advance';

    await setPOState(chatId, {
        userId,
        flow,
        step: 'enter_amount',
        advanceId: advance.id,
        advanceName: name,
        remaining,
    });

    if (flow === 'expense') {
        await sendMessage(chatId, `💵 *Сумма расхода*\n\nАванс: ${name} ($${remaining} осталось)\nВведите сумму в долларах (например: 150 или 150.50):`);
    } else {
        await sendMessage(chatId, `💵 *Возврат средств*\n\nАванс: ${name} ($${remaining} осталось)\nВведите сумму возврата:`);
    }
}

async function handleAmountInput(chatId: number, userId: number, text: string, state: BotPOState): Promise<void> {
    const amount = parseFloat(text.replace(',', '.').replace('$', '').trim());

    if (isNaN(amount) || amount <= 0) {
        await sendMessage(chatId, '⚠️ Введите числовую сумму, например: 150 или 150.50');
        return;
    }

    const remaining = state.remaining || 0;

    if (state.flow === 'return') {
        // Return cannot exceed balance
        if (amount > remaining) {
            await sendMessage(chatId, `⚠️ Сумма возврата не может превышать остаток ($${remaining}). Введите сумму заново:`);
            return;
        }

        // Return flow: skip description/receipt/category → go to confirm
        const newRemaining = Math.round((remaining - amount) * 100) / 100;
        await setPOState(chatId, {
            ...state,
            amount,
            step: 'confirm',
        });

        await sendMessage(chatId, `✅ *Подтверждение возврата*\n\n📋 Аванс: ${state.advanceName}\n💵 Возврат: $${amount.toFixed(2)}\nОстаток после возврата: $${newRemaining.toFixed(2)}\n\nПодтвердить?`, {
            inline_keyboard: [
                [
                    { text: '✅ Подтвердить', callback_data: 'po_return_confirm' },
                    { text: '❌ Отмена', callback_data: 'po_return_cancel' },
                ],
            ],
        });
        return;
    }

    // Expense flow: warn if overspend but allow
    if (amount > remaining) {
        await sendMessage(chatId, `⚠️ Внимание: сумма ($${amount}) превышает остаток ($${remaining}). Расход будет записан.`);
    }

    await setPOState(chatId, {
        ...state,
        amount,
        step: 'enter_description',
    });

    await sendMessage(chatId, `📝 *Описание*\n\nЧто купили? Например:\n• Drywall sheets 20 pcs\n• Screws and anchors at Home Depot`);
}

async function handleDescriptionInput(chatId: number, userId: number, text: string, state: BotPOState): Promise<void> {
    if (!text || text.trim().length < 2) {
        await sendMessage(chatId, '⚠️ Введите описание (минимум 2 символа):');
        return;
    }

    await setPOState(chatId, {
        ...state,
        description: text.trim().slice(0, 500),
        step: 'upload_receipt',
    });

    await sendMessage(chatId, '📷 *Чек / Receipt*\n\nОтправьте фото чека или нажмите "Без чека":', {
        inline_keyboard: [[{ text: '📷 Без чека', callback_data: 'po_expense_no_receipt' }]],
    });
}

async function handleReceiptPhoto(chatId: number, userId: number, fileId: string, state: BotPOState): Promise<void> {
    await setPOState(chatId, {
        ...state,
        receiptFileId: fileId,
        step: 'select_category',
    });

    await sendCategoryPicker(chatId);
}

async function handleNoReceipt(chatId: number, userId: number): Promise<void> {
    const state = await getPOState(chatId);
    if (!state) {
        await sendMessage(chatId, '⚠️ Сессия истекла. Начните заново: /po');
        return;
    }

    await setPOState(chatId, {
        ...state,
        receiptFileId: undefined,
        step: 'select_category',
    });

    await sendCategoryPicker(chatId);
}

async function sendCategoryPicker(chatId: number): Promise<void> {
    const buttons: any[][] = [];
    // 2 buttons per row
    for (let i = 0; i < EXPENSE_CATEGORIES.length; i += 2) {
        const row = [{ text: EXPENSE_CATEGORIES[i].label, callback_data: `po_expense_cat_${EXPENSE_CATEGORIES[i].id}` }];
        if (i + 1 < EXPENSE_CATEGORIES.length) {
            row.push({ text: EXPENSE_CATEGORIES[i + 1].label, callback_data: `po_expense_cat_${EXPENSE_CATEGORIES[i + 1].id}` });
        }
        buttons.push(row);
    }

    await sendMessage(chatId, '🏷 *Категория*\n\nВыберите категорию:', {
        inline_keyboard: buttons,
    });
}

async function handleCategorySelected(chatId: number, userId: number, category: string): Promise<void> {
    const state = await getPOState(chatId);
    if (!state || state.flow !== 'expense') {
        await sendMessage(chatId, '⚠️ Сессия истекла. Начните заново: /po');
        return;
    }

    await setPOState(chatId, {
        ...state,
        category,
        step: 'confirm',
    });

    const catLabel = EXPENSE_CATEGORIES.find(c => c.id === category)?.label || category;
    const receiptStatus = state.receiptFileId ? '✅ Приложен' : '❌ Нет';

    await sendMessage(chatId, `✅ *Подтверждение расхода*\n\n📋 Аванс: ${state.advanceName}\n💵 Сумма: $${(state.amount || 0).toFixed(2)}\n📝 ${state.description}\n🏷 ${catLabel}\n📷 Чек: ${receiptStatus}\n\nВсё верно?`, {
        inline_keyboard: [
            [
                { text: '✅ Подтвердить', callback_data: 'po_expense_confirm' },
                { text: '❌ Отмена', callback_data: 'po_expense_cancel' },
            ],
        ],
    });
}

// ─── Confirm & Save ─────────────────────────────────────────────────

async function handleExpenseConfirm(chatId: number, userId: number): Promise<void> {
    const state = await getPOState(chatId);
    if (!state || state.flow !== 'expense' || state.step !== 'confirm') {
        await sendMessage(chatId, '⚠️ Сессия истекла. Начните заново: /po');
        return;
    }

    const employeeName = await resolveEmployeeName(userId);
    const platformUser = await findPlatformUser(userId);

    // Create transaction document
    const txRef = db.collection('advance_transactions').doc();
    const txData: Record<string, any> = {
        advanceId: state.advanceId,
        employeeId: platformUser?.id || String(userId),
        employeeName,
        type: 'expense_report',
        amount: state.amount,
        description: state.description || '',
        category: state.category || 'other',
        hasReceipt: !!state.receiptFileId,
        receiptUrl: null,
        createdBy: platformUser?.id || String(userId),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        source: 'telegram_bot',
    };

    // Upload receipt if present
    if (state.receiptFileId) {
        const receiptUrl = await uploadReceiptFile(state.receiptFileId, state.advanceId!, txRef.id);
        if (receiptUrl) {
            txData.receiptUrl = receiptUrl;
        } else {
            // Receipt upload failed — still record expense but warn
            txData.hasReceipt = false;
        }
    }

    await txRef.set(txData);

    // Check if advance should auto-settle (balance = 0)
    const advDoc = await db.collection('advance_accounts').doc(state.advanceId!).get();
    if (advDoc.exists) {
        const advData = advDoc.data()!;
        const txSnap = await db.collection('advance_transactions')
            .where('advanceId', '==', state.advanceId)
            .where('status', '==', 'active')
            .get();
        const totalSpent = txSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        const newBalance = Math.round((advData.amount - totalSpent) * 100) / 100;

        if (newBalance <= 0) {
            await db.collection('advance_accounts').doc(state.advanceId!).update({
                status: 'settled',
                settledAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Notify admin about auto-settle
            notifyAdmin(`✅ *PO Закрыт:* ${employeeName} — ${state.advanceName} (баланс $0)`).catch(() => {});
        }

        // Send confirmation to user
        const remaining = Math.max(0, newBalance);
        await sendMessage(chatId, `✅ *Расход записан!*\n\n$${(state.amount || 0).toFixed(2)} — ${state.description}\nОстаток по авансу: $${remaining.toFixed(2)}`);

        // Notify admin
        const receiptIcon = txData.hasReceipt ? '✅' : '❌';
        const adminMsg = `📦 *PO Расход*\n👤 ${employeeName}\n💵 $${(state.amount || 0).toFixed(2)} — ${state.description}\n📋 ${state.advanceName} ($${remaining.toFixed(2)} осталось)\n📷 Чек: ${receiptIcon}`;

        if (state.receiptFileId && txData.hasReceipt) {
            sendAdminPhoto(state.receiptFileId, adminMsg).catch(() => {});
        } else {
            notifyAdmin(adminMsg).catch(() => {});
        }
    } else {
        await sendMessage(chatId, '✅ *Расход записан!*');
    }

    await clearPOState(chatId);
}

async function handleReturnConfirm(chatId: number, userId: number): Promise<void> {
    const state = await getPOState(chatId);
    if (!state || state.flow !== 'return' || state.step !== 'confirm') {
        await sendMessage(chatId, '⚠️ Сессия истекла. Начните заново: /po');
        return;
    }

    const employeeName = await resolveEmployeeName(userId);
    const platformUser = await findPlatformUser(userId);

    // Create return transaction
    await db.collection('advance_transactions').add({
        advanceId: state.advanceId,
        employeeId: platformUser?.id || String(userId),
        employeeName,
        type: 'return',
        amount: state.amount,
        description: `Возврат $${(state.amount || 0).toFixed(2)}`,
        hasReceipt: false,
        createdBy: platformUser?.id || String(userId),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        source: 'telegram_bot',
    });

    // Check auto-settle
    const advDoc = await db.collection('advance_accounts').doc(state.advanceId!).get();
    let remaining = 0;
    if (advDoc.exists) {
        const advData = advDoc.data()!;
        const txSnap = await db.collection('advance_transactions')
            .where('advanceId', '==', state.advanceId)
            .where('status', '==', 'active')
            .get();
        const totalSpent = txSnap.docs.reduce((s, d) => s + (d.data().amount || 0), 0);
        remaining = Math.round((advData.amount - totalSpent) * 100) / 100;

        if (remaining <= 0) {
            await db.collection('advance_accounts').doc(state.advanceId!).update({
                status: 'settled',
                settledAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            notifyAdmin(`✅ *PO Закрыт:* ${employeeName} — ${state.advanceName} (баланс $0)`).catch(() => {});
        }
    }

    await sendMessage(chatId, `✅ *Возврат записан!*\n\n$${(state.amount || 0).toFixed(2)} возвращено\nОстаток по авансу: $${Math.max(0, remaining).toFixed(2)}`);

    notifyAdmin(`💵 *PO Возврат*\n👤 ${employeeName}\n💵 $${(state.amount || 0).toFixed(2)} возвращено\n📋 ${state.advanceName} ($${Math.max(0, remaining).toFixed(2)} осталось)`).catch(() => {});

    await clearPOState(chatId);
}

// ─── History ────────────────────────────────────────────────────────

async function showHistory(chatId: number, userId: number): Promise<void> {
    const searchIds = await buildSearchIds(userId);

    // Get last 10 transactions across all advances
    const txSnap = await db.collection('advance_transactions')
        .where('employeeId', 'in', searchIds)
        .where('status', '==', 'active')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

    if (txSnap.empty) {
        await sendMessage(chatId, '📜 *История операций PO*\n\nОпераций пока нет.', {
            inline_keyboard: [[{ text: '⬅️ Назад к авансам', callback_data: 'po_back_to_overview' }]],
        });
        return;
    }

    // Load advance names for display
    const advanceIds = [...new Set(txSnap.docs.map(d => d.data().advanceId))];
    const advanceDocs = await Promise.all(
        advanceIds.map(id => db.collection('advance_accounts').doc(id).get())
    );
    const advanceNames: Record<string, string> = {};
    advanceDocs.forEach(d => {
        if (d.exists) {
            const data = d.data()!;
            advanceNames[d.id] = data.projectName || data.description || 'Advance';
        }
    });

    let lines = '';
    txSnap.docs.forEach((d, idx) => {
        const tx = d.data();
        const typeEmoji = tx.type === 'expense_report' ? '📸' : tx.type === 'return' ? '💵' : '📝';
        const advName = advanceNames[tx.advanceId] || 'Advance';
        const desc = tx.type === 'return' ? 'Возврат' : (tx.description || '—');
        const catEmoji = EXPENSE_CATEGORIES.find(c => c.id === tx.category)?.emoji || '';
        const dateStr = tx.createdAt ? formatDate(tx.createdAt) : '—';

        lines += `\n${idx + 1}. ${typeEmoji} $${(tx.amount || 0).toFixed(2)} — ${desc} (${advName})`;
        if (catEmoji) lines += `\n   ${catEmoji} ${tx.category}`;
        lines += ` • ${dateStr}\n`;
    });

    await sendMessage(chatId, `📜 *История операций PO*\n${lines}\n📋 Итого записей: ${txSnap.size}`, {
        inline_keyboard: [[{ text: '⬅️ Назад к авансам', callback_data: 'po_back_to_overview' }]],
    });
}
