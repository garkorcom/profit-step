/**
 * @fileoverview Split Checklist Item — Extract item to standalone note
 * 
 * Takes a checklist item from a note and creates a new standalone note.
 * The new note inherits projectId, deadline, and other context from parent.
 * 
 * @module callable/notes/splitChecklistItem
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

interface SplitRequest {
    noteId: string;
    itemId: string;
}

interface SplitResponse {
    success: boolean;
    newNoteId?: string;
    error?: string;
}

/**
 * Split a checklist item into a standalone note
 * 
 * @param noteId - Parent note ID
 * @param itemId - Checklist item UUID to extract
 * @returns New note ID
 */
export const splitChecklistItem = functions
    .region('us-central1')
    .https.onCall(async (data: SplitRequest, context): Promise<SplitResponse> => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'Требуется авторизация'
            );
        }

        const { noteId, itemId } = data;

        if (!noteId || !itemId) {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'noteId и itemId обязательны'
            );
        }

        try {
            // Get parent note
            const parentRef = db.collection('notes').doc(noteId);
            const parentDoc = await parentRef.get();

            if (!parentDoc.exists) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'Заметка не найдена'
                );
            }

            const parentData = parentDoc.data()!;

            // Verify ownership
            if (parentData.ownerId !== context.auth.uid) {
                throw new functions.https.HttpsError(
                    'permission-denied',
                    'Нет доступа к этой заметке'
                );
            }

            // Find item in checklist
            const checklist = parentData.checklist || [];
            const itemIndex = checklist.findIndex((item: any) => item.id === itemId);

            if (itemIndex === -1) {
                throw new functions.https.HttpsError(
                    'not-found',
                    'Пункт не найден в списке'
                );
            }

            const item = checklist[itemIndex];

            // Create new note with inherited context
            const newNoteData: any = {
                stage: 'inbox',
                source: {
                    channel: 'web',
                    externalId: `split-from-${noteId}`
                },
                ownerId: parentData.ownerId,
                ownerName: parentData.ownerName,
                telegramId: parentData.telegramId,

                title: item.text,
                description: `Отделено из: "${parentData.title}"`,

                // Inherited context
                projectId: parentData.projectId,
                projectName: parentData.projectName,
                locationId: parentData.locationId,
                deadline: parentData.deadline,

                // Split tracking
                parentId: noteId,

                aiStatus: 'none',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // If item has original source (photo), add as attachment
            if (item.originalSource) {
                newNoteData.attachments = [{
                    type: 'image',
                    url: item.originalSource
                }];
            }

            // Transaction: create new note + remove item from parent
            const newNoteRef = db.collection('notes').doc();

            await db.runTransaction(async (transaction) => {
                // Create new note
                transaction.set(newNoteRef, newNoteData);

                // Remove item from parent's checklist
                const updatedChecklist = checklist.filter((_: any, i: number) => i !== itemIndex);
                transaction.update(parentRef, {
                    checklist: updatedChecklist,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });

            logger.info(`✅ Split item "${item.text}" from note ${noteId} → ${newNoteRef.id}`);

            return {
                success: true,
                newNoteId: newNoteRef.id
            };

        } catch (error: any) {
            logger.error('Split failed:', error);

            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            throw new functions.https.HttpsError(
                'internal',
                `Ошибка разделения: ${error.message}`
            );
        }
    });
