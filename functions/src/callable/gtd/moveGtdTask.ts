import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const moveGtdTask = functions.https.onCall(async (data, context) => {
    // 1. Validate auth
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'Требуется аутентификация'
        );
    }

    const userId = context.auth.uid;
    const userName = context.auth.token.name || context.auth.token.email || 'Пользователь';
    
    // 2. Parse payload
    const { taskId, destColId, sourceColId } = data;
    if (!taskId || !destColId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Обязательные параметры: taskId, destColId'
        );
    }

    try {
        const taskRef = db.collection('gtd_tasks').doc(taskId);
        
        // Use atomic arrayUnion to prevent race conditions during DND bursts
        const newHistoryEvent = {
            type: 'status_changed',
            description: `Статус изменен на "${destColId.replace('_', ' ')}"`,
            userId: userId,
            userName: userName,
            timestamp: admin.firestore.Timestamp.now(),
        };

        const updates: any = {
            status: destColId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            taskHistory: admin.firestore.FieldValue.arrayUnion(newHistoryEvent)
        };

        // Auto-set completedAt when moving to Done
        if (destColId === 'done' && sourceColId !== 'done') {
            updates.completedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // Feature 6.4: Auto-clear completedAt when moving AWAY from Done
        if (sourceColId === 'done' && destColId !== 'done') {
            updates.completedAt = admin.firestore.FieldValue.delete();
        }

        // Auto-set needsEstimate when moving to Estimate
        if (destColId === 'estimate') {
            updates.needsEstimate = true;
        }

        await taskRef.update(updates);

        return { success: true };
    } catch (error: any) {
        console.error(`Error moving GTD task ${taskId}:`, error);
        throw new functions.https.HttpsError('internal', `Failed to move task: ${error.message}`);
    }
});
