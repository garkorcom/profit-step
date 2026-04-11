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
import * as POHandler from './handlers/poHandler';
import * as SelfServiceHandler from './handlers/selfServiceHandler';
import * as SmartStartHandler from './handlers/smartStartHandler';
import { sendMessage, getActiveSession, getActiveSessionStrict, sendMainMenu, findPlatformUser, logBotAction, calculateDistanceMeters } from './telegramUtils';
import { resolveHourlyRate } from './rateUtils';
import { verifyEmployeeFace } from '../../services/faceVerificationService';
import { generateConversationalReply } from '../../services/telegramAIAssistant';

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
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || '';

// Site Checklist Questions
const CHECKLIST_QUESTIONS = [
    { key: 'materials', text: '✅ Материалы на объекте?' },
    { key: 'tools', text: '✅ Инструменты взял?' },
    { key: 'access', text: '✅ Пропуск/доступ есть?' },
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

    // 2a. Check for active GTD flow (comment, progress, delegate)
    const gtdState = await GtdHandler.getGtdState(chatId);
    if (gtdState) {
        const consumed = await GtdHandler.handleGtdFlowMessage(chatId, userId, text, message, gtdState);
        if (consumed) return;
        // If not consumed (e.g. /start, /menu), fall through to main handler
    }

    // 2b. Check for active PO flow (intercepts text + photo messages)
    const poState = await POHandler.getPOState(chatId);
    if (poState) {
        // /start and /menu should clear PO state AND continue to main handler
        if (text === '/start' || text === '/menu') {
            await POHandler.handlePOFlowMessage(chatId, userId, text, message, poState);
            // Fall through to main handler below
        } else {
            await POHandler.handlePOFlowMessage(chatId, userId, text, message, poState);
            return;
        }
    }

    // 3. Main Logic
    if (text === '/start' || text === '/menu') {
        // --- EMERGENCY RESET (ZERO-BLOCK) --- Fix 3 (Wave 2): Covers ALL awaiting states
        const activeSession = await getActiveSession(userId);
        if (activeSession) {
            const data = activeSession.data();
            if (data.awaitingLocation || data.awaitingChecklist || data.awaitingStartPhoto || data.awaitingStartVoice
                || data.awaitingEndPhoto || data.awaitingEndVoice || data.awaitingDescription) {
                // User called menu while stuck. Unblock them from any state.
                await activeSession.ref.update({
                    awaitingLocation: false,
                    awaitingChecklist: false,
                    awaitingStartPhoto: false,
                    awaitingStartVoice: false,
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

        // Case 1+43: Smart quick-start suggestion when idle
        if (!activeSession) {
            await SmartStartHandler.suggestQuickStart(chatId, userId);
        }
    } else if (text === '🏁 Конец дня') {
        // Case 31: One-tap end day with auto-summary
        await SmartStartHandler.handleEndDay(chatId, userId);
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
☕ Break - Перерыв
/switch - Сменить проект (без остановки)
🏁 Конец дня - Быстрое завершение

*Самообслуживание:*
/mybalance - 💰 Мой баланс ЗП
/myhours - ⏱ Часы за неделю
/mypay - 📃 Расчётный лист
/timeline - 📊 Таймлайн дня

*Отчёты:*
/report - 📢 Быстрый отчёт (материалы, проблемы, безопасность)`);
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
            await sendMessage(chatId, `📸 *Для начала смены:*\n\n1️⃣ Нажми 📎 (скрепку) внизу\n2️⃣ Выбери 📷 *Камера*\n3️⃣ Сделай селфи на объекте\n4️⃣ Отправь фото\n\nЗатем отправь 📍 *геолокацию* (📎 → Геопозиция).`);
            await sendMainMenu(chatId, userId);
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
    } else if (text === '⏩ Skip' || text === '⏩ Пропустить (Слабый интернет)' || text === '⏩ Пропустить фото') {
        await logBotAction(userId, userId, 'skip_media');
        // Check if we are awaiting location specifically (since Location uses string match fallback)
        const activeSession = await getActiveSession(userId);
        if (activeSession && activeSession.data().awaitingLocation) {
            await activeSession.ref.update({
                awaitingLocation: false,
                awaitingChecklist: true,
                checklistStep: 0,
                checklistAnswers: {},
                startLocation: null
            });
            await sendMessage(chatId, "⏩ Локация пропущена.\n\n📋 Пройди чеклист перед началом работы:");
            await sendChecklistQuestion(chatId, 0);
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
    } else if (text === '/mytasks') {
        await GtdHandler.sendMyTasks(chatId, userId);
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
    } else if (text === '/template' || text === '/templates') {
        await GtdHandler.handleTemplateCommand(chatId, userId, '');
    } else if (text === '/team') {
        await GtdHandler.handleTeamCommand(chatId, userId);
    } else if (text === '/pool') {
        await GtdHandler.handlePoolCommand(chatId, userId);
    } else if (text === '/po' || text === '📦 PO / Авансы') {
        await POHandler.handlePOCommand(chatId, userId);
    // --- SELF-SERVICE COMMANDS ---
    } else if (text === '/mybalance' || text === '💰 Баланс') {
        await SelfServiceHandler.handleMyBalance(chatId, userId);
    } else if (text === '/myhours') {
        await SelfServiceHandler.handleMyHours(chatId, userId);
    } else if (text === '/mypay') {
        await SelfServiceHandler.handleMyPay(chatId, userId);
    } else if (text === '/timeline') {
        await SmartStartHandler.handleTimeline(chatId, userId);
    } else if (text === '/report' || text === '📢 Отчёт') {
        await SmartStartHandler.showReportMenu(chatId);
    } else if (text === '/switch' || text === '🔄 Сменить объект') {
        await SelfServiceHandler.handleSwitchProject(chatId, userId);
    } else if (text && text.length > 0) {
        // Handle text descriptions if awaiting, OR send to AI Assistant
        const activeSession = await getActiveSession(userId);

        if (activeSession) {
            const sessionData = activeSession.data();

            // Case 37: Quick report details
            if (sessionData.awaitingReportDetails && sessionData.reportType) {
                await SmartStartHandler.handleReportDetails(
                    chatId, userId, text,
                    sessionData.reportType,
                    sessionData.clientName || 'Unknown',
                    sessionData.clientId || null
                );
                return;
            }

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
            data.startsWith('checklist_') || data.startsWith('po_') ||
            data.startsWith('tmpl_') || data.startsWith('task_wait_reason:') ||
            data.startsWith('task_phase:') || data.startsWith('task_set_') ||
            data.startsWith('task_proof:') || data.startsWith('task_approve:') ||
            data.startsWith('task_reject:') || data.startsWith('task_finance:') ||
            data.startsWith('team_') || data.startsWith('task_selfassign:') ||
            data.startsWith('task_suggest:') || data.startsWith('task_assign_to:') ||
            data.startsWith('switch_project:') || data.startsWith('quick_start:') ||
            data.startsWith('start_task:') || data.startsWith('done_task:') ||
            data === 'switch_task' || data.startsWith('end_day:') ||
            data.startsWith('block_task:') || data.startsWith('block_reason:') ||
            data.startsWith('unblock_task:') || data.startsWith('photo_cat:') ||
            data.startsWith('report:') || data.startsWith('late:');
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
        else if (data === 'tasks_back' || data === 'tasks_plan' ||
            data.startsWith('tasks:') || data.startsWith('task_') ||
            data.startsWith('tmpl_')) {
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
        // --- PO (ADVANCE) HANDLERS ---
        else if (data.startsWith('po_')) {
            await POHandler.handlePOCallback(chatId, userId, data, query.message.message_id);
        }
        // --- SWITCH PROJECT HANDLER ---
        else if (data.startsWith('switch_project:')) {
            const clientId = data.split('switch_project:')[1];
            await SelfServiceHandler.handleSwitchProjectCallback(chatId, userId, clientId, query.id);
        }
        // --- QUICK START HANDLER (Case 1) ---
        else if (data.startsWith('quick_start:')) {
            const clientId = data.split('quick_start:')[1];
            const result = await SmartStartHandler.handleQuickStartCallback(chatId, userId, clientId);
            if (result === 'started') {
                await initWorkSession(chatId, userId, clientId);
            } else if (result === 'show_list') {
                await handleLocationPickOther(chatId, userId);
            }
        }
        // --- TASK LINKING HANDLERS (Cases 9, 10) ---
        else if (data.startsWith('start_task:')) {
            const taskId = data.split('start_task:')[1];
            await SmartStartHandler.handleStartTaskCallback(chatId, userId, taskId);
        }
        else if (data.startsWith('done_task:')) {
            const taskId = data.split('done_task:')[1];
            await SmartStartHandler.handleDoneTaskCallback(chatId, userId, taskId);
        }
        else if (data === 'switch_task') {
            await SmartStartHandler.handleSwitchTaskCallback(chatId, userId);
        }
        // --- END DAY HANDLER (Case 31) ---
        else if (data.startsWith('end_day:')) {
            const action = data.split('end_day:')[1];
            const result = await SmartStartHandler.handleEndDayCallback(chatId, userId, action);
            if (result === 'confirm') {
                await SmartStartHandler.quickCloseSession(chatId, userId);
                await sendMainMenu(chatId, userId);
            }
        }
        // --- BLOCKED TASK HANDLERS (Case 17) ---
        else if (data.startsWith('block_task:')) {
            const taskId = data.split('block_task:')[1];
            await SmartStartHandler.handleBlockTask(chatId, taskId);
        }
        else if (data.startsWith('block_reason:')) {
            const parts = data.split(':');
            const taskId = parts[1];
            const reason = parts[2];
            await SmartStartHandler.handleBlockReasonCallback(chatId, userId, taskId, reason);
        }
        else if (data.startsWith('unblock_task:')) {
            const taskId = data.split('unblock_task:')[1];
            await SmartStartHandler.handleUnblockTask(chatId, userId, taskId);
        }
        // --- PHOTO CATEGORY HANDLERS (Case 45) ---
        else if (data.startsWith('photo_cat:')) {
            const parts = data.split(':');
            const sessionId = parts[1];
            const category = parts[2];
            const photoFileId = parts[3];
            await SmartStartHandler.handlePhotoCategoryCallback(chatId, sessionId, category, photoFileId);
        }
        // --- QUICK REPORT HANDLERS (Cases 37-42) ---
        else if (data.startsWith('report:')) {
            const reportType = data.split('report:')[1];
            await SmartStartHandler.handleReportCallback(chatId, userId, reportType);
        }
        else if (data.startsWith('late:')) {
            const minutes = parseInt(data.split('late:')[1]);
            await SmartStartHandler.handleLateCallback(chatId, userId, minutes);
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

// --- Checklist Logic ---

async function sendChecklistQuestion(chatId: number, step: number) {
    if (step >= CHECKLIST_QUESTIONS.length) return;
    const question = CHECKLIST_QUESTIONS[step];
    await sendMessage(chatId, question.text, {
        inline_keyboard: [
            [
                { text: '✅ Да', callback_data: `checklist_yes_${step}` },
                { text: '❌ Нет', callback_data: `checklist_no_${step}` },
            ]
        ]
    });
}

async function handleChecklistCallback(chatId: number, userId: number, data: string) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены.");
        return;
    }

    const sessionData = activeSession.data();
    if (!sessionData.awaitingChecklist) {
        return;
    }

    // Parse: checklist_yes_0 or checklist_no_1
    const parts = data.split('_');
    const answer = parts[1] === 'yes';
    const step = parseInt(parts[2]);

    if (step !== sessionData.checklistStep) {
        // Ignore clicks on already-answered questions
        return;
    }

    const questionKey = CHECKLIST_QUESTIONS[step].key;
    const answers = sessionData.checklistAnswers || {};
    answers[questionKey] = answer;

    const nextStep = step + 1;

    if (nextStep < CHECKLIST_QUESTIONS.length) {
        // More questions to ask
        await activeSession.ref.update({
            checklistStep: nextStep,
            checklistAnswers: answers,
        });
        await sendChecklistQuestion(chatId, nextStep);
    } else {
        // All questions answered — proceed to photo step
        await activeSession.ref.update({
            checklistStep: nextStep,
            checklistAnswers: answers,
            awaitingChecklist: false,
            awaitingStartPhoto: true,
        });

        const allYes = Object.values(answers).every((v: any) => v === true);
        const summary = CHECKLIST_QUESTIONS.map((q, i) => {
            const val = answers[q.key];
            return `${val ? '✅' : '❌'} ${q.text.replace('✅ ', '')}`;
        }).join('\n');

        await sendMessage(chatId,
            `📋 *Чеклист завершён:*\n${summary}\n\n` +
            (allYes ? '👍 Всё готово!\n\n' : '⚠️ Есть нерешённые вопросы. Админ уведомлён.\n\n') +
            `📸 Теперь отправь **фото** начала работ.`,
            {
                keyboard: [[{ text: '⏩ Пропустить фото' }]],
                resize_keyboard: true
            }
        );

        // Notify admin if something is missing
        if (!allYes) {
            const employeeName = sessionData.employeeName || 'Сотрудник';
            const clientName = sessionData.clientName || 'Объект';
            await sendAdminNotification(
                `⚠️ *Чеклист:* ${employeeName}\n📍 ${clientName}\n${summary}`
            );
        }
    }
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

    // 3. Identity Sync & Rate Resolution
    const { hourlyRate, platformUser, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

    if (platformUser) {
        // Sync local employee record to match platform name
        await db.collection('employees').doc(String(userId)).set({
            name: employeeName,
            telegramId: userId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    // 4. Create Session (Pending Location)
    const sessionRef = await db.collection('work_sessions').add({
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
        awaitingChecklist: false,
        checklistStep: 0,
        checklistAnswers: {},
        awaitingStartPhoto: false,
        hourlyRate: hourlyRate, // Snapshot rate
        // Phase 5: Task linking (optional, for future "Start from Task")
        taskId: null,
        taskTitle: null
    });

    await logBotAction(userId, userId, 'session_created', { sessionId: sessionRef.id, clientId, clientName });
    logger.info(`[${employeeName}] ▶️ Work Started — ${clientName}`);

    // ─── hourlyRate = 0 warning ───
    if (!hourlyRate) {
        await sendMessage(chatId, '⚠️ Внимание! Ваша почасовая ставка не установлена ($0/ч). Пожалуйста, свяжитесь с руководителем для уточнения.');
    }

    // ZERO-BLOCK: Immediately send the main menu keyboard (Break / Finish Work) 
    // so the user is never blocked, even while waiting for location.
    await sendMainMenu(chatId, userId);

    await sendMessage(chatId, `${autoSwitchMsg}📍 Client selected: *${clientName}*\n\nPlease share your **Live Location** or current **Location** to verify attendance.\n(Click the 📎 attachment icon -> Location)`,
        {
            keyboard: [[{ text: "📍 Send Location", request_location: true }], [{ text: "⏩ Пропустить (Слабый интернет)" }, { text: "❌ Cancel" }]],
            resize_keyboard: true
        }
    );
    await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started*\n📍 ${clientName}`);

    // Case 9: Auto-show project tasks after clock-in
    await SmartStartHandler.showProjectTasks(chatId, userId, clientId);
}

async function handleLocation(chatId: number, userId: number, location: any) {
    // Fix 4 (Deep Testing): Ignore Live Location broadcasts to prevent spam
    // Telegram sends repeated location updates when user shares "Live Location"
    if (location.live_period) {
        logger.info(`🔇 Ignoring Live Location from user ${userId} (live_period: ${location.live_period}s)`);
        return;
    }

    const activeSession = await getActiveSession(userId);
    const { latitude, longitude } = location;

    if (!activeSession) {
        // --- NO ACTIVE SESSION: IT'S A START TRIGGER ---
        const matchedProject = await findNearbyProject(latitude, longitude);
        const pendingStartRef = db.collection('pending_starts').doc(String(userId));

        if (matchedProject) {
            // Found a match! Ask for confirmation
            await updateLocationLastUsed(matchedProject.id);

            await pendingStartRef.set({
                matchedProjectId: matchedProject.id,
                matchedClientId: matchedProject.clientId,
                matchedClientName: matchedProject.clientName,
                matchedServiceName: matchedProject.serviceName || null,
                location: location,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const serviceSuffix = matchedProject.serviceName ? ` - ${matchedProject.serviceName}` : '';
            await sendMessage(chatId,
                `📍 *Локация определена!*\n\n` +
                `🏢 Объект: *${matchedProject.clientName}${serviceSuffix}*\n\n` +
                `Это старт работы?`,
                {
                    inline_keyboard: [
                        [{ text: '✅ Да, начать', callback_data: 'location_confirm_start' }],
                        [{ text: '🔄 Другой объект', callback_data: 'location_pick_other' }],
                        [{ text: '❌ Отмена', callback_data: 'location_cancel' }]
                    ]
                }
            );
        } else {
            // No match - ask to select client
            await pendingStartRef.set({ location: location, createdAt: admin.firestore.FieldValue.serverTimestamp() });

            await sendMessage(chatId,
                `📍 *Локация получена!*\n\nОбъект поблизости не найден.\nВыбери объект из списка или напиши текстом в чат (если это новый клиент):`,
                { remove_keyboard: true }
            );

            const snapshot = await db.collection('clients').orderBy('name', 'asc').limit(500).get();
            if (!snapshot.empty) {
                const inlineKeyboard: any[][] = [];
                snapshot.docs.forEach(doc => {
                    const client = doc.data();
                    if (client.status === 'done') return;
                    inlineKeyboard.push([{ text: client.name, callback_data: `location_new_client_${doc.id}` }]);
                });
                if (inlineKeyboard.length > 0) {
                    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);
                    await sendMessage(chatId, '🏢 Доступные объекты:', { inline_keyboard: inlineKeyboard });
                }
            }
        }
        return;
    }

    // --- ACTIVE SESSION EXISTS ---
    const sessionData = activeSession.data();

    // Fix 2/5: Prevent location looping and live location spam if already awaiting media
    if (sessionData.awaitingStartPhoto || sessionData.awaitingStartVoice || sessionData.awaitingEndPhoto || sessionData.awaitingEndVoice) {
        await sendMessage(chatId, "⚠️ Заверши текущий шаг (отправь фото/аудио или нажми Пропустить), а не локацию.");
        return;
    }

    // Handle Finish Location (Anti-Fraud Step)
    if (sessionData.awaitingEndLocation) {
        const targetLat = sessionData.startLocation?.latitude;
        const targetLng = sessionData.startLocation?.longitude;

        let distanceInfo = "";
        let locationMismatch = false;
        let locationDistanceMeters = null;

        if (targetLat && targetLng) {
            locationDistanceMeters = calculateDistanceMeters(latitude, longitude, targetLat, targetLng);
            if (locationDistanceMeters > 500) {
                locationMismatch = true;
                distanceInfo = `\n⚠️ Сильное отклонение от старта (${locationDistanceMeters}м).`;
            } else {
                distanceInfo = `\n✅ Локация подтверждена.`;
            }
        }

        const updatePayload: any = {
            endLocation: location,
            awaitingEndLocation: false,
            awaitingEndPhoto: true
        };
        
        if (locationMismatch) {
            updatePayload.locationMismatch = true;
            updatePayload.needsAdjustment = true;
            updatePayload.locationMismatchReason = `Закрытие смены в ${locationDistanceMeters}м от старта`;
        }
        if (locationDistanceMeters !== null) {
            updatePayload.endLocationDistanceMeters = locationDistanceMeters;
        }

        await activeSession.ref.update(updatePayload);

        await sendMessage(chatId,
            `📍 *Геопозиция получена.*${distanceInfo}\n\n📸 Теперь отправь **фото** (или файл/видео) выполненной работы.`,
            { keyboard: [[{ text: "⏩ Пропустить фото" }]], resize_keyboard: true }
        );
        return;
    }

    // Backwards Compatibility for old awaitingLocation state
    if (sessionData.awaitingLocation) {
        const clientId = sessionData.clientId;
        if (clientId !== 'no_project') {
            let locationMismatch = false;
            let locationDistanceMeters = null;

            const clientDoc = await db.collection('clients').doc(clientId).get();
            if (clientDoc.exists) {
                const clientData = clientDoc.data();
                if (clientData?.workLocation?.latitude && clientData?.workLocation?.longitude) {
                    const targetLat = clientData.workLocation.latitude;
                    const targetLng = clientData.workLocation.longitude;
                    const radiusRadius = clientData.workLocation.radius || 150; // Changed default from 500m to 150m for tighter audit

                    locationDistanceMeters = calculateDistanceMeters(latitude, longitude, targetLat, targetLng);
                    if (locationDistanceMeters > radiusRadius) {
                        locationMismatch = true;
                        // Soft Geofencing: Do not notify user about error, just log it internally
                        await db.collection('activity_logs').add({
                            companyId: sessionData.companyId || 'system',
                            projectId: clientId,
                            type: 'note',
                            content: `🔴 Аудит Локации: Смена начата вне объекта (отклонение ${Math.round(locationDistanceMeters)}м от гео-зоны).`,
                            performedBy: 'Система Контроля',
                            performedAt: admin.firestore.FieldValue.serverTimestamp(),
                            isInternalOnly: true
                        });
                    } else {
                        await sendMessage(chatId, `✅ Локация подтверждена.`);
                    }
                }
            }

            const updatePayload: any = {
                startLocation: location,
                awaitingLocation: false,
                awaitingStartPhoto: true
            };
            if (locationMismatch) {
                updatePayload.locationMismatch = true;
                updatePayload.outOfBounds = true; // Phase 2: Soft geofencing flag
            }
            if (locationDistanceMeters !== null) updatePayload.locationDistanceMeters = locationDistanceMeters;

            await activeSession.ref.update(updatePayload);
            await sendMessage(chatId, "📸 Теперь отправь **фото** начала работ.", {
                keyboard: [[{ text: "⏩ Пропустить фото" }]],
                resize_keyboard: true
            });
        }
        return;
    }

    // IT'S A FINISH TRIGGER (Sent location while working)
    // Fix 4: Ask for confirmation before closing the shift
    if (sessionData.status === 'active' || sessionData.status === 'paused') {
        const targetLat = sessionData.startLocation?.latitude;
        const targetLng = sessionData.startLocation?.longitude;

        let distanceInfo = "";
        if (targetLat && targetLng) {
            const dist = calculateDistanceMeters(latitude, longitude, targetLat, targetLng);
            if (dist > 500) {
                distanceInfo = `\n⚠️ Финиш в ${dist}м от точки старта.`;
            }
        }

        // Store end location temporarily but DON'T set awaitingEndPhoto yet
        await activeSession.ref.update({ endLocation: location });

        await sendMessage(chatId,
            `📍 *Геопозиция получена.*${distanceInfo}\n\nЭто завершение работы?`,
            {
                inline_keyboard: [
                    [{ text: '✅ Да, завершить', callback_data: 'location_confirm_finish' }],
                    [{ text: '❌ Нет, работаю', callback_data: 'location_cancel_finish' }]
                ]
            }
        );
    }
}

/**
 * User confirmed auto-detected project from pending_starts.
 */
async function handleLocationConfirmStart(chatId: number, userId: number) {
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    const pendingDoc = await pendingStartRef.get();

    if (!pendingDoc.exists) {
        await sendMessage(chatId, "⚠️ Данные локации устарели. Отправь локацию заново.", { remove_keyboard: true });
        return;
    }

    const data = pendingDoc.data()!;

    // Fix 2: TTL — reject if pending_starts is older than 30 minutes
    const createdAt = data.createdAt?.toDate?.();
    if (createdAt && (Date.now() - createdAt.getTime() > 30 * 60 * 1000)) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ Данные устарели (>30 мин). Отправь геолокацию заново.", { remove_keyboard: true });
        return;
    }

    // Fix 3: Double-click guard — check if session already exists
    const existingSession = await getActiveSession(userId);
    if (existingSession) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ У тебя уже есть активная смена. Используй ⏹️ Finish Work.");
        return;
    }

    const clientId = data.matchedClientId;
    const clientName = data.matchedClientName;
    const serviceName = data.matchedServiceName;
    const location = data.location;

    const { hourlyRate, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

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
        awaitingLocation: false,
        awaitingChecklist: true,
        checklistStep: 0,
        checklistAnswers: {},
        awaitingStartPhoto: false,
        hourlyRate: hourlyRate,
        taskId: null,
        taskTitle: null
    });

    await pendingStartRef.delete();

    // ─── hourlyRate = 0 warning ───
    if (!hourlyRate) {
        await sendMessage(chatId, '⚠️ Внимание! Ваша почасовая ставка не установлена ($0/ч). Пожалуйста, свяжитесь с руководителем для уточнения.');
    }

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Объект: *${clientName}${serviceName ? ' - ' + serviceName : ''}*\n\n` +
        `📋 Пройди чеклист перед началом работы:`
    );

    // Send first checklist question
    await sendChecklistQuestion(chatId, 0);

    await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started (Location)*\n📍 ${clientName}`);

    // Case 9: Auto-show project tasks after clock-in
    await SmartStartHandler.showProjectTasks(chatId, userId, data.matchedClientId);
}

/**
 * Fix 4: User confirmed they want to finish the shift.
 */
async function handleLocationConfirmFinish(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены.");
        return;
    }

    // Fix 4: Zombie click protection
    if (!activeSession.data().endLocation) {
        await sendMessage(chatId, "⚠️ Эта кнопка устарела.");
        return;
    }

    await activeSession.ref.update({ awaitingEndPhoto: true });

    await sendMessage(chatId,
        "📸 Отправь **фото** выполненной работы (или нажми Пропустить).",
        {
            keyboard: [[{ text: "⏩ Пропустить фото" }]],
            resize_keyboard: true
        }
    );
}

