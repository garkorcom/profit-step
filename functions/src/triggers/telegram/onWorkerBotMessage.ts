import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { findNearbyProject, saveProjectLocation, updateLocationLastUsed } from '../../utils/geoUtils';
import * as ShoppingHandler from './handlers/shoppingHandler';
import * as InboxHandler from './handlers/inboxHandler';
import * as GtdHandler from './handlers/gtdHandler';
import { sendMessage, getActiveSession, sendMainMenu } from './telegramUtils';
// TODO Phase 1: Use UserContext for optimized DB calls
// import { buildUserContext, UserContext, toInboxContext } from './userContext';

// Initialize in the file if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Configuration
// SECURITY: Prefer environment variable, fallback to config, then hardcoded (for dev/ref)
// Ideally: firebase functions:config:set worker_bot.token="..." worker_bot.password="..."
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;
const WORKER_PASSWORD = process.env.WORKER_PASSWORD || functions.config().worker_bot?.password || '9846';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || functions.config().worker_bot?.admin_group_id;

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
        caption?: string;  // Photo/video caption
        media_group_id?: string;  // Album grouping
        forward_from?: {  // Forwarded message info
            id: number;
            first_name: string;
        };
        photo?: {
            file_id: string;
            file_unique_id: string;
            width: number;
            height: number;
        }[];
        document?: {
            file_id: string;
            file_name?: string;
            mime_type?: string;
        };
        video?: {
            file_id: string;
            mime_type?: string;
        };
        voice?: {
            file_id: string;
            duration: number;
            mime_type?: string;
            file_size?: number;
        };
        location?: {
            latitude: number;
            longitude: number;
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
    if (text === '/start') {
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
▶️ Start Work - Начать сессию
⏹️ Finish Work - Завершить работу  
☕ Break - Перерыв`);
    } else if (text === '▶️ Start Work') {
        await sendClientList(chatId);
    } else if (text === '⏹️ Finish Work') {
        await handleFinishWorkRequest(chatId, userId);
    } else if (text === '⚠️ Finish Late') {
        await handleFinishLateRequest(chatId, userId);
    } else if (text === '☕ Break') {
        await pauseWorkSession(chatId, userId);
    } else if (text === '▶️ Resume Work') {
        await resumeWorkSession(chatId, userId);
    } else if (text === '❌ Cancel' || text === '/cancel') {
        await handleCancel(chatId, userId);
    } else if (text === '⏩ Skip') {
        await handleSkipMedia(chatId, userId);
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
                const platformUser = await InboxHandler.findPlatformUserForInbox(userId);
                await InboxHandler.handleInboxForward({
                    chatId, userId, userName, messageId: message.message_id,
                    platformUserId: platformUser?.id
                }, message.caption || '📷 Фото', message.forward_from);
                return;
            }
            // Route to inbox for photos (unless starting work session)
            const platformUser = await InboxHandler.findPlatformUserForInbox(userId);
            await InboxHandler.handleInboxPhoto({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, message.photo, message.caption, message.media_group_id);
        } else {
            await handleMediaUpload(chatId, userId, message);
        }
    } else if (message.voice) {
        // Check if awaiting shopping voice input
        const wasShoppingVoice = await ShoppingHandler.handleShoppingVoiceInput(
            chatId, userId, message.voice.file_id
        );
        if (wasShoppingVoice) return;

        // Check for active session
        const activeSessionForVoice = await getActiveSession(userId);
        if (activeSessionForVoice) {
            // Regular voice handling (work report)
            await handleVoiceMessage(chatId, userId, message);
        } else {
            // No session - route to inbox
            const platformUser = await InboxHandler.findPlatformUserForInbox(userId);
            await InboxHandler.handleInboxVoice({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, message.voice);
        }
    } else if (message.document) {
        // Document without session - route to inbox
        const activeSessionForDoc = await getActiveSession(userId);
        if (!activeSessionForDoc) {
            const platformUser = await InboxHandler.findPlatformUserForInbox(userId);
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
            const platformUser = await InboxHandler.findPlatformUserForInbox(userId);
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
        // Handle text descriptions if awaiting, OR send to inbox
        const activeSession = await getActiveSession(userId);
        if (activeSession) {
            // In work session - use old logic
            await handleText(chatId, userId, text);
        } else {
            // No session - send to inbox
            const platformUser = await InboxHandler.findPlatformUserForInbox(userId);
            await InboxHandler.handleInboxText({
                chatId, userId, userName, messageId: message.message_id,
                platformUserId: platformUser?.id
            }, text);
        }
    } else {
        await sendMessage(chatId, "I didn't understand that. Please use the menu or type /help.");
    }
}

async function handleCallbackQuery(query: any) {
    const chatId = query.message.chat.id;
    const data = query.data;
    const userId = query.from.id;

    try {
        if (data.startsWith('start_client_')) {
            const clientId = data.split('start_client_')[1];
            await handleClientSelection(chatId, userId, clientId);
        } else if (data.startsWith('start_service_idx_')) {
            // Format: start_service_idx_<clientId>_<serviceIndex>
            const parts = data.split('_');
            const clientId = parts[3];
            const serviceIndex = parseInt(parts[4]);
            await handleServiceSelection(chatId, userId, clientId, serviceIndex);
        } else if (data === 'cancel_selection') {
            await sendMessage(chatId, "Selection cancelled.");
            await sendMainMenu(chatId, userId);
        }
        // --- NEW HANDLERS ---
        else if (data === 'force_finish_work') {
            await handleFinishWorkRequest(chatId, userId);
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
        // --- LOCATION FLOW HANDLERS (Photo-First) ---
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
        // --- SHOPPING HANDLERS ---
        else if (data.startsWith('shop:')) {
            await ShoppingHandler.handleShoppingCallback(chatId, userId, data, query.message.message_id);
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

async function extendSession(chatId: number, userId: number, minutes: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) return;

    const snoozeUntil = admin.firestore.Timestamp.fromMillis(Date.now() + (minutes * 60000));

    await activeSession.ref.update({
        reminderCount: 0, // Reset counter
        snoozeUntil: snoozeUntil
    });

    await sendMessage(chatId, `✅ Reminder snoozed for ${minutes} minutes.`);
}

// --- Core Logic ---

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



async function sendClientList(chatId: number) {
    // Fetch clients from Firestore
    // Fetch clients from Firestore
    // SIMPLIFIED QUERY (Fix for Missing Index): 
    // Instead of complex filters, just fetch latest 50 and filter in memory.
    const snapshot = await db.collection('clients')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

    if (snapshot.empty) {
        await sendMessage(chatId, "No clients found in CRM.");
        return;
    }

    const inlineKeyboard: any[][] = [];

    snapshot.docs.forEach(doc => {
        const client = doc.data();
        // Manual filter for 'done' status just in case
        if (client.status === 'done') return;

        inlineKeyboard.push([{ text: client.name, callback_data: `start_client_${doc.id}` }]);
    });

    // Add "No Project" Button
    inlineKeyboard.push([{ text: "🚫 No Project", callback_data: "start_client_no_project" }]);

    // Add Cancel Button
    inlineKeyboard.push([{ text: "❌ Cancel", callback_data: "cancel_selection" }]);

    await sendMessage(chatId, "📍 Select Client/Object:", { inline_keyboard: inlineKeyboard });
}

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
            return [{ text: service, callback_data: `start_service_idx_${clientId}_${index}` }];
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

async function initWorkSession(chatId: number, userId: number, clientId: string, serviceName?: string) {
    // 1. Check if already active
    const activeSession = await getActiveSession(userId);
    let autoSwitchMsg = '';

    if (activeSession) {
        // AUTO-SWITCH: Finish the active session automatically
        autoSwitchMsg = await autoFinishActiveSession(activeSession, chatId, userId);
    }

    // 2. Get Client Name
    const clientDoc = await db.collection('clients').doc(clientId).get();
    let clientName = clientDoc.exists ? clientDoc.data()?.name : 'Unknown Client';

    if (serviceName) {
        clientName = `${clientName} - ${serviceName}`;
    }

    // 3. Identity Sync
    const platformUser = await findPlatformUser(userId);
    let employeeName = 'Worker';
    let platformUserId = null;
    let companyId = null;
    let hourlyRate = 0; // Default rate

    // First get employee record (always exists for bot workers)
    const empDoc = await db.collection('employees').doc(String(userId)).get();
    const empData = empDoc.exists ? empDoc.data() : null;

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId;
        // Priority: platformUser.hourlyRate -> employees.hourlyRate
        hourlyRate = platformUser.hourlyRate || empData?.hourlyRate || 0;

        // Sync local employee record to match platform name
        await db.collection('employees').doc(String(userId)).set({
            name: employeeName,
            telegramId: userId,
            // We preserve role if it exists, or default to worker
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } else {
        // Fallback to local employee record only
        if (empData) {
            employeeName = empData.name || 'Worker';
            hourlyRate = empData.hourlyRate || 0; // Get rate from employee doc
        }
    }

    // 4. Create Session (Pending Location)
    await db.collection('work_sessions').add({
        employeeId: userId,
        employeeName: employeeName,
        platformUserId: platformUserId, // Link to platform user
        companyId: companyId,           // Link to company
        clientId: clientId,
        clientName: clientName,
        startTime: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        service: serviceName || null, // Create field if exists
        awaitingLocation: true,
        awaitingStartPhoto: false,
        hourlyRate: hourlyRate, // Snapshot rate
        // Phase 5: Task linking (optional, for future "Start from Task")
        taskId: null,
        taskTitle: null
    });

    await sendMessage(chatId, `${autoSwitchMsg}📍 Client selected: *${clientName}*\n\nPlease share your **Live Location** or current **Location** to verify attendance.\n(Click the 📎 attachment icon -> Location)`,
        {
            keyboard: [[{ text: "📍 Send Location", request_location: true }, { text: "❌ Cancel" }]],
            resize_keyboard: true
        }
    );
    await sendAdminNotification(`▶️ *Work Started*\n👤 ${employeeName}\n📍 ${clientName}`);
}

async function handleLocation(chatId: number, userId: number, location: any) {
    const activeSession = await getActiveSession(userId);

    // --- CASE 1: Awaiting location for photo-first flow ---
    const pendingPhotoRef = db.collection('pending_photos').doc(String(userId));
    const pendingPhotoDoc = await pendingPhotoRef.get();

    if (pendingPhotoDoc.exists) {
        // pendingData available for future use
        const { latitude, longitude } = location;

        // Try to find matching project by location
        const matchedProject = await findNearbyProject(latitude, longitude);

        if (matchedProject) {
            // Found a match! Show confirmation
            await updateLocationLastUsed(matchedProject.id);

            // Store match for callback
            await pendingPhotoRef.update({
                matchedProjectId: matchedProject.id,
                matchedClientId: matchedProject.clientId,
                matchedClientName: matchedProject.clientName,
                matchedServiceName: matchedProject.serviceName || null,
                location: location
            });

            const serviceSuffix = matchedProject.serviceName ? ` - ${matchedProject.serviceName}` : '';
            await sendMessage(chatId,
                `📍 *Локация определена!*\n\n` +
                `🏢 Проект: *${matchedProject.clientName}${serviceSuffix}*\n\n` +
                `Начать работу здесь?`,
                {
                    inline_keyboard: [
                        [{ text: '✅ Да, начать', callback_data: 'location_confirm_start' }],
                        [{ text: '🔄 Другой проект', callback_data: 'location_pick_other' }],
                        [{ text: '❌ Отмена', callback_data: 'location_cancel' }]
                    ]
                }
            );
        } else {
            // No match - ask to select project and save new location
            await pendingPhotoRef.update({ location: location });

            await sendMessage(chatId,
                `📍 *Новая локация!*\n\nЭта локация не найдена в базе.\nВыбери проект, чтобы сохранить её:`,
                { remove_keyboard: true }
            );

            // Show client list with special callback for saving location
            const snapshot = await db.collection('clients').orderBy('createdAt', 'desc').limit(20).get();
            if (!snapshot.empty) {
                const inlineKeyboard: any[][] = [];
                snapshot.docs.forEach(doc => {
                    const client = doc.data();
                    // Filter out 'done' clients
                    if (client.status === 'done') return;
                    inlineKeyboard.push([{ text: client.name, callback_data: `location_new_client_${doc.id}` }]);
                });
                if (inlineKeyboard.length > 0) {
                    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);
                    await sendMessage(chatId, '🏢 Выбери проект:', { inline_keyboard: inlineKeyboard });
                }
            }
        }
        return;
    }

    // --- CASE 2: Traditional flow (awaiting location after client selection) ---
    if (activeSession && activeSession.data().awaitingLocation) {
        // Validation: Check if location matches the selected client
        const sessionData = activeSession.data();
        const clientId = sessionData.clientId;

        // Skip check for "No Project"
        if (clientId !== 'no_project') {
            // We need to find the project location. 
            // Ideally project_locations has it, or we check the client/site address.
            // For now, let's use the findNearbyProject utility to see if the current location matches the intended client.
            const { latitude, longitude } = location;
            const matchedProject = await findNearbyProject(latitude, longitude);

            if (matchedProject && matchedProject.clientId === clientId) {
                // Perfectly matches!
                const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                await sendMessage(chatId, `✅ Фото принято! Объект *${sessionData.clientName}* время старта *${timeStr}*`);
                await sendMessage(chatId, "🚀 Сессия начата, удачной работы!");
            } else {
                // Warning
                // locationWarning = "\n⚠️ *Локация не соответствует клиенту*"; 
                // Actually logic says: If mismatch -> "Location mismatch", then proceed to voice.
                await sendMessage(chatId, "⚠️ *Локация не соответствует клиенту*");
            }
        } else {
            await sendMessage(chatId, "✅ Локация сохранена.");
        }

        // Save location and move to next step (Skip Photo step as per new requirement? 
        // OLD REQUIREMENT says: "If locations match... Photo accepted". 
        // Wait, "Photo accepted" implies we already sent a photo? 
        // In this flow (CASE 2), we just sent LOCATION. We haven't sent PHOTO yet.
        // The prompt says: "Implement logic of comparing 3 coordinates... If match... Bot replies: 'Photo accepted!'"
        // This implies the user sends a PHOTO with GEO.
        // BUT here we are in `handleLocation` which handles "InputMediaLocation" or "Location Share".

        // Let's re-read: "Implement logic comparing... User Location ... Project Coords ... Photo Geotag".
        // "If locations match... Bot replies 'Photo accepted'".
        // This suggests THIS logic belongs in `handleUnsolicitedPhoto` or `handleMediaUpload` (Start Photo).
        // OR it suggests the flow is: Select Client -> Send Photo (with geo) -> Verify.
        // Currently flow is: Select Client -> Send Location -> Send Photo -> Voice.

        // The Prompt says: "After checking location proceed to voice request." (Screen 4).
        // It seems to imply we SKIP the separate photo step if we do validation here?
        // Or maybe verification happens at the Photo step?
        // Let's look at `handleMediaUpload` (Start Photo).
        // Currently: Awaiting Location -> Awaiting Start Photo.

        // Let's implement this verification in `handleLocation` first (User shares Live Location).
        // And we will ALSO implement it in `handleMediaUpload` if they send a photo with geodata.

        // UPDATED FLOW: 
        // 1. User sends Location.
        // 2. We verify.
        // 3. We reply and ask for Photo? Or Voice?
        // Prompt says: "After checking location transition to voice request".
        // This implies we MIGHT skip the separate text photo request? 
        // But Screen 3 title is "Geolocation and Photo".
        // Let's keep the Photo step but maybe the verification happens THERE?

        // Actually, the prompt says "Implement logic to compare... Location sent by user... Coords of object...".
        // "If match... Bot says: Photo accepted!". 
        // This phrasing "Photo accepted" strongly implies this check happens when the PHOTO is received.
        // So I should modify `handleMediaUpload` (Start Session Photo) to check the location (if available from previous step or metadata).

        // HOWEVER, the `handleLocation` function is where we receive the explicit location.
        // If the user sends location separate from photo, we store it.

        // Let's update `handleLocation` to just store it.
        // And update `handleMediaUpload` to do the check?
        // BUT, `handleMediaUpload` (Start Photo) comes AFTER `handleLocation`.
        // If we want to verify, we verify when we have both (or one if strict).

        // Let's stick to the current flow: Location -> Photo -> Voice.
        // I will add the check in `handleLocation` (validation of the location itself).
        // And I will add the check in `handleUnsolicitedPhoto` (Photo-First).

        // Wait, if I delete the "Photo accepted" message from here, where do I put it?
        // The prompt says: "If locations match... Bot answers: 'Photo accepted! ... Start time ...'".
        // Then "Session started...".
        // Then "Voice report...".

        // So the flow:
        // 1. Client selected.
        // 2. Request Location.
        // 3. User sends Location. -> Bot validates.
        // 4. Request Photo.
        // 5. User sends Photo. -> Bot says "Photo accepted".

        // Okay, I will implement validation in `handleLocation` but keep the "Photo" message for the photo step?
        // "If locations match (with allowed radius): Bot answers 'Photo accepted!...'".
        // This implies the check is done WHEN THE PHOTO IS SENT (using the location from the previous step).

        await activeSession.ref.update({
            startLocation: location,
            awaitingLocation: false,
            awaitingStartPhoto: true
        });

        await sendMessage(chatId, "✅ Локация получена.\n\n📸 Теперь отправь **фото** начала работ.", { remove_keyboard: true });
    } else {
        await sendMessage(chatId, "Updated location received.", { remove_keyboard: true });
    }
}



/**
 * User confirmed auto-detected project - start session.
 */
async function handleLocationConfirmStart(chatId: number, userId: number) {
    const pendingPhotoRef = db.collection('pending_photos').doc(String(userId));
    const pendingPhotoDoc = await pendingPhotoRef.get();

    if (!pendingPhotoDoc.exists) {
        await sendMessage(chatId, "⚠️ Нет ожидающих фото.", { remove_keyboard: true });
        return;
    }

    const data = pendingPhotoDoc.data()!;
    const clientId = data.matchedClientId;
    const clientName = data.matchedClientName;
    const serviceName = data.matchedServiceName;
    const photoUrl = data.url;
    const location = data.location;

    // Create session directly (skip location step since we have it)
    const platformUser = await findPlatformUser(userId);
    let employeeName = 'Worker';
    let platformUserId = null;
    let companyId = null;
    let hourlyRate = 0;

    // Check employees collection for rate (Admin UI saves here)
    const empDoc = await db.collection('employees').doc(String(userId)).get();
    const empData = empDoc.exists ? empDoc.data() : null;

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId;
        // Priority: platformUser.hourlyRate -> employees.hourlyRate
        hourlyRate = platformUser.hourlyRate || empData?.hourlyRate || 0;
    } else if (empData) {
        employeeName = empData.name || 'Worker';
        hourlyRate = empData.hourlyRate || 0;
    }

    await db.collection('work_sessions').add({
        employeeId: userId,
        employeeName: employeeName,
        platformUserId: platformUserId,
        companyId: companyId,
        clientId: clientId,
        clientName: serviceName ? `${clientName} - ${serviceName}` : clientName,
        startTime: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        service: serviceName || null,
        startLocation: location,
        startPhotoUrl: photoUrl,
        awaitingLocation: false,
        awaitingStartPhoto: false,
        awaitingStartVoice: true, // Go to voice step
        hourlyRate: hourlyRate,
        photoFirstFlow: true, // Mark as photo-first
        taskId: null,
        taskTitle: null
    });

    // Cleanup pending photo
    await pendingPhotoRef.delete();

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Проект: *${clientName}${serviceName ? ' - ' + serviceName : ''}*\n\n` +
        `🎙 Запиши голосовое: что планируешь сегодня делать?`,
        {
            keyboard: [[{ text: '⏩ Skip' }]],
            resize_keyboard: true
        }
    );

    await sendAdminNotification(`▶️ *Work Started (Auto)*\n👤 ${employeeName}\n📍 ${clientName}`);
}

