/**
 * @fileoverview Firestore trigger for Note creation (v2)
 * 
 * Processes notes with pending AI status:
 * - Transcribes voice notes
 * - Detects list patterns → creates checklist
 * - Resolves project names → projectId
 * - Generates smart titles
 * - Sends Telegram notification on completion
 * 
 * @module triggers/firestore/onNoteCreated
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sendMessage, editMessage } from '../telegram/telegramUtils';
import { safeConfig } from '../../utils/safeConfig';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

// API Key with fallback to safeConfig()
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || safeConfig().gemini?.api_key;

// Prompts are defined in RAG CONTEXT FUNCTIONS section below

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

interface AIParseResult {
    title: string;
    checklist: { text: string }[];
    projectName?: string | null;
    projectId?: string | null;
    deadlineHint?: string | null;
    // Smart Dispatcher: Assignee detection
    assigneeName?: string | null;
    assigneeId?: string | null;
    // Confidence levels for UI highlighting
    projectConfidence?: 'high' | 'low';
    assigneeConfidence?: 'high' | 'low';
}

/**
 * RAG context data for AI prompt
 */
interface ContextData {
    projects: string;
    users: string;
}

// ═══════════════════════════════════════════════════════════
// MAIN TRIGGER
// ═══════════════════════════════════════════════════════════

/**
 * Firestore trigger: on Note creation
 * Handles async AI processing for voice notes with list detection
 */