/**
 * Fix 4: User said they're still working — false alarm location.
 */
async function handleLocationCancelFinish(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (activeSession) {
        // Fix 4: Zombie click protection
        if (!activeSession.data().endLocation) {
            await sendMessage(chatId, "⚠️ Эта кнопка устарела.");
            return;
        }
        // Remove the prematurely saved endLocation
        await activeSession.ref.update({
            endLocation: admin.firestore.FieldValue.delete()
        });
    }
    await sendMessage(chatId, "✅ Понял, продолжай работу! 💪");
    await sendMainMenu(chatId, userId);
}

/**
 * User wants to pick a different project than auto-detected.
 */
async function handleLocationPickOther(chatId: number, userId: number) {
    const snapshot = await db.collection('clients').orderBy('name', 'asc').limit(500).get();

    if (snapshot.empty) {
        await sendMessage(chatId, "Клиенты не найдены.");
        return;
    }

    const inlineKeyboard: any[][] = [];
    snapshot.docs.forEach(doc => {
        const client = doc.data();
        if (client.status === 'done') return;
        inlineKeyboard.push([{ text: client.name, callback_data: `location_new_client_${doc.id}` }]);
    });
    inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);

    await sendMessage(chatId, '🏢 Доступные объекты:', { inline_keyboard: inlineKeyboard });
}