/**
 * User wants to pick a different project than auto-detected.
 */
async function handleLocationPickOther(chatId: number, userId: number) {
    const snapshot = await db.collection('clients').orderBy('createdAt', 'desc').limit(20).get();

    if (snapshot.empty) {
        await sendMessage(chatId, "No clients found.");
        return;
    }

    const inlineKeyboard: any[][] = [];
    snapshot.docs.forEach(doc => {
        const client = doc.data();
        // Filter out 'done' clients
        if (client.status === 'done') return;
        inlineKeyboard.push([{ text: client.name, callback_data: `location_new_client_${doc.id}` }]);
    });
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);

    await sendMessage(chatId, '🏢 Выбери проект:', { inline_keyboard: inlineKeyboard });
}

/**
 * Cancel the photo-first flow.
 */
async function handleLocationCancel(chatId: number, userId: number) {
    const pendingPhotoRef = db.collection('pending_photos').doc(String(userId));
    await pendingPhotoRef.delete();

    await sendMessage(chatId, "❌ Отменено.", { remove_keyboard: true });
    await sendMainMenu(chatId, userId);
}

/**
 * User selected a new client for the photo-first flow.
 * Save the location to project_locations and start session.
 */
async function handleLocationNewClient(chatId: number, userId: number, clientId: string) {
    const pendingPhotoRef = db.collection('pending_photos').doc(String(userId));
    const pendingPhotoDoc = await pendingPhotoRef.get();

    if (!pendingPhotoDoc.exists) {
        await sendMessage(chatId, "⚠️ Нет ожидающих фото.");
        return;
    }

    const pendingData = pendingPhotoDoc.data()!;
    const location = pendingData.location;
    const photoUrl = pendingData.url;

    // Get client info
    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
        await sendMessage(chatId, "⚠️ Клиент не найден.");
        return;
    }
    const clientData = clientDoc.data()!;
    const clientName = clientData.name;

    // Save new location to project_locations
    await saveProjectLocation(
        clientId,
        clientName,
        location.latitude,
        location.longitude,
        userId
    );

    // Create session
    const platformUser = await findPlatformUser(userId);
    let employeeName = 'Worker';
    let platformUserId = null;
    let companyId = null;
    let hourlyRate = 0;

    // Check employees collection for rate (Admin UI saves here)
    const empDoc = await db.collection('employees').doc(String(userId)).get();
    const empData = empDoc.exists ? empDoc.data() : null;

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId;
        // Priority: platformUser.hourlyRate -> employees.hourlyRate
        hourlyRate = platformUser.hourlyRate || empData?.hourlyRate || 0;
    } else if (empData) {
        employeeName = empData.name || 'Worker';
        hourlyRate = empData.hourlyRate || 0;
    }

    await db.collection('work_sessions').add({
        employeeId: userId,
        employeeName: employeeName,
        platformUserId: platformUserId,
        companyId: companyId,
        clientId: clientId,
        clientName: clientName,
        startTime: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        startLocation: location,
        startPhotoUrl: photoUrl,
        awaitingLocation: false,
        awaitingStartPhoto: false,
        awaitingStartVoice: true,
        hourlyRate: hourlyRate,
        photoFirstFlow: true,
        taskId: null,
        taskTitle: null
    });

    // Cleanup
    await pendingPhotoRef.delete();

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Проект: *${clientName}*\n` +
        `📍 Локация сохранена для будущего.\n\n` +
        `🎙 Запиши голосовое: что планируешь сегодня делать?`,
        {
            keyboard: [[{ text: '⏩ Skip' }]],
            resize_keyboard: true
        }
    );

    await sendAdminNotification(`▶️ *Work Started (New Location)*\n👤 ${employeeName}\n📍 ${clientName}`);
}

async function pauseWorkSession(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "No active session to pause.");
        await sendMainMenu(chatId, userId);
        return;
    }

    // Add a break entry
    const now = admin.firestore.Timestamp.now();
    await activeSession.ref.update({
        status: 'paused',
        lastBreakStart: now
    });

    await sendMessage(chatId, "☕ Session paused. Enjoy your break! Press 'Resume' when back.");
    await sendMainMenu(chatId, userId); // Update buttons
}

async function resumeWorkSession(chatId: number, userId: number) {
    const sessionSnapshot = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused') // Look for paused
        .limit(1)
        .get();

    if (sessionSnapshot.empty) {
        await sendMessage(chatId, "No paused session found.");
        await sendMainMenu(chatId, userId);
        return;
    }

    const session = sessionSnapshot.docs[0];
    const data = session.data();
    const now = admin.firestore.Timestamp.now();

    // Calculate break duration
    const breakStart = data.lastBreakStart;
    let breakDurationMinutes = 0;
    if (breakStart) {
        breakDurationMinutes = Math.round((now.toMillis() - breakStart.toMillis()) / 60000);
    }

    // --- AUTO-CORRECTION LOGIC ---
    let adjustedBreakMinutes = breakDurationMinutes;
    let adjustmentApplied = false;
    const BREAK_LIMIT = 60; // Configurable limit

    if (breakDurationMinutes > BREAK_LIMIT) {
        // User forgot to resume? Cap at limit, count rest as work.
        adjustedBreakMinutes = BREAK_LIMIT;
        adjustmentApplied = true;
    }

    const updateData: any = {
        status: 'active',
        lastBreakStart: admin.firestore.FieldValue.delete(), // Remove temp field
        breakNotificationSent: admin.firestore.FieldValue.delete(), // clear flag
        breaks: admin.firestore.FieldValue.arrayUnion({
            start: breakStart,
            end: now,
            durationMinutes: adjustedBreakMinutes, // Use adjusted
            originalDuration: breakDurationMinutes,
            autoAdjusted: adjustmentApplied
        }),
        totalBreakMinutes: admin.firestore.FieldValue.increment(adjustedBreakMinutes)
    };

    if (adjustmentApplied) {
        updateData.needsAdjustment = true; // Flag for admin
        updateData.autoCorrectedBreak = true;
    }

    await session.ref.update(updateData);

    if (adjustmentApplied) {
        await sendMessage(chatId, `⚠️ **Корректировка перерыва**\nВаш перерыв длился ${Math.floor(breakDurationMinutes / 60)}ч ${breakDurationMinutes % 60}м.\nМы засчитали стандартный перерыв (1ч), остальное время пошло в работу.\n\n▶️ Работа возобновлена.`);
    } else {
        await sendMessage(chatId, `▶️ Работа возобновлена. Перерыв: ${breakDurationMinutes}м.`);
    }

    await sendMainMenu(chatId, userId);
}

async function handleFinishWorkRequest(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ You don't have an active work session.");
        await sendMainMenu(chatId, userId);
        return;
    }

    // Mark as awaiting end photo
    await activeSession.ref.update({
        awaitingEndPhoto: true
    });

    await sendMessage(chatId, "📸 Please send a photo (or file/video) of the finished work to complete the session.\n\nOr click Skip if not applicable.", {
        keyboard: [[{ text: "⏩ Skip" }]],
        resize_keyboard: true
    });
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

async function handleSkipMedia(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ No active session.", { remove_keyboard: true });
        return;
    }

    const sessionData = activeSession.data();

    if (sessionData.awaitingEndPhoto) {
        // Skip End Photo → go to voice
        await activeSession.ref.update({
            awaitingEndPhoto: false,
            awaitingEndVoice: true,
            skippedEndPhoto: true
        });
        await sendMessage(chatId,
            "⏩ Фото пропущено.\n\n🎙 Запиши голосовое: Что успел сделать?",
            { keyboard: [[{ text: "⏩ Skip" }]], resize_keyboard: true }
        );
    } else if (sessionData.awaitingEndVoice) {
        // Skip End Voice → IMMEDIATE FINALIZE
        // Fix: Record "SKIP" in database instead of generic text
        await finalizeSession(chatId, userId, activeSession, "SKIP");

    } else if (sessionData.awaitingDescription) {
        // Skip Description → Finalize with SKIP marker
        await finalizeSession(chatId, userId, activeSession, "SKIP");

    } else if (sessionData.awaitingStartPhoto) {
        // Skip Start Photo → go to voice
        await activeSession.ref.update({
            awaitingStartPhoto: false,
            awaitingStartVoice: true,
            skippedStartPhoto: true
        });
        await sendMessage(chatId,
            "⏩ Фото пропущено.\n\n🎙 Запиши голосовое: что планируешь сегодня делать?",
            { keyboard: [[{ text: "⏩ Skip" }]], resize_keyboard: true }
        );
    } else if (sessionData.awaitingStartVoice) {
        // Skip Start Voice → session started
        await activeSession.ref.update({
            awaitingStartVoice: false,
            skippedStartVoice: true
        });
        await sendMessage(chatId, "✅ Смена началась! Удачи!", { remove_keyboard: true });
        await sendMainMenu(chatId, userId);
    } else {
        await sendMessage(chatId, "⚠️ Нечего пропускать.");
    }
}

async function handleMediaUpload(chatId: number, userId: number, message: any) {
    // Determine file_id and extension
    let fileId: string | undefined;
    let extension = 'jpg'; // Default

    if (message.photo) {
        fileId = message.photo[message.photo.length - 1].file_id;
        extension = 'jpg';
    } else if (message.document) {
        fileId = message.document.file_id;
        // Try to get extension from filename or mimetype
        if (message.document.file_name) {
            const parts = message.document.file_name.split('.');
            if (parts.length > 1) extension = parts.pop()!;
        } else if (message.document.mime_type) {
            extension = message.document.mime_type.split('/')[1];
        }
    } else if (message.video) {
        fileId = message.video.file_id;
        extension = 'mp4';
    }

    if (!fileId) return;

    // Check active session
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ No active session to attach media to.");
        return;
    }

    const sessionData = activeSession.data();

    if (sessionData.awaitingStartPhoto) {
        // Save Start Media
        const url = await saveTelegramFile(fileId, `work_photos/${activeSession.id}/start_${Date.now()}.${extension}`);

        // --- GEOLOCATION VERIFICATION LOGIC ---
        // 1. Get Session Location (saved in previous step)
        const startLocation = sessionData.startLocation;
        let isLocationMatch = false;

        if (startLocation) {
            const { latitude, longitude } = startLocation;
            // Check against project location
            // We need to know which project logic involves.
            // We can check `findNearbyProject` again or check specific client coords if we stored them.
            const matchedProject = await findNearbyProject(latitude, longitude);
            // Verify if matched project corresponds to selected client
            if (matchedProject && matchedProject.clientId === sessionData.clientId) {
                isLocationMatch = true;
            }
            // TODO: Check Photo Exif if available (not available in standard photo messages usually, only files)
        }

        // --- REPLY MESSAGES ---
        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        if (isLocationMatch || sessionData.clientId === 'no_project') {
            await sendMessage(chatId, `✅ Фото принято! Объект *${sessionData.clientName}* время старта *${timeStr}*\n\n🚀 Сессия начата, удачной работы!`);
        } else {
            await sendMessage(chatId, "⚠️ Локация не соответствует клиенту\n\n🚀 Сессия начата (с предупреждением).");
        }

        await activeSession.ref.update({
            startPhotoId: fileId,
            startPhotoUrl: url,
            startMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingStartPhoto: false,
            awaitingStartVoice: true  // Ask for voice
        });

        await sendMessage(chatId,
            "🎙 Запиши голосовое: что планируешь сегодня делать?",
            {
                keyboard: [[{ text: "⏩ Skip" }]],
                resize_keyboard: true
            }
        );

    } else if (sessionData.awaitingEndPhoto) {
        // Save End Media
        const url = await saveTelegramFile(fileId, `work_photos/${activeSession.id}/end_${Date.now()}.${extension}`);

        // Move to voice step instead of text description
        await activeSession.ref.update({
            endPhotoId: fileId,
            endPhotoUrl: url,
            endMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingEndPhoto: false,
            awaitingEndVoice: true  // NEW: Ask for voice about results
        });

        await sendMessage(chatId,
            "📸 Фото принято!\n\n🎙 Запиши голосовое: Что успел сделать?",
            {
                keyboard: [[{ text: "⏩ Skip" }]],
                resize_keyboard: true
            }
        );

    } else {
        await sendMessage(chatId, "I'm not expecting media right now.");
    }
}

async function handleCancel(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (activeSession) {
        const data = activeSession.data();
        // Only cancel if in a setup phase or stuck
        if (data.awaitingLocation || data.awaitingStartPhoto) {
            await activeSession.ref.delete();
            await sendMessage(chatId, "✅ Pending session cancelled.", { remove_keyboard: true });
        } else {
            await sendMessage(chatId, "⚠️ Cannot cancel an active work session. Use 'Finish Work' instead.");
        }
    } else {
        await sendMessage(chatId, "Nothing to cancel.", { remove_keyboard: true });
    }
    await sendMainMenu(chatId, userId);
}

async function handleText(chatId: number, userId: number, text: string) {
    // Check if awaiting shopping quick add
    const wasShoppingAdd = await ShoppingHandler.handleShoppingQuickAddText(chatId, userId, text);
    if (wasShoppingAdd) return;

    const activeSession = await getActiveSession(userId);
    if (!activeSession) return; // Should not happen often if we ignore other text

    if (activeSession.data().awaitingDescription) {
        // FINALIZE SESSION with text description
        await finalizeSession(chatId, userId, activeSession, text);
    }
}


async function finalizeSession(chatId: number, userId: number, activeSession: any, description: string) {
    const sessionData = activeSession.data();
    const endTime = admin.firestore.Timestamp.now();
    const startTime = sessionData.startTime;

    let hourlyRate = sessionData.hourlyRate;

    // FAILSAFE: If no snapshot rate (old session), fetch current profile rate
    // UPDATED: Check for default_rate in User Profile first!
    if (hourlyRate === undefined || hourlyRate === null || hourlyRate === 0) {
        const platformUser = await findPlatformUser(userId);

        // Priority: UserProfile.defaultRate -> UserProfile.hourlyRate -> Employee.hourlyRate
        if (platformUser) {
            if (platformUser.defaultRate) {
                hourlyRate = platformUser.defaultRate;
            } else if (platformUser.hourlyRate) {
                hourlyRate = platformUser.hourlyRate;
            }
        }

        if (!hourlyRate) {
            const empDoc = await db.collection('employees').doc(String(userId)).get();
            hourlyRate = empDoc.data()?.hourlyRate || 0;
        }

        // Update the session with this rate so we have it for history
        await activeSession.ref.update({ hourlyRate: hourlyRate });
    }

    // Calculate duration (minus breaks if any)
    let totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);

    // --- HANDLE OPEN BREAK (Finish while Paused) ---
    const BREAK_LIMIT = 60;
    let currentBreakMinutes = 0;
    let adjustmentApplied = false;

    if (sessionData.status === 'paused' && sessionData.lastBreakStart) {
        const breakStart = sessionData.lastBreakStart;
        const actualBreakMinutes = Math.round((endTime.toMillis() - breakStart.toMillis()) / 60000);

        currentBreakMinutes = actualBreakMinutes;

        // Apply auto-correction if needed
        if (actualBreakMinutes > BREAK_LIMIT) {
            currentBreakMinutes = BREAK_LIMIT;
            adjustmentApplied = true;
        }

        // Record this final break in history (optional, or just deduct)
        // Ideally we should push to 'breaks' array for completeness, but session is closing.
        // We'll just ensure totalMinutes is correct.
    }

    let existingBreaks = sessionData.totalBreakMinutes || 0;
    let totalDeductibleBreak = existingBreaks + currentBreakMinutes;

    totalMinutes -= totalDeductibleBreak;

    // --- Message Customization ---
    let extraMessage = "";
    if (adjustmentApplied) {
        extraMessage = `\n⚠️ **Авто-коррекция**: Перерыв был ограничен 1ч (вместо ${Math.floor((sessionData.lastBreakStart ? (endTime.toMillis() - sessionData.lastBreakStart.toMillis()) / 60000 : 0) / 60)}ч).`;
    }

    // Prepare Update Data
    const updateData: any = {
        description: description,
        endTime: endTime,
        durationMinutes: totalMinutes,
        sessionEarnings: 0, // calc below
        status: 'completed',
        awaitingDescription: false,
        totalBreakMinutes: totalDeductibleBreak // Update this to reflect the final break
    };

    if (adjustmentApplied) {
        updateData.needsAdjustment = true;
        updateData.autoCorrectedBreak = true;

        // Also add the break record
        updateData.breaks = admin.firestore.FieldValue.arrayUnion({
            start: sessionData.lastBreakStart,
            end: endTime,
            durationMinutes: currentBreakMinutes,
            autoAdjusted: true,
            note: "Closed on finish"
        });
    } else if (currentBreakMinutes > 0) {
        // Normal break close
        updateData.breaks = admin.firestore.FieldValue.arrayUnion({
            start: sessionData.lastBreakStart,
            end: endTime,
            durationMinutes: currentBreakMinutes,
            note: "Closed on finish"
        });
    }

    // Flag cleared
    updateData.lastBreakStart = admin.firestore.FieldValue.delete();
    updateData.breakNotificationSent = admin.firestore.FieldValue.delete();

    // ... continue calculation

    // Sanity check
    if (totalMinutes < 0) totalMinutes = 0;

    // --- Calculate Earnings ---
    const hours = parseFloat((totalMinutes / 60).toFixed(2));
    const sessionEarnings = parseFloat((hours * hourlyRate).toFixed(2));

    // Update earnings in updateData
    updateData.sessionEarnings = sessionEarnings;

    // --- Calculate Daily Totals ---
    const dailyStats = await calculateDailyStats(userId, totalMinutes, sessionEarnings);
    const dailyHours = Math.floor(dailyStats.minutes / 60);
    const dailyMins = dailyStats.minutes % 60;

    await activeSession.ref.update(updateData);

    // "Rest up!" removed. Rate line added.
    await sendMessage(chatId, `🏁 Work finished!\n\n⏱ Session: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💰 Earned: $${sessionEarnings}\nRate: $${hourlyRate}/hr\n📅 **Today Total: ${dailyHours}h ${dailyMins}m ($${dailyStats.earnings.toFixed(2)})**\n📍 Client: ${sessionData.clientName}\n📝 Desc: ${description}${extraMessage}`);

    await sendAdminNotification(`🏁 *Work Finished*\n👤 ${sessionData.employeeName}\n📍 ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}\n📝 ${description}`);

    // Return to main menu after finishing
    await sendMainMenu(chatId, userId);
}

/**
 * Helper to call Google AI (Generative Language API) with model fallback.
 * Uses the already-enabled Generative Language API instead of Vertex AI.
 */
async function transcribeAudioWithRetry(audioBase64: string, systemPrompt: string): Promise<string> {
    // Get API key from Firebase config or environment
    const apiKey = process.env.GEMINI_API_KEY || functions.config().gemini?.api_key;

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured. Set it via: firebase functions:config:set gemini.api_key="YOUR_KEY"');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Fallback Strategy (Updated for current availability):
    // 1. gemini-2.0-flash (Latest)
    // 2. gemini-1.5-flash-latest
    // 3. gemini-1.5-pro-latest  
    // 4. gemini-pro (Legacy alias)
    const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-pro'];

    const errors: string[] = [];

    for (const modelName of models) {
        console.log(`🤖 Trying ${modelName} via Google AI...`);

        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: 'application/json' }
        });
        logger.info(`🤖 Trying ${modelName} via Google AI...`);

        try {
            const result = await model.generateContent([
                { text: systemPrompt },
                {
                    inlineData: {
                        mimeType: 'audio/ogg',
                        data: audioBase64
                    }
                }
            ]);
            const response = await result.response;
            const text = response.text();

            if (text) {
                logger.info(`✅ Success with ${modelName}`);
                return text;
            }
        } catch (error: any) {
            const errMsg = `⚠️ Error with ${modelName}: ${error.message}`;
            logger.warn(errMsg);
            errors.push(errMsg);
            // Continue to next model
        }
    }

    logger.error('❌ All Gemini attempts failed', { errors });
    throw new Error(`All models failed. Last error: ${errors[errors.length - 1]}`);
}

/**
 * Handles voice messages from workers.
 * Uses Gemini 1.5 Flash to transcribe and extract structured data.
 */
async function handleVoiceMessage(chatId: number, userId: number, message: any) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной сессии для голосового сообщения.");
        return;
    }

    const sessionData = activeSession.data();
    const fileId = message.voice.file_id;

    // Determine context: start or end of shift
    const context = sessionData.awaitingEndVoice ? 'END_SHIFT' : 'START_SHIFT';

    await sendMessage(chatId, "🎙 Принял, расшифровываю...");

    try {
        // 1. Download voice file from Telegram
        const fileRes = await axios.get(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${fileId}`);
        const filePath = fileRes.data.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`;

        const audioResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const audioBase64 = Buffer.from(audioResponse.data).toString('base64');
        logger.info(`🎙 Audio downloaded`, { size: audioResponse.data.length, base64Length: audioBase64.length });

        // 2. Save voice to Storage (optional, for history)
        const voiceStoragePath = `work_voices/${activeSession.id}/${context.toLowerCase()}_${Date.now()}.ogg`;
        const bucket = admin.storage().bucket();
        const file = bucket.file(voiceStoragePath);
        await file.save(Buffer.from(audioResponse.data), { contentType: 'audio/ogg' });
        const voiceUrl = `gs://${bucket.name}/${voiceStoragePath}`;



        const empDoc = await db.collection('employees').doc(String(userId)).get();
        const userTimezone = empDoc.data()?.timezone || 'America/New_York';
        const currentDate = new Date().toLocaleDateString('ru-RU', { timeZone: userTimezone });

        const systemPrompt = `
Ты — опытный прораб-секретарь на стройке. Слушай голосовые сообщения рабочих и превращай их в структурированный отчет JSON.

Контекст: "${context}"
Язык: Русский
Текущая дата: ${currentDate} (Часовой пояс: ${userTimezone})

ИНСТРУКЦИИ:
1. Убери слова-паразиты.
2. Сформулируй четкое описание.
3. Если START_SHIFT: извлеки planned_task и location.
4. Если END_SHIFT: извлеки сделанное (summary, description), проблемы (issues).
5. ВАЖНО: Если слышишь намерения на будущее ("надо купить", "завтра сделаю", "нужно"), ОБЯЗАТЕЛЬНО извлеки это в массив tasks.

ФОРМАТ JSON:
{
  "summary": "Краткое описание (3-5 слов)",
  "description": "Полное описание работ",
  "issues": "Текст проблемы или null",
  "location_detected": "Локация или null",
  "tasks": [
    {
      "title": "Название задачи",
      "dueDate": "YYYY-MM-DD" (или null),
      "priority": "high" | "medium" | "low",
      "estimatedDurationMinutes": "number (минуты)" (например, 120 для 2 часов)
    }
  ]
}`;

        // 3. Send to Gemini 1.5 Flash for transcription (with Region Fallback)
        logger.info(`🎙 Sending audio to Gemini. Project: ${process.env.GCLOUD_PROJECT || 'profit-step'}`);

        let aiData;
        try {
            const responseText = await transcribeAudioWithRetry(audioBase64, systemPrompt);
            // Cleanup markdown code blocks if present
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiData = JSON.parse(cleanText);
            logger.info('🤖 AI Data', aiData);
        } catch (err: any) {
            logger.error('❌ Transcription completely failed', err);
            await sendMessage(chatId, "⚠️ Ошибка сервиса AI. Попробуйте еще раз или напишите текстом.");
            return;
        }



        // 4. Update session with AI data
        const updates: Record<string, any> = {
            aiTranscribedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (context === 'START_SHIFT') {
            updates.plannedTaskSummary = aiData.summary;
            updates.plannedTaskDescription = aiData.description;
            updates.locationDetected = aiData.location_detected;
            updates.voiceStartUrl = voiceUrl;
            updates.awaitingStartVoice = false;

            // Continue to normal flow
            await sendMessage(chatId, `📝 Записал задачу: *${aiData.summary}*\n\n_${aiData.description}_`);
            await sendMainMenu(chatId, userId);
        } else {
            // END_SHIFT context
            updates.resultSummary = aiData.summary;
            updates.resultDescription = aiData.description;
            updates.issuesReported = aiData.issues;
            updates.voiceEndUrl = voiceUrl;
            updates.awaitingEndVoice = false;
            updates.description = aiData.description; // Use AI description as main description

            // --- PROCESS TASKS ---
            let newTasksCount = 0;
            if (aiData.tasks && Array.isArray(aiData.tasks) && aiData.tasks.length > 0) {
                newTasksCount = await GtdHandler.createTasksFromVoiceReport({
                    userId,
                    sessionId: activeSession.ref.id,
                    sessionData: {
                        clientId: sessionData.clientId,
                        clientName: sessionData.clientName
                    },
                    aiTasks: aiData.tasks,
                    voiceUrl,
                    summary: aiData.summary
                });
            }

            // Notify admin if issues detected
            if (aiData.issues) {
                await sendAdminNotification(`⚠️ *Проблема от рабочего*\n👤 ${sessionData.employeeName}\n📍 ${sessionData.clientName}\n🔴 ${aiData.issues}`);
            }

            let responseMsg = `✅ Записал: *${aiData.summary}*`;
            if (newTasksCount > 0) {
                responseMsg += `\n📥 Создано задач: ${newTasksCount}`;
            }
            if (aiData.issues) {
                responseMsg += `\n⚠️ Проблема: ${aiData.issues}`;
            }

            await sendMessage(chatId, responseMsg);

            // Now finalize the session (move to description step or complete)
            updates.awaitingDescription = true;
            await sendMessage(chatId, "📝 Хочешь добавить текстовое описание? (Или напиши 'Skip')");
        }

        await activeSession.ref.update(updates);

    } catch (error: any) {
        logger.error('Error transcribing voice:', error);
        await sendMessage(chatId, `⚠️ Ошибка расшифровки: ${error.message}. Попробуй ещё раз или напиши текстом.`);
    }
}

