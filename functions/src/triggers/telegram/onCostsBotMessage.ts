import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as CostsAI from '../../services/costsAIService';
import { COSTS_BOT_TOKEN, COSTS_BOT_SECRETS } from '../../config';

// Initialize if not already
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Cost Categories
const COST_CATEGORIES = [
    { id: 'materials', label: '🧱 Материалы' },
    { id: 'tools', label: '🔧 Инструменты' },
    { id: 'reimbursement', label: '💵 Возврат' },
    { id: 'fuel', label: '⛽ Топливо' },
    { id: 'housing', label: '🏠 Жильё' },
    { id: 'food', label: '🍔 Питание' },
    { id: 'permit', label: '📋 Разрешения' },
    { id: 'other', label: '📦 Другое' }
];

// Types
interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from: {
            id: number;
            first_name: string;
            username?: string;
        };
        chat: {
            id: number;
        };
        text?: string;
        photo?: {
            file_id: string;
        }[];
        voice?: {
            file_id: string;
        };
    };
    callback_query?: {
        id: string;
        from: {
            id: number;
            first_name: string;
        };
        message: {
            chat: {
                id: number;
            };
            message_id: number;
        };
        data: string;
    };
}

interface CostSession {
    state: 'select_client' | 'select_category' | 'enter_amount' | 'upload_photo' | 'confirm_ocr' | 'enter_description';
    clientId?: string;
    clientName?: string;
    category?: string;
    categoryLabel?: string;
    amount?: number;
    originalAmount?: number;
    receiptPhotoUrl?: string;
    // AI OCR fields
    aiExtractedAmount?: number;
    aiExtractedStore?: string;
    aiConfidence?: string;
}

// --- Main Function ---
export const onCostsBotMessage = functions
  .runWith({ secrets: [...COSTS_BOT_SECRETS] })
  .https.onRequest(async (req, res) => {
    logger.info('💰 Costs Bot Webhook', { method: req.method });

    if (req.method !== 'POST') {
        res.status(200).send('Costs Bot Webhook OK');
        return;
    }

    try {
        const update = req.body as TelegramUpdate;

        if (update.callback_query) {
            await handleCallback(update.callback_query);
        } else if (update.message) {
            await handleMessage(update.message);
        }

        res.status(200).send('OK');
    } catch (error) {
        logger.error('Error in Costs Bot:', error);
        res.status(200).send('OK');
    }
});

// --- Message Handler ---
async function handleMessage(message: any) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;

    // Auth check: only registered employees can use the bot
    const empDoc = await db.collection('employees').doc(String(userId)).get();
    if (!empDoc.exists) {
        if (text === '/start' || text === '/help') {
            await sendMessage(chatId, '❌ Вы не зарегистрированы. Обратитесь к администратору.');
        }
        return;
    }

    // Start command
    if (text === '/start') {
        await sendMainMenu(chatId);
        return;
    }

    // Enter Cost button
    if (text === '💰 Ввести затрату' || text === '/cost') {
        await showClientSelection(chatId, userId);
        return;
    }

    // Help
    if (text === '/help' || text === '❓ Помощь') {
        await sendMessage(chatId, `📚 *Справка - Учёт Затрат*

Этот бот помогает записывать операционные расходы.

*Как использовать:*
1. Нажмите "💰 Ввести затрату"
2. Выберите клиента
3. Выберите категорию
4. Введите сумму
5. Загрузите фото чека
6. Добавьте описание (опционально)

*Категории:*
• Материалы, Инструменты, Топливо
• Жильё, Питание, Разрешения
• Возврат (сумма учитывается как минус)

Все данные сохраняются и доступны в отчётах.`);
        return;
    }

    // Photo upload
    if (message.photo) {
        const largestPhoto = message.photo[message.photo.length - 1];
        await handlePhotoUpload(chatId, userId, largestPhoto.file_id, message.from.first_name);
        return;
    }

    // Voice message
    if (message.voice) {
        await handleVoiceMessage(chatId, userId, message.voice.file_id);
        return;
    }

    // Text input (amount or description)
    if (text && text.length > 0) {
        await handleTextInput(chatId, userId, text);
        return;
    }
}

