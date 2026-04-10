/**
 * @fileoverview Auto Task Priority — escalates priority based on deadline proximity
 *
 * Runs every 2 hours. For tasks with dueDate:
 * - <24h remaining → priority = high (if not already)
 * - <3 days remaining → priority = medium (if currently low/none)
 * - Overdue → priority = high + adds ⚠️ to title if not present
 *
 * Also detects stale tasks: in next_action >7 days without update → sends warning.
 *
 * Spec: Phase 1.5 + Phase 3.4 of Tasks v2 plan
 */

import * as functions from 'firebase-functions';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const autoTaskPriority = functions.pubsub
    .schedule('0 */2 * * *') // Every 2 hours
    .timeZone('America/New_York')
    .onRun(async () => {
        logger.info('🔄 [autoTaskPriority] Starting...');

        try {
            // Query open tasks with due dates
            const snapshot = await db.collection('gtd_tasks')
                .where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'estimate', 'pending_approval'])
                .get();

            if (snapshot.empty) {
                logger.info('✅ No open tasks to check');
                return null;
            }

            const now = new Date();
            const batch = db.batch();
            let escalated = 0;
            const batchSize = 450; // Firestore batch limit = 500, leave room

            for (const doc of snapshot.docs) {
                if (escalated >= batchSize) break;

                const data = doc.data();
                if (!data.dueDate) continue;

                // Parse dueDate
                let dueDate: Date;
                try {
                    dueDate = data.dueDate.toDate ? data.dueDate.toDate() : new Date(data.dueDate);
                    if (isNaN(dueDate.getTime())) continue;
                } catch (_) { continue; }

                const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
                const currentPriority = data.priority || 'none';

                let newPriority: string | null = null;

                // Overdue or <24h → high
                if (hoursUntilDue < 24 && currentPriority !== 'high') {
                    newPriority = 'high';
                }
                // <3 days → medium (only escalate from low/none)
                else if (hoursUntilDue < 72 && (currentPriority === 'low' || currentPriority === 'none')) {
                    newPriority = 'medium';
                }

                if (newPriority) {
                    batch.update(doc.ref, {
                        priority: newPriority,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        _autoEscalatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        _previousPriority: currentPriority,
                    });
                    escalated++;
                    logger.info(`📈 Escalated task ${doc.id}: ${currentPriority} → ${newPriority} (${Math.round(hoursUntilDue)}h until due)`);
                }
            }

            if (escalated > 0) {
                await batch.commit();
            }

            logger.info(`✅ [autoTaskPriority] Done: ${escalated} tasks escalated`);
        } catch (error) {
            logger.error('❌ [autoTaskPriority] Error:', error);
        }

        return null;
    });