async function handleMe(chatId: number, userId: number) {
    const doc = await db.collection('employees').doc(String(userId)).get();
    if (!doc.exists) return;
    const data = doc.data();
    await sendMessage(chatId, `👤 *Your Profile*\n\nName: **${data?.name}**\nRole: ${data?.role}\nID: \`${userId}\`\n\nTo change name, type:\n\`/name New Name\``);
}

async function handleNameChange(chatId: number, userId: number, newName: string) {
    if (!newName || newName.length < 2) {
        await sendMessage(chatId, "⚠️ Name must be at least 2 characters.");
        return;
    }
    await db.collection('employees').doc(String(userId)).update({
        name: newName
    });
    await sendMessage(chatId, `✅ Name updated to: **${newName}**`);
}

/**
 * Sets or updates user's timezone preference.
 * Used for accurate daily statistics calculation.
 * 
 * @param chatId - Telegram chat ID for responses
 * @param userId - Telegram user ID
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 */
async function handleTimezone(chatId: number, userId: number, timezone: string) {
    if (!timezone) {
        await sendMessage(chatId, "⚠️ Usage: /timezone [Timezone]\nExample: `/timezone America/New_York`");
        return;
    }

    // Validate timezone string
    try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (e) {
        await sendMessage(chatId, "⚠️ Invalid timezone. Try 'America/New_York' or 'Europe/Kyiv'.");
        return;
    }

    const platformUser = await findPlatformUser(userId);
    if (platformUser) {
        await db.collection('users').doc(platformUser.id).update({ timezone: timezone });
    }
    // Also update local employee record as backup/primary for unlinked
    await db.collection('employees').doc(String(userId)).set({ timezone: timezone }, { merge: true });

    await sendMessage(chatId, `✅ Timezone set to: **${timezone}**`);
}

