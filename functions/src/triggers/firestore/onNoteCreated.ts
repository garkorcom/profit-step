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
import { sendMessage } from '../telegram/telegramUtils';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

// ═══════════════════════════════════════════════════════════
// AI PROMPTS
// ═══════════════════════════════════════════════════════════

const LIST_DETECTION_PROMPT = `You are an AI assistant for a construction management app.
Analyze this voice message transcription from a foreman.

Your task:
1. If the user lists MULTIPLE tasks/actions (using words like "первое", "второе", "список", numbered items, or comma-separated actions), extract them as a checklist.
2. If single task/note, return empty checklist.
3. Try to detect project name if mentioned (client name, location like "Вилла", "Кухня на Барбери").
4. Try to detect deadline if mentioned ("завтра", "в пятницу", "до конца недели").

Return ONLY valid JSON (no markdown):
{
  "title": "Summary title for the list or single task",
  "checklist": [
    {"text": "First task"},
    {"text": "Second task"}
  ],
  "projectName": "Villa" or null,
  "deadlineHint": "tomorrow" or "friday" or null
}

If single task, checklist should be empty array [].`;

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

interface AIParseResult {
    title: string;
    checklist: { text: string }[];
    projectName?: string | null;
    deadlineHint?: string | null;
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

            // Step 2: Parse for list detection
            logger.info('Parsing for list structure...');
            const parsed = await parseForList(transcription);

            // Step 3: Resolve project if mentioned
            let projectId: string | undefined;
            let projectName: string | undefined;

            if (parsed.projectName) {
                const project = await resolveProject(parsed.projectName);
                if (project) {
                    projectId = project.id;
                    projectName = project.name;
                }
            }

            // Step 4: Build checklist if detected
            const checklist = parsed.checklist.map(item => ({
                id: generateUUID(),
                text: item.text,
                isDone: false
            }));

            // Step 5: Parse deadline hint
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

            await snap.ref.update(updateData);

            logger.info(`✅ Note processed: ${noteId}`, {
                title,
                checklistCount: checklist.length,
                hasProject: !!projectId,
                hasDeadline: !!deadline
            });

            // Send Telegram notification
            if (note.telegramId) {
                let message = `✅ *Распознано:*\n\n${title}`;
                if (checklist.length > 0) {
                    message += `\n\n📋 *Список (${checklist.length} пунктов)*`;
                }
                if (projectName) {
                    message += `\n📍 Проект: ${projectName}`;
                }
                await sendMessage(note.telegramId, message);
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
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

/**
 * Parse transcription for list structure using AI
 */
async function parseForList(transcription: string): Promise<AIParseResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    try {
        const result = await model.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: LIST_DETECTION_PROMPT },
                    { text: `\n\nTranscription to analyze:\n"${transcription}"` }
                ]
            }]
        });

        const responseText = result.response.text().trim();

        // Clean up response (remove markdown if present)
        const jsonText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const parsed = JSON.parse(jsonText);

        return {
            title: parsed.title || transcription.substring(0, 50),
            checklist: parsed.checklist || [],
            projectName: parsed.projectName || null,
            deadlineHint: parsed.deadlineHint || null
        };

    } catch (error) {
        logger.warn('List parsing failed, using simple transcription', error);
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
