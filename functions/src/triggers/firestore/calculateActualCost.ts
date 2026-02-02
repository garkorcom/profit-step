/**
 * @fileoverview Calculate actual cost for notes from time entries
 * 
 * Trigger: When WorkSession is created/updated with relatedNoteId
 * Action: Recalculate note.financials.actualCost = sum(hours × rate)
 * 
 * @module triggers/firestore/calculateActualCost
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Trigger: When WorkSession changes, update related note's actualCost
 */
export const onSessionChangeUpdateCost = functions
    .region('us-central1')
    .firestore.document('sessions/{sessionId}')
    .onWrite(async (change, context) => {
        const sessionId = context.params.sessionId;

        // Get before and after data
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;

        // Check if this session is linked to a note
        const noteIdBefore = before?.relatedNoteId;
        const noteIdAfter = after?.relatedNoteId;

        // If no note link, nothing to do
        if (!noteIdBefore && !noteIdAfter) {
            return null;
        }

        // Collect note IDs to recalculate
        const noteIdsToUpdate = new Set<string>();
        if (noteIdBefore) noteIdsToUpdate.add(noteIdBefore);
        if (noteIdAfter) noteIdsToUpdate.add(noteIdAfter);

        // Recalculate cost for each affected note
        for (const noteId of noteIdsToUpdate) {
            await recalculateNoteCost(noteId);
        }

        logger.info(`Cost recalculated for notes: ${Array.from(noteIdsToUpdate).join(', ')}`, {
            sessionId,
            trigger: 'onWrite'
        });

        return null;
    });

/**
 * Recalculate actual cost for a note based on all linked sessions
 */
async function recalculateNoteCost(noteId: string): Promise<void> {
    try {
        // Find all completed sessions linked to this note
        const sessionsSnap = await db.collection('sessions')
            .where('relatedNoteId', '==', noteId)
            .where('status', '==', 'completed')
            .get();

        let totalCost = 0;
        let totalMinutes = 0;

        for (const sessionDoc of sessionsSnap.docs) {
            const session = sessionDoc.data();
            const minutes = session.durationMinutes || 0;
            const hourlyRate = session.hourlyRate || 0;

            // Calculate session cost
            const sessionCost = (minutes / 60) * hourlyRate;
            totalCost += sessionCost;
            totalMinutes += minutes;
        }

        // Round to 2 decimal places
        totalCost = Math.round(totalCost * 100) / 100;

        // Update note
        const noteRef = db.collection('notes').doc(noteId);
        await noteRef.update({
            'financials.actualCost': totalCost,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        logger.info(`Note ${noteId} cost updated`, {
            totalCost,
            totalMinutes,
            sessionCount: sessionsSnap.size
        });

    } catch (error) {
        logger.error(`Failed to recalculate cost for note ${noteId}`, error);
    }
}

/**
 * Trigger: Update note.activeTimer when session starts/ends
 */
export const syncActiveTimer = functions
    .region('us-central1')
    .firestore.document('sessions/{sessionId}')
    .onWrite(async (change, context) => {
        const after = change.after.exists ? change.after.data() : null;
        const before = change.before.exists ? change.before.data() : null;

        // Check if session is linked to a note
        const noteId = after?.relatedNoteId || before?.relatedNoteId;
        if (!noteId) return null;

        const noteRef = db.collection('notes').doc(noteId);

        // Session started (created as active)
        if (!before && after?.status === 'active') {
            await noteRef.update({
                activeTimer: {
                    sessionId: context.params.sessionId,
                    startedAt: after.startTime,
                    employeeId: after.employeeId,
                    employeeName: after.employeeName
                },
                stage: 'execution', // Auto-move to execution
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            logger.info(`Timer started for note ${noteId}`);
            return null;
        }

        // Session ended (status changed from active)
        if (before?.status === 'active' && after?.status !== 'active') {
            // Check if there are other active sessions for this note
            const activeSessionsSnap = await db.collection('sessions')
                .where('relatedNoteId', '==', noteId)
                .where('status', '==', 'active')
                .limit(1)
                .get();

            if (activeSessionsSnap.empty) {
                // No more active sessions, clear timer
                await noteRef.update({
                    activeTimer: admin.firestore.FieldValue.delete(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                logger.info(`Timer cleared for note ${noteId}`);
            }
            return null;
        }

        return null;
    });