// handleHelp removed - /help now handled inline in handleMessage

async function sendAdminNotification(text: string) {
    if (!ADMIN_GROUP_ID) return;
    try {
        await sendMessage(Number(ADMIN_GROUP_ID), text);
    } catch (error) {
        logger.error('Failed to notify admin group', error);
        // Do not throw, so user flow is not interrupted
    }
}


// --- Helpers ---

async function saveTelegramFile(fileId: string, destinationPath: string): Promise<string | null> {
    if (!WORKER_BOT_TOKEN) {
        logger.error("Missing WORKER_BOT_TOKEN");
        return null;
    }
    try {
        // 1. Get File Path from Telegram
        const fileRes = await axios.get(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${fileId}`);
        const filePath = fileRes.data.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`;

        // 2. Download File
        const response = await axios({
            url: fileUrl,
            method: 'GET',
            responseType: 'arraybuffer'
        });
        const buffer = Buffer.from(response.data, 'binary');

        // 3. Determine Content Type
        const ext = destinationPath.split('.').pop()?.toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
        if (ext === 'png') contentType = 'image/png';
        if (ext === 'mp4') contentType = 'video/mp4';
        if (ext === 'pdf') contentType = 'application/pdf';

        // 4. Upload to Firebase Storage with Download Token
        const bucket = admin.storage().bucket();
        const file = bucket.file(destinationPath);
        const token = crypto.randomUUID();

        await file.save(buffer, {
            contentType: contentType,
            metadata: {
                metadata: {
                    firebaseStorageDownloadTokens: token
                }
            }
        });

        // 5. Construct Public Download URL
        const bucketName = bucket.name;
        const encodedName = encodeURIComponent(destinationPath);
        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedName}?alt=media&token=${token}`;

        return publicUrl;

    } catch (error) {
        logger.error('Error saving Telegram file', error);
        return null;
    }
}

/**
 * Gets the user's currently active or paused work session.
 * 
 * @param userId - Telegram user ID
 * @returns Active session document or null if none found
 */


/**
 * Calculates daily work statistics for a user.
 * 
 * Searches for completed sessions using BOTH:
 * - Telegram ID (number) - for bot-created sessions
 * - Firebase UID (string) - for Web UI-created sessions
 * 
 * Uses user's configured timezone to determine "today" boundaries.
 * Falls back to UTC if timezone not configured.
 * 
 * @param userId - Telegram user ID
 * @param currentSessionMinutes - Minutes from currently active session (if any)
 * @param currentSessionEarnings - Earnings from currently active session (if any)
 * @param chatId - Chat ID for error messages (optional)
 * @returns Object with total minutes and earnings for today
 */
async function calculateDailyStats(userId: number, currentSessionMinutes = 0, currentSessionEarnings = 0, chatId: number | null = null) {
    let timezone = 'America/New_York';
    let platformUserId: string | null = null;

    // Fetch user's timezone preference
    try {
        const platformUser = await findPlatformUser(userId);
        if (platformUser) {
            platformUserId = platformUser.id;
            if (platformUser.timezone) {
                timezone = platformUser.timezone;
            }
        }

        // Fallback to employees collection for timezone
        if (timezone === 'UTC') {
            const empDoc = await db.collection('employees').doc(String(userId)).get();
            if (empDoc.exists && empDoc.data()?.timezone) {
                timezone = empDoc.data()?.timezone;
            }
        }
    } catch (e) {
        console.error("Error fetching user timezone:", e);
    }

    const now = new Date();
    const searchStart = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48h lookback for timezone safety

    let dailyMinutes = currentSessionMinutes;
    let dailyEarnings = currentSessionEarnings;

    // Build array of IDs to search (supports legacy sessions with different ID types)
    const searchIds: any[] = [userId];
    if (platformUserId) searchIds.push(platformUserId);

    try {
        const potentialSessions = await db.collection('work_sessions')
            .where('employeeId', 'in', searchIds)
            .where('status', '==', 'completed')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(searchStart))
            .orderBy('endTime', 'desc')
            .get();

        // Filter sessions by "today" in user's timezone
        const todayString = now.toLocaleDateString('en-US', { timeZone: timezone });

        potentialSessions.docs.forEach(doc => {
            const d = doc.data();
            if (!d.endTime) return;

            const sDate = d.endTime.toDate();
            const sDateStr = sDate.toLocaleDateString('en-US', { timeZone: timezone });

            if (sDateStr === todayString) {
                dailyMinutes += (d.durationMinutes || 0);
                dailyEarnings += (d.sessionEarnings || 0);
            }
        });
    } catch (e: any) {
        console.error("Error calculating daily totals:", e);
        if (chatId) {
            await sendMessage(chatId, `⚠️ Daily Stats Error: ${e.message}`);
        }
    }

    return { minutes: dailyMinutes, earnings: dailyEarnings };
}

async function autoFinishActiveSession(activeSession: FirebaseFirestore.QueryDocumentSnapshot, chatId: number, userId: number): Promise<string> {
    const sessionData = activeSession.data();
    const endTime = admin.firestore.Timestamp.now();
    const startTime = sessionData.startTime;

    // Determine hourly rate (snapshot or fallback)
    let hourlyRate = sessionData.hourlyRate;
    if (hourlyRate === undefined || hourlyRate === null) {
        // Fallback fetch if missing
        const empDoc = await db.collection('employees').doc(String(userId)).get();
        hourlyRate = empDoc.data()?.hourlyRate || 0;
        await activeSession.ref.update({ hourlyRate: hourlyRate });
    }

    // Calculate duration
    let totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);
    if (sessionData.totalBreakMinutes) {
        totalMinutes -= sessionData.totalBreakMinutes;
    }
    // Safety check just in case
    if (totalMinutes < 0) totalMinutes = 0;

    // Calculate Earnings
    const hours = parseFloat((totalMinutes / 60).toFixed(2));
    const sessionEarnings = parseFloat((hours * hourlyRate).toFixed(2));

    await activeSession.ref.update({
        description: `Auto-switched to new task (Bot)`,
        endTime: endTime,
        durationMinutes: totalMinutes,
        sessionEarnings: sessionEarnings,
        status: 'completed',
        awaitingDescription: false,
        awaitingEndPhoto: false,
        awaitingLocation: false
    });

    // Notify admin
    await sendAdminNotification(`🔄 *Auto-Switch*\n👤 ${sessionData.employeeName}\n📍 Closed: ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}`);

    return `⚠️ Previous session closed (${sessionData.clientName}).\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m  |  💵 Earned: $${sessionEarnings}\n\n`;
}




async function findPlatformUser(telegramId: number): Promise<any | null> {
    try {
        const snapshot = await db.collection('users')
            .where('telegramId', '==', String(telegramId))
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        }
    } catch (error) {
        console.error("Error finding platform user:", error);
    }
    return null;
}


// GTD Tasks Functions moved to handlers/gtdHandler.ts

// ============================================
// SHOPPING HANDLERS
// ============================================

/**
 * Handle /shopping command - show project list
 */


/**
 * Show client selection for new list
 */


/**
 * Handle all shopping callbacks
 */


/**
 * Show shopping list with items
 */


/**
 * Start receipt upload flow
 */


/**
 * Start quick add flow (supports text, voice, photo)
 */


/**
 * Handle shopping receipt photo upload
 */


/**
 * Handle shopping quick add text (AI-powered)
 */


/**
 * Handle shopping voice input (AI-powered)
 */


/**
 * Handle shopping photo input (AI-powered)
 */


/**
 * Show draft confirmation UI
 */


/**
 * Handle draft callbacks (delete, save, more, clear)
 */

// handleQuickTask moved to handlers/gtdHandler.ts
