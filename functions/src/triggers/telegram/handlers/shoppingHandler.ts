import * as admin from 'firebase-admin';
import axios from 'axios';
import { logger } from 'firebase-functions';
import * as ShoppingAI from '../../../services/shoppingAIService';
import * as ShoppingService from '../../../services/shoppingBotService';
import { sendMessage, showDraftConfirmation, sendMainMenu } from '../telegramUtils';
import { safeConfig } from '../../../utils/safeConfig';

const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || safeConfig().worker_bot?.token;

/**
 * Handle shopping quick add text (AI-powered)
 * Also handles manual receipt amount input
 */
export async function handleShoppingQuickAddText(
    chatId: number,
    userId: number,
    text: string
): Promise<boolean> {
    // Check if user is awaiting quick add OR receipt amount
    const sessionDoc = await admin.firestore().collection('user_sessions').doc(String(userId)).get();
    if (!sessionDoc.exists) return false;

    const session = sessionDoc.data();

    // Handle manual receipt amount input
    if (session?.awaitingReceiptAmount && session?.pendingReceiptId) {
        const amount = parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));

        if (isNaN(amount) || amount <= 0) {
            await sendMessage(chatId, "⚠️ Введите корректную сумму (например: 142.50)");
            return true;
        }

        // Update receipt with amount
        await admin.firestore().collection('receipts').doc(session.pendingReceiptId).update({
            totalAmount: amount,
            status: 'needs_review'
        });

        // Get listId for back button
        const receiptDoc = await admin.firestore().collection('receipts').doc(session.pendingReceiptId).get();
        const listId = receiptDoc.data()?.listId;

        // Clear session
        await admin.firestore().collection('user_sessions').doc(String(userId)).update({
            awaitingReceiptAmount: false,
            pendingReceiptId: null,
            shoppingListId: null,
        });

        await sendMessage(chatId,
            `✅ *Чек сохранён!*\n\n💰 Сумма: *$${amount.toFixed(2)}*\n\n_Чек отправлен на проверку менеджеру._`,
            { inline_keyboard: [[{ text: '🔙 К списку', callback_data: `shop:list:${listId}` }]] }
        );

        return true;
    }

    if (!session?.awaitingShoppingAdd || !session?.shoppingListId) return false;

    const listId = session.shoppingListId;
    const clientName = session.shoppingClientName || 'список';

    try {
        await sendMessage(chatId, "🤖 Анализирую...");

        const existingDraft = session.shoppingDraft || [];
        // Pass existing draft to AI for context-aware update
        const newDraft = await ShoppingAI.parseTextInput(text, existingDraft);

        if (newDraft.length === 0 && existingDraft.length > 0) {
            // If AI returns empty but we had draft, it might be a failure or explicit clear.
            // However, prompt instructions say "return draft unchanged if irrelevant".
            // If mostly empty, maybe check log? For safety, if error, we catch it.
            // But if AI just fails to produce JSON, we might lose data? 
            // `parseTextInput` returns [] on error.
            // To be safe: checks inside `shoppingHandler`? 
            // `parseTextInput` catches error and returns [].
            // We should differentiate error vs "clear all".
            // User likely won't clear via text "clear all" implicitly.
            // Let's assume [] means failure if text wasn't "delete all".
            // But I can't know. 
            // Allow empty return if text seems like delete? 
            // For now, if result is empty, assume error/no-op and KEEP old draft?
            // No, AI prompt says "Output COMPLETE updated list".
        }

        // Actually, let's trust AI but if it returns empty and text was not "delete", warn?
        // Let's just update.

        // Wait, parseTextInput returns [] on exception.
        // I need to know if it was exception.
        // `parseTextInput` logs error.

        if (newDraft.length === 0) {
            // Fallback: append if it was just a simple list processing?
            // No, cannot append if we don't have new items.
            // Assume failed to parse.
            logger.warn('AI returned empty list', { text });
            await sendMessage(chatId, "❌ Не удалось понять запрос. Драфт не изменен.");
            return true;
        }

        await admin.firestore().collection('user_sessions').doc(String(userId)).update({
            shoppingDraft: newDraft,
        });

        await showDraftConfirmation(chatId, newDraft, listId, clientName);

        return true;
    } catch (error) {
        logger.error('Error in AI text parsing', error);
        await sendMessage(chatId, "⚠️ Ошибка распознавания. Попробуй снова.");
        return true;
    }
}