// --- Callback Handler ---
async function handleCallback(query: any) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    const parts = data.split(':');
    const action = parts[0];
    const param = parts[1];

    try {
        switch (action) {
            case 'client': {
                const clientDoc = await db.collection('clients').doc(param).get();
                if (!clientDoc.exists) {
                    await sendMessage(chatId, '❌ Клиент не найден.');
                    break;
                }
                const clientData = clientDoc.data()!;

                await setSession(userId, {
                    state: 'select_category',
                    clientId: param,
                    clientName: clientData.name
                });

                await showCategorySelection(chatId, clientData.name);
                break;
            }

            case 'cat': {
                const session = await getSession(userId);
                if (!session) {
                    await sendMessage(chatId, '❌ Сессия истекла. Нажмите /start');
                    break;
                }

                const categoryObj = COST_CATEGORIES.find(c => c.id === param);

                await setSession(userId, {
                    ...session,
                    state: 'enter_amount',
                    category: param,
                    categoryLabel: categoryObj?.label || param
                });

                const hint = param === 'reimbursement'
                    ? '\n\n💡 *Возврат:* сумма будет учтена как отрицательная'
                    : '';

                await sendMessage(chatId,
                    `📂 Категория: *${categoryObj?.label || param}*${hint}\n\n💵 Введите сумму (только цифры):`
                );
                break;
            }

            case 'skip_desc': {
                const session = await getSession(userId);
                if (!session || session.state !== 'enter_description') {
                    await sendMessage(chatId, '❌ Сессия истекла.');
                    break;
                }
                await saveCostEntry(chatId, userId, session);
                break;
            }

            case 'ocr': {
                // OCR confirmation callbacks
                const session = await getSession(userId);
                if (!session || session.state !== 'confirm_ocr') {
                    await sendMessage(chatId, '❌ Сессия истекла.');
                    break;
                }

                if (param === 'confirm' && session.aiExtractedAmount) {
                    // User confirmed AI-extracted amount
                    const finalAmount = session.category === 'reimbursement'
                        ? -session.aiExtractedAmount
                        : session.aiExtractedAmount;

                    await setSession(userId, {
                        ...session,
                        state: 'enter_description',
                        amount: finalAmount,
                        originalAmount: session.aiExtractedAmount
                    });

                    const amountStr = `$${session.aiExtractedAmount.toFixed(2)}`;
                    const storeInfo = session.aiExtractedStore ? `\n🏪 Магазин: ${session.aiExtractedStore}` : '';

                    await sendMessage(chatId,
                        `✅ Сумма подтверждена: *${amountStr}*${storeInfo}\n\n📝 Введите описание или запишите голосовое:`,
                        {
                            inline_keyboard: [[{ text: '⏭️ Пропустить', callback_data: 'skip_desc' }]]
                        }
                    );
                } else if (param === 'manual') {
                    // User wants to enter amount manually
                    await setSession(userId, {
                        ...session,
                        state: 'enter_amount',
                        aiExtractedAmount: undefined,
                        aiExtractedStore: undefined
                    });

                    await sendMessage(chatId, '💵 Введите сумму вручную (только цифры):');
                }
                break;
            }

            case 'cancel': {
                await clearSession(userId);
                await sendMessage(chatId, '❌ Отменено.');
                await sendMainMenu(chatId);
                break;
            }
        }

        // Answer callback
        await axios.post(`https://api.telegram.org/bot${COSTS_BOT_TOKEN.value()}/answerCallbackQuery`, {
            callback_query_id: query.id
        });
    } catch (error) {
        logger.error('Error in callback:', error);
    }
}

// --- Text Input Handler ---
async function handleTextInput(chatId: number, userId: number, text: string) {
    const session = await getSession(userId);
    if (!session) return;

    // Amount input
    if (session.state === 'enter_amount') {
        const cleanedText = text.trim().replace(/,/g, '.');

        if (!/^[\d.]+$/.test(cleanedText)) {
            await sendMessage(chatId, '❌ Неверный формат. Используйте только цифры.\n\nПример: `125.50` или `125,50`');
            return;
        }

        const amount = parseFloat(cleanedText);
        if (isNaN(amount) || amount <= 0) {
            await sendMessage(chatId, '❌ Введите положительное число.\n\nПример: `125.50`');
            return;
        }

        const finalAmount = session.category === 'reimbursement' ? -amount : amount;

        await setSession(userId, {
            ...session,
            state: 'upload_photo',
            amount: finalAmount,
            originalAmount: amount
        });

        await sendMessage(chatId,
            `💵 Сумма: *$${amount.toFixed(2)}*${session.category === 'reimbursement' ? ' (возврат: -$' + amount.toFixed(2) + ')' : ''}\n\n📷 Загрузите фото чека/документа:`
        );
        return;
    }

    // Description input
    if (session.state === 'enter_description') {
        await saveCostEntry(chatId, userId, session, text);
        return;
    }
}