/**
 * Cancel the location start flow.
 */
async function handleLocationCancel(chatId: number, userId: number) {
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    await pendingStartRef.delete();

    await sendMessage(chatId, "❌ Старт смены отменен.", { remove_keyboard: true });
    await sendMainMenu(chatId, userId);
}

/**
 * User selected a new client from the list for the pending location start.
 */
async function handleLocationNewClient(chatId: number, userId: number, clientId: string) {
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    const pendingDoc = await pendingStartRef.get();

    if (!pendingDoc.exists) {
        await sendMessage(chatId, "⚠️ Данные локации устарели. Отправьте геопозицию заново.");
        return;
    }

    // Fix 2: TTL check
    const pendingData = pendingDoc.data()!;
    const createdAt = pendingData.createdAt?.toDate?.();
    if (createdAt && (Date.now() - createdAt.getTime() > 30 * 60 * 1000)) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ Данные устарели (>30 мин). Отправь геолокацию заново.");
        return;
    }

    // Fix 3: Double-click guard
    const existingSession = await getActiveSession(userId);
    if (existingSession) {
        await pendingStartRef.delete();
        await sendMessage(chatId, "⚠️ У тебя уже есть активная смена.");
        return;
    }

    const location = pendingData.location;

    const clientDoc = await db.collection('clients').doc(clientId).get();
    if (!clientDoc.exists) {
        await sendMessage(chatId, "⚠️ Клиент не найден.");
        return;
    }
    const clientData = clientDoc.data()!;
    const clientName = clientData.name;

    // Save newly associated location
    await saveProjectLocation(
        clientId,
        clientName,
        location.latitude,
        location.longitude,
        userId
    );

    const { hourlyRate, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

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
        awaitingLocation: false,
        awaitingChecklist: true,
        checklistStep: 0,
        checklistAnswers: {},
        awaitingStartPhoto: false,
        hourlyRate: hourlyRate,
        taskId: null,
        taskTitle: null
    });

    await pendingStartRef.delete();

    // ─── hourlyRate = 0 warning ───
    if (!hourlyRate) {
        await sendMessage(chatId, '⚠️ Внимание! Ваша почасовая ставка не установлена ($0/ч). Пожалуйста, свяжитесь с руководителем для уточнения.');
    }

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Объект: *${clientName}*\n` +
        `📍 Координаты объекта сохранены в базу.\n\n` +
        `📋 Пройди чеклист перед началом работы:`
    );
    await sendChecklistQuestion(chatId, 0);

    await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started (New DB Location)*\n📍 ${clientName}`);
}

