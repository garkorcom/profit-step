import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as crypto from 'crypto';

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
    } else if (text === '/finish_day' || text === '🏁 Finish Day') {
        await handleFinishDay(chatId, userId);
    } else if (text === '☕ Break') {
        await pauseWorkSession(chatId, userId);
    } else if (text === '▶️ Resume Work') {
        await resumeWorkSession(chatId, userId);
    } else if (text === '❌ Cancel') {
        await handleCancel(chatId, userId);
    } else if (text === '⏩ Skip') {
        await handleSkipMedia(chatId, userId);
    } else if (message.photo || message.document || message.video) {
        await handleMediaUpload(chatId, userId, message);
    } else if (message.location) {
        await handleLocation(chatId, userId, message.location);
    } else if (text === '/me') {
        await handleMe(chatId, userId);
    } else if (text && text.startsWith('/name ')) {
        const newName = text.substring(6).trim();
        await handleNameChange(chatId, userId, newName);
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

    // Add Cancel Button
    inlineKeyboard.push([{ text: "❌ Cancel", callback_data: "cancel_selection" }]);

    await sendMessage(chatId, "📍 Select Client/Object:", { inline_keyboard: inlineKeyboard });
}

async function handleClientSelection(chatId: number, userId: number, clientId: string) {
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

    if (activeSession && activeSession.data().awaitingLocation) {
        // Save location and move to next step
        await activeSession.ref.update({
            startLocation: location, // { latitude, longitude }
            awaitingLocation: false,
            awaitingStartPhoto: true
        });

        await sendMessage(chatId, "✅ Location verified.\n\n📸 Now please send a **photo** of the start condition.", { remove_keyboard: true }); // Remove special location keyboard if any
    } else {
        await sendMessage(chatId, "Updated location received.", { remove_keyboard: true });
    }
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
        // Skip End Media
        await activeSession.ref.update({
            awaitingEndPhoto: false,
            awaitingDescription: true,
            skippedEndPhoto: true
        });

        await sendMessage(chatId, "⏩ Media skipped.\nPlease type a brief **description** of what was done (or type 'Skip').", { remove_keyboard: true });
    } else if (sessionData.awaitingStartPhoto) {
        // Skip Start Media (if we want to allow this too, user mainly asked for end of day, but good to have)
        await activeSession.ref.update({
            awaitingStartPhoto: false,
            skippedStartPhoto: true
        });
        await sendMessage(chatId, `✅ Work started! (Media skipped)`, { remove_keyboard: true });
        await sendMainMenu(chatId);
    } else {
        await sendMessage(chatId, "⚠️ Nothing to skip right now.");
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
            awaitingStartPhoto: false
        });
        await sendMessage(chatId, `✅ Work started! Good luck.`, { remove_keyboard: true });
        await sendMainMenu(chatId);

    } else if (sessionData.awaitingEndPhoto) {
        // Save End Media
        const url = await saveTelegramFile(fileId, `work_photos/${activeSession.id}/end_${Date.now()}.${extension}`);

        // Move to description step
        await activeSession.ref.update({
            endPhotoId: fileId,
            endPhotoUrl: url,
            endMediaType: message.video ? 'video' : (message.document ? 'document' : 'photo'),
            awaitingEndPhoto: false,
            awaitingDescription: true
        });

        await sendMessage(chatId, "📝 Media received. Please type a brief **description** of what was done.", { remove_keyboard: true });

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
        await sendMainMenu(chatId);
    }
}

async function handleFinishDay(chatId: number, userId: number) {
    let msg = '';
    const activeSession = await getActiveSession(userId);
    if (activeSession) {
        msg = await autoFinishActiveSession(activeSession, chatId, userId);
    }

    // Calculate Daily Stats
    const stats = await calculateDailyStats(userId);
    const h = Math.floor(stats.minutes / 60);
    const m = stats.minutes % 60;

    await sendMessage(chatId, `${msg}📅 *Daily Summary*\n\n⏱ Total Time: ${h}h ${m}m\n💰 Earned: $${stats.earnings.toFixed(2)}\n\nGood job!`);
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

async function handleHelp(chatId: number) {
    const helpText = `👷‍♂️ *Worker Bot Manual*

*Commands:*
/start - Open Main Menu
/me - Show Profile
/name [Name] - Change Name
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

async function getActiveSession(userId: number) {
    // Check active OR paused (conceptually active session)
    // Actually we usually query 'active' or 'paused'.
    // Let's check 'active' first.
    let qs = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active') // Query for active sessions
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // If no active, check for paused
    qs = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused') // Query for paused sessions
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    return null;
}

async function calculateDailyStats(userId: number, currentSessionMinutes = 0, currentSessionEarnings = 0) {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    let dailyMinutes = currentSessionMinutes;
    let dailyEarnings = currentSessionEarnings;

    try {
        const todaySessions = await db.collection('work_sessions')
            .where('employeeId', '==', userId)
            .where('status', '==', 'completed')
            .where('endTime', '>=', admin.firestore.Timestamp.fromDate(startOfDay))
            .where('endTime', '<=', admin.firestore.Timestamp.fromDate(endOfDay))
            .get();

        todaySessions.docs.forEach(doc => {
            const d = doc.data();
            dailyMinutes += (d.durationMinutes || 0);
            dailyEarnings += (d.sessionEarnings || 0);
        });
    } catch (e) {
        console.error("Error calculating daily totals:", e);
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
        const tasksSnapshot = await db.collection('users')
            .doc(platformUser.id)
            .collection('gtd_tasks')
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
        const tasksSnapshot = await db.collection('users')
            .doc(platformUser.id)
            .collection('gtd_tasks')
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
