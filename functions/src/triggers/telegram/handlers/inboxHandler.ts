/**
 * @fileoverview Inbox Handler for Telegram Bot
 * 
 * "Fire & Forget" pattern - instant response, async processing.
 * Handles: text, voice, photo, album, document, forward.
 * 
 * @module triggers/telegram/handlers/inboxHandler
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions';
import axios from 'axios';
import { sendMessage } from '../telegramUtils';

const db = admin.firestore();
const storage = admin.storage();

const WORKER_BOT_TOKEN = process.env.WORKER_BOT_TOKEN;

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
 * Handle text message → Create note immediately
 */
export async function handleInboxText(
    ctx: InboxContext,
    text: string
): Promise<void> {
    const title = text.length > 50 ? text.substring(0, 50) + '...' : text;

    await createNote({
        ctx,
        title,
        description: text,
        aiStatus: 'none'
    });

    await sendMessage(ctx.chatId, '✅ Записано');
}

/**
 * Handle voice message → Upload audio, create note, trigger AI
 */
export async function handleInboxVoice(
    ctx: InboxContext,
    voice: { file_id: string; duration: number; mime_type?: string }
): Promise<void> {
    const timeStr = new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York'
    });

    // Immediate response
    await sendMessage(ctx.chatId, '🎙 Голосовое принято, обрабатываю...');

    // Upload to Storage
    const audioUrl = await saveTelegramFile(
        voice.file_id,
        `notes/${ctx.userId}/voice_${Date.now()}.ogg`
    );

    // Create note with pending AI
    await createNote({
        ctx,
        title: `🎙 Аудиозаметка от ${timeStr}`,
        aiStatus: 'pending',
        attachments: [{
            type: 'audio',
            url: audioUrl,
            mimeType: voice.mime_type || 'audio/ogg'
        }],
        originalAudioUrl: audioUrl
    });
}

/**
 * Handle photo message → Check for album, create note
 */
export async function handleInboxPhoto(
    ctx: InboxContext,
    photo: { file_id: string }[],
    caption?: string,
    mediaGroupId?: string
): Promise<void> {
    const largestPhoto = photo[photo.length - 1];

    // If part of album, delegate to album handler
    if (mediaGroupId) {
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

    await createNote({
        ctx,
        title,
        description: caption,
        aiStatus: 'none',
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

interface CreateNoteParams {
    ctx: InboxContext;
    title: string;
    description?: string;
    aiStatus: 'none' | 'pending';
    attachments?: { type: 'image' | 'audio' | 'file'; url: string; name?: string; mimeType?: string }[];
    originalAudioUrl?: string;
    mediaGroupId?: string;
    forwardFrom?: { name: string; id?: number };
}

async function createNote(params: CreateNoteParams): Promise<string> {
    const { ctx, title, description, aiStatus, attachments, originalAudioUrl, mediaGroupId, forwardFrom } = params;

    const noteData: any = {
        stage: 'inbox',
        source: {
            channel: 'telegram',
            externalId: String(ctx.messageId),
            senderName: ctx.userName,
            chatId: ctx.chatId,
            ...(mediaGroupId && { mediaGroupId }),
            ...(forwardFrom && { forwardFrom })
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
    logger.info(`📝 Note created: ${docRef.id}`, { title, aiStatus });

    return docRef.id;
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
 * Find platform user by Telegram ID
 */
export async function findPlatformUserForInbox(telegramId: number): Promise<{ id: string; displayName: string } | null> {
    const snapshot = await db.collection('users')
        .where('telegramId', '==', String(telegramId))
        .limit(1)
        .get();

    if (snapshot.empty) {
        // Try as number
        const snapshot2 = await db.collection('users')
            .where('telegramId', '==', telegramId)
            .limit(1)
            .get();

        if (snapshot2.empty) return null;
        const doc = snapshot2.docs[0];
        return { id: doc.id, displayName: doc.data().displayName || 'Unknown' };
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, displayName: doc.data().displayName || 'Unknown' };
}