async function pauseWorkSession(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) {
        await sendMessage(chatId, "⚠️ Нет активной смены для паузы.");
        await sendMainMenu(chatId, userId);
        return;
    }

    // Add a break entry
    const now = admin.firestore.Timestamp.now();
    await activeSession.ref.update({
        status: 'paused',
        lastBreakStart: now
    });

    await sendMessage(chatId, "☕ Перерыв начат! Нажми «▶️ Продолжить работу» когда вернёшься.");
    await sendMainMenu(chatId, userId); // Update buttons
}

async function resumeWorkSession(chatId: number, userId: number) {
    const sessionSnapshot = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused') // Look for paused
        .limit(1)
        .get();

    if (sessionSnapshot.empty) {
        await sendMessage(chatId, "⚠️ Нет смены на паузе.");
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

async function handleSkipMedia(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ No active session.", { remove_keyboard: true });
        return;
    }

    const sessionData = activeSession.data();

    if (sessionData.awaitingEndLocation) {
        // Skip End Location → go to photo
        await activeSession.ref.update({
            awaitingEndLocation: false,
            awaitingEndPhoto: true,
            skippedEndLocation: true,
            needsAdjustment: true,
            locationMismatch: true,
            locationMismatchReason: "Location skipped at finish"
        });
        await sendMessage(chatId,
            "⏩ Локация пропущена. ⚠️ Отметка о пропуске сохранена.\n\n📸 Теперь отправь **фото** (или файл/видео) выполненной работы.",
            { keyboard: [[{ text: "⏩ Пропустить фото" }]], resize_keyboard: true }
        );
    } else if (sessionData.awaitingEndPhoto) {
        // Skip End Photo → go to voice
        await activeSession.ref.update({
            awaitingEndPhoto: false,
            awaitingEndVoice: true,
            skippedEndPhoto: true
        });
        await sendMessage(chatId,
            "⏩ Фото пропущено.\n\n🎙 Запиши голосовое: Что успел сделать?",
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
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
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
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

    // Fix 6 (Wave 2): Block dangerous file extensions
    const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'msi', 'ps1', 'sh', 'dll', 'scr', 'vbs', 'js'];
    if (BLOCKED_EXTENSIONS.includes(extension.toLowerCase())) {
        await sendMessage(chatId, "⚠️ Этот тип файла не поддерживается. Отправь фото или видео.");
        return;
    }

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

        const timeStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

        await sendMessage(chatId, `✅ Фото принято! Объект *${sessionData.clientName}* время старта *${timeStr}*\n\n🚀 Сессия начата, удачной работы!`);

        // Fix 7: Write main update FIRST, then fire face verification AFTER
        await activeSession.ref.update({
            startPhotoId: fileId,
            startPhotoUrl: url,
            startMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingStartPhoto: false,
            awaitingStartVoice: true
        });

        // --- FACE VERIFICATION (Asynchronous, AFTER main update) ---
        const platformUserUrl = (await findPlatformUser(userId))?.referenceFacePhotoUrl;
        if (platformUserUrl && url) {
            verifyEmployeeFace(platformUserUrl, url).then(async (matchResult) => {
                await activeSession.ref.update({
                    faceMatch: matchResult.match,
                    faceConfidence: matchResult.confidence,
                    faceMismatchReason: matchResult.reason
                });
                if (!matchResult.match) {
                    await sendMessage(chatId, `⚠️ *ПРЕДУПРЕЖДЕНИЕ:*\nСистема не смогла сопоставить ваше лицо с профилем (${Math.round(matchResult.confidence)}%).\nСмена продолжена, но админ уведомлен.`);
                }
            }).catch(e => console.error("Face verification background task failed", e));
        }

        // --- NEW: Time-Lapse Activity Log (Start Photo/Video) ---
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            await db.collection('activity_logs').add({
                companyId: sessionData.companyId || 'system',
                projectId: sessionData.clientId,
                type: message.video ? 'video' : (message.document ? 'document' : 'photo'),
                content: 'Медиа начала смены',
                mediaUrl: url,
                performedBy: sessionData.employeeName || 'Сотрудник',
                performedAt: admin.firestore.FieldValue.serverTimestamp(),
                isInternalOnly: false
            });
        }

        await sendMessage(chatId,
            "🎙 Запиши голосовое: что планируешь сегодня делать?",
            {
                keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]],
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

        // --- NEW: Time-Lapse Activity Log (End Photo/Video) ---
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            await db.collection('activity_logs').add({
                companyId: sessionData.companyId || 'system',
                projectId: sessionData.clientId,
                type: message.video ? 'video' : (message.document ? 'document' : 'photo'),
                content: 'Медиа окончания смены',
                mediaUrl: url,
                performedBy: sessionData.employeeName || 'Сотрудник',
                performedAt: admin.firestore.FieldValue.serverTimestamp(),
                isInternalOnly: false
            });
        }

        await sendMessage(chatId,
            "📸 Фото принято!\n\n🎙 Запиши голосовое: Что успел сделать?",
            {
                keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]],
                resize_keyboard: true
            }
        );

    } else {
        // Fix 3: Handle media group (album) spam silently
        if (message.media_group_id) {
            return;
        }

        // Task 2: Mid-session photo — save to Firebase Storage
        if (message.photo && sessionData.clientId) {
            const largestPhoto = message.photo[message.photo.length - 1];
            const photoFileId = largestPhoto.file_id;
            const storagePath = `clients/${sessionData.clientId}/photos/${activeSession.id}/${Date.now()}.jpg`;
            const url = await saveTelegramFile(photoFileId, storagePath);

            if (url) {
                const currentPhotos: string[] = sessionData.photoUrls || [];
                currentPhotos.push(url);
                await activeSession.ref.update({ photoUrls: currentPhotos });

                // Save to work_session_media for categorization
                await db.collection('work_session_media').add({
                    sessionId: activeSession.id,
                    employeeId: userId,
                    fileId: photoFileId,
                    url: url,
                    type: 'photo',
                    context: 'mid_shift',
                    clientId: sessionData.clientId,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Also log in activity_logs for time-lapse
                if (sessionData.clientId !== 'no_project') {
                    await db.collection('activity_logs').add({
                        companyId: sessionData.companyId || 'system',
                        projectId: sessionData.clientId,
                        type: 'photo',
                        content: 'Фото с объекта (mid-session)',
                        mediaUrl: url,
                        performedBy: sessionData.employeeName || 'Сотрудник',
                        performedAt: admin.firestore.FieldValue.serverTimestamp(),
                        isInternalOnly: false
                    });
                }

                // Case 45: Photo category picker for mid-shift photos
                await SmartStartHandler.showPhotoCategoryPicker(chatId, activeSession.id, photoFileId);
            } else {
                await sendMessage(chatId, "⚠️ Не удалось сохранить фото. Попробуй ещё раз.");
            }
        } else {
            await sendMessage(chatId, "I'm not expecting media right now.");
        }
    }
}

async function handleCancel(chatId: number, userId: number) {
    // Fix 6: Also clean up pending_starts on cancel
    await db.collection('pending_starts').doc(String(userId)).delete().catch(() => { });

    const activeSession = await getActiveSession(userId);
    if (activeSession) {
        const data = activeSession.data();
        // Only cancel if in a setup phase or stuck
        if (data.awaitingLocation || data.awaitingChecklist || data.awaitingStartPhoto) {
            await activeSession.ref.delete();
            await sendMessage(chatId, "✅ Сессия отменена.", { remove_keyboard: true });
        } else if (data.awaitingEndLocation || data.awaitingEndPhoto || data.awaitingEndVoice) {
            // Revert closing sequence
            await activeSession.ref.update({
                awaitingEndLocation: false,
                awaitingEndPhoto: false,
                awaitingEndVoice: false
            });
            await sendMessage(chatId, "✅ Завершение отменено. Продолжай работу.", { remove_keyboard: true });
        } else {
            await sendMessage(chatId, "⚠️ Нельзя отменить активную смену. Используй ⏹️ Finish Work.");
        }
    } else {
        await sendMessage(chatId, "✅ Отменено.", { remove_keyboard: true });
    }
    await sendMainMenu(chatId, userId);
}

async function handleText(chatId: number, userId: number, text: string) {
    // Check if awaiting shopping quick add
    const wasShoppingAdd = await ShoppingHandler.handleShoppingQuickAddText(chatId, userId, text);
    if (wasShoppingAdd) return;

    // Fix 5: Check if pending_starts exists — user typed a custom client name
    const pendingStartRef = db.collection('pending_starts').doc(String(userId));
    const pendingStartDoc = await pendingStartRef.get();
    if (pendingStartDoc.exists) {
        const pendingData = pendingStartDoc.data()!;
        const location = pendingData.location;
        const { hourlyRate, platformUserId, companyId, employeeName } = await resolveHourlyRate(userId);

        await db.collection('work_sessions').add({
            employeeId: userId,
            employeeName: employeeName,
            platformUserId: platformUserId,
            companyId: companyId,
            clientId: 'custom',
            clientName: text,
            startTime: admin.firestore.FieldValue.serverTimestamp(),
            status: 'active',
            startLocation: location,
            awaitingLocation: false,
            awaitingChecklist: true,
            checklistStep: 0,
            checklistAnswers: {},
            awaitingStartPhoto: false,
            hourlyRate: hourlyRate,
            taskId: null,
            taskTitle: null
        });

        await pendingStartRef.delete();
        await sendMessage(chatId,
            `✅ *Смена начата!*\n\n🏢 Объект: *${text}* (ручной ввод)\n\n📋 Пройди чеклист перед началом работы:`
        );
        await sendChecklistQuestion(chatId, 0);
        await sendAdminNotification(`👤 *${employeeName}:*\n▶️ *Work Started (Manual)*\n📍 ${text}`);
        return;
    }

    const activeSession = await getActiveSession(userId);
    if (!activeSession) return;

    const sessionData = activeSession.data();

    // --- SMART TYPE FALLBACK (ZERO-BLOCK) ---
    // If we are expecting a photo but got text, treat the text as an explanation and skip the photo.
    if (sessionData.awaitingStartPhoto) {
        await logBotAction(userId, userId, 'smart_fallback_start_photo', { text_reason: text });
        await activeSession.ref.update({
            awaitingStartPhoto: false,
            awaitingStartVoice: true,
            skippedStartPhoto: true,
            startPhotoReason: text
        });
        await sendMessage(chatId,
            `⏩ Фото пропущено (Причина: "${text}").\n\n🎙 Запиши голосовое: что планируешь сегодня делать?`,
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
        );
        return;
    }

    if (sessionData.awaitingEndLocation) {
        if (text === '❌ Отмена' || text === '❌ Cancel') {
            await handleCancel(chatId, userId);
            return;
        }
        await logBotAction(userId, userId, 'smart_fallback_end_location', { text_reason: text });
        await activeSession.ref.update({
            awaitingEndLocation: false,
            awaitingEndPhoto: true,
            skippedEndLocation: true,
            needsAdjustment: true,
            locationMismatch: true,
            locationMismatchReason: `Пропуск локации текстом: ${text}`
        });
        await sendMessage(chatId,
            `⏩ Локация пропущена. ⚠️ Отметка о пропуске сохранена.\n\n📸 Теперь отправь **фото** выполненной работы.`,
            { keyboard: [[{ text: "⏩ Пропустить фото" }]], resize_keyboard: true }
        );
        return;
    }

    if (sessionData.awaitingEndPhoto) {
        await logBotAction(userId, userId, 'smart_fallback_end_photo', { text_reason: text });
        await activeSession.ref.update({
            awaitingEndPhoto: false,
            awaitingEndVoice: true,
            skippedEndPhoto: true,
            endPhotoReason: text
        });
        await sendMessage(chatId,
            `⏩ Фото пропущено (Причина: "${text}").\n\n🎙 Запиши голосовое: Что успел сделать?`,
            { keyboard: [[{ text: "⏩ Пропустить (Слабый интернет)" }]], resize_keyboard: true }
        );
        return;
    }

    // Fix 1: Text fallback for Start Voice
    if (sessionData.awaitingStartVoice) {
        await logBotAction(userId, userId, 'smart_fallback_start_voice', { text_reason: text });
        await activeSession.ref.update({
            awaitingStartVoice: false,
            plannedTaskDescription: text,
            plannedTaskSummary: text
        });
        await sendMessage(chatId, "✅ Текст сохранен вместо голосового.\n🚀 Сессия началась, удачной работы!", { remove_keyboard: true });
        await sendMainMenu(chatId, userId);
        return;
    }

    // Fix 1: Text fallback for End Voice
    if (sessionData.awaitingEndVoice) {
        await logBotAction(userId, userId, 'smart_fallback_end_voice', { text_reason: text });
        // Since End Voice is the last step, finalize directly
        await finalizeSession(chatId, userId, activeSession, text);
        return;
    }

    if (sessionData.awaitingDescription) {
        // FINALIZE SESSION with text description
        await finalizeSession(chatId, userId, activeSession, text);
    }
}


async function finalizeSession(chatId: number, userId: number, activeSession: any, description: string) {
    const sessionData = activeSession.data();
    let endTime = admin.firestore.Timestamp.now();
    const startTime = sessionData.startTime;

    let hourlyRate = sessionData.hourlyRate;

    // FAILSAFE: If no snapshot rate (old session), resolve from profile
    // Fix 2 (Wave 2): Guard against $0/hr when profile is deleted
    let rateWarning = '';
    if (hourlyRate === undefined || hourlyRate === null || hourlyRate === 0) {
        const rateResult = await resolveHourlyRate(userId);
        hourlyRate = rateResult.hourlyRate;

        if (hourlyRate === 0 || isNaN(hourlyRate) || hourlyRate < 0) {
            hourlyRate = 0;
            rateWarning = 'Ставка $0 — профиль не найден или некорректная ставка';
        }

        // Update the session with this rate so we have it for history
        await activeSession.ref.update({ hourlyRate: hourlyRate });
    }

    // Calculate duration (minus breaks if any)
    let totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);

    // --- HANDLE OPEN BREAK (Finish while Paused) ---
    let currentBreakMinutes = 0;
    let adjustmentApplied = false;

    if (sessionData.status === 'paused' && sessionData.lastBreakStart) {
        const breakStart = sessionData.lastBreakStart;
        
        // FIX (Anti-Gamble): If finishing while paused, actual work ended when the break started.
        // We rollback endTime to lastBreakStart and don't count the inactive period.
        endTime = breakStart;
        
        // Recalculate total elapsed time since endTime was modified
        totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);
        
        // We do not add actualBreakMinutes because the shift officially ends at breakStart
        currentBreakMinutes = 0;
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
    // Fix 4 (Wave 2): Limit description length to prevent Firestore bloat
    const safeDescription = description.substring(0, 2000);

    const updateData: any = {
        description: safeDescription,
        endTime: endTime,
        durationMinutes: totalMinutes,
        sessionEarnings: 0, // calc below
        status: 'completed',
        awaitingDescription: false,
        totalBreakMinutes: totalDeductibleBreak // Update this to reflect the final break
    };

    // Fix 2 (Wave 2): Flag zero-rate sessions for admin review
    if (rateWarning) {
        updateData.needsAdjustment = true;
        updateData.rateWarning = rateWarning;
    }

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

    // Fix 1 (Deep Testing): Use Firestore Transaction to prevent cron vs worker race condition
    // If cron has already closed this session, abort gracefully instead of overwriting
    try {
        await admin.firestore().runTransaction(async (transaction) => {
            const sessionRef = admin.firestore().collection('work_sessions').doc(activeSession.id);
            const freshDoc = await transaction.get(sessionRef);
            if (!freshDoc.exists) {
                throw new Error('SESSION_DELETED');
            }
            const freshData = freshDoc.data()!;
            if (freshData.status === 'completed') {
                throw new Error('SESSION_ALREADY_CLOSED');
            }
            transaction.update(sessionRef, updateData);
        });
    } catch (txError: any) {
        if (txError.message === 'SESSION_ALREADY_CLOSED' || txError.message === 'SESSION_DELETED') {
            logger.warn(`⚠️ Session ${activeSession.id} was already closed (cron race). User ${userId} notified.`);
            await sendMessage(chatId, '⚠️ Эта смена уже была автоматически закрыта системой. Данные отчёта сохранены. Обратись к админу, если нужна корректировка.');
            await sendMainMenu(chatId, userId);
            return;
        }
        throw txError; // Re-throw unexpected errors
    }

    // V2: Time-of-day flavor + Russian — session summary (without balance)
    const finishHour = new Date().getHours();
    const finishGreeting = finishHour >= 17 ? '🌙 Отличная работа!' : '🏁 Смена завершена!';
    await sendMessage(chatId, `${finishGreeting}\n\n⏱ Сессия: ${Math.floor(totalMinutes / 60)}ч ${totalMinutes % 60}мин\n💰 Заработано: $${sessionEarnings}\n💵 Ставка: $${hourlyRate}/ч\n📅 *За сегодня: ${dailyHours}ч ${dailyMins}мин ($${dailyStats.earnings.toFixed(2)})*\n📍 Объект: ${sessionData.clientName}\n📝 ${description}${extraMessage}`);

    logger.info(`[${sessionData.employeeName}] 🏁 Work Finished — ${sessionData.clientName} (${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m, $${sessionEarnings})`);

    // Fix 8 (Wave 2): Sanitize user-generated text in admin notifications
    const sanitizedDesc = safeDescription.replace(/[*_`\[\]()~>#+\-=|{}.!]/g, '').substring(0, 500);
    await sendAdminNotification(`👤 *${sessionData.employeeName}:*\n🏁 *Work Finished*\n📍 ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}\n📝 ${sanitizedDesc}`);

    // Return to main menu after finishing ("Ты сейчас не на смене")
    await sendMainMenu(chatId, userId);

    // Calculate and send YTD salary balance as a separate follow-up message.
    // Uses work_sessions collection (unified ledger) instead of the unused 'payments' collection.
    // Queries both Telegram numeric ID and Firebase UID to cover all sessions.
    try {
        const yearStart = new Date(new Date().getFullYear(), 0, 1);

        // Resolve Firebase UID for cross-ID matching
        const platformUser = await findPlatformUser(userId);
        const searchIds: (string | number)[] = [userId, String(userId)];
        if (platformUser) searchIds.push(platformUser.id);

        // Query all work_sessions for this employee from YTD
        const ytdSnap = await admin.firestore().collection('work_sessions')
            .where('employeeId', 'in', searchIds)
            .where('startTime', '>=', admin.firestore.Timestamp.fromDate(yearStart))
            .get();

        let totalEarned = 0;
        let totalPayments = 0;

        ytdSnap.docs.forEach((d: any) => {
            const data = d.data();
            if (data.isVoided) return;

            if (data.type === 'payment') {
                totalPayments += Math.abs(data.sessionEarnings || 0);
            } else if (data.status === 'completed' || data.type === 'manual_adjustment') {
                totalEarned += (data.sessionEarnings || 0);
            }
        });

        const balance = totalEarned - totalPayments;
        const balanceEmoji = balance >= 0 ? '💚' : '🔴';

        // Query PO (advance) balance for the same employee
        let poLine = '';
        try {
            const advSnap = await admin.firestore().collection('advance_accounts')
                .where('employeeId', 'in', searchIds)
                .where('status', '==', 'open')
                .get();

            if (!advSnap.empty) {
                const advTxSnap = await admin.firestore().collection('advance_transactions')
                    .where('employeeId', 'in', searchIds)
                    .where('status', '==', 'active')
                    .get();

                const totalIssued = advSnap.docs.reduce((s: number, d: any) => s + (d.data().amount || 0), 0);
                const totalSpent = advTxSnap.docs
                    .filter((d: any) => advSnap.docs.some((a: any) => a.id === d.data().advanceId))
                    .reduce((s: number, d: any) => s + (d.data().amount || 0), 0);
                const poBalance = Math.round((totalIssued - totalSpent) * 100) / 100;

                if (poBalance !== 0) {
                    const poEmoji = poBalance > 0 ? '📦' : '⚠️';
                    poLine = `\n${poEmoji} Баланс ПО: *$${poBalance.toFixed(2)}* (${advSnap.size} авансов)`;
                }
            }
        } catch (poErr) {
            console.error('PO balance calc error:', poErr);
        }

        await sendMessage(chatId, `${balanceEmoji} Баланс ЗП: *$${balance.toFixed(2)}*\n📊 Начислено с начала года: $${totalEarned.toFixed(2)}\n💸 Выплачено: $${totalPayments.toFixed(2)}${poLine}`);
    } catch (e) {
        console.error('Balance calc error:', e);
        // Non-critical — don't fail the session finalization
    }
}

/**
 * Helper to call Google AI (Generative Language API) with model fallback.
 * Uses the already-enabled Generative Language API instead of Vertex AI.
 */
async function transcribeAudioWithRetry(audioBase64: string, systemPrompt: string): Promise<string> {
    // Get API key from Firebase config or environment
    const apiKey = process.env.GEMINI_API_KEY || '';

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

    // Determine context: start, end or mid shift
    let context = 'MID_SHIFT';
    if (sessionData.awaitingEndVoice) {
        context = 'END_SHIFT';
    } else if (sessionData.awaitingStartVoice) {
        context = 'START_SHIFT';
    }

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

        // --- FETCH ACTIVE TASKS FOR CONTEXT ---
        let activeTasksContext = 'Нет активных задач для загрузки.';
        if (sessionData.clientId && sessionData.clientId !== 'no_project') {
            const tasksSnap = await db.collection('gtd_tasks')
                .where('projectId', '==', sessionData.clientId)
                .where('status', 'in', ['todo', 'in_progress'])
                .get();
            
            if (!tasksSnap.empty) {
                const tasksList = tasksSnap.docs.map(doc => {
                    const data = doc.data();
                    return `- [ID: ${doc.id}] ${data.title} (Текущий прогресс: ${data.progressPercentage || 0}%)`;
                });
                activeTasksContext = tasksList.join('\n');
            }
        }

        const systemPrompt = `
Ты — опытный прораб-секретарь на стройке. Слушай голосовые сообщения рабочих и превращай их в структурированный отчет JSON.

Контекст: "${context}"
Язык: Русский
Текущая дата: ${currentDate} (Часовой пояс: ${userTimezone})

Активные задачи проекта (ID, Название, Прогресс):
${activeTasksContext}

ИНСТРУКЦИИ:
1. Убери слова-паразиты.
2. Сформулируй четкое описание.
3. Если START_SHIFT: извлеки planned_task и location.
4. Если END_SHIFT: извлеки сделанное (summary, description), проблемы (issues).
5. Если MID_SHIFT: Если рабочий ПРОСИТ ЗАКРЫТЬ СМЕНУ ("я закончил", "вырубай", "закрывай сессию") -> верни intent: "CLOSE_SESSION". 
   Если он ПРОСТО Диктует рабочую заметку или задачу -> верни intent: "NOTE", summary и description.
6. ВАЖНО: Если слышишь намерения на будущее ("надо купить", "завтра сделаю", "нужно"), ОБЯЗАТЕЛЬНО извлеки это в массив tasks.
7. ВАЖНО: Если рабочий сообщает о прогрессе выполнения конкретной работы (например, "половина стяжки готова" или "закончил плитку"), найди наиболее подходящую задачу из списка "Активные задачи проекта".
   В ответе JSON добавь массив "taskUpdates":
   [{ "taskId": "ID_задачи", "progressPercentage": 100 }] (в процентах от 1 до 100).

ФОРМАТ JSON:
{
  "intent": "CLOSE_SESSION" | "NOTE" | null,
  "summary": "Краткое описание (3-5 слов)",
  "description": "Полное описание работ",
  "issues": "Текст проблемы или null",
  "location_detected": "Локация или null",
  "tasks": [
    {
      "title": "Название задачи",
      "dueDate": "YYYY-MM-DD" (или null),
      "priority": "high" | "medium" | "low",
      "estimatedDurationMinutes": "number (минуты)"
    }
  ],
  "taskUpdates": [
    {
      "taskId": "ID",
      "progressPercentage": 100
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

        // --- PROCESS TASK UPDATES (Phase 2) ---
        let updatedTasksCount = 0;
        if (aiData.taskUpdates && Array.isArray(aiData.taskUpdates)) {
            for (const upd of aiData.taskUpdates) {
                if (upd.taskId && typeof upd.progressPercentage === 'number') {
                    await db.collection('gtd_tasks').doc(upd.taskId).update({
                        progressPercentage: upd.progressPercentage,
                        status: upd.progressPercentage === 100 ? 'done' : 'in_progress',
                        ...(upd.progressPercentage === 100 ? { actualEndDate: admin.firestore.FieldValue.serverTimestamp() } : {})
                    });
                    
                    if (sessionData.clientId && sessionData.clientId !== 'no_project') {
                        await db.collection('activity_logs').add({
                            companyId: sessionData.companyId || 'system',
                            projectId: sessionData.clientId,
                            type: 'ai_action',
                            content: `🤖 ИИ обновил статус задачи на ${upd.progressPercentage}% на основе аудио-отчета.`,
                            taskId: upd.taskId,
                            performedBy: 'AI Assistant',
                            performedAt: admin.firestore.FieldValue.serverTimestamp(),
                            isInternalOnly: false
                        });
                    }
                    updatedTasksCount++;
                }
            }
        }

        if (context === 'START_SHIFT') {
            updates.plannedTaskSummary = aiData.summary;
            updates.plannedTaskDescription = aiData.description;
            updates.locationDetected = aiData.location_detected;
            updates.voiceStartUrl = voiceUrl;
            updates.awaitingStartVoice = false;

            // Continue to normal flow
            await activeSession.ref.update(updates);
            await sendMessage(chatId, `📝 Записал задачу: *${aiData.summary}*\n\n_${aiData.description}_`);
            await sendMainMenu(chatId, userId);
        } else if (context === 'END_SHIFT') {
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
                await sendAdminNotification(`👤 *${sessionData.employeeName}:*\n⚠️ *Проблема от рабочего*\n📍 ${sessionData.clientName}\n🔴 ${aiData.issues}`);
            }

            let responseMsg = `✅ Записал: *${aiData.summary}*`;
            if (newTasksCount > 0) {
                responseMsg += `\n📥 Создано задач: ${newTasksCount}`;
            }
            if (updatedTasksCount > 0) {
                responseMsg += `\n🤖 Обновлен прогресс у ${updatedTasksCount} задач.`;
            }
            if (aiData.issues) {
                responseMsg += `\n⚠️ Проблема: ${aiData.issues}`;
            }

            // Now finalize the session (move to description step or complete)
            updates.awaitingDescription = true;

            // IMPORTANT: Persist updates BEFORE sending prompts to avoid race condition
            await activeSession.ref.update(updates);

            // --- NEW: Time-Lapse Activity Log (End Voice) ---
            if (sessionData.clientId && sessionData.clientId !== 'no_project') {
                await db.collection('activity_logs').add({
                    companyId: sessionData.companyId || 'system',
                    projectId: sessionData.clientId,
                    type: 'audio',
                    content: `Голосовой отчет: ${aiData.summary}\n${aiData.description}`,
                    mediaUrl: voiceUrl,
                    performedBy: sessionData.employeeName || 'Сотрудник',
                    performedAt: admin.firestore.FieldValue.serverTimestamp(),
                    isInternalOnly: false
                });
            }

            await sendMessage(chatId, responseMsg);
            await sendMessage(chatId, "📝 Хочешь добавить текстовое описание? (Или напиши 'Skip')");
        } else if (context === 'MID_SHIFT') {
            if (aiData.intent === 'CLOSE_SESSION') {
                const summaryText = aiData.summary || aiData.description || "Завершение смены";
                await sendMessage(chatId, `⏹️ Ты хочешь завершить текущую смену?\n\n_«${summaryText}»_`, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Да, завершить", callback_data: `force_finish_work` }],
                            [{ text: "❌ Нет, продолжить", callback_data: `cancel_close_session` }]
                        ]
                    }
                });
            } else {
                // intent === NOTE or null
                const platformUser = await findPlatformUser(userId);
                const descriptionWithTasks = [aiData.description];
                
                if (aiData.tasks && aiData.tasks.length > 0) {
                    descriptionWithTasks.push(`\n**Задачи/Покупки:**`);
                    aiData.tasks.forEach((t: any) => descriptionWithTasks.push(`- ${t.title}`));
                }

                await InboxHandler.createNote({
                    ctx: {
                        chatId,
                        userId,
                        userName: message.from?.first_name || 'Worker',
                        messageId: message.message_id,
                        platformUserId: platformUser?.id
                    },
                    title: aiData.summary || 'Голосовая заметка',
                    description: descriptionWithTasks.filter(Boolean).join('\n'),
                    aiStatus: 'none',
                    originalAudioUrl: voiceUrl
                });

                await sendMessage(chatId, `📝 Заметка сохранена во входящие:\n*${aiData.summary || 'Без названия'}*`);
            }
        }

    } catch (error: any) {
        logger.error('Error transcribing voice:', error);
        await sendMessage(chatId, `⚠️ Ошибка расшифровки: ${error.message}. Попробуй ещё раз или напиши текстом.`);
    }
}

