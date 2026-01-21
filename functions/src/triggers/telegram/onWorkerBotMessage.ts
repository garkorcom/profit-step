import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { findNearbyProject, saveProjectLocation, updateLocationLastUsed } from '../../utils/geoUtils';

// Initialize in the file if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Configuration
// SECURITY: Prefer environment variable, fallback to config, then hardcoded (for dev/ref)
// Ideally: firebase functions:config:set worker_bot.token="..." worker_bot.password="..."
const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || functions.config().worker_bot?.token;
const WORKER_PASSWORD = process.env.WORKER_PASSWORD || functions.config().worker_bot?.password || 'work2025';
const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID || functions.config().worker_bot?.admin_group_id;

// Types
interface TelegramUpdate {
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
    // 1. Handle Telegram Webhook
    if (req.method === 'POST') {
        try {
            const update = req.body as TelegramUpdate;

            // Handle Callback Queries (Button Clicks)
            if (update.callback_query) {
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
                    console.log(`⏭️ Skipping duplicate message: ${msgId}`);
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
            console.error('Error in onWorkerBotMessage:', error);
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
            await sendMainMenu(chatId);
            return;
        }
        await sendMessage(chatId, "🔒 Access Denied.\nPlease enter the access password:");
        return;
    }

    // 2. Main Logic
    if (text === '/start') {
        await sendMainMenu(chatId);
    } else if (text === '▶️ Start Work') {
        await sendClientList(chatId);
    } else if (text === '⏹️ Finish Work') {
        await handleFinishWorkRequest(chatId, userId);
    } else if (text === '☕ Break') {
        await pauseWorkSession(chatId, userId);
    } else if (text === '▶️ Resume Work') {
        await resumeWorkSession(chatId, userId);
    } else if (text === '❌ Cancel') {
        await handleCancel(chatId, userId);
    } else if (text === '⏩ Skip') {
        await handleSkipMedia(chatId, userId);
    } else if (message.photo || message.document || message.video) {
        // NEW: Check if this is an unsolicited photo (no active session)
        const activeSessionForMedia = await getActiveSession(userId);
        if (!activeSessionForMedia && message.photo) {
            await handleUnsolicitedPhoto(chatId, userId, message);
        } else {
            await handleMediaUpload(chatId, userId, message);
        }
    } else if (message.voice) {
        await handleVoiceMessage(chatId, userId, message);
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
        await sendTasksMenu(chatId, userId);
    } else if (text && text.length > 0) {
        // Handle text descriptions if awaiting
        await handleText(chatId, userId, text);
    } else if (text === '/help') {
        await handleHelp(chatId);
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
            await sendMainMenu(chatId);
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
        else if (data === 'tasks_back') {
            await sendTasksMenu(chatId, userId);
        } else if (data.startsWith('tasks:')) {
            const status = data.split(':')[1];
            await sendTaskList(chatId, userId, status);
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
    } catch (error) {
        console.error('Error in handleCallbackQuery:', error);
        await sendMessage(chatId, "⚠️ Error processing request.");
    } finally {
        // Answer callback to stop loading animation
        try {
            await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: query.id
            });
        } catch (e) {
            console.error('Error answering callback:', e);
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

async function sendMainMenu(chatId: number) {
    // Check if session is paused or active to decide generic menu
    const activeSession = await getActiveSession(chatId);

    let keyboard;
    if (activeSession && activeSession.data().status === 'paused') {
        keyboard = [
            [{ text: "▶️ Resume Work" }, { text: "⏹️ Finish Work" }]
        ];
    } else if (activeSession && activeSession.data().status === 'active') {
        keyboard = [
            [{ text: "☕ Break" }, { text: "⏹️ Finish Work" }]
        ];
    } else {
        keyboard = [
            [{ text: "▶️ Start Work" }],
            [{ text: "📋 Tasks" }]
        ];
    }

    await sendMessage(chatId, "👷‍♂️ *Worker Panel*\nSelect an action:", {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
    });
}

async function sendClientList(chatId: number) {
    // Fetch clients from Firestore
    const snapshot = await db.collection('clients').orderBy('createdAt', 'desc').limit(10).get();

    if (snapshot.empty) {
        await sendMessage(chatId, "No clients found in CRM.");
        return;
    }

    const inlineKeyboard = snapshot.docs.map(doc => {
        const client = doc.data();
        return [{ text: client.name, callback_data: `start_client_${doc.id}` }];
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

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId;
        hourlyRate = platformUser.hourlyRate || 0; // Get rate from platform user

        // Sync local employee record to match platform name
        await db.collection('employees').doc(String(userId)).set({
            name: employeeName,
            telegramId: userId,
            // We preserve role if it exists, or default to worker
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    } else {
        // Fallback to local employee record
        const empDoc = await db.collection('employees').doc(String(userId)).get();
        if (empDoc.exists) {
            const empData = empDoc.data();
            employeeName = empData?.name || 'Worker';
            hourlyRate = empData?.hourlyRate || 0; // Get rate from employee doc
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
        hourlyRate: hourlyRate // Snapshot rate
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
            const snapshot = await db.collection('clients').orderBy('createdAt', 'desc').limit(10).get();
            if (!snapshot.empty) {
                const inlineKeyboard = snapshot.docs.map(doc => {
                    const client = doc.data();
                    return [{ text: client.name, callback_data: `location_new_client_${doc.id}` }];
                });
                inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);
                await sendMessage(chatId, '🏢 Выбери проект:', { inline_keyboard: inlineKeyboard });
            }
        }
        return;
    }

    // --- CASE 2: Traditional flow (awaiting location after client selection) ---
    if (activeSession && activeSession.data().awaitingLocation) {
        // Save location and move to next step
        await activeSession.ref.update({
            startLocation: location, // { latitude, longitude }
            awaitingLocation: false,
            awaitingStartPhoto: true
        });

        await sendMessage(chatId, "✅ Location verified.\n\n📸 Now please send a **photo** of the start condition.", { remove_keyboard: true });
    } else {
        await sendMessage(chatId, "Updated location received.", { remove_keyboard: true });
    }
}

/**
 * Handle photo sent without an active session (Photo-First Flow).
 * Tries to extract GPS from EXIF metadata first.
 * If GPS found → auto-detect project (skip location request).
 * If no GPS → ask for location.
 */
async function handleUnsolicitedPhoto(chatId: number, userId: number, message: any) {
    const fileId = message.photo[message.photo.length - 1].file_id;

    // Import extractGPSFromPhoto
    const { extractGPSFromPhoto } = await import('../../utils/geoUtils');

    // Get file path from Telegram
    const fileInfoResponse = await axios.get(
        `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const filePath = fileInfoResponse.data.result.file_path;

    // Download file as buffer to check EXIF
    const fileResponse = await axios.get(
        `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`,
        { responseType: 'arraybuffer' }
    );
    const fileBuffer = Buffer.from(fileResponse.data);

    // Try to extract GPS from EXIF
    const exifGPS = await extractGPSFromPhoto(fileBuffer);

    // Save photo to storage
    const url = await saveTelegramFile(fileId, `pending_photos/${userId}/photo_${Date.now()}.jpg`);

    if (exifGPS) {
        // GPS found in EXIF! Try to auto-detect project
        const matchedProject = await findNearbyProject(exifGPS.latitude, exifGPS.longitude);

        if (matchedProject) {
            // Found a match! Show confirmation
            await updateLocationLastUsed(matchedProject.id);

            // Store for callback
            await db.collection('pending_photos').doc(String(userId)).set({
                fileId: fileId,
                url: url,
                userId: userId,
                chatId: chatId,
                location: exifGPS,
                matchedProjectId: matchedProject.id,
                matchedClientId: matchedProject.clientId,
                matchedClientName: matchedProject.clientName,
                matchedServiceName: matchedProject.serviceName || null,
                createdAt: admin.firestore.Timestamp.now(),
                gpsSource: 'exif'
            });

            const serviceSuffix = matchedProject.serviceName ? ` - ${matchedProject.serviceName}` : '';
            await sendMessage(chatId,
                `📍 *Локация из фото!*\n\n` +
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
            return;
        } else {
            // GPS found but no matching project → save for new location
            await db.collection('pending_photos').doc(String(userId)).set({
                fileId: fileId,
                url: url,
                userId: userId,
                chatId: chatId,
                location: exifGPS,
                createdAt: admin.firestore.Timestamp.now(),
                gpsSource: 'exif'
            });

            await sendMessage(chatId,
                `📍 *GPS из фото получен!*\n\n` +
                `Эта локация не найдена в базе.\nВыбери проект:`,
                { remove_keyboard: true }
            );

            // Show client list
            const snapshot = await db.collection('clients').orderBy('createdAt', 'desc').limit(10).get();
            if (!snapshot.empty) {
                const inlineKeyboard = snapshot.docs.map(doc => {
                    const client = doc.data();
                    return [{ text: client.name, callback_data: `location_new_client_${doc.id}` }];
                });
                inlineKeyboard.push([{ text: '❌ Отмена', callback_data: 'location_cancel' }]);
                await sendMessage(chatId, '🏢 Выбери проект:', { inline_keyboard: inlineKeyboard });
            }
            return;
        }
    }

    // No GPS in EXIF → ask for location (original flow)
    await db.collection('pending_photos').doc(String(userId)).set({
        fileId: fileId,
        url: url,
        userId: userId,
        chatId: chatId,
        createdAt: admin.firestore.Timestamp.now(),
        gpsSource: null
    });

    await sendMessage(chatId,
        `📸 *Фото получено!*\n\n` +
        `📍 GPS не найден в фото.\nОтправь свою *локацию*.`,
        {
            keyboard: [[{ text: '📍 Отправить локацию', request_location: true }], [{ text: '❌ Отмена' }]],
            resize_keyboard: true
        }
    );
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

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId;
        hourlyRate = platformUser.hourlyRate || 0;
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
        photoFirstFlow: true // Mark as photo-first
    });

    // Cleanup pending photo
    await pendingPhotoRef.delete();

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Проект: *${clientName}${serviceName ? ' - ' + serviceName : ''}*\n\n` +
        `🎙 Запиши голосовое: *Что планируешь делать?*`,
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
    const snapshot = await db.collection('clients').orderBy('createdAt', 'desc').limit(10).get();

    if (snapshot.empty) {
        await sendMessage(chatId, "No clients found.");
        return;
    }

    const inlineKeyboard = snapshot.docs.map(doc => {
        const client = doc.data();
        return [{ text: client.name, callback_data: `location_new_client_${doc.id}` }];
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
    await sendMainMenu(chatId);
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

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId;
        hourlyRate = platformUser.hourlyRate || 0;
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
        photoFirstFlow: true
    });

    // Cleanup
    await pendingPhotoRef.delete();

    await sendMessage(chatId,
        `✅ *Смена начата!*\n\n` +
        `🏢 Проект: *${clientName}*\n` +
        `📍 Локация сохранена для будущего.\n\n` +
        `🎙 Запиши голосовое: *Что планируешь делать?*`,
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
        await sendMainMenu(chatId);
        return;
    }

    // Add a break entry
    const now = admin.firestore.Timestamp.now();
    await activeSession.ref.update({
        status: 'paused',
        lastBreakStart: now
    });

    await sendMessage(chatId, "☕ Session paused. Enjoy your break! Press 'Resume' when back.");
    await sendMainMenu(chatId); // Update buttons
}

async function resumeWorkSession(chatId: number, userId: number) {
    const sessionSnapshot = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused') // Look for paused
        .limit(1)
        .get();

    if (sessionSnapshot.empty) {
        await sendMessage(chatId, "No paused session found.");
        await sendMainMenu(chatId);
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

    await session.ref.update({
        status: 'active',
        lastBreakStart: admin.firestore.FieldValue.delete(), // Remove temp field
        breaks: admin.firestore.FieldValue.arrayUnion({
            start: breakStart,
            end: now,
            durationMinutes: breakDurationMinutes
        }),
        totalBreakMinutes: admin.firestore.FieldValue.increment(breakDurationMinutes)
    });

    await sendMessage(chatId, `▶️ Work resumed. Break: ${breakDurationMinutes}m.`);
    await sendMainMenu(chatId);
}

async function handleFinishWorkRequest(chatId: number, userId: number) {
    const activeSession = await getActiveSession(userId);

    if (!activeSession) {
        await sendMessage(chatId, "⚠️ You don't have an active work session.");
        await sendMainMenu(chatId);
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
            "⏩ Фото пропущено.\\n\\n🎙 Запиши голосовое: *Что успел сделать?*",
            { keyboard: [[{ text: "⏩ Skip" }]], resize_keyboard: true }
        );
    } else if (sessionData.awaitingEndVoice) {
        // Skip End Voice → go to text description
        await activeSession.ref.update({
            awaitingEndVoice: false,
            awaitingDescription: true,
            skippedEndVoice: true
        });
        await sendMessage(chatId, "⏩ Голосовое пропущено.\\n📝 Напиши коротко что сделал:", { remove_keyboard: true });
    } else if (sessionData.awaitingStartPhoto) {
        // Skip Start Photo → go to voice
        await activeSession.ref.update({
            awaitingStartPhoto: false,
            awaitingStartVoice: true,
            skippedStartPhoto: true
        });
        await sendMessage(chatId,
            "⏩ Фото пропущено.\\n\\n🎙 Запиши голосовое: *Что планируешь делать?*",
            { keyboard: [[{ text: "⏩ Skip" }]], resize_keyboard: true }
        );
    } else if (sessionData.awaitingStartVoice) {
        // Skip Start Voice → session started
        await activeSession.ref.update({
            awaitingStartVoice: false,
            skippedStartVoice: true
        });
        await sendMessage(chatId, "✅ Смена началась! Удачи!", { remove_keyboard: true });
        await sendMainMenu(chatId);
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

        await activeSession.ref.update({
            startPhotoId: fileId,
            startPhotoUrl: url,
            startMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingStartPhoto: false,
            awaitingStartVoice: true  // NEW: Ask for voice about plans
        });

        await sendMessage(chatId,
            "📸 Фото принято!\\n\\n" +
            "🎙 *Запиши голосовое:* Что планируешь сегодня делать?\\n" +
            "_Например: 'Буду красить стены в 203 номере'_",
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
            "📸 Фото принято!\\n\\n" +
            "🎙 *Запиши голосовое:* Что успел сделать? Были ли проблемы?\\n" +
            "_Например: 'Всё покрасил, но не хватило грунтовки'_",
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
    await sendMainMenu(chatId);
}

async function handleText(chatId: number, userId: number, text: string) {
    const activeSession = await getActiveSession(userId);
    if (!activeSession) return; // Should not happen often if we ignore other text

    if (activeSession.data().awaitingDescription) {
        // FINALIZE SESSION
        const sessionData = activeSession.data();
        const endTime = admin.firestore.Timestamp.now();
        const startTime = sessionData.startTime;

        let hourlyRate = sessionData.hourlyRate;

        // FAILSAFE: If no snapshot rate (old session), fetch current profile rate
        if (hourlyRate === undefined || hourlyRate === null) {
            const platformUser = await findPlatformUser(userId);
            if (platformUser && platformUser.hourlyRate) {
                hourlyRate = platformUser.hourlyRate;
            } else {
                const empDoc = await db.collection('employees').doc(String(userId)).get();
                hourlyRate = empDoc.data()?.hourlyRate || 0;
            }
            // Update the session with this rate so we have it for history
            await activeSession.ref.update({ hourlyRate: hourlyRate });
        }

        // Calculate duration (minus breaks if any)
        let totalMinutes = Math.round((endTime.toMillis() - startTime.toMillis()) / 60000);
        if (sessionData.totalBreakMinutes) {
            totalMinutes -= sessionData.totalBreakMinutes;
        }

        // --- Calculate Earnings ---
        const hours = parseFloat((totalMinutes / 60).toFixed(2));
        const sessionEarnings = parseFloat((hours * hourlyRate).toFixed(2));

        // --- Calculate Daily Totals ---
        const dailyStats = await calculateDailyStats(userId, totalMinutes, sessionEarnings);
        const dailyHours = Math.floor(dailyStats.minutes / 60);
        const dailyMins = dailyStats.minutes % 60;


        await activeSession.ref.update({
            description: text,
            endTime: endTime,
            durationMinutes: totalMinutes,
            sessionEarnings: sessionEarnings,
            status: 'completed',
            awaitingDescription: false
        });

        await sendMessage(chatId, `🏁 Work finished!\n\n⏱ Session: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💰 Earned: $${sessionEarnings}\n📅 **Today Total: ${dailyHours}h ${dailyMins}m ($${dailyStats.earnings.toFixed(2)})**\n📍 Client: ${sessionData.clientName}\n📝 Desc: ${text}`);

        await sendAdminNotification(`🏁 *Work Finished*\n👤 ${sessionData.employeeName}\n📍 ${sessionData.clientName}\n⏱ ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n💵 Earned: $${sessionEarnings}\n📝 ${text}`);

        // Return to main menu after finishing
        await sendMainMenu(chatId);
    }
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
        try {
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: { responseMimeType: 'application/json' }
            });

            const result = await model.generateContent([
                { text: systemPrompt },
                {
                    inlineData: {
                        mimeType: 'audio/ogg',
                        data: audioBase64
                    }
                }
            ]);

            const text = result.response.text();

            if (text) {
                console.log(`✅ Success with ${modelName}`);
                return text;
            }
        } catch (error: any) {
            const errMsg = `[${modelName}] Failed: ${error.message}`;
            console.warn(errMsg);
            errors.push(errMsg);
            // Continue to next model
        }
    }

    console.error('❌ All Gemini attempts failed:', errors);
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
        console.log(`🎙 Audio downloaded. Size: ${audioResponse.data.length} bytes. Base64 length: ${audioBase64.length}`);

        // 2. Save voice to Storage (optional, for history)
        const voiceStoragePath = `work_voices/${activeSession.id}/${context.toLowerCase()}_${Date.now()}.ogg`;
        const bucket = admin.storage().bucket();
        const file = bucket.file(voiceStoragePath);
        await file.save(Buffer.from(audioResponse.data), { contentType: 'audio/ogg' });
        const voiceUrl = `gs://${bucket.name}/${voiceStoragePath}`;



        const empDoc = await db.collection('employees').doc(String(userId)).get();
        const userTimezone = empDoc.data()?.timezone || 'UTC';
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
        console.log(`🎙 Sending audio to Gemini. Project: ${process.env.GCLOUD_PROJECT || 'profit-step'}`);

        let aiData;
        try {
            const responseText = await transcribeAudioWithRetry(audioBase64, systemPrompt);
            // Cleanup markdown code blocks if present
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiData = JSON.parse(cleanText);
            console.log('🤖 AI Data:', JSON.stringify(aiData, null, 2));
        } catch (err: any) {
            console.error('❌ Transcription completely failed:', err);
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
            await sendMainMenu(chatId);
        } else {
            // END_SHIFT context
            updates.resultSummary = aiData.summary;
            updates.resultDescription = aiData.description;
            updates.issuesReported = aiData.issues;
            updates.voiceEndUrl = voiceUrl;
            updates.awaitingEndVoice = false;
            updates.description = aiData.description; // Use AI description as main description

            // --- PROCESS TASKS (NEW) ---
            let newTasksCount = 0;
            if (aiData.tasks && Array.isArray(aiData.tasks) && aiData.tasks.length > 0) {
                const platformUser = await findPlatformUser(userId);
                if (platformUser) {
                    const batch = db.batch();
                    const now = admin.firestore.Timestamp.now();

                    for (const task of aiData.tasks) {
                        const taskRef = db.collection('gtd_tasks').doc(); // GLOBAL collection
                        let dueDate = null;
                        if (task.dueDate) {
                            // Try to parse YYYY-MM-DD
                            try {
                                const d = new Date(task.dueDate);
                                if (!isNaN(d.getTime())) {
                                    dueDate = admin.firestore.Timestamp.fromDate(d);
                                }
                            } catch (e) { }
                        }

                        batch.set(taskRef, {
                            ownerId: platformUser.id,
                            ownerName: platformUser.displayName || 'Worker',
                            title: task.title || 'Новая задача',
                            description: `🎙 Создано из голосового отчета.\nКонтекст: ${aiData.summary}\n[Аудио](${voiceUrl})`,
                            status: 'inbox',
                            priority: task.priority || 'medium', // Default to medium per plan
                            clientId: sessionData.clientId || null,
                            clientName: sessionData.clientName || null,
                            sourceAudioUrl: voiceUrl,
                            context: '@bot',
                            dueDate: dueDate,
                            estimatedDurationMinutes: task.estimatedDurationMinutes || null,
                            createdAt: now,
                            updatedAt: now
                        });
                        newTasksCount++;
                    }
                    await batch.commit();
                    console.log(`✅ Created ${newTasksCount} tasks for user ${platformUser.id}`);
                }
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

            await sendMessage(chatId, responseMsg + `\n\nОтдыхай!`);

            // Now finalize the session (move to description step or complete)
            updates.awaitingDescription = true;
            await sendMessage(chatId, "📝 Хочешь добавить текстовое описание? (Или напиши 'Skip')");
        }

        await activeSession.ref.update(updates);

    } catch (error: any) {
        console.error('Error transcribing voice:', error);
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

async function handleHelp(chatId: number) {
    const helpText = `👷‍♂️ *Worker Bot Manual*

*Commands:*
/start - Open Main Menu
/me - Show Profile
/me - Show Profile
/name [Name] - Change Name
/timezone [Zone] - Set Timezone (e.g. America/New_York)
/help - Show this message

*Workflow:*
1. **Start Work**: Choose client -> Send Location -> Send Start Photo.
2. **Break**: Pauses timer.
3. **Finish Work**: Send End Photo -> Write Report.

*FAQ:*
- If menu disappears, type /start
- Send photos as *Photo* (not File)
`;
    await sendMessage(chatId, helpText);
}

async function sendAdminNotification(text: string) {
    if (!ADMIN_GROUP_ID) return;
    try {
        await sendMessage(Number(ADMIN_GROUP_ID), text);
    } catch (error) {
        console.error('Failed to notify admin group:', error);
        // Do not throw, so user flow is not interrupted
    }
}


// --- Helpers ---

async function saveTelegramFile(fileId: string, destinationPath: string): Promise<string | null> {
    if (!WORKER_BOT_TOKEN) return null;
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
        console.error('Error saving Telegram file:', error);
        return null;
    }
}

/**
 * Gets the user's currently active or paused work session.
 * 
 * @param userId - Telegram user ID
 * @returns Active session document or null if none found
 */
async function getActiveSession(userId: number) {
    // Check for active sessions first
    let qs = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // Check for paused sessions if no active found
    qs = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    return null;
}

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
    let timezone = 'UTC';
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

async function sendMessage(chatId: number, text: string, options: any = {}) {
    if (!WORKER_BOT_TOKEN) {
        console.error("Missing WORKER_BOT_TOKEN");
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
            body.reply_markup = { keyboard: options.keyboard, resize_keyboard: true, one_time_keyboard: false };
            delete body.keyboard;
        }
        if (options.inline_keyboard) {
            body.reply_markup = { inline_keyboard: options.inline_keyboard };
            delete body.inline_keyboard;
        }
        if (options.remove_keyboard) {
            body.reply_markup = { remove_keyboard: true };
            delete body.remove_keyboard;
        }

        await axios.post(`https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`, body);
    } catch (error: any) {
        console.error('Error sending Telegram message:', error.response?.data || error.message);
    }
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

// --- GTD Tasks Functions ---

const GTD_COLUMNS = [
    { id: 'inbox', title: '📥 Inbox', emoji: '📥' },
    { id: 'next_action', title: '▶️ Next', emoji: '▶️' },
    { id: 'projects', title: '📂 Projects', emoji: '📂' },
    { id: 'waiting', title: '⏳ Waiting', emoji: '⏳' },
    { id: 'someday', title: '💭 Someday', emoji: '💭' },
    { id: 'done', title: '✅ Done', emoji: '✅' }
];

const PRIORITY_EMOJI: Record<string, string> = {
    high: '🔴',
    medium: '🟠',
    low: '🔵',
    none: '⚪'
};

async function sendTasksMenu(chatId: number, telegramId: number) {
    const platformUser = await findPlatformUser(telegramId);

    if (!platformUser) {
        await sendMessage(chatId, "❌ *No linked account*\n\nTo view tasks, link your Telegram to your platform account.\n\nGo to Profile → Settings → Link Telegram");
        return;
    }

    try {
        // Fetch all tasks for this user
        // Fetch all tasks for this user (GLOBAL collection)
        const tasksSnapshot = await db.collection('gtd_tasks')
            .where('ownerId', '==', platformUser.id)
            .get();

        // Count by status
        const counts: Record<string, number> = {};
        GTD_COLUMNS.forEach(col => { counts[col.id] = 0; });

        tasksSnapshot.forEach(doc => {
            const status = doc.data().status;
            if (counts[status] !== undefined) {
                counts[status]++;
            }
        });

        const totalTasks = tasksSnapshot.size;

        // Build inline keyboard (2 columns)
        const inlineKeyboard: any[][] = [];
        for (let i = 0; i < GTD_COLUMNS.length; i += 2) {
            const row: any[] = [];
            row.push({
                text: `${GTD_COLUMNS[i].emoji} ${GTD_COLUMNS[i].id === 'next_action' ? 'Next' : GTD_COLUMNS[i].title.split(' ')[1]} (${counts[GTD_COLUMNS[i].id]})`,
                callback_data: `tasks:${GTD_COLUMNS[i].id}`
            });
            if (GTD_COLUMNS[i + 1]) {
                row.push({
                    text: `${GTD_COLUMNS[i + 1].emoji} ${GTD_COLUMNS[i + 1].id === 'next_action' ? 'Next' : GTD_COLUMNS[i + 1].title.split(' ')[1]} (${counts[GTD_COLUMNS[i + 1].id]})`,
                    callback_data: `tasks:${GTD_COLUMNS[i + 1].id}`
                });
            }
            inlineKeyboard.push(row);
        }

        await sendMessage(chatId, `📋 *Your Tasks* (${totalTasks} total)\n\nTap a column to view:`, {
            inline_keyboard: inlineKeyboard
        });

    } catch (error) {
        console.error('Error fetching tasks:', error);
        await sendMessage(chatId, "⚠️ Error loading tasks. Please try again.");
    }
}

async function sendTaskList(chatId: number, telegramId: number, status: string) {
    const platformUser = await findPlatformUser(telegramId);

    if (!platformUser) {
        await sendMessage(chatId, "❌ Account not linked.");
        return;
    }

    try {
        // Fetch tasks with this status
        // Fetch tasks with this status (GLOBAL collection)
        const tasksSnapshot = await db.collection('gtd_tasks')
            .where('ownerId', '==', platformUser.id)
            .where('status', '==', status)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();

        const column = GTD_COLUMNS.find(c => c.id === status);
        const columnTitle = column?.title || status;

        if (tasksSnapshot.empty) {
            await sendMessage(chatId, `${columnTitle}\n\n_No tasks in this column_`, {
                inline_keyboard: [[{ text: '◀️ Back', callback_data: 'tasks_back' }]]
            });
            return;
        }

        // Build task list
        let taskList = `${columnTitle}\n\n`;
        let index = 1;

        for (const doc of tasksSnapshot.docs) {
            const task = doc.data();
            const priority = PRIORITY_EMOJI[task.priority || 'none'];
            const title = task.title || 'Untitled';

            // Get client name if exists
            let clientNote = '';
            if (task.clientId) {
                try {
                    const clientDoc = await db.collection('clients').doc(task.clientId).get();
                    if (clientDoc.exists) {
                        clientNote = ` · ${clientDoc.data()?.name}`;
                    }
                } catch (e) {
                    // Ignore client fetch errors
                }
            }

            // Format due date if exists
            let dueNote = '';
            if (task.dueDate) {
                const dueDate = task.dueDate.toDate();
                const today = new Date();
                const isOverdue = dueDate < today;
                const dateStr = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                dueNote = isOverdue ? ` ⚠️ ${dateStr}` : ` 📅 ${dateStr}`;
            }

            taskList += `${index}. ${priority} ${title}${clientNote}${dueNote}\n`;
            index++;
        }

        if (tasksSnapshot.size >= 10) {
            taskList += `\n_...and more. View all in web app._`;
        }

        await sendMessage(chatId, taskList, {
            inline_keyboard: [[{ text: '◀️ Back to Menu', callback_data: 'tasks_back' }]]
        });

    } catch (error) {
        console.error('Error fetching task list:', error);
        await sendMessage(chatId, "⚠️ Error loading tasks.", {
            inline_keyboard: [[{ text: '◀️ Back', callback_data: 'tasks_back' }]]
        });
    }
}