/**
 * Handle shopping voice input (AI-powered)
 */
export async function handleShoppingVoiceInput(
    chatId: number,
    userId: number,
    voiceFileId: string
): Promise<boolean> {
    const sessionDoc = await admin.firestore().collection('user_sessions').doc(String(userId)).get();
    if (!sessionDoc.exists) return false;

    const session = sessionDoc.data();
    if (!session?.awaitingShoppingAdd || !session?.shoppingListId) return false;

    const listId = session.shoppingListId;
    const clientName = session.shoppingClientName || 'список';

    try {
        await sendMessage(chatId, "🎤 Слушаю и анализирую...");

        const existingDraft = session.shoppingDraft || [];
        const audioBuffer = await ShoppingAI.downloadTelegramFile(voiceFileId, WORKER_BOT_TOKEN);
        const newDraft = await ShoppingAI.parseVoiceInput(audioBuffer, 'audio/ogg', existingDraft);

        if (newDraft.length === 0) {
            await sendMessage(chatId, "❌ Не удалось распознать. Драфт не изменен.");
            return true;
        }

        await admin.firestore().collection('user_sessions').doc(String(userId)).update({
            shoppingDraft: newDraft,
        });

        await showDraftConfirmation(chatId, newDraft, listId, clientName);

        return true;
    } catch (error) {
        logger.error('Error in AI voice parsing', error);
        await sendMessage(chatId, "⚠️ Ошибка распознавания голоса.");
        return true;
    }
}

/**
 * Handle shopping photo input (AI-powered)
 */
export async function handleShoppingPhotoInput(
    chatId: number,
    userId: number,
    photoFileId: string
): Promise<boolean> {
    const sessionDoc = await admin.firestore().collection('user_sessions').doc(String(userId)).get();
    if (!sessionDoc.exists) return false;

    const session = sessionDoc.data();
    if (!session?.awaitingShoppingAdd || !session?.shoppingListId) return false;

    const listId = session.shoppingListId;
    const clientName = session.shoppingClientName || 'список';

    try {
        await sendMessage(chatId, "📷 Анализирую фото...");

        const imageBuffer = await ShoppingAI.downloadTelegramFile(photoFileId, WORKER_BOT_TOKEN);
        const parsedItems = await ShoppingAI.parseImageInput(imageBuffer);

        if (parsedItems.length === 0) {
            await sendMessage(chatId, "❌ Не удалось распознать товары на фото. Попробуй:\n• Фото списка крупнее\n• Текстом\n• Голосом");
            return true;
        }

        const existingDraft = session.shoppingDraft || [];
        const newDraft = [...existingDraft, ...parsedItems];

        await admin.firestore().collection('user_sessions').doc(String(userId)).update({
            shoppingDraft: newDraft,
        });

        await showDraftConfirmation(chatId, newDraft, listId, clientName);

        return true;
    } catch (error) {
        logger.error('Error in AI photo parsing', error);
        await sendMessage(chatId, "⚠️ Ошибка распознавания фото.");
        return true;
    }
}

/**
 * Handle shopping receipt photo (direct storage upload)
 * Now integrates OCR for automatic amount extraction
 */