/**
 * 📊 Мой статус — show current session details + daily/weekly stats
 */
async function handleStatusRequest(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);
    const { hourlyRate, employeeName } = await resolveHourlyRate(userId);
    const now = Date.now();

    let statusMsg = `📊 *Статус: ${employeeName}*\n\n`;

    if (activeSession) {
        const sd = activeSession.data();
        const startMs = sd.startTime?.toMillis?.() || now;
        const totalBreaks = sd.totalBreakMinutes || 0;
        let ongoingBreak = 0;
        if (sd.status === 'paused' && sd.lastBreakStart) {
            ongoingBreak = Math.floor((now - sd.lastBreakStart.toMillis()) / 60000);
        }
        const elapsedTotal = Math.floor((now - startMs) / 60000);
        const workMinutes = Math.max(0, elapsedTotal - totalBreaks - ongoingBreak);
        const h = Math.floor(workMinutes / 60);
        const m = workMinutes % 60;
        const rate = sd.hourlyRate || hourlyRate || 0;
        const earned = ((workMinutes / 60) * rate).toFixed(2);

        statusMsg += `🏢 Объект: *${sd.clientName}*\n`;
        statusMsg += sd.status === 'paused' ? `☕ Статус: На перерыве\n` : `✅ Статус: Работает\n`;
        statusMsg += `⏱ Время работы: ${h}ч ${m}мин\n`;
        statusMsg += `💰 Заработано: $${earned}\n`;
        statusMsg += `💵 Ставка: $${rate}/ч\n`;
        if (totalBreaks > 0 || ongoingBreak > 0) {
            statusMsg += `☕ Перерывы: ${totalBreaks + ongoingBreak} мин\n`;
        }
    } else {
        statusMsg += `📭 Нет активной смены.\n`;
    }

    // Daily stats
    const dailyStats = await calculateDailyStats(userId);
    const dH = Math.floor(dailyStats.minutes / 60);
    const dM = dailyStats.minutes % 60;
    statusMsg += `\n📅 *Сегодня:* ${dH}ч ${dM}мин | $${dailyStats.earnings.toFixed(2)}`;

    await sendMessage(chatId, statusMsg);
    await sendMainMenu(chatId, userId);
}

