/**
 * @fileoverview Quality Loop API Functions
 * 
 * Submit for Review: Assignee marks task as done
 * Verify Task: Controller accepts or returns task
 * 
 * @module api/qualityLoop
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

/**
 * Submit task for review (called by assignee)
 * Sets gates.internalDone = true
 */
export const submitForReview = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
        }

        const { noteId } = data;
        const userId = context.auth.uid;

        if (!noteId) {
            throw new functions.https.HttpsError('invalid-argument', 'noteId is required');
        }

        const noteRef = db.collection('notes').doc(noteId);
        const noteSnap = await noteRef.get();

        if (!noteSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Note not found');
        }

        const note = noteSnap.data()!;

        // Verify caller is assignee
        if (!note.assigneeIds?.includes(userId)) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only assigned users can submit for review'
            );
        }

        // Already submitted?
        if (note.gates?.internalDone) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Already submitted for review'
            );
        }

        // Update gates
        await noteRef.update({
            'gates.internalDone': true,
            'gates.internalDoneAt': admin.firestore.FieldValue.serverTimestamp(),
            'gates.internalDoneBy': userId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        logger.info(`✅ Task submitted for review: ${noteId} by ${userId}`);

        // TODO: Send push notification to controller
        // if (note.controllerId) {
        //     await sendNotification(note.controllerId, {
        //         title: 'Task ready for review',
        //         body: note.title
        //     });
        // }

        return {
            success: true,
            message: 'Task submitted for review',
            controllerId: note.controllerId
        };
    });

/**
 * Verify task (called by controller)
 * action: 'accept' - marks as verified and archives
 * action: 'return' - resets internalDone and sends back to assignee
 */
export const verifyTask = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
        // Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
        }

        const { noteId, action, comment } = data;
        const userId = context.auth.uid;

        if (!noteId || !action) {
            throw new functions.https.HttpsError('invalid-argument', 'noteId and action are required');
        }

        if (!['accept', 'return'].includes(action)) {
            throw new functions.https.HttpsError('invalid-argument', 'action must be "accept" or "return"');
        }

        const noteRef = db.collection('notes').doc(noteId);
        const noteSnap = await noteRef.get();

        if (!noteSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Note not found');
        }

        const note = noteSnap.data()!;

        // Verify caller is controller
        if (note.controllerId !== userId) {
            throw new functions.https.HttpsError(
                'permission-denied',
                'Only the controller can verify this task'
            );
        }

        // Must be submitted first
        if (!note.gates?.internalDone) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Task has not been submitted for review yet'
            );
        }

        if (action === 'accept') {
            // Accept: Mark as verified and archive
            await noteRef.update({
                'gates.verified': true,
                'gates.verifiedAt': admin.firestore.FieldValue.serverTimestamp(),
                'gates.verifiedBy': userId,
                stage: 'archived',
                archivedReason: 'verified',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            logger.info(`✅ Task accepted: ${noteId} by ${userId}`);

            return {
                success: true,
                message: 'Task accepted and archived',
                action: 'accept'
            };

        } else if (action === 'return') {
            // Return: Reset internalDone, add comment
            await noteRef.update({
                'gates.internalDone': false,
                'gates.returnedAt': admin.firestore.FieldValue.serverTimestamp(),
                'gates.returnComment': comment || 'Returned without comment',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            logger.info(`↩️ Task returned: ${noteId} by ${userId}`);

            // TODO: Send notification to assignee
            // if (note.assigneeIds?.length) {
            //     await sendNotification(note.assigneeIds[0], {
            //         title: 'Task returned',
            //         body: comment || 'Please revise and resubmit'
            //     });
            // }

            return {
                success: true,
                message: 'Task returned to assignee',
                action: 'return',
                comment: comment || null
            };
        }

        throw new functions.https.HttpsError('internal', 'Unexpected error');
    });
