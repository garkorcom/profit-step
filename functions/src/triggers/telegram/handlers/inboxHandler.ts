/**
 * @fileoverview Inbox Handler for Telegram Bot (v2 - Stability Update)
 * 
 * "Fire & Forget" pattern - instant response, async processing.
 * Handles: text, voice, photo, album, document, forward.
 * 
 * v2 Improvements:
 * - Better album grouping via Firestore query fallback
 * - Smart text detection for AI processing
 * - UX: Edit message after AI completes
 * 
 * @module triggers/telegram/handlers/inboxHandler
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import axios from 'axios';
import { sendMessage, editMessage, getActiveSession } from '../telegramUtils';
import { parseVoiceTask } from '../../../services/smartDispatcherService';
import { safeConfig } from '../../../utils/safeConfig';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;
const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];

/**
 * Transcribe voice message for Inbox Tasks
 */
async function transcribeInboxVoice(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string | null> {
    if (!GEMINI_API_KEY) {
        logger.error('GEMINI_API_KEY not configured');
        throw new Error('GEMINI_API_KEY not configured');
    }
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const audioBase64 = audioBuffer.toString('base64');

    const TRANSCRIPTION_PROMPT = `Ты помощник, который точно транскрибирует голосовые сообщения рабочего на стройке в текст без изменений. Не добавляй от себя ничего, только текст сообщения. Никакого markdown. Выведи только то что услышал на аудио.`;

    for (const modelName of MODELS) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: TRANSCRIPTION_PROMPT },
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: audioBase64
                            }
                        }
                    ]
                }]
            });

            const response = await result.response;
            const text = response.text()?.trim();

            if (text && text.length > 0) {
                return text;
            }
        } catch (error: any) {
            logger.warn(`InboxAI transcribe: Model ${modelName} failed`, { error: error.message });
        }
    }

    logger.error('InboxAI: Voice transcription failed on all models');
    return null;
}

const db = admin.firestore();
const storage = admin.storage();

