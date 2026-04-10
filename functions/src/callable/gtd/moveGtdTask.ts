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
    const { taskId, destColId, sourceColId, force } = data;
    if (!taskId || !destColId) {
        throw new functions.https.HttpsError(
            'invalid-argument',
            'Обязательные параметры: taskId, destColId'
        );
    }

    try {
        const taskRef = db.collection('gtd_tasks').doc(taskId);
        const taskDoc = await taskRef.get();

        if (!taskDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Task not found');
        }

        const taskData = taskDoc.data()!;

        // ─── Phase 4.4: Completion Proof Check ─────────────────
        // If task requires photo proof before closing and none exists
        if (destColId === 'done' && taskData.requiresCompletionProof && !force) {
            const hasProof = taskData.completionProofPhotoId ||
                (taskData.taskHistory || []).some(
                    (h: any) => h.type === 'completion_proof' || h.type === 'photo'
                );

            if (!hasProof) {
                throw new functions.https.HttpsError(
                    'failed-precondition',
                    'NEEDS_PROOF: This task requires a completion photo before closing.'
                );
            }
        }

        // ─── Phase 4.5: Approval Enforcement ──────────────────
        // If task requires approval, route to pending_approval instead of done
        if (destColId === 'done' && taskData.requiresApproval && !taskData.approvedAt && !force) {
            // Route to pending_approval instead
            const historyEvent = {
                type: 'status_changed',
                description: 'Submitted for approval (auto-routed from Done)',
                userId: userId,
                userName: userName,
                timestamp: admin.firestore.Timestamp.now(),
            };

            await taskRef.update({
                status: 'pending_approval',
                submittedForApprovalAt: admin.firestore.FieldValue.serverTimestamp(),
                submittedForApprovalBy: userId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                taskHistory: admin.firestore.FieldValue.arrayUnion(historyEvent),
            });

            return {
                success: true,
                redirected: true,
                redirectTo: 'pending_approval',
                message: 'Task requires approval. Sent to pending_approval.',
            };
        }

        // ─── Standard move logic ──────────────────────────────
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

        // Phase 4.2: Clear waiting reason when moving OUT of waiting
        if (sourceColId === 'waiting' && destColId !== 'waiting') {
            updates.waitingReason = null;
        }

        // Phase 4.5: Clear approval fields when moving OUT of pending_approval
        if (sourceColId === 'pending_approval' && destColId !== 'pending_approval') {
            if (destColId !== 'done') {
                // Rejection — clear approval data
                updates.approvedAt = admin.firestore.FieldValue.delete();
                updates.approvedBy = admin.firestore.FieldValue.delete();
            }
        }

        await taskRef.update(updates);

        return { success: true };
    } catch (error: any) {
        if (error instanceof functions.https.HttpsError) throw error;
        console.error(`Error moving GTD task ${taskId}:`, error);
        throw new functions.https.HttpsError('internal', `Failed to move task: ${error.message}`);
    }
});
