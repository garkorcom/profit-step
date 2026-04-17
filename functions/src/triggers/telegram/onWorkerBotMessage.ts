import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as ShoppingHandler from './handlers/shoppingHandler';
import * as InboxHandler from './handlers/inboxHandler';
import * as GtdHandler from './handlers/gtdHandler';
import { sendMessage, getActiveSession, getActiveSessionStrict, sendMainMenu, findPlatformUser, logBotAction } from './telegramUtils';
import { generateConversationalReply } from '../../services/telegramAIAssistant';

// Handler modules (extracted for modularity)
import { initWorkSession, pauseWorkSession, resumeWorkSession, extendSession } from './handlers/sessionManager';
import { handleLocation, handleLocationConfirmStart, handleLocationPickOther, handleLocationCancel, handleLocationNewClient, handleLocationConfirmFinish, handleLocationCancelFinish } from './handlers/locationFlow';
import { handleMediaUpload, handleVoiceMessage, handleSkipMedia } from './handlers/mediaHandler';
import { handleChecklistCallback } from './handlers/checklistFlow';
import { handleStatusRequest, handleHelpRequest, handleMe, handleNameChange, handleTimezone } from './handlers/profileHandlers';
import { handleText, handleCancel } from './handlers/textFallbacks';

// Types
import { TelegramUpdate } from './types/telegram';

// Initialize in the file if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Configuration
// SECURITY: Prefer environment variable, fallback to config, then hardcoded (for dev/ref)
// Ideally: firebase functions:config:set worker_bot.token="..." worker_bot.password="..."
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || '';
const WORKER_PASSWORD = process.env.WORKER_PASSWORD || '9846' || '9846';

// --- Main Function ---

export const onWorkerBotMessage = functions.https.onRequest(async (req, res) => {
    // DIAGNOSTIC LOGGING
    logger.info(`📨 Telegram Webhook Request`, { method: req.method, path: req.path });
    logger.info(`🔑 Config Check`, { tokenConfigured: !!WORKER_BOT_TOKEN });

    // 1. Handle Telegram Webhook
    if (req.method === 'POST') {
        try {
            const update = req.body as TelegramUpdate;
            logger.info('📦 Update Payload', { updateId: update.update_id, from: update.message?.from?.id || update.callback_query?.from?.id });

            // Handle Callback Queries (Button Clicks)
            if (update.callback_query) {
                logger.info(`🔘 Processing Callback`, { data: update.callback_query.data });
                await logBotAction(update.callback_query.from.id, update.callback_query.from.id, 'callback_query', { data: update.callback_query.data });
                await handleCallbackQuery(update.callback_query);
                res.status(200).send('OK');
                return;
            }

            // Handle Messages
            if (update.message) {
                // IDEMPOTENCY: Prevent duplicate processing on poor network
                const msgId = `tg_${update.message.from.id}_${update.message.message_id}`;
                const processedRef = db.collection('processed_messages').doc(msgId);
                const already = await processedRef.get();

                if (already.exists) {
                    logger.info(`⏭️ Skipping duplicate message`, { msgId });
                    res.status(200).send('OK');
                    return;
                }

                // Mark as processed BEFORE handling (to prevent race conditions)
                await processedRef.set({
                    processedAt: admin.firestore.FieldValue.serverTimestamp(),
                    userId: update.message.from.id
                });

                await logBotAction(update.message.from.id, update.message.from.id, 'incoming_message', {
                    text: update.message.text ? update.message.text.substring(0, 100) : null,
                    hasPhoto: !!update.message.photo,
                    hasVoice: !!update.message.voice,
                    hasLocation: !!update.message.location
                });

                await handleMessage(update.message);
                res.status(200).send('OK');
                return;
            }

            res.status(200).send('OK');
        } catch (error) {
            logger.error('Error in onWorkerBotMessage', error);
            res.status(500).send('Internal Server Error');
        }
    } else {
        res.status(405).send('Method Not Allowed');
    }
});