const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN || safeConfig().worker_bot?.token;

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface InboxContext {
    chatId: number;
    userId: number;
    userName: string;
    messageId: number;
    platformUserId?: string;
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLERS
// ═══════════════════════════════════════════════════════════

/**
 * Handle text message → Create note with smart AI detection
 * 
 * FIX #3: If text is complex (multiline, long, contains list markers),
 * set aiStatus: 'pending' to trigger list parsing
 */
export async function handleInboxText(
    ctx: InboxContext,
    text: string,
    suppressReply: boolean = false
): Promise<void> {
    const title = text.length > 50 ? text.substring(0, 50) + '...' : text;

    // Smart text detection: multiline, long, or contains list markers
    const isComplex =
        text.includes('\n') ||
        text.length > 100 ||
        /\d\.\s/.test(text) ||           // "1. item"
        /[-•]\s/.test(text) ||           // "- item" or "• item"
        /первое|второе|третье/i.test(text);  // Russian list markers

    // If complex, send to AI for list parsing
    const aiStatus = isComplex ? 'pending' : 'none';

    let botReplyId: number | undefined;

    if (isComplex) {
        // FIX #4: Send processing message, save ID for later edit
        const result = await sendMessageWithId(ctx.chatId, '⏳ Анализирую текст...');
        botReplyId = result?.message_id;
    }

    await createNote({
        ctx,
        title,
        description: text,
        aiStatus,
        botReplyId
    });

    if (!isComplex && !suppressReply) {
        await sendMessage(ctx.chatId, '✅ Записано');
    }
}

/**
 * Handle voice message → Transcribe with AI, CREATE GTD TASK
 * 
 * v3 Update: Inline transcription - no longer relies on Firestore trigger.
 * Voice messages are transcribed synchronously before creating the GTD task.
 */
export async function handleInboxVoice(
    ctx: InboxContext,
    voice: { file_id: string; duration: number; mime_type?: string }
): Promise<void> {
    // Send processing message
    const result = await sendMessageWithId(ctx.chatId, '🎙 Расшифровываю голосовое...');
    const botReplyId = result?.message_id;

    try {
        // 1. Download voice file from Telegram
        const fileRes = await axios.get(
            `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${voice.file_id}`
        );
        const filePath = fileRes.data.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`;

        const audioResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const audioBuffer = Buffer.from(audioResponse.data);

        logger.info(`🎤 Voice downloaded`, { size: audioBuffer.length, userId: ctx.userId });

        // 2. Upload to Storage (for history)
        const audioUrl = await saveBufferToStorage(
            audioBuffer,
            `gtd_voice/${ctx.userId}/voice_${Date.now()}.ogg`,
            'audio/ogg'
        );

        // 3. Transcribe with AI
        const transcription = await transcribeInboxVoice(audioBuffer, 'audio/ogg');

        if (!transcription) {
            throw new Error('Transcription returned empty');
        }

        logger.info(`🎙 Transcription result`, { text: transcription.substring(0, 100), userId: ctx.userId });

        // 4. Smart Dispatcher: extract assignee, client, priority from transcription
        const entities = await parseVoiceTask(
            transcription,
            ctx.platformUserId || String(ctx.userId),
            ctx.userName
        );

        logger.info(`🎯 Smart Dispatcher result`, {
            assigneeId: entities.assigneeId,
            clientId: entities.clientId,
            confidence: entities.confidence
        });

        // 5. Create GTD task with extracted entities
        const taskRef = await admin.firestore().collection('gtd_tasks').add({
            title: entities.title,
            description: transcription,
            status: 'inbox',
            priority: entities.priority || 'medium',
            taskType: null,
            estimatedHours: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ownerId: ctx.platformUserId || String(ctx.userId),
            createdBy: ctx.platformUserId || String(ctx.userId),
            createdByName: ctx.userName,
            // Smart Dispatcher extracted fields
            assigneeId: entities.assigneeId || null,
            assigneeName: entities.assigneeName || null,
            clientId: entities.clientId || null,
            clientName: entities.clientName || null,
            dueDate: entities.dueDate || null,
            // Metadata
            source: 'telegram_voice',
            telegramUserId: ctx.userId,
            aiStatus: 'completed',
            aiConfidence: entities.confidence,
            originalAudioUrl: audioUrl,
        });

        logger.info(`✅ Voice task created`, { taskId: taskRef.id, userId: ctx.userId });

        // 6. Build rich response message
        let responseMsg = `✅ Задача создана:\n\n📝 *${entities.title}*`;
        if (entities.assigneeName) {
            responseMsg += `\n👤 Исполнитель: ${entities.assigneeName}`;
        }
        if (entities.clientName) {
            responseMsg += `\n📍 Клиент: ${entities.clientName}`;
        }
        if (entities.dueDate) {
            const date = entities.dueDate.toDate();
            responseMsg += `\n📅 Дедлайн: ${date.toLocaleDateString('ru-RU')}`;
        }

        if (botReplyId) {
            await editMessage(ctx.chatId, botReplyId, responseMsg);
        } else {
            await sendMessage(ctx.chatId, responseMsg);
        }

        // 7. Check active session to warn user
        const activeSession = await getActiveSession(ctx.userId);
        if (!activeSession) {
            await sendMessage(ctx.chatId, "⚠️ Данная задача сохранена во Входящие (Inbox), так как сейчас нет активной рабочей смены.\n\n📎 Отправьте геопозицию, чтобы начать смену.");
        }

    } catch (error: any) {
        logger.error('Voice transcription failed', { error: error.message, userId: ctx.userId });

        // Fallback: create task without transcription
        const timeStr = new Date().toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/New_York'
        });

        // Upload audio anyway
        const audioUrl = await saveTelegramFile(
            voice.file_id,
            `gtd_voice/${ctx.userId}/voice_${Date.now()}.ogg`
        );

        await admin.firestore().collection('gtd_tasks').add({
            title: `🎙 Голосовая задача от ${timeStr}`,
            description: '⚠️ Не удалось расшифровать. Прослушайте аудио.',
            status: 'inbox',
            priority: 'medium',
            taskType: null,
            estimatedHours: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ownerId: ctx.platformUserId || String(ctx.userId), // Required for GTD board visibility
            createdBy: ctx.platformUserId || String(ctx.userId),
            createdByName: ctx.userName,
            source: 'telegram_voice',
            telegramUserId: ctx.userId,
            aiStatus: 'failed',
            aiError: error.message,
            originalAudioUrl: audioUrl,
        });

        if (botReplyId) {
            await editMessage(ctx.chatId, botReplyId, '⚠️ Не удалось расшифровать голосовое, но задача сохранена.');
        } else {
            await sendMessage(ctx.chatId, '⚠️ Не удалось расшифровать голосовое, но задача сохранена.');
        }
    }
}

/**
 * Handle photo message → Check for album, create note
 * 
 * FIX #1: Better album handling with Firestore query fallback
 */
export async function handleInboxPhoto(
    ctx: InboxContext,
    photo: { file_id: string }[],
    caption?: string,
    mediaGroupId?: string
): Promise<void> {
    const largestPhoto = photo[photo.length - 1];

    // FIX #1: If part of album, check existing notes first
    if (mediaGroupId) {
        // Check if note with this mediaGroupId already exists (created in last 2 min)
        const twoMinAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
        const existingNotes = await db.collection('notes')
            .where('source.mediaGroupId', '==', mediaGroupId)
            .where('createdAt', '>', twoMinAgo)
            .limit(1)
            .get();

        if (!existingNotes.empty) {
            // Add photo to existing note
            const photoUrl = await saveTelegramFile(
                largestPhoto.file_id,
                `notes/${ctx.userId}/album_${mediaGroupId}_${Date.now()}.jpg`
            );

            await existingNotes.docs[0].ref.update({
                attachments: admin.firestore.FieldValue.arrayUnion({
                    type: 'image',
                    url: photoUrl
                }),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            logger.info(`📷 Added photo to existing album note: ${existingNotes.docs[0].id}`);
            return;
        }

        // First photo in album - use pending_albums for grouping
        await handleAlbumPhoto(ctx, largestPhoto.file_id, caption, mediaGroupId);
        return;
    }

    // Single photo - process immediately
    const photoUrl = await saveTelegramFile(
        largestPhoto.file_id,
        `notes/${ctx.userId}/photo_${Date.now()}.jpg`
    );

    const title = caption
        ? (caption.length > 50 ? caption.substring(0, 50) + '...' : caption)
        : `📷 Фото от ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;

    // If caption is long, might contain list - trigger AI
    const aiStatus = caption && caption.length > 100 ? 'pending' : 'none';

    await createNote({
        ctx,
        title,
        description: caption,
        aiStatus,
        attachments: [{
            type: 'image',
            url: photoUrl
        }]
    });

    await sendMessage(ctx.chatId, '✅ Фото сохранено');
}

/**
 * Handle album photo - group by media_group_id
 */
async function handleAlbumPhoto(
    ctx: InboxContext,
    fileId: string,
    caption: string | undefined,
    mediaGroupId: string
): Promise<void> {
    const albumRef = db.collection('pending_albums').doc(mediaGroupId);

    await db.runTransaction(async (transaction) => {
        const albumDoc = await transaction.get(albumRef);

        if (albumDoc.exists) {
            // Add to existing album
            const data = albumDoc.data()!;
            transaction.update(albumRef, {
                photoFileIds: [...data.photoFileIds, fileId],
                caption: data.caption || caption, // Keep first caption
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } else {
            // Create new album entry
            transaction.set(albumRef, {
                mediaGroupId,
                userId: ctx.userId,
                chatId: ctx.chatId,
                userName: ctx.userName,
                platformUserId: ctx.platformUserId,
                photoFileIds: [fileId],
                caption: caption || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3000) // 3 sec TTL
            });

            // Schedule album finalization
            setTimeout(() => finalizeAlbum(mediaGroupId), 2500);
        }
    });
}

/**
 * Finalize album - create single note from grouped photos
 */
async function finalizeAlbum(mediaGroupId: string): Promise<void> {
    const albumRef = db.collection('pending_albums').doc(mediaGroupId);
    const albumDoc = await albumRef.get();

    if (!albumDoc.exists) return;

    const data = albumDoc.data()!;
    const photoFileIds: string[] = data.photoFileIds || [];

    if (photoFileIds.length === 0) return;

    try {
        // Upload all photos
        const attachments = await Promise.all(
            photoFileIds.map(async (fileId, idx) => {
                const url = await saveTelegramFile(
                    fileId,
                    `notes/${data.userId}/album_${mediaGroupId}_${idx}.jpg`
                );
                return { type: 'image' as const, url };
            })
        );

        const title = data.caption
            ? (data.caption.length > 50 ? data.caption.substring(0, 50) + '...' : data.caption)
            : `📷 Альбом (${attachments.length} фото)`;

        // Create note
        await createNote({
            ctx: {
                chatId: data.chatId,
                userId: data.userId,
                userName: data.userName,
                messageId: 0,
                platformUserId: data.platformUserId
            },
            title,
            description: data.caption,
            aiStatus: 'none',
            attachments,
            mediaGroupId
        });

        await sendMessage(data.chatId, `✅ Альбом сохранён (${attachments.length} фото)`);

        // Cleanup
        await albumRef.delete();
    } catch (error) {
        logger.error('Error finalizing album', error);
    }
}

/**
 * Handle document upload
 */
export async function handleInboxDocument(
    ctx: InboxContext,
    document: { file_id: string; file_name?: string; mime_type?: string }
): Promise<void> {
    const fileName = document.file_name || 'file';

    const fileUrl = await saveTelegramFile(
        document.file_id,
        `notes/${ctx.userId}/docs/${Date.now()}_${fileName}`
    );

    await createNote({
        ctx,
        title: `📎 ${fileName}`,
        aiStatus: 'none',
        attachments: [{
            type: 'file',
            url: fileUrl,
            name: fileName,
            mimeType: document.mime_type
        }]
    });

    await sendMessage(ctx.chatId, '✅ Файл сохранён');
}

/**
 * Handle forwarded message
 */
export async function handleInboxForward(
    ctx: InboxContext,
    text: string,
    forwardFrom: { first_name: string; id?: number }
): Promise<void> {
    const fromName = forwardFrom.first_name;
    const fullText = `Переслано от: ${fromName}\n\n${text}`;
    const title = text.length > 40
        ? `↪️ ${fromName}: ${text.substring(0, 40)}...`
        : `↪️ ${fromName}: ${text}`;

    await createNote({
        ctx,
        title,
        description: fullText,
        aiStatus: 'none',
        forwardFrom: {
            name: fromName,
            id: forwardFrom.id
        }
    });

    await sendMessage(ctx.chatId, '✅ Пересланное сообщение сохранено');
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

export interface CreateNoteParams {
    ctx: InboxContext;
    title: string;
    description?: string;
    aiStatus: 'none' | 'pending';
    attachments?: { type: 'image' | 'audio' | 'file'; url: string; name?: string; mimeType?: string }[];
    originalAudioUrl?: string;
    mediaGroupId?: string;
    forwardFrom?: { name: string; id?: number };
    botReplyId?: number;  // FIX #4: Store for later editing
}

export async function createNote(params: CreateNoteParams): Promise<string> {
    const { ctx, title, description, aiStatus, attachments, originalAudioUrl, mediaGroupId, forwardFrom, botReplyId } = params;

    const noteData: any = {
        stage: 'inbox',
        source: {
            channel: 'telegram',
            externalId: String(ctx.messageId),
            senderName: ctx.userName,
            chatId: ctx.chatId,
            ...(mediaGroupId && { mediaGroupId }),
            ...(forwardFrom && { forwardFrom }),
            ...(botReplyId && { botReplyId })  // FIX #4
        },
        ownerId: ctx.platformUserId || String(ctx.userId),
        ownerName: ctx.userName,
        telegramId: ctx.userId,
        title,
        aiStatus,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (description) noteData.description = description;
    if (attachments && attachments.length > 0) noteData.attachments = attachments;
    if (originalAudioUrl) noteData.originalAudioUrl = originalAudioUrl;

    const docRef = await db.collection('notes').add(noteData);
    logger.info(`📝 Note created: ${docRef.id}`, { title, aiStatus, hasBotReplyId: !!botReplyId });

    return docRef.id;
}

/**
 * Send message and return message ID for later editing
 */
async function sendMessageWithId(chatId: number, text: string): Promise<{ message_id: number } | null> {
    try {
        const response = await axios.post(
            `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/sendMessage`,
            {
                chat_id: chatId,
                text,
                parse_mode: 'Markdown'
            }
        );
        return response.data?.result;
    } catch (error) {
        logger.error('Failed to send message with ID', error);
        return null;
    }
}

/**
 * Download file from Telegram and upload to Firebase Storage
 */
async function saveTelegramFile(fileId: string, storagePath: string): Promise<string> {
    // Get file path from Telegram
    const fileInfoResponse = await axios.get(
        `https://api.telegram.org/bot${WORKER_BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const filePath = fileInfoResponse.data.result.file_path;

    // Download file
    const fileResponse = await axios.get(
        `https://api.telegram.org/file/bot${WORKER_BOT_TOKEN}/${filePath}`,
        { responseType: 'arraybuffer' }
    );
    const fileBuffer = Buffer.from(fileResponse.data);

    // Upload to Firebase Storage
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    await file.save(fileBuffer, {
        metadata: {
            contentType: getContentType(storagePath)
        }
    });

    // Make public and get URL
    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
}

function getContentType(path: string): string {
    if (path.endsWith('.ogg')) return 'audio/ogg';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
}

/**
 * Save buffer directly to Firebase Storage
 */
async function saveBufferToStorage(
    buffer: Buffer,
    storagePath: string,
    contentType: string
): Promise<string> {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);

    await file.save(buffer, {
        metadata: { contentType }
    });

    await file.makePublic();
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
}