export async function handleShoppingReceiptPhoto(
    chatId: number,
    userId: number,
    photoFileId: string,
    userName: string
): Promise<boolean> {
    const sessionDoc = await admin.firestore().collection('user_sessions').doc(String(userId)).get();
    if (!sessionDoc.exists) return false;

    const session = sessionDoc.data();
    if (!session?.awaitingShoppingReceipt || !session?.shoppingListId) return false;

    const listId = session.shoppingListId;

    try {
        // 1. Download and upload photo to Storage
        const fileResponse = await axios.get(
            `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${photoFileId}`
        );
        const filePath = fileResponse.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`;

        const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(imageResponse.data);

        const bucket = admin.storage().bucket();
        const fileName = `receipts/${listId}/${Date.now()}_${userId}.jpg`;
        const file = bucket.file(fileName);

        await file.save(buffer, {
            metadata: { contentType: 'image/jpeg' },
        });

        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        // 2. Show "Analyzing..." message
        await sendMessage(chatId, "⏳ *Анализирую чек...*");

        // 3. Run OCR to extract amount
        const { extractAmountFromReceipt } = await import('../../../services/receiptOcrService');
        const ocrResult = await extractAmountFromReceipt(publicUrl);

        // 4. Process receipt (create receipt doc with pending status)
        const result = await ShoppingService.processReceipt(listId, publicUrl, userId, userName);

        if (!result.success) {
            await sendMessage(chatId, "⚠️ Ошибка обработки чека. Попробуйте снова.");
            return true;
        }

        // 5. Get receipt ID for callbacks
        const receiptSnap = await admin.firestore().collection('receipts')
            .where('listId', '==', listId)
            .where('uploadedBy', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        const receiptId = receiptSnap.docs[0]?.id;

        if (ocrResult.success && ocrResult.amount) {
            // 6a. OCR found amount - ask for confirmation
            const confidenceEmoji = ocrResult.confidence === 'high' ? '✅' :
                ocrResult.confidence === 'medium' ? '🔶' : '⚠️';

            await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                awaitingShoppingReceipt: false,
                awaitingReceiptAmount: false,
                pendingReceiptId: receiptId,
                pendingReceiptAmount: ocrResult.amount,
                shoppingListId: listId,
            });

            await sendMessage(chatId,
                `${confidenceEmoji} *Чек распознан!*\n\n` +
                `💰 Сумма: *$${ocrResult.amount.toFixed(2)}*\n` +
                `📦 Товаров: ${result.boughtItems.length}\n\n` +
                `Подтвердите сумму:`,
                {
                    inline_keyboard: [
                        [
                            { text: '✅ Подтвердить', callback_data: `shop:confirm_amount:${receiptId}:${ocrResult.amount}` },
                            { text: '✏️ Изменить', callback_data: `shop:edit_amount:${receiptId}` }
                        ],
                        [{ text: '❌ Отмена', callback_data: `shop:cancel_receipt:${listId}` }]
                    ]
                }
            );
        } else {
            // 6b. OCR failed - ask for manual input
            await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                awaitingShoppingReceipt: false,
                awaitingReceiptAmount: true,
                pendingReceiptId: receiptId,
                shoppingListId: listId,
            });

            await sendMessage(chatId,
                `📝 *Чек загружен!*\n\n` +
                `📦 Товаров: ${result.boughtItems.length}\n\n` +
                `💰 Введите сумму чека (только число):`,
                {
                    inline_keyboard: [[{ text: '❌ Отмена', callback_data: `shop:cancel_receipt:${listId}` }]]
                }
            );
        }

        return true;
    } catch (error) {
        logger.error('Error processing shopping receipt', error);
        await sendMessage(chatId, "⚠️ Ошибка загрузки чека.");
        return true;
    }
}

/**
 * Handle goods photo upload (Double Proof Step 2)
 * Saves goods photo URL and completes the Double Proof verification
 */
export async function handleGoodsPhoto(
    chatId: number,
    userId: number,
    photoFileId: string
): Promise<boolean> {
    const sessionDoc = await admin.firestore().collection('user_sessions').doc(String(userId)).get();
    if (!sessionDoc.exists) return false;

    const session = sessionDoc.data();
    if (!session?.awaitingGoodsPhoto || !session?.pendingReceiptId) return false;

    const receiptId = session.pendingReceiptId;
    const listId = session.shoppingListId;

    try {
        // 1. Download and upload photo to Storage
        const fileResponse = await axios.get(
            `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${photoFileId}`
        );
        const filePath = fileResponse.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`;

        const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(imageResponse.data);

        const bucket = admin.storage().bucket();
        const fileName = `goods_photos/${listId}/${Date.now()}_${userId}.jpg`;
        const file = bucket.file(fileName);

        await file.save(buffer, {
            metadata: { contentType: 'image/jpeg' },
        });

        await file.makePublic();
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

        // 2. Update receipt with goods photo (keeps awaiting status for payment source)
        const result = await ShoppingService.addGoodsPhoto(receiptId, publicUrl);

        if (!result.success) {
            await sendMessage(chatId, "⚠️ Ошибка сохранения фото товаров.");
            return true;
        }

        // 3. Set session to await payment source selection
        await admin.firestore().collection('user_sessions').doc(String(userId)).update({
            awaitingGoodsPhoto: false,
            awaitingPaymentSource: true,  // NEW: Phase 2
            pendingReceiptId: receiptId,
            shoppingListId: listId,
        });

        // 4. Show payment source selection menu (Financial Constructor)
        await sendMessage(chatId,
            `✅ *Фото товаров сохранено!*\n\n` +
            `💳 *Шаг 3: Откуда деньги?*\n\n` +
            `Выберите способ оплаты:`,
            {
                inline_keyboard: [
                    [{ text: '💳 Моя карта / Наличные', callback_data: `shop:payment:${receiptId}:personal` }],
                    [{ text: '🏢 Корпоративная карта', callback_data: `shop:payment:${receiptId}:company_card` }],
                    [{ text: '💰 Подотчёт (выданные)', callback_data: `shop:payment:${receiptId}:cash_advance` }],
                    [{ text: '❌ Отмена', callback_data: `shop:cancel_receipt:${listId}` }]
                ]
            }
        );

        logger.info(`Goods photo uploaded: receipt ${receiptId}, awaiting payment source`);
        return true;
    } catch (error) {
        logger.error('Error processing goods photo', error);
        await sendMessage(chatId, "⚠️ Ошибка загрузки фото товаров.");
        return true;
    }
}