/**
 * ❓ Помощь — user-friendly instructions
 */
async function handleHelpRequest(chatId: number, userId: number) {
    await sendMessage(chatId, `❓ *Как пользоваться ботом*

*📍 Начать смену:*
1. Нажми 📎 (скрепку) внизу
2. Отправь 📍 Геопозицию
3. Бот определит объект автоматически
4. Сделай 📸 селфи на объекте
5. Запиши 🎙 голосовое (план работ)

*⏹ Завершить смену:*
1. Нажми "⏹ Завершить смену"
2. Отправь 📍 геопозицию
3. Сделай 📸 фото результата
4. Запиши 🎙 голосовое (что сделал)

*☕ Перерыв:*
Нажми "⏸ Перерыв" → "▶️ Продолжить работу"

*📊 Статус:*
Нажми "📊 Мой статус" — время, заработок

*📋 Задачи / 🛒 Закупки:*
Доступны через меню

*💡 Подсказки:*
• Можно отправить голосовое в любой момент
• Текст сохраняется в Inbox
• Фото пропускается кнопкой "Пропустить"`);
    await sendMainMenu(chatId, userId);
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
        // Fallback to employees collection if platformUser had no timezone
        if (!platformUser?.timezone) {
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

    // Determine hourly rate (snapshot or full resolution)
    let hourlyRate = sessionData.hourlyRate;
    if (hourlyRate === undefined || hourlyRate === null || hourlyRate === 0) {
        const rateResult = await resolveHourlyRate(userId);
        hourlyRate = rateResult.hourlyRate;
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
    await sendAdminNotification(`👤 *${sessionData.employeeName}:*\n🔄 *Auto-Switch*\n📍 Closed: ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}`);

    return `⚠️ Previous session closed (${sessionData.clientName}).\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m  |  💵 Earned: $${sessionEarnings}\n\n`;
}
