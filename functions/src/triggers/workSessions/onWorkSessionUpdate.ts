/**
 * @fileoverview Trigger for logging AI accuracy when work sessions complete
 * 
 * When a work_session transitions from 'active' to 'completed':
 * 1. Check if the related task has AI estimation data
 * 2. If yes, log the comparison between predicted and actual time
 * 3. This data enables continuous learning and estimate refinement
 * 4. Log TIMER_STOP event to BigQuery for analytics
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { AIAccuracyLog, ACCURACY_CONFIG } from '../../types/aiAccuracy';
import { normalizeDescription } from '../../utils/aiCacheUtils';
import { logAuditEvent } from '../../utils/auditLogger';
import { sendMainMenu, sendMessage } from '../telegram/telegramUtils';

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

        // ═══════════════════════════════════════════════════
        // BigQuery Audit: TIMER_STOP event (non-blocking)
        // ═══════════════════════════════════════════════════
        logAuditEvent({
            entityType: 'work_session',
            entityId: sessionId,
            eventCode: 'TIMER_STOP',
            actorUid: String(after.employeeId),
            projectId: after.clientId,
            companyId: after.companyId,
            before: { status: before.status },
            after: {
                status: after.status,
                durationMinutes: actualMinutes,
                hourlyRate: after.hourlyRate,
            },
            financialImpact: after.sessionEarnings || (actualMinutes / 60 * (after.hourlyRate || 0)),
            timeImpact: actualMinutes,
        });

        // ═══════════════════════════════════════════════════
        // Notify user via Telegram about session closure
        // ═══════════════════════════════════════════════════
        try {
            // 🛡️ ЗАЩИТА ОТ ЭХА — telegram_bot пропускаем, openclaw показываем с пометкой
            if (after.updatedBySource === 'telegram_bot') {
                console.log(`⏭️ Stopped via ${after.updatedBySource}, skipping echo notification.`);
            } else {
                const userDoc = await db.collection('users').doc(after.employeeId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    const telegramChatId = userData?.telegramChatId || userData?.telegramId;
                    const telegramId = userData?.telegramId;

                    if (telegramChatId) {
                        const earnedStr = after.sessionEarnings != null ? `$${after.sessionEarnings}` : 'N/A';
                        const sourceLabel = after.updatedBySource === 'openclaw' ? 'Jarvis 🤖' : 'Web CRM 💻';
                        let msg = `⏹️ <b>Рабочая смена завершена (${sourceLabel})</b>\n\n🏢 Объект: ${after.clientName || 'Не указан'}\n⏱ Время: ${actualMinutes} мин.\n💰 Заработано: ${earnedStr}`;

                        if (after.autoClosed) {
                            msg = `⚠️ <b>Ваша смена длилась слишком долго и была автоматически закрыта</b>\n\n⏱ Учтено: ${actualMinutes} мин\n💰 Заработано: ${earnedStr}\n\nПожалуйста, свяжитесь с администратором для корректировки времени.`;
                        }

                        // Send text and force update keyboard to default
                        await sendMessage(telegramChatId, msg, { parse_mode: 'HTML' });
                        if (telegramId) {
                            // Wait 5 seconds before sending main menu to avoid race condition
                            // where new session might be starting immediately after stop
                            setTimeout(async () => {
                                try {
                                    // Check if employee has a new active session before sending main menu
                                    const activeSessionSnap = await db.collection('work_sessions')
                                        .where('employeeId', '==', after.employeeId)
                                        .where('status', '==', 'active')
                                        .limit(1)
                                        .get();

                                    if (activeSessionSnap.empty) {
                                        await sendMainMenu(telegramChatId, telegramId);
                                    } else {
                                        console.log(`⏭️ Employee has new active session, skipping main menu for ${telegramChatId}`);
                                    }
                                } catch (error) {
                                    console.error('Error sending delayed main menu:', error);
                                }
                            }, 5000);
                        }
                        console.log(`✅ Session close notification sent to Telegram ID ${telegramChatId}`);
                    }
                }
            }
        } catch (error) {
            console.error("Error sending close notification:", error);
        }

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
            // Still continue to ledger entry below (no return here)
        }

        // ═══════════════════════════════════════════════════
        // Phase 5: Sync session time/cost into GTD task
        // ═══════════════════════════════════════════════════
        if (relatedTaskId) {
            try {
                const taskDoc = await db.collection('gtd_tasks').doc(relatedTaskId).get();
                if (taskDoc.exists) {
                    const taskData = taskDoc.data()!;
                    const sessionEarnings = after.sessionEarnings || (actualMinutes / 60 * (after.hourlyRate || 0));

                    // Increment task totals atomically
                    await db.collection('gtd_tasks').doc(relatedTaskId).update({
                        totalTimeSpentMinutes: admin.firestore.FieldValue.increment(actualMinutes),
                        totalEarnings: admin.firestore.FieldValue.increment(
                            Math.round(sessionEarnings * 100) / 100
                        ),
                        lastSessionAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastSessionBy: after.employeeId || '',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    console.log(`💰 [Phase 5] Task ${relatedTaskId} updated: +${actualMinutes}min, +$${sessionEarnings.toFixed(2)}`);

                    // Check if AI accuracy logging is needed
                    if (!taskData.aiEstimateUsed || !taskData.estimatedDurationMinutes) {
                        console.log(`⏭️ Task ${relatedTaskId} has no AI estimate, skipping accuracy log`);
                    }
                }
            } catch (err) {
                console.error(`❌ [Phase 5] Error updating task financials for ${relatedTaskId}:`, err);
            }
        }

        // ═══════════════════════════════════════════════════
        // AI Accuracy logging (existing logic)
        // ═══════════════════════════════════════════════════
        if (relatedTaskId) {
            try {
                const taskDoc = await db.collection('gtd_tasks').doc(relatedTaskId).get();

                if (taskDoc.exists) {
                    const taskData = taskDoc.data();

                    if (taskData?.aiEstimateUsed && taskData?.estimatedDurationMinutes) {
                        const predictedMinutes = taskData.estimatedDurationMinutes;
                        const accuracyRatio = predictedMinutes / actualMinutes;
                        const errorMinutes = Math.abs(predictedMinutes - actualMinutes);

                        if (accuracyRatio <= ACCURACY_CONFIG.MAX_RATIO && accuracyRatio >= 1 / ACCURACY_CONFIG.MAX_RATIO) {
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
                        } else {
                            console.log(`⏭️ Extreme ratio ${accuracyRatio.toFixed(2)}, skipping (outlier)`);
                        }
                    } else {
                        console.log(`⏭️ Task ${relatedTaskId} has no AI estimate, skipping accuracy log`);
                    }
                } else {
                    console.log(`⏭️ Task ${relatedTaskId} not found, skipping accuracy log`);
                }
            } catch (error) {
                console.error('❌ Error logging AI accuracy:', error);
            }
        }

        // ═══════════════════════════════════════════════════
        // Create Ledger Entry for Labor Cost
        // ═══════════════════════════════════════════════════
        try {
            const clientId = after.clientId;
            if (!clientId || clientId === 'no_project') {
                console.log(`⏭️ No valid clientId, skipping ledger entry`);
                return;
            }

            // Use sessionEarnings if available, otherwise calculate from hourlyRate
            let laborCost = after.sessionEarnings || 0;

            if (laborCost <= 0) {
                const rate = after.hourlyRate || 0;
                const hoursWorked = actualMinutes / 60;
                laborCost = hoursWorked * rate;
            }

            if (laborCost <= 0) {
                console.log(`⏭️ Labor cost is 0, skipping ledger entry`);
                return;
            }

            // Get or create project for this client
            const projectsSnap = await db.collection('projects')
                .where('clientId', '==', clientId)
                .where('status', '==', 'active')
                .limit(1)
                .get();

            let projectId: string;
            let projectRef;

            if (projectsSnap.empty) {
                // Create default project
                projectRef = db.collection('projects').doc();
                projectId = projectRef.id;

                await projectRef.set({
                    clientId,
                    clientName: after.clientName || 'Unknown',
                    companyId: after.companyId || 'default',
                    name: 'Основной проект',
                    status: 'active',
                    totalDebit: 0,
                    totalCredit: 0,
                    balance: 0,
                    createdAt: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                    createdBy: 'system'
                });
                console.log(`📁 Created default project for client ${clientId}`);
            } else {
                projectId = projectsSnap.docs[0].id;
            }

            // Create ledger entry
            const ledgerRef = db.collection('project_ledger').doc();
            const employeeName = after.employeeName || `Employee ${after.employeeId}`;
            const hoursFormatted = (actualMinutes / 60).toFixed(1);
            const rateFormatted = after.hourlyRate || 0;

            await ledgerRef.set({
                projectId,
                clientId,
                companyId: after.companyId || 'default',
                type: 'debit',
                category: 'labor',
                amount: Math.round(laborCost * 100) / 100, // Round to cents
                description: `Работа: ${employeeName}, ${hoursFormatted}ч × $${rateFormatted}/ч`,
                sourceType: 'work_session',
                sourceId: sessionId,
                date: after.endTime || admin.firestore.Timestamp.now(),
                createdAt: admin.firestore.Timestamp.now(),
                createdBy: 'system'
            });

            // Update project totals
            const projectDoc = projectsSnap.empty ? projectRef : db.collection('projects').doc(projectId);
            const currentProject = projectsSnap.empty ? null : projectsSnap.docs[0].data();

            const newDebit = (currentProject?.totalDebit || 0) + laborCost;
            const newCredit = currentProject?.totalCredit || 0;

            await projectDoc!.update({
                totalDebit: Math.round(newDebit * 100) / 100,
                balance: Math.round((newDebit - newCredit) * 100) / 100,
                updatedAt: admin.firestore.Timestamp.now()
            });

            console.log(`💰 Ledger entry created: $${laborCost.toFixed(2)} labor for project ${projectId}`);

        } catch (error) {
            console.error('❌ Error creating ledger entry:', error);
        }
    });