/**
 * Handle draft callbacks
 */
export async function handleDraftCallback(
    chatId: number,
    userId: number,
    action: string,
    params: string[]
): Promise<void> {
    const sessionDoc = await admin.firestore().collection('user_sessions').doc(String(userId)).get();
    if (!sessionDoc.exists) return;

    const session = sessionDoc.data();
    const listId = session?.shoppingListId;
    const clientName = session?.shoppingClientName || 'список';
    let draft: ShoppingAI.ParsedShoppingItem[] = session?.shoppingDraft || [];

    switch (action) {
        case 'del': {
            const idx = parseInt(params[0], 10);
            if (idx >= 0 && idx < draft.length) {
                draft.splice(idx, 1);
                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    shoppingDraft: draft,
                });
            }
            await showDraftConfirmation(chatId, draft, listId, clientName);
            break;
        }

        case 'save': {
            if (draft.length > 0 && listId) {
                const items = draft.map(d => ({
                    name: d.name,
                    quantity: d.quantity,
                    unit: d.unit,
                    isUrgent: d.isUrgent,
                    status: 'pending' as const,
                    completed: false,
                }));

                await ShoppingService.addItemsToList(listId, items);

                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    awaitingShoppingAdd: false,
                    shoppingListId: null,
                    shoppingDraft: [],
                    shoppingClientName: null,
                });

                await sendMessage(chatId,
                    `✅ Добавлено ${items.length} товаров в ${clientName}!`,
                    { inline_keyboard: [[{ text: '🔙 К списку', callback_data: `shop:list:${listId}` }]] }
                );
            }
            break;
        }

        case 'more': {
            await sendMessage(chatId,
                `➕ Добавь ещё товары (текст/голос/фото):\n\n_В черновике уже ${draft.length} поз._`,
                { inline_keyboard: [[{ text: '📋 Показать черновик', callback_data: 'draft:show' }]] }
            );
            break;
        }

        case 'clear': {
            await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                shoppingDraft: [],
            });
            await sendMessage(chatId, "🗑 Черновик очищен.",
                { inline_keyboard: [[{ text: '⬅️ К списку', callback_data: `shop:list:${listId}` }]] }
            );
            break;
        }

        case 'show': {
            await showDraftConfirmation(chatId, draft, listId, clientName);
            break;
        }
    }
}

/**
 * Handle shopping command (/shopping)
 * Uses Smart Context to auto-select client based on session status.
 */
export async function handleShoppingCommand(chatId: number, userId: number) {
    try {
        // 1. Resolve context - get default client from session
        const { resolveContext } = await import('../../../services/contextResolver');
        const context = await resolveContext(userId);

        // 2. If we have a default target (from active session), go directly to that list
        if (context.defaultTargetId && context.defaultTargetName) {
            // Find or create list for this client
            const listId = await ShoppingService.getOrCreateListForClient(
                context.defaultTargetId,
                context.defaultTargetName
            );

            // Show the list with change location button
            await showSmartShoppingList(chatId, listId, context.defaultTargetName, context.userStatus);
            return;
        }

        // 3. No session context - show client selection
        const lists = await ShoppingService.getActiveListsForBot();

        if (lists.length === 0) {
            // No existing lists - offer to create
            await showClientSelectionForNewList(chatId);
            return;
        }

        const keyboard = ShoppingService.buildProjectListKeyboard(lists);
        keyboard.push([{ text: '➕ Новый список', callback_data: 'shop:create' }]);
        keyboard.push([{ text: '⬅️ Меню', callback_data: 'shop:menu' }]);

        await sendMessage(chatId,
            "🛒 *Закупки*\n\nВыберите объект или создайте список:",
            { inline_keyboard: keyboard }
        );
    } catch (error) {
        logger.error('Error in handleShoppingCommand:', error);
        await sendMessage(chatId, "⚠️ Ошибка загрузки списков.");
    }
}

