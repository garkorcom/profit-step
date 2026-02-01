/**
 * @fileoverview Merge Notes — Combine multiple notes into one with checklist
 * 
 * Takes multiple notes and combines them into a single note with checklist.
 * All attachments are combined. Original notes are archived (soft delete).
 * 
 * @module callable/notes/mergeNotes
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

interface MergeRequest {
    noteIds: string[];
    newTitle?: string;
}

interface MergeResponse {
    success: boolean;
    newNoteId?: string;
    mergedCount?: number;
    error?: string;
}

/**
 * Merge multiple notes into one with checklist
 * 
 * @param noteIds - Array of note IDs to merge
 * @param newTitle - Optional custom title for merged note
 * @returns New merged note ID
 */
export const mergeNotes = functions
    .region('us-central1')
    .https.onCall(async (data: MergeRequest, context): Promise<MergeResponse> => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Требуется авторизация'
            );
        }

        const { noteIds, newTitle } = data;

        if (!noteIds || noteIds.length < 2) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Минимум 2 заметки для объединения'
            );
        }

        if (noteIds.length > 20) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Максимум 20 заметок для объединения'
            );
        }

        try {
            // Load all notes
            const noteDocs = await Promise.all(
                noteIds.map(id => db.collection('notes').doc(id).get())
            );

            // Validate all notes exist and belong to user
            const notes: any[] = [];
            for (const doc of noteDocs) {
                if (!doc.exists) {
                    throw new functions.https.HttpsError(
                        'not-found',
                        `Заметка ${doc.id} не найдена`
                    );
                }

                const data = doc.data()!;
                if (data.ownerId !== context.auth.uid) {
                    throw new functions.https.HttpsError(
                        'permission-denied',
                        `Нет доступа к заметке ${doc.id}`
                    );
                }

                notes.push({ id: doc.id, ...data });
            }

            // Build checklist from note titles
            const checklist = notes.map((note, index) => ({
                id: generateUUID(),
                text: note.title,
                isDone: false,
                originalSource: note.attachments?.[0]?.url // First attachment as source
            }));

            // Combine all attachments
            const allAttachments: any[] = [];
            for (const note of notes) {
                if (note.attachments) {
                    allAttachments.push(...note.attachments);
                }
            }

            // Determine project (most recent if different)
            const projectId = notes.find(n => n.projectId)?.projectId;
            const projectName = notes.find(n => n.projectName)?.projectName;
            const locationId = notes.find(n => n.locationId)?.locationId;

            // Determine deadline (earliest if multiple)
            let deadline: any = undefined;
            for (const note of notes) {
                if (note.deadline) {
                    if (!deadline || note.deadline.toMillis() < deadline.toMillis()) {
                        deadline = note.deadline;
                    }
                }
            }

            // Generate title
            const mergedTitle = newTitle || `Пакет: ${notes.length} задач`;

            // Create merged note
            const newNoteData: any = {
                stage: 'inbox',
                source: {
                    channel: 'web',
                    externalId: `merged-${Date.now()}`
                },
                ownerId: context.auth.uid,
                ownerName: notes[0].ownerName,
                telegramId: notes[0].telegramId,

                title: mergedTitle,
                description: `Объединено из ${notes.length} заметок`,

                checklist,

                // Inherited context (from most complete note)
                ...(projectId && { projectId }),
                ...(projectName && { projectName }),
                ...(locationId && { locationId }),
                ...(deadline && { deadline }),

                // Merge tracking
                mergedFromIds: noteIds,

                // Combined attachments
                ...(allAttachments.length > 0 && { attachments: allAttachments }),

                aiStatus: 'none',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // Transaction: create merged note + archive originals
            const newNoteRef = db.collection('notes').doc();

            await db.runTransaction(async (transaction) => {
                // Create merged note
                transaction.set(newNoteRef, newNoteData);

                // Archive original notes
                for (const noteId of noteIds) {
                    transaction.update(db.collection('notes').doc(noteId), {
                        stage: 'archived',
                        archivedReason: 'merged',
                        mergedIntoId: newNoteRef.id,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            });

            logger.info(`✅ Merged ${notes.length} notes → ${newNoteRef.id}`, {
                originalIds: noteIds,
                checklistCount: checklist.length,
                attachmentCount: allAttachments.length
            });

            return {
                success: true,
                newNoteId: newNoteRef.id,
                mergedCount: notes.length
            };

        } catch (error: any) {
            logger.error('Merge failed:', error);

            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            throw new functions.https.HttpsError(
                'internal',
                `Ошибка объединения: ${error.message}`
            );
        }
    });

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