// --- Photo Handler ---
async function handlePhotoUpload(chatId: number, userId: number, photoFileId: string, userName: string) {
    const session = await getSession(userId);
    if (!session || session.state !== 'upload_photo') {
        await sendMessage(chatId, '❌ Сначала выберите клиента и категорию. Нажмите /start');
        return;
    }

    try {
        // Get file info
        const fileResponse = await axios.get(
            `https://api.telegram.org/bot${COSTS_BOT_TOKEN.value()}/getFile?file_id=${photoFileId}`
        );
        const filePath = fileResponse.data.result.file_path;

        // Download file
        const fileUrl = `https://api.telegram.org/file/bot${COSTS_BOT_TOKEN.value()}/${filePath}`;
        const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        // Upload to Firebase Storage
        const bucket = admin.storage().bucket();
        const fileName = `costs/${session.clientId}/${Date.now()}_${userId}.jpg`;
        const file = bucket.file(fileName);

        await file.save(imageBuffer, {
            metadata: { contentType: 'image/jpeg' }
        });

        // Generate signed URL (7-day expiry) instead of making public
        const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        const publicUrl = signedUrl;

        // Send "analyzing" message
        await sendMessage(chatId, '🔍 Анализирую чек...');

        // Try AI OCR
        let receipt: CostsAI.ParsedReceipt | null = null;
        try {
            receipt = await CostsAI.parseReceiptImage(imageBuffer);
        } catch (ocrError) {
            logger.warn('OCR failed, falling back to manual', ocrError);
        }

        if (receipt && CostsAI.isReceiptParsed(receipt)) {
            // AI successfully extracted amount
            await setSession(userId, {
                ...session,
                state: 'confirm_ocr',
                receiptPhotoUrl: publicUrl,
                aiExtractedAmount: receipt.amount!,
                aiExtractedStore: receipt.storeName || undefined,
                aiConfidence: receipt.confidence
            });

            const message = CostsAI.buildReceiptConfirmMessage(receipt);
            await sendMessage(chatId, message, {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить', callback_data: 'ocr:confirm' }],
                    [{ text: '❌ Ввести вручную', callback_data: 'ocr:manual' }]
                ]
            });
        } else {
            // OCR failed - go to manual amount entry
            await setSession(userId, {
                ...session,
                state: 'enter_amount',
                receiptPhotoUrl: publicUrl
            });

            await sendMessage(chatId,
                '📸 Фото загружено!\n\n❌ Не удалось распознать чек автоматически.\n\n💵 Введите сумму вручную:'
            );
        }
    } catch (error: any) {
        logger.error('Error uploading photo:', error);
        await sendMessage(chatId, '❌ Ошибка загрузки. Попробуйте ещё раз.');
    }
}

// --- Voice Handler ---
async function handleVoiceMessage(chatId: number, userId: number, voiceFileId: string) {
    const session = await getSession(userId);
    if (!session || session.state !== 'enter_description') {
        await sendMessage(chatId, '❌ Сначала начните оформление затраты. Нажмите /start');
        return;
    }

    try {
        await sendMessage(chatId, '🎙 Транскрибирую голосовое...');

        // Download voice file
        const audioBuffer = await CostsAI.downloadTelegramFile(voiceFileId, COSTS_BOT_TOKEN.value());

        // Transcribe with AI
        const transcription = await CostsAI.transcribeVoice(audioBuffer, 'audio/ogg');

        if (transcription && transcription.length > 0) {
            // Successfully transcribed - use as description
            await saveCostEntry(chatId, userId, session, transcription);
        } else {
            // Transcription failed - save as voice note
            const fileResponse = await axios.get(
                `https://api.telegram.org/bot${COSTS_BOT_TOKEN.value()}/getFile?file_id=${voiceFileId}`
            );
            const filePath = fileResponse.data.result.file_path;
            const voiceUrl = `https://api.telegram.org/file/bot${COSTS_BOT_TOKEN.value()}/${filePath}`;

            await saveCostEntry(chatId, userId, session, '🎙 Голосовое (не распознано)', voiceUrl);
        }
    } catch (error) {
        logger.error('Error with voice:', error);
        await sendMessage(chatId, '❌ Ошибка. Попробуйте текстом.');
    }
}