/**
 * Show shopping list with Smart Context header and change location button
 */
async function showSmartShoppingList(
    chatId: number,
    listId: string,
    clientName: string,
    userStatus: string
) {
    const list = await ShoppingService.getListForDisplay(listId);

    if (!list) {
        await sendMessage(chatId, "⚠️ Список не найден.");
        return;
    }

    const statusEmoji = userStatus === 'active' ? '🟢' : userStatus === 'paused' ? '⏸' : '⚪';
    const header = `🛒 *Закупка: ${clientName}*  ${statusEmoji}`;

    let itemsText = '';
    if (list.items.length === 0) {
        itemsText = '\n\n_Список пуст. Добавьте товары голосом или текстом._';
    } else {
        itemsText = '\n\n' + list.items
            .filter(i => i.status === 'pending' || i.status === 'selected')
            .map(item => {
                const check = item.status === 'selected' ? '☑️' : '⬜';
                const urgent = item.isUrgent ? '🔴' : '';
                return `${check} ${item.name} ${item.quantity}${item.unit || ''}${urgent}`;
            })
            .join('\n');
    }

    const keyboard: any[][] = [];

    // Item toggle buttons (first 10)
    const pendingItems = list.items.filter(i => i.status === 'pending' || i.status === 'selected').slice(0, 10);
    for (const item of pendingItems) {
        const check = item.status === 'selected' ? '☑️' : '⬜';
        keyboard.push([{
            text: `${check} ${item.name}`,
            callback_data: `shop:toggle:${listId}:${item.id}`
        }]);
    }

    // Action buttons row
    keyboard.push([
        { text: '🔄 Объект', callback_data: `shop:change_location:${listId}` },
        { text: '➕ Добавить', callback_data: `shop:add:${listId}` }
    ]);

    // Bottom row
    const selectedCount = list.items.filter(i => i.status === 'selected').length;
    if (selectedCount > 0) {
        keyboard.push([
            { text: `📸 Чек (${selectedCount})`, callback_data: `shop:receipt:${listId}` },
            { text: '⬅️ Меню', callback_data: 'shop:menu' }
        ]);
    } else {
        keyboard.push([{ text: '⬅️ Меню', callback_data: 'shop:menu' }]);
    }

    await sendMessage(chatId, header + itemsText, { inline_keyboard: keyboard });
}

/**
 * Handle all shopping callbacks
 */
