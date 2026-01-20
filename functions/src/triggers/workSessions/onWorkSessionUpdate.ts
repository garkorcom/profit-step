/**
 * @fileoverview Trigger for logging AI accuracy when work sessions complete
 * 
 * When a work_session transitions from 'active' to 'completed':
 * 1. Check if the related task has AI estimation data
 * 2. If yes, log the comparison between predicted and actual time
 * 3. This data enables continuous learning and estimate refinement
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { AIAccuracyLog, ACCURACY_CONFIG } from '../../types/aiAccuracy';
import { normalizeDescription } from '../../utils/aiCacheUtils';

const db = admin.firestore();

export const onWorkSessionUpdate = functions.firestore
    .document('work_sessions/{sessionId}')
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        const sessionId = context.params.sessionId;

        // ═══════════════════════════════════════════════════
        // Only process sessions that just completed
        // ═══════════════════════════════════════════════════
        if (before.status === 'completed' || after.status !== 'completed') {
            return; // Already completed or not transitioning to completed
        }

        console.log(`📊 Session ${sessionId} completed. Checking for AI accuracy logging...`);

        // Calculate duration
        const startTime = after.startTime?.toDate?.() || new Date(after.startTime);
        const endTime = after.endTime?.toDate?.() || new Date(after.endTime);
        const actualMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

        // Skip very short sessions (likely noise/mistakes)
        if (actualMinutes < ACCURACY_CONFIG.MIN_SESSION_MINUTES) {
            console.log(`⏭️ Session too short (${actualMinutes} min), skipping accuracy log`);
            return;
        }

        // ═══════════════════════════════════════════════════
        // Check if there's a related task with AI data
        // ═══════════════════════════════════════════════════
        const relatedTaskId = after.relatedTaskId || after.taskId;

        if (!relatedTaskId) {
            console.log(`⏭️ No related task ID, skipping accuracy log`);
            return;
        }

        try {
            const taskDoc = await db.collection('gtd_tasks').doc(relatedTaskId).get();

            if (!taskDoc.exists) {
                console.log(`⏭️ Task ${relatedTaskId} not found, skipping accuracy log`);
                return;
            }

            const taskData = taskDoc.data();

            // Check if task has AI estimation
            if (!taskData?.aiEstimateUsed || !taskData?.estimatedDurationMinutes) {
                console.log(`⏭️ Task ${relatedTaskId} has no AI estimate, skipping`);
                return;
            }

            const predictedMinutes = taskData.estimatedDurationMinutes;

            // Calculate accuracy metrics
            const accuracyRatio = predictedMinutes / actualMinutes;
            const errorMinutes = Math.abs(predictedMinutes - actualMinutes);

            // Filter extreme outliers
            if (accuracyRatio > ACCURACY_CONFIG.MAX_RATIO || accuracyRatio < 1 / ACCURACY_CONFIG.MAX_RATIO) {
                console.log(`⏭️ Extreme ratio ${accuracyRatio.toFixed(2)}, skipping (outlier)`);
                return;
            }

            // ═══════════════════════════════════════════════════
            // Log the accuracy data
            // ═══════════════════════════════════════════════════
            const accuracyLog: AIAccuracyLog = {
                taskId: relatedTaskId,
                taskTitle: taskData.title || after.description || 'Unknown',
                normalizedDescription: normalizeDescription(taskData.title || ''),
                sessionId: sessionId,

                predictedMinutes,
                actualMinutes,
                accuracyRatio,
                errorMinutes,

                employeeRole: taskData.assigneeRole || after.employeeRole || '',
                employeeId: after.employeeId || '',
                clientId: taskData.clientId || after.clientId || '',

                createdAt: admin.firestore.Timestamp.now(),
            };

            await db.collection(ACCURACY_CONFIG.COLLECTION).add(accuracyLog);

            const accuracyPercent = (accuracyRatio * 100).toFixed(0);
            const direction = accuracyRatio > 1 ? 'overestimated' : 'underestimated';

            console.log(`✅ AI Accuracy logged: Predicted ${predictedMinutes}min vs Actual ${actualMinutes}min`);
            console.log(`   → Accuracy: ${accuracyPercent}% (AI ${direction} by ${errorMinutes}min)`);

        } catch (error) {
            console.error('❌ Error logging AI accuracy:', error);
        }
    });