// --- Save Cost Entry ---
async function saveCostEntry(
    chatId: number,
    userId: number,
    session: CostSession,
    description?: string,
    voiceNoteUrl?: string
) {
    // Try multiple sources for user name
    let userName = 'Unknown';
    const empDoc = await db.collection('employees').doc(userId.toString()).get();
    if (empDoc.exists && empDoc.data()?.name) {
        userName = empDoc.data()!.name;
    } else {
        const userDoc = await db.collection('telegram_users').doc(userId.toString()).get();
        if (userDoc.exists && userDoc.data()?.firstName) {
            userName = userDoc.data()!.firstName;
        }
    }

    const costEntry = {
        userId: userId.toString(),
        userName,
        clientId: session.clientId,
        clientName: session.clientName,
        category: session.category,
        categoryLabel: session.categoryLabel,
        amount: session.amount,
        originalAmount: session.originalAmount,
        receiptPhotoUrl: session.receiptPhotoUrl,
        description: description || null,
        voiceNoteUrl: voiceNoteUrl || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'confirmed',
        source: 'costs_bot'
    };

    await db.collection('costs').add(costEntry);
    await clearSession(userId);

    const categoryObj = COST_CATEGORIES.find(c => c.id === session.category);
    const date = new Date();
    const dateStr = date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    await sendMessage(chatId,
        `✅ *Затрата записана!*

📅 Дата: ${dateStr}
🏢 Клиент: ${session.clientName}
📂 Категория: ${categoryObj?.label || session.category}
💵 Сумма: $${Math.abs(session.amount || 0).toFixed(2)}${session.category === 'reimbursement' ? ' (возврат)' : ''}
📝 Описание: ${description || 'Не указано'}`
    );

    await sendMainMenu(chatId);
}

// --- UI Functions ---
async function sendMainMenu(chatId: number) {
    await sendMessage(chatId, '💰 *Учёт Затрат*\n\nВыберите действие:', {
        keyboard: [
            [{ text: '💰 Ввести затрату' }],
            [{ text: '❓ Помощь' }]
        ],
        resize_keyboard: true
    });
}

async function showClientSelection(chatId: number, userId: number) {
    const clientsSnap = await db.collection('clients')
        .where('status', '==', 'active')
        .orderBy('name')
        .limit(20)
        .get();

    if (clientsSnap.empty) {
        await sendMessage(chatId, '❌ Нет активных клиентов. Обратитесь к администратору.');
        return;
    }

    const buttons = clientsSnap.docs.map(doc => [{
        text: doc.data().name,
        callback_data: `client:${doc.id}`
    }]);

    buttons.push([{ text: '❌ Отмена', callback_data: 'cancel' }]);

    await setSession(userId, { state: 'select_client' });

    await sendMessage(chatId, '🏢 Выберите клиента:', {
        inline_keyboard: buttons
    });
}

async function showCategorySelection(chatId: number, clientName: string) {
    const buttons = COST_CATEGORIES.map(cat => [{
        text: cat.label,
        callback_data: `cat:${cat.id}`
    }]);
    buttons.push([{ text: '❌ Отмена', callback_data: 'cancel' }]);

    await sendMessage(chatId,
        `🏢 Клиент: *${clientName}*\n\n📂 Выберите категорию:`,
        { inline_keyboard: buttons }
    );
}

// --- Telegram API ---
async function sendMessage(chatId: number, text: string, options: any = {}) {
    if (!COSTS_BOT_TOKEN.value()) {
        logger.error("Missing COSTS_BOT_TOKEN");
        return;
    }

    try {
        const body: any = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...options
        };

        if (options.keyboard) {
            body.reply_markup = { keyboard: options.keyboard, resize_keyboard: true };
            delete body.keyboard;
        }
        if (options.inline_keyboard) {
            body.reply_markup = { inline_keyboard: options.inline_keyboard };
            delete body.inline_keyboard;
        }

        await axios.post(`https://api.telegram.org/bot${COSTS_BOT_TOKEN.value()}/sendMessage`, body);
    } catch (error: any) {
        logger.error('Error sending message:', error?.response?.data || error.message);
    }
}

// --- Session Management ---
async function getSession(userId: number): Promise<CostSession | null> {
    const doc = await db.collection('bot_sessions').doc(`costs_${userId}`).get();
    return doc.exists ? doc.data() as CostSession : null;
}

async function setSession(userId: number, session: CostSession): Promise<void> {
    await db.collection('bot_sessions').doc(`costs_${userId}`).set(session);
}

async function clearSession(userId: number): Promise<void> {
    await db.collection('bot_sessions').doc(`costs_${userId}`).delete();
}