export async function handleShoppingCallback(
    chatId: number,
    userId: number,
    data: string,
    messageId: number
) {
    const parts = data.split(':');
    const action = parts[1];

    try {
        switch (action) {
            case 'list': {
                const listId = parts[2];
                await showShoppingList(chatId, listId, messageId);
                break;
            }

            case 'toggle': {
                const listId = parts[2];
                const itemId = parts[3];
                const result = await ShoppingService.toggleItemSelection(listId, itemId, userId);

                if (result.success) {
                    await showShoppingList(chatId, listId, messageId);
                }
                break;
            }

            case 'receipt': {
                const listId = parts[2];
                await startReceiptUpload(chatId, userId, listId, messageId);
                break;
            }

            case 'add': {
                const listId = parts[2];
                await startQuickAdd(chatId, userId, listId, messageId);
                break;
            }

            case 'back': {
                await handleShoppingCommand(chatId, userId);
                break;
            }

            case 'cancel': {
                const listId = parts[2];
                await ShoppingService.cancelSelection(listId, userId);
                await showShoppingList(chatId, listId, messageId);
                break;
            }

            case 'cancel_receipt': {
                const listId = parts[2];
                await showShoppingList(chatId, listId, messageId);
                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    awaitingShoppingReceipt: false,
                    shoppingListId: null,
                });
                break;
            }

            case 'cancel_add': {
                const listId = parts[2];
                await showShoppingList(chatId, listId, messageId);
                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    awaitingShoppingAdd: false,
                    shoppingListId: null,
                });
                break;
            }

            case 'menu': {
                await sendMainMenu(chatId, userId);
                break;
            }

            case 'create': {
                await showClientSelectionForNewList(chatId);
                break;
            }

            case 'new_list_client': {
                const clientId = parts[2];
                const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();
                const clientName = clientDoc.exists ? clientDoc.data()?.name : 'Project';

                const listId = await ShoppingService.createShoppingList(clientId, clientName);
                await showShoppingList(chatId, listId);
                break;
            }

            case 'change_location': {
                // Show sorted client list for location change
                const { getClientsSortedForSelection } = await import('../../../services/contextResolver');
                const currentListId = parts[2];
                const currentList = await ShoppingService.getListForDisplay(currentListId);

                const clients = await getClientsSortedForSelection(currentList?.clientId);

                if (clients.length === 0) {
                    await sendMessage(chatId, "⚠️ Нет активных проектов.");
                    break;
                }

                const keyboard = clients.slice(0, 10).map(client => [{
                    text: (client.isCurrent ? '✓ ' : '') +
                        (client.isNearby ? '📍 ' : '') +
                        client.name,
                    callback_data: `shop:switch_to_client:${client.id}`
                }]);

                keyboard.push([{ text: '❌ Отмена', callback_data: `shop:list:${currentListId}` }]);

                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: '🏢 *Выберите объект:*\n\n_Смена объекта не влияет на ваш таймер работы_',
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard },
                });
                break;
            }

            case 'switch_to_client': {
                // Switch to different client's shopping list
                const clientId = parts[2];
                const clientDoc = await admin.firestore().collection('clients').doc(clientId).get();
                const clientName = clientDoc.exists ? clientDoc.data()?.name : 'Project';

                // Get or create list for this client
                const listId = await ShoppingService.getOrCreateListForClient(clientId, clientName);

                // Get context for status display
                const { resolveContext } = await import('../../../services/contextResolver');
                const context = await resolveContext(userId);

                // Show the new list with smart header
                const list = await ShoppingService.getListForDisplay(listId);
                if (list) {
                    await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/deleteMessage`, {
                        chat_id: chatId,
                        message_id: messageId,
                    }).catch(() => { }); // Ignore delete errors

                    await showSmartShoppingList(chatId, listId, clientName, context.userStatus);
                }
                break;
            }

            case 'confirm_amount': {
                // User confirmed OCR-detected amount -> Now request goods photo (Double Proof)
                const receiptId = parts[2];
                const amount = parseFloat(parts[3]);

                if (receiptId && amount > 0) {
                    // Update receipt with amount (but keep awaiting_goods_photo status)
                    await admin.firestore().collection('receipts').doc(receiptId).update({
                        totalAmount: amount,
                        // status stays 'awaiting_goods_photo' until goods photo is added
                    });

                    // Get listId for cancel button
                    const receiptDoc = await admin.firestore().collection('receipts').doc(receiptId).get();
                    const receiptListId = receiptDoc.data()?.listId;

                    // Set session to await goods photo
                    await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                        pendingReceiptAmount: null,
                        awaitingGoodsPhoto: true,          // NEW: Double Proof Step 2
                        pendingReceiptId: receiptId,
                        shoppingListId: receiptListId,
                    });

                    // Request goods photo (Double Proof)
                    await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
                        chat_id: chatId,
                        message_id: messageId,
                        text: `✅ *Сумма подтверждена: $${amount.toFixed(2)}*\n\n` +
                            `🛍 *Шаг 2: Фото товаров*\n\n` +
                            `📷 Сфотографируйте:\n` +
                            `• Пакеты с покупками\n` +
                            `• Открытый багажник\n` +
                            `• Тележку\n\n` +
                            `_Это подтверждает факт покупки._`,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[{ text: '❌ Отмена', callback_data: `shop:cancel_receipt:${receiptListId}` }]]
                        }
                    });
                }
                break;
            }

            case 'edit_amount': {
                // User wants to manually enter amount
                const receiptId = parts[2];

                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    awaitingReceiptAmount: true,
                    pendingReceiptId: receiptId,
                });

                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `💰 *Введите сумму чека:*\n\n_Только число, например: 142.50_`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '❌ Отмена', callback_data: `shop:menu` }]]
                    }
                });
                break;
            }

            case 'payment': {
                // User selected payment source (Financial Constructor)
                const receiptId = parts[2];
                const paymentSource = parts[3] as 'personal' | 'company_card' | 'cash_advance';

                // Get listId from receipt
                const receiptDoc = await admin.firestore().collection('receipts').doc(receiptId).get();
                if (!receiptDoc.exists) {
                    await sendMessage(chatId, "⚠️ Чек не найден.");
                    break;
                }
                const listId = receiptDoc.data()?.listId;

                // Save payment source to receipt
                await admin.firestore().collection('receipts').doc(receiptId).update({
                    paymentSource: paymentSource,
                });

                // Update session for allocation step
                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    awaitingPaymentSource: false,
                    awaitingAllocation: true,
                    pendingReceiptId: receiptId,
                    selectedPaymentSource: paymentSource,
                    shoppingListId: listId,
                });

                // Show allocation selection (Phase 3: Cost Center)
                const paymentLabel = paymentSource === 'personal' ? '💳 Личные' :
                    paymentSource === 'company_card' ? '🏢 Корп. карта' : '💰 Подотчёт';

                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `✅ *Оплата: ${paymentLabel}*\n\n` +
                        `📦 *Шаг 4: За чей счёт?*\n\n` +
                        `Кому выставить счёт за покупку?`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🏗 Клиенту (в счёт)', callback_data: `shop:allocate:${receiptId}:billable` }],
                            [{ text: '🏢 Расход компании', callback_data: `shop:allocate:${receiptId}:internal` }],
                            [{ text: '🍔 Личное (вычет из ЗП)', callback_data: `shop:allocate:${receiptId}:personal` }],
                            [{ text: '❌ Отмена', callback_data: `shop:cancel_receipt:${listId}` }]
                        ]
                    }
                });
                break;
            }

            case 'allocate': {
                // User selected cost center (Allocation)
                const receiptId = parts[2];
                const costCenter = parts[3] as 'billable' | 'internal' | 'personal';

                // Get receipt data
                const receiptDoc = await admin.firestore().collection('receipts').doc(receiptId).get();
                if (!receiptDoc.exists) {
                    await sendMessage(chatId, "⚠️ Чек не найден.");
                    break;
                }
                const receiptData = receiptDoc.data()!;
                const listId = receiptData.listId;
                const paymentSource = receiptData.paymentSource;
                const totalAmount = receiptData.totalAmount || 0;

                // Determine initial billing/reimbursement status
                let billingStatus: 'pending' | 'verified' = 'pending';
                let reimbursementStatus: 'pending' | undefined;

                if (paymentSource === 'personal') {
                    reimbursementStatus = 'pending'; // Company owes employee
                }

                // Update receipt with allocation and complete the wizard
                const updateData: any = {
                    costCenter: costCenter,
                    billingStatus: billingStatus,
                    status: 'needs_review', // Ready for manager verification
                };
                if (reimbursementStatus) {
                    updateData.reimbursementStatus = reimbursementStatus;
                }
                await admin.firestore().collection('receipts').doc(receiptId).update(updateData);

                // Clear session completely
                await admin.firestore().collection('user_sessions').doc(String(userId)).update({
                    awaitingAllocation: false,
                    awaitingPaymentSource: false,
                    pendingReceiptId: null,
                    selectedPaymentSource: null,
                    shoppingListId: null,
                });

                // Build success message
                const paymentLabel = paymentSource === 'personal' ? '💳 Личные' :
                    paymentSource === 'company_card' ? '🏢 Корп. карта' : '💰 Подотчёт';
                const allocationLabel = costCenter === 'billable' ? '🏗 Клиент' :
                    costCenter === 'internal' ? '🏢 Компания' : '🍔 Личное';

                let reimbursementText = '';
                if (paymentSource === 'personal' && costCenter !== 'personal') {
                    reimbursementText = `\n\n💵 *Возврат: $${totalAmount.toFixed(2)}*\n_Добавлено к возврату сотруднику._`;
                }

                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
                    chat_id: chatId,
                    message_id: messageId,
                    text: `✅ *Покупка оформлена!*\n\n` +
                        `📸 Чек: ✓\n` +
                        `🛍 Товары: ✓\n` +
                        `💳 Оплата: ${paymentLabel}\n` +
                        `📦 Счёт: ${allocationLabel}` +
                        reimbursementText +
                        `\n\n_Отправлено на проверку менеджеру._`,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🔙 К списку', callback_data: `shop:list:${listId}` }]]
                    }
                });

                logger.info(`Receipt wizard completed: ${receiptId}, payment=${paymentSource}, costCenter=${costCenter}`);
                break;
            }

            case 'noop': {
                break;
            }
        }
    } catch (error) {
        logger.error('Error in handleShoppingCallback:', error);
        await sendMessage(chatId, "⚠️ Ошибка обработки действия.");
    }
}

async function showShoppingList(chatId: number, listId: string, messageId?: number) {
    const list = await ShoppingService.getListForDisplay(listId);

    if (!list) {
        await sendMessage(chatId, "⚠️ Список не найден.");
        return;
    }

    const selectedCount = list.items.filter(i => i.status === 'selected').length;
    const pendingCount = list.items.filter(i => i.status === 'pending' || !i.status).length;
    const boughtCount = list.items.filter(i =>
        i.status === 'bought_pending' || i.status === 'bought_verified'
    ).length;

    let text = `🛒 *${list.clientName}*\n`;
    text += `Выбрано: ${selectedCount} | Осталось: ${pendingCount} | Куплено: ${boughtCount}\n\n`;
    text += `Нажми на товар для выбора:`;

    const keyboard = ShoppingService.buildItemListKeyboard(list);

    if (messageId) {
        try {
            await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
                chat_id: chatId,
                message_id: messageId,
                text,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard },
            });
        } catch (e) {
            await sendMessage(chatId, text, { inline_keyboard: keyboard, parse_mode: 'HTML' });
        }
    } else {
        await sendMessage(chatId, text, { inline_keyboard: keyboard, parse_mode: 'HTML' });
    }
}

async function startReceiptUpload(chatId: number, userId: number, listId: string, messageId: number) {
    const list = await ShoppingService.getListForDisplay(listId);
    if (!list) return;

    const selectedItems = list.items.filter(i => i.status === 'selected');
    if (selectedItems.length === 0) {
        await sendMessage(chatId, "⚠️ Сначала выберите товары.");
        return;
    }

    await admin.firestore().collection('user_sessions').doc(String(userId)).set({
        awaitingShoppingReceipt: true,
        shoppingListId: listId,
        shoppingMessageId: messageId,
    }, { merge: true });

    let itemList = selectedItems.map(i => `• ${i.name}`).join('\n');

    await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: `📸 *Загрузка чека*\n\nВы отметили ${selectedItems.length} товаров:\n${itemList}\n\n📷 Отправьте фото чека:`,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Отмена', callback_data: `shop:cancel_receipt:${listId}` }]]
        },
    });
}

async function startQuickAdd(chatId: number, userId: number, listId: string, messageId: number) {
    const list = await ShoppingService.getListForDisplay(listId);
    const clientName = list?.clientName || 'список';

    await admin.firestore().collection('user_sessions').doc(String(userId)).set({
        awaitingShoppingAdd: true,
        shoppingListId: listId,
        shoppingMessageId: messageId,
        shoppingClientName: clientName,
        shoppingDraft: [],
    }, { merge: true });

    await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: `➕ *Добавить товары в ${clientName}*\n\nОтправь что угодно:\n\n📝 Текст — "Краска 5л, гвозди 2кг"\n🎤 Голосовое — "Запиши профиль десять штук"\n📷 Фото — сфоткай список или материалы\n\nИИ распознает и предложит подтвердить.`,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Отмена', callback_data: `shop:cancel_add:${listId}` }]]
        },
    });
}

async function showClientSelectionForNewList(chatId: number) {
    const clients = await ShoppingService.getAllClientsForSelection();

    if (clients.length === 0) {
        await sendMessage(chatId, "⚠️ Нет активных проектов.");
        return;
    }

    const keyboard = clients.map(client => [{
        text: client.name,
        callback_data: `shop:new_list_client:${client.id}`
    }]);

    keyboard.push([{ text: '❌ Отмена', callback_data: 'shop:menu' }]);

    await sendMessage(chatId, "🏢 Выберите проект для нового списка:", {
        inline_keyboard: keyboard
    });
}