export const onNoteCreated = functions
    .region('us-central1')
    .firestore
    .document('notes/{noteId}')
    .onCreate(async (snap, context) => {
        const noteId = context.params.noteId;
        const note = snap.data();

        logger.info(`📝 Note created: ${noteId}`, {
            stage: note.stage,
            aiStatus: note.aiStatus
        });

        // Only process notes with pending AI status
        if (note.aiStatus !== 'pending') {
            logger.info('No AI processing needed');
            return null;
        }

        // Check for audio attachment
        const audioAttachment = note.attachments?.find(
            (a: any) => a.type === 'audio'
        );

        if (!audioAttachment) {
            logger.warn('No audio attachment found for pending AI note');
            await snap.ref.update({
                aiStatus: 'failed',
                aiError: 'No audio attachment found'
            });
            return null;
        }

        try {
            // Download audio from Storage
            const audioUrl = audioAttachment.url || note.originalAudioUrl;
            logger.info(`Downloading audio from ${audioUrl}`);

            const audioBuffer = await downloadFromStorage(audioUrl);

            if (!audioBuffer) {
                throw new Error('Failed to download audio');
            }

            // Step 1: Transcribe audio
            logger.info('Starting AI transcription...');
            const transcription = await transcribeAudio(
                audioBuffer,
                audioAttachment.mimeType || 'audio/ogg'
            );

            if (!transcription) {
                throw new Error('Transcription returned empty');
            }

            logger.info(`Transcription: ${transcription.substring(0, 100)}...`);

            // Step 2: Load full RAG context (projects + users with aliases)
            logger.info('Loading RAG context...');
            const context = await loadFullContext();

            // Step 3: Parse with Smart Dispatcher (list + project + assignee detection)
            logger.info('Running Smart Dispatcher...');
            const parsed = await parseWithSmartDispatcher(transcription, context, note.ownerId, note.ownerName);

            // Step 4: Use projectId from AI if valid, otherwise resolve
            let projectId = parsed.projectId || undefined;
            let projectName = parsed.projectName || undefined;

            if (!projectId && parsed.projectName) {
                const project = await resolveProject(parsed.projectName);
                if (project) {
                    projectId = project.id;
                    projectName = project.name;
                }
            }

            // Step 5: Build checklist if detected
            const checklist = parsed.checklist.map((item: { text: string }) => ({
                id: generateUUID(),
                text: item.text,
                isDone: false
            }));

            // Step 6: Parse deadline hint
            const deadline = parsed.deadlineHint
                ? parseDeadlineHint(parsed.deadlineHint)
                : undefined;

            // Determine title
            const title = parsed.title || (
                transcription.length > 50
                    ? transcription.substring(0, 47) + '...'
                    : transcription
            );

            // Update note with all extracted data
            const updateData: any = {
                title,
                description: transcription,
                stage: 'ready',
                aiStatus: 'completed',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            if (checklist.length > 0) {
                updateData.checklist = checklist;
            }
            if (projectId) {
                updateData.projectId = projectId;
                updateData.projectName = projectName;
            }
            if (deadline) {
                updateData.deadline = deadline;
            }

            // Smart Dispatcher: Handle assignee
            let assigneeId = parsed.assigneeId || undefined;
            let assigneeName = parsed.assigneeName || undefined;

            if (assigneeId) {
                updateData.assigneeIds = [assigneeId];
                updateData.assigneeNames = [assigneeName || 'Unknown'];

                // Auto-Controller Rule: If assignee ≠ owner, owner becomes controller
                if (assigneeId !== note.ownerId) {
                    updateData.controllerId = note.ownerId;
                    updateData.controllerName = note.ownerName || 'Owner';
                    updateData.gates = {
                        internalDone: false,
                        verified: false
                    };
                    logger.info(`🎯 Auto-controller set: ${note.ownerName} controls task for ${assigneeName}`);
                }
            }

            // AI Metadata for UI highlighting
            updateData.aiMetadata = {
                isProjectPredicted: !!projectId,
                isAssigneePredicted: !!assigneeId,
                confidence: (parsed.projectConfidence === 'high' || parsed.assigneeConfidence === 'high') ? 'high' : 'low'
            };

            await snap.ref.update(updateData);

            logger.info(`✅ Note processed: ${noteId}`, {
                title,
                checklistCount: checklist.length,
                hasProject: !!projectId,
                hasDeadline: !!deadline
            });

            // FIX #4: Edit original "processing" message or send new one
            if (note.telegramId) {
                let message = `✅ *Распознано:*\n\n${title}`;
                if (checklist.length > 0) {
                    const listItems = checklist.slice(0, 5).map(i => `▫️ ${i.text}`).join('\n');
                    message += `\n\n📋 *Список (${checklist.length}):*\n${listItems}`;
                    if (checklist.length > 5) message += `\n...и ещё ${checklist.length - 5}`;
                }
                if (projectName) {
                    message += `\n\n📍 Проект: ${projectName}`;
                }
                if (deadline) {
                    message += `\n⏰ Дедлайн: ${deadline.toDate().toLocaleDateString('ru-RU')}`;
                }

                const botReplyId = note.source?.botReplyId;
                if (botReplyId) {
                    await editMessage(note.telegramId, botReplyId, message);
                } else {
                    await sendMessage(note.telegramId, message);
                }
            }

            return null;

        } catch (error: any) {
            logger.error('AI processing failed', error);

            await snap.ref.update({
                aiStatus: 'failed',
                aiError: error.message || 'Unknown error',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Notify user of failure
            if (note.telegramId) {
                await sendMessage(note.telegramId,
                    `⚠️ Не удалось распознать голосовое.\n` +
                    `Заметка сохранена как аудио.`
                );
            }

            return null;
        }
    });

// ═══════════════════════════════════════════════════════════
// AI FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Transcribe audio using Gemini
 */
async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string | null> {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const audioBase64 = audioBuffer.toString('base64');

    const result = await model.generateContent({
        contents: [{
            role: 'user',
            parts: [
                { text: 'Transcribe this audio message. Output ONLY the transcribed text in the original language (likely Russian). If you cannot transcribe, return empty string.' },
                {
                    inlineData: {
                        mimeType,
                        data: audioBase64
                    }
                }
            ]
        }]
    });

    const response = result.response.text().trim();
    return response || null;
}

// ═══════════════════════════════════════════════════════════
// RAG CONTEXT FUNCTIONS (Smart Dispatcher v2)
// ═══════════════════════════════════════════════════════════

/**
 * Load full RAG context: projects and users with aliases
 * Used by Smart Dispatcher to match voice mentions to exact IDs
 */
async function loadFullContext(): Promise<ContextData> {
    try {
        // Load projects/clients with aliases
        const clientsSnap = await db.collection('clients')
            .where('status', '!=', 'archived')
            .limit(50)
            .get();

        const projects = clientsSnap.docs.map(d => {
            const data = d.data();
            const aliases = data.aliases?.length
                ? `, aliases: [${data.aliases.map((a: string) => `"${a}"`).join(', ')}]`
                : '';
            return `{ id: "${d.id}", name: "${data.name}"${aliases} }`;
        }).join('\n');

        // Load active users with aliases
        const usersSnap = await db.collection('users')
            .where('status', '==', 'active')
            .limit(30)
            .get();

        const users = usersSnap.docs.map(d => {
            const data = d.data();
            const aliases = data.aliases?.length
                ? `, aliases: [${data.aliases.map((a: string) => `"${a}"`).join(', ')}]`
                : '';
            return `{ id: "${d.id}", name: "${data.displayName}"${aliases} }`;
        }).join('\n');

        logger.info(`RAG Context loaded: ${clientsSnap.size} projects, ${usersSnap.size} users`);

        return { projects, users };
    } catch (error) {
        logger.warn('Failed to load RAG context', error);
        return { projects: '(Error)', users: '(Error)' };
    }
}

/**
 * Smart Dispatcher Prompt Template
 */
const SMART_DISPATCHER_PROMPT = `Ты — умный диспетчер строительной компании.
Проанализируй голосовое сообщение и извлеки структурированные данные.

═══════════════════════════════════════════════════════════
📁 СПРАВОЧНИК ПРОЕКТОВ (используй ТОЧНЫЕ ID из этого списка!):
{projectContext}

👥 СПРАВОЧНИК СОТРУДНИКОВ:
{userContext}
═══════════════════════════════════════════════════════════

📝 СООБЩЕНИЕ от пользователя {ownerName} (ID: {ownerId}):
"{transcription}"

═══════════════════════════════════════════════════════════
ИНСТРУКЦИИ:
1. ПРОЕКТ: Если упоминается проект из списка (по имени или alias), верни его ТОЧНЫЙ ID.
2. ИСПОЛНИТЕЛЬ: Если упоминается человек КРОМЕ автора, верни его ID как assigneeId.
   - Используй aliases для сопоставления (Леша → Алексей)
   - Если говорит "я сделаю", "сам" — НЕ ставь assigneeId
3. ЧЕКЛИСТ: Если есть список действий (первое, второе, или перечисления), извлеки их.
4. ДЕДЛАЙН: Если указано время ("завтра", "в пятницу"), укажи в deadlineHint.

ВАЖНО: Возвращай ТОЛЬКО валидный JSON без markdown-разметки!
═══════════════════════════════════════════════════════════

{
  "title": "Краткий заголовок задачи",
  "checklist": [{"text": "Задача 1"}, {"text": "Задача 2"}],
  "projectId": "точный_id_из_справочника" | null,
  "projectName": "Название проекта" | null,
  "projectConfidence": "high" | "low",
  "assigneeId": "точный_id_пользователя" | null,
  "assigneeName": "Имя исполнителя" | null,
  "assigneeConfidence": "high" | "low",
  "deadlineHint": "завтра" | "пятница" | null
}`;

/**
 * Parse transcription using Smart Dispatcher with full RAG context
 */
async function parseWithSmartDispatcher(
    transcription: string,
    context: ContextData,
    ownerId: string,
    ownerName?: string
): Promise<AIParseResult> {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Build prompt with context
    const prompt = SMART_DISPATCHER_PROMPT
        .replace('{projectContext}', context.projects || '(Нет проектов)')
        .replace('{userContext}', context.users || '(Нет пользователей)')
        .replace('{ownerName}', ownerName || 'Unknown')
        .replace('{ownerId}', ownerId)
        .replace('{transcription}', transcription);

    try {
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const responseText = result.response.text().trim();

        // Clean up response (remove markdown if present)
        const jsonText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const parsed = JSON.parse(jsonText);

        logger.info('Smart Dispatcher result', {
            projectId: parsed.projectId,
            assigneeId: parsed.assigneeId,
            checklistCount: parsed.checklist?.length || 0
        });

        return {
            title: parsed.title || transcription.substring(0, 50),
            checklist: parsed.checklist || [],
            projectName: parsed.projectName || null,
            projectId: parsed.projectId || null,
            deadlineHint: parsed.deadlineHint || null,
            assigneeName: parsed.assigneeName || null,
            assigneeId: parsed.assigneeId || null,
            projectConfidence: parsed.projectConfidence || 'low',
            assigneeConfidence: parsed.assigneeConfidence || 'low'
        };

    } catch (error) {
        logger.warn('Smart Dispatcher parsing failed, falling back', error);
        return {
            title: transcription.length > 50
                ? transcription.substring(0, 47) + '...'
                : transcription,
            checklist: [],
            projectName: null,
            deadlineHint: null
        };
    }
}

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Resolve project name to ID via Firestore lookup
 */
async function resolveProject(projectName: string): Promise<{ id: string; name: string } | null> {
    try {
        // Search in clients collection (projects are often client names)
        const clientsSnap = await db.collection('clients')
            .where('name', '>=', projectName)
            .where('name', '<=', projectName + '\uf8ff')
            .limit(1)
            .get();

        if (!clientsSnap.empty) {
            const doc = clientsSnap.docs[0];
            return { id: doc.id, name: doc.data().name };
        }

        // Fuzzy search - simple contains check
        const allClients = await db.collection('clients').limit(50).get();
        const lowerName = projectName.toLowerCase();

        for (const doc of allClients.docs) {
            const clientName = doc.data().name?.toLowerCase() || '';
            if (clientName.includes(lowerName) || lowerName.includes(clientName)) {
                return { id: doc.id, name: doc.data().name };
            }
        }

        return null;
    } catch (error) {
        logger.warn('Project resolution failed', error);
        return null;
    }
}

/**
 * Parse deadline hint to Firestore Timestamp
 */
function parseDeadlineHint(hint: string): admin.firestore.Timestamp | undefined {
    const now = new Date();
    const lowerHint = hint.toLowerCase();

    if (lowerHint.includes('today') || lowerHint.includes('сегодня')) {
        now.setHours(18, 0, 0, 0);
        return admin.firestore.Timestamp.fromDate(now);
    }

    if (lowerHint.includes('tomorrow') || lowerHint.includes('завтра')) {
        now.setDate(now.getDate() + 1);
        now.setHours(18, 0, 0, 0);
        return admin.firestore.Timestamp.fromDate(now);
    }

    if (lowerHint.includes('friday') || lowerHint.includes('пятниц')) {
        const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
        now.setDate(now.getDate() + daysUntilFriday);
        now.setHours(18, 0, 0, 0);
        return admin.firestore.Timestamp.fromDate(now);
    }

    if (lowerHint.includes('week') || lowerHint.includes('недел')) {
        now.setDate(now.getDate() + 7);
        now.setHours(18, 0, 0, 0);
        return admin.firestore.Timestamp.fromDate(now);
    }

    return undefined;
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Download file from Firebase Storage URL
 */
async function downloadFromStorage(url: string): Promise<Buffer | null> {
    try {
        const match = url.match(/storage\.googleapis\.com\/([^/]+)\/(.+)/);

        if (!match) {
            logger.error('Invalid storage URL format:', url);
            return null;
        }

        const [, bucketName, filePath] = match;
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(filePath);

        const [buffer] = await file.download();
        return buffer;

    } catch (error) {
        logger.error('Failed to download from storage:', error);
        return null;
    }
}

/**
 * Generate UUID v4
 */
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