// --- Handlers ---

async function handleMessage(message: any) {
    const chatId = message.chat.id;
    const text = message.text;
    const userId = message.from.id;
    const userName = message.from.first_name;

    // 1. Check Auth
    const isAuth = await checkAuth(userId);

    if (!isAuth) {
        if (text === `/login ${WORKER_PASSWORD}` || text === WORKER_PASSWORD) {
            await registerWorker(userId, userName);
            await sendMessage(chatId, "✅ Authorization successful! You can now use the bot.\n\nCommands:\n/start - Main Menu\n/help - Instructions");
            await sendMainMenu(chatId, userId);
            return;
        }
        await sendMessage(chatId, "🔒 Access Denied.\nPlease enter the access password:");
        return;
    }

    // 2. Main Logic
    if (text === '/start' || text === '/menu') {
        // --- EMERGENCY RESET (ZERO-BLOCK) --- Fix 3 (Wave 2): Covers ALL awaiting states
        const activeSession = await getActiveSession(userId);
        if (activeSession) {
            const data = activeSession.data();
            if (data.awaitingLocation || data.awaitingChecklist || data.awaitingStartPhoto || data.awaitingStartVoice
                || data.awaitingEndLocation || data.awaitingEndPhoto || data.awaitingEndVoice || data.awaitingDescription) {
                // User called menu while stuck. Unblock them from any state.
                await activeSession.ref.update({
                    awaitingLocation: false,
                    awaitingChecklist: false,
                    awaitingStartPhoto: false,
                    awaitingStartVoice: false,
                    awaitingEndLocation: false,
                    awaitingEndPhoto: false,
                    awaitingEndVoice: false,
                    awaitingDescription: false,
                    skippedStartPhoto: data.awaitingStartPhoto || false,
                    skippedEndPhoto: data.awaitingEndPhoto || false,
                });
                await logBotAction(userId, userId, 'emergency_menu_reset', {
                    previousState: data.awaitingLocation ? 'location' : data.awaitingStartPhoto ? 'startPhoto'
                        : data.awaitingStartVoice ? 'startVoice' : data.awaitingEndPhoto ? 'endPhoto'
                            : data.awaitingEndVoice ? 'endVoice' : 'description'
                });
            }
        }
        await sendMainMenu(chatId, userId);
    } else if (text === '/?' || text === '/help') {
        // Help command with instructions for adding new users
        await sendMessage(chatId, `📚 *Справка*

*Как добавить нового пользователя:*
1️⃣ Новый сотрудник открывает бота в Telegram
2️⃣ Нажимает /start
3️⃣ Вводит пароль: \`9846\`
4️⃣ После авторизации появится в системе

━━━━━━━━━━━━━━━━━━
*📝 Быстрое создание задачи:*

\`/task Купить краску для Смирнова\`

→ Создаст задачу в Inbox!
🤖 AI определит тип, приоритет и дату.

━━━━━━━━━━━━━━━━━━
*🎙 Голосовые задачи:*

Просто отправь голосовое → AI транскрибирует и создаст задачу в Inbox!

━━━━━━━━━━━━━━━━━━
*Доступные команды:*
/start - Главное меню
/task <описание> - Создать задачу
/? или /help - Эта справка
🛒 Закупки - Списки покупок

*Работа с таймером:*
📎 Геолокация — Начать/Завершить смену
⏹️ Finish Work - Завершить работу
☕ Break - Перерыв`);
    } else if (text === '▶️ Начать смену') {
        // V2: Start shift button → photo instruction
        const activeSession = await getActiveSession(userId);
        if (activeSession) {
            const sd = activeSession.data();
            const now = Date.now();
            const startMs = sd.startTime?.toMillis?.() || now;
            const elapsed = Math.floor((now - startMs) / 60000);
            const h = Math.floor(elapsed / 60);
            const m = elapsed % 60;
            await sendMessage(chatId, `⚠️ Ты уже на смене!\n\n🏢 Объект: *${sd.clientName}*\nВремя: ${h}ч ${m}мин.`);
            await sendMainMenu(chatId, userId);
        } else {
            // Show start instructions with location button — don't repeat main menu
            await sendMessage(chatId,
                `📍 *Для начала смены:*\n\nОтправь свою *геолокацию* — бот определит объект автоматически.\n\n_(Нажми 📎 скрепку → Геопозиция)_`,
                {
                    keyboard: [
                        [{ text: '📍 Отправить Локацию', request_location: true }],
                        [{ text: '❌ Отмена' }]
                    ],
                    resize_keyboard: true
                }
            );
        }
    } else if (text === '⏹ Завершить смену' || text === '⏹️ Finish Work') {
        await handleFinishWorkRequest(chatId, userId);
    } else if (text === '⏸ Перерыв' || text === '☕ Break') {
        await logBotAction(userId, userId, 'break_started');
        await pauseWorkSession(chatId, userId);
    } else if (text === '▶️ Продолжить работу' || text === '▶️ Resume Work') {
        await logBotAction(userId, userId, 'break_ended');
        await resumeWorkSession(chatId, userId);
    } else if (text === '📊 Мой статус') {
        await handleStatusRequest(chatId, userId);
    } else if (text === '❓ Помощь') {
        await handleHelpRequest(chatId, userId);
    } else if (text === '▶️ Start Work') {
        // Backward compat: old Start Work button → redirect
        await sendMessage(chatId, "📎 *Новый способ старта!*\n\nЧтобы начать смену, нажми 📎 (скрепку) и отправь свою *Геолокацию*.\nБот автоматически определит объект.");
        await sendMainMenu(chatId, userId);
    } else if (text === '⚠️ Finish Late') {
        await handleFinishLateRequest(chatId, userId);
    } else if (text === '❌ Cancel' || text === '/cancel') {
        await logBotAction(userId, userId, 'cancel_action');
        await handleCancel(chatId, userId);
    } else if (text === '⏩ Skip' || text === '⏩ Пропустить' || text === '⏩ Пропустить (Слабый интернет)' || text === '⏩ Пропустить фото') {
        await logBotAction(userId, userId, 'skip_media');
        // Check if we are awaiting location specifically (since Location uses string match fallback)
        const activeSession = await getActiveSession(userId);
        if (activeSession && activeSession.data().awaitingLocation) {
            await activeSession.ref.update({
                awaitingLocation: false,
                startLocation: null
            });
            await sendMessage(chatId, "⏩ Локация пропущена. Смена активна!");
            await sendMainMenu(chatId, userId);
        } else {
            // Normal media skip flow
            await handleSkipMedia(chatId, userId);
        }
    } else if (message.photo || message.document || message.video) {
        // Check if awaiting shopping receipt photo
        if (message.photo) {
            const largestPhoto = message.photo[message.photo.length - 1];

            // First check goods photo (Double Proof Step 2)
            const wasGoodsPhoto = await ShoppingHandler.handleGoodsPhoto(
                chatId, userId, largestPhoto.file_id
            );
            if (wasGoodsPhoto) return;

            // Then check receipt upload
            const wasReceipt = await ShoppingHandler.handleShoppingReceiptPhoto(
                chatId, userId, largestPhoto.file_id, message.from.first_name
            );
            if (wasReceipt) return;

            // Then check smart add photo (Shopping)
            const wasSmartAdd = await ShoppingHandler.handleShoppingPhotoInput(
                chatId, userId, largestPhoto.file_id
            );
            if (wasSmartAdd) return;
        }

        // If not shopping related, proceed to work session media logic
        const activeSessionForMedia = await getActiveSession(userId);
        if (!activeSessionForMedia && message.photo) {
            // Check for forwarded message
            if (message.forward_from) {
                const platformUser = await findPlatformUser(userId);
                await InboxHandler.handleInboxForward({
                    chatId, userId, userName, messageId: message.message_id,
                    platformUserId: platformUser?.id
                }, message.caption || '📷 Фото', message.forward_from);
                return;
            }
            // Route to inbox for photos (unless starting work session)
            const platformUser = await findPlatformUser(userId);
            await InboxHandler.handleInboxPhoto({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, message.photo, message.caption, message.media_group_id);
        } else {
            await handleMediaUpload(chatId, userId, message);
        }
    } else if (message.voice) {
        // Fix 5 (Wave 2): Work voice takes priority over Shopping when session awaits voice
        const activeSessionForVoice = await getActiveSessionStrict(userId);
        if (activeSessionForVoice) {
            const voiceSessionData = activeSessionForVoice.data();
            if (voiceSessionData.awaitingStartVoice || voiceSessionData.awaitingEndVoice) {
                // Session needs this voice — route to work report, NOT shopping
                await handleVoiceMessage(chatId, userId, message);
                return;
            }
        }

        // Check if awaiting shopping voice input
        const wasShoppingVoice = await ShoppingHandler.handleShoppingVoiceInput(
            chatId, userId, message.voice.file_id
        );
        if (wasShoppingVoice) return;

        // Check for active session (other voice scenarios)
        if (activeSessionForVoice) {
            await handleVoiceMessage(chatId, userId, message);
        } else {
            // No session - route to inbox
            const platformUser = await findPlatformUser(userId);
            await InboxHandler.handleInboxVoice({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, message.voice);
        }
    } else if (message.document) {
        // Document without session - route to inbox
        const activeSessionForDoc = await getActiveSession(userId);
        if (!activeSessionForDoc) {
            const platformUser = await findPlatformUser(userId);
            await InboxHandler.handleInboxDocument({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, message.document);
            return;
        }
        // Else fall through to media upload handler
        await handleMediaUpload(chatId, userId, message);
    } else if (message.forward_from && message.text) {
        // Forwarded text message
        const activeSessionForFwd = await getActiveSession(userId);
        if (!activeSessionForFwd) {
            const platformUser = await findPlatformUser(userId);
            await InboxHandler.handleInboxForward({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, message.text, message.forward_from);
            return;
        }
    } else if (message.location) {
        await handleLocation(chatId, userId, message.location);
    } else if (text === '/me') {
        await handleMe(chatId, userId);
    } else if (text && text.startsWith('/name ')) {
        const newName = text.substring(6).trim();
        await handleNameChange(chatId, userId, newName);
    } else if (text && text.startsWith('/timezone ')) {
        const timezone = text.substring(10).trim();
        await handleTimezone(chatId, userId, timezone);
    } else if (text === '/tasks' || text === '📋 Tasks') {
        await GtdHandler.sendTasksMenu(chatId, userId);
    } else if (text && text.startsWith('/task ')) {
        // Quick task creation: /task <description>
        const taskDescription = text.substring(6).trim();
        if (taskDescription.length < 3) {
            await sendMessage(chatId, '⚠️ Описание задачи слишком короткое.\n\nПример: `/task Купить краску для объекта`');
            return;
        }
        await GtdHandler.handleQuickTask(chatId, userId, taskDescription, userName);
    } else if (text && text.startsWith('/plan')) {
        // AI Day Planner: /plan | /plan week | /plan tomorrow
        const args = text.length > 5 ? text.substring(5).trim() : '';
        await GtdHandler.handlePlanCommand(chatId, userId, args);
    } else if (text === '/shopping' || text === '🛒 Shopping') {
        await ShoppingHandler.handleShoppingCommand(chatId, userId);
    } else if (text === '/inbox' || text === '📥 Inbox') {
        // Inbox mode - explain how to use
        await sendMessage(chatId, `📥 *Режим Inbox*

Просто отправь мне:
• 📝 Текст — запишу заметку
• 🎙 Голосовое — транскрибирую AI
• 📷 Фото — сохраню с подписью
• 📎 Файл — сохраню документ

Всё попадёт в твой Inbox для дальнейшей обработки.`);
    } else if (text && text.length > 0) {
        // Handle text descriptions if awaiting, OR send to AI Assistant
        const activeSession = await getActiveSession(userId);

        if (activeSession) {
            const sessionData = activeSession.data();
            const isExpectedInput = sessionData.awaitingLocation ||
                                  sessionData.awaitingChecklist ||
                                  sessionData.awaitingStartPhoto ||
                                  sessionData.awaitingEndPhoto ||
                                  sessionData.awaitingStartVoice ||
                                  sessionData.awaitingEndVoice ||
                                  sessionData.awaitingDescription;
            if (isExpectedInput) {
                // In work session and expecting input - use old logic
                await handleText(chatId, userId, text);
                return;
            }
        }

        // --- AI Assistant Integration ---
        const platformUser = await findPlatformUser(userId);

        let sessionCtx: any = { status: 'none' };
        if (activeSession) {
            const sd = activeSession.data();
            sessionCtx = {
                status: sd.status || 'active',
                taskName: sd.taskTitle || sd.plannedTaskDescription || undefined,
                startedAt: sd.startTime?.toDate(),
            };
            if (sd.startTime) {
                const now = Date.now();
                const start = sd.startTime.toMillis();
                const totalBreaks = sd.totalBreakMinutes || 0;
                let ongoingBreak = 0;
                if (sd.status === 'paused' && sd.lastBreakStart) {
                    ongoingBreak = Math.floor((now - sd.lastBreakStart.toMillis()) / 60000);
                }
                const elapsedTotal = Math.floor((now - start) / 60000);
                sessionCtx.durationMinutes = Math.max(0, elapsedTotal - totalBreaks - ongoingBreak);
            }
        }

        // Send a quick typing action to show it's alive (optional, but good UX)
        try {
            await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendChatAction`, {
                chat_id: chatId,
                action: 'typing'
            });
        } catch (e) { /* ignore */ }

        const aiResponse = await generateConversationalReply(userId, userName, text, sessionCtx);

        if (!aiResponse) {
            // Fallback if AI fails completely
            await InboxHandler.handleInboxText({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, text);
            return;
        }

        if (aiResponse.intent === 'chat') {
            await sendMessage(chatId, aiResponse.reply);
            await sendMainMenu(chatId, userId);
        } else {
            // Note intent -> Save to Inbox AND send the AI's custom reply (suppressing default 'Saved' msg)
            await InboxHandler.handleInboxText({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, text, true); // suppressReply = true

            await sendMessage(chatId, aiResponse.reply);
            await sendMainMenu(chatId, userId);
        }
    } else {
        await sendMessage(chatId, "I didn't understand that. Please use the menu or type /help.");
    }
}

async function handleCallbackQuery(query: any) {
    const chatId = query.message.chat.id;
    const data = query.data;
    const userId = query.from.id;

    // Fix 6 (Deep Testing): Zombie inline button guard
    // Reject callbacks from messages older than 5 minutes to prevent stale clicks
    const CALLBACK_MAX_AGE_SECONDS = 300; // 5 minutes
    const messageDate = query.message?.date;
    if (messageDate && (Math.floor(Date.now() / 1000) - messageDate > CALLBACK_MAX_AGE_SECONDS)) {
        // Allow GTD/Shopping callbacks (they're always valid)
        const isAlwaysValid = data.startsWith('tasks:') || data.startsWith('task_view:') ||
            data.startsWith('task_done:') || data.startsWith('task_move:') ||
            data.startsWith('shop:') || data.startsWith('draft:') || data === 'tasks_back' ||
            data.startsWith('checklist_');
        if (!isAlwaysValid) {
            logger.info(`🔇 Zombie callback rejected from user ${userId}: "${data}" (age: ${Math.floor(Date.now() / 1000) - messageDate}s)`);
            try {
                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: query.id,
                    text: '⚠️ Эта кнопка устарела. Используйте /start',
                    show_alert: true
                });
            } catch (e) { /* ignore */ }
            return;
        }
    }

    try {
        if (data.startsWith('start_client_')) {
            const clientId = data.split('start_client_')[1];
            await handleClientSelection(chatId, userId, clientId);
        } else if (data.startsWith('svc|')) {
            // Format: svc|<clientId>|<serviceIndex>
            const parts = data.split('|');
            const clientId = parts[1];
            const serviceIndex = parseInt(parts[2]);
            await handleServiceSelection(chatId, userId, clientId, serviceIndex);
        } else if (data === 'cancel_selection') {
            await sendMessage(chatId, "Selection cancelled.");
            await sendMainMenu(chatId, userId);
        }
        // --- NEW HANDLERS ---
        else if (data === 'force_finish_work') {
            await handleFinishWorkRequest(chatId, userId);
        } else if (data === 'cancel_close_session') {
            try {
                await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/deleteMessage`, {
                    chat_id: chatId,
                    message_id: query.message.message_id
                });
            } catch (e) {
                 await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/editMessageReplyMarkup`, {
                     chat_id: chatId,
                     message_id: query.message.message_id,
                     reply_markup: { inline_keyboard: [] }
                 }).catch(() => {});
            }
            await sendMessage(chatId, "▶️ Принято, продолжаем работу.");
        } else if (data === 'extend_1h') {
            await extendSession(chatId, userId, 60);
        } else if (data === 'extend_2h') {
            await extendSession(chatId, userId, 120);
        } else if (data === 'still_working') {
            await extendSession(chatId, userId, 30); // Snooze for 30 mins
        }
        // --- GTD TASKS HANDLERS ---
        else if (data === 'tasks_back' || data.startsWith('tasks:') || data.startsWith('task_view:') || data.startsWith('task_done:') || data.startsWith('task_move:')) {
            await GtdHandler.handleGtdCallback(chatId, userId, data);
        }
        // --- LOCATION FLOW HANDLERS ---
        else if (data === 'location_confirm_start') {
            await handleLocationConfirmStart(chatId, userId);
        } else if (data === 'location_pick_other') {
            await handleLocationPickOther(chatId, userId);
        } else if (data === 'location_cancel') {
            await handleLocationCancel(chatId, userId);
        } else if (data.startsWith('location_new_client_')) {
            const clientId = data.split('location_new_client_')[1];
            await handleLocationNewClient(chatId, userId, clientId);
        }
        // --- FINISH CONFIRMATION HANDLERS (Fix 4) ---
        else if (data === 'location_confirm_finish') {
            await handleLocationConfirmFinish(chatId, userId);
        } else if (data === 'location_cancel_finish') {
            await handleLocationCancelFinish(chatId, userId);
        }
        // --- SHOPPING HANDLERS ---
        else if (data.startsWith('shop:')) {
            await ShoppingHandler.handleShoppingCallback(chatId, userId, data, query.message.message_id);
        }
        // --- CHECKLIST HANDLERS ---
        else if (data.startsWith('checklist_')) {
            await handleChecklistCallback(chatId, userId, data);
        }
        // --- DRAFT HANDLERS (shopping add confirmation) ---
        else if (data.startsWith('draft:')) {
            const parts = data.split(':');
            const action = parts[1];
            const params = parts.slice(2);
            await ShoppingHandler.handleDraftCallback(chatId, userId, action, params);
        }

    } catch (error) {
        logger.error('Error in handleCallbackQuery', error);
        await sendMessage(chatId, "⚠️ Error processing request.");
    } finally {
        // Answer callback to stop loading animation
        try {
            await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: query.id
            });
        } catch (e) {
            logger.error('Error answering callback', e);
        }
    }
}

// --- Core Auth & Routing Helpers (kept in main file) ---

async function checkAuth(userId: number): Promise<boolean> {
    const doc = await db.collection('employees').doc(String(userId)).get();
    return doc.exists;
}

async function registerWorker(userId: number, name: string) {
    await db.collection('employees').doc(String(userId)).set({
        telegramId: userId,
        name: name,
        role: 'worker',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
}

// sendClientList removed — no longer used in Location-First flow

async function handleClientSelection(chatId: number, userId: number, clientId: string) {
    if (clientId === 'no_project') {
        const noProjectRef = db.collection('clients').doc('no_project');
        const noProjectDoc = await noProjectRef.get();

        if (!noProjectDoc.exists) {
            // Auto-create "No Project" client
            await noProjectRef.set({
                name: 'No Project',
                status: 'active',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        // Start session directly (no services)
        await initWorkSession(chatId, userId, 'no_project');
        return;
    }

    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
        await sendMessage(chatId, "⚠️ Client not found.");
        return;
    }
    const clientData = clientDoc.data();
    const services = clientData?.services || [];

    if (services.length > 0) {
        // Show Service Selection Menu
        const inlineKeyboard = services.map((service: string, index: number) => {
            return [{ text: service, callback_data: `svc|${clientId}|${index}` }];
        });
        inlineKeyboard.push([{ text: "🔙 Back", callback_data: "start_client_" + clientId }]); // Loopback or cancel? Better just cancel or re-list. Let's do cancel for simplicity or restart list.
        // Actually "Back" to client list is better but we need to re-fetch.
        // Let's just have Cancel.
        inlineKeyboard.push([{ text: "❌ Cancel", callback_data: "cancel_selection" }]);

        await sendMessage(chatId, `🛠 Select Service for *${clientData?.name}*:`, { inline_keyboard: inlineKeyboard });
    } else {
        // No services, start directly
        await initWorkSession(chatId, userId, clientId);
    }
}

async function handleServiceSelection(chatId: number, userId: number, clientId: string, serviceIndex: number) {
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
        await sendMessage(chatId, "⚠️ Client not found.");
        return;
    }
    const clientData = clientDoc.data();
    const services = clientData?.services || [];

    if (serviceIndex >= 0 && serviceIndex < services.length) {
        const serviceName = services[serviceIndex];
        await initWorkSession(chatId, userId, clientId, serviceName);
    } else {
        await sendMessage(chatId, "⚠️ Invalid service selected.");
    }
}

async function handleFinishWorkRequest(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены для завершения.");
        await sendMainMenu(chatId, userId);
        return;
    }

    // Mark as awaiting end location (NEW: Anti-fraud step)
    await activeSession.ref.update({
        awaitingEndLocation: true
    });

    await sendMessage(chatId,
        "📍 Для завершения смены отправь **текущую геопозицию**.\n(Скрепка 📎 -> Локация)\n\n*Это нужно для подтверждения твоего присутствия на объекте.*",
        {
            keyboard: [
                [{ text: "📍 Отправить Локацию", request_location: true }],
                [{ text: "⏩ Пропустить (Слабый интернет)" }, { text: "❌ Отмена" }]
            ],
            resize_keyboard: true
        }
    );
}

async function handleFinishLateRequest(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ You don't have an active work session.");
        await sendMainMenu(chatId, userId);
        return;
    }

    // "Finish Late" Flow:
    // 1. Mark session as needing adjustment
    // 2. Skip Photo & Voice
    // 3. Ask for text description/time

    await activeSession.ref.update({
        needsAdjustment: true,
        awaitingDescription: true // Skip directly to description
    });

    await sendMessage(chatId, "🕒 *Позднее закрытие*\n\nВведите реальное время окончания или причину позднего закрытия:", {
        keyboard: [[{ text: "⏩ Skip" }]], // User can skip providing reason? Probably better to enforce text but "Skip" allows finalizing with empty reason.
        resize_keyboard: true
    });
}
