/**
 * @fileoverview Weekly Balance Reconciliation
 *
 * Runs every Sunday at 2:00 AM ET.
 * Recomputes each employee's balance from all work_sessions since Jan 1
 * and compares against `runningBalance` cached on the user document.
 *
 * If drift > $1: logs alert to console and sends Telegram to admin.
 *
 * Pattern based on Modern Treasury / Medici best practices:
 * - Cached balance for O(1) reads (no full scan on page load)
 * - Periodic reconciliation catches any drift from bugs, race conditions, or manual edits
 *
 * The cached `runningBalance` is updated by:
 * - generateDailyPayroll.ts (increments on earning creation)
 * - Payment handler in FinancePage.tsx (decrements on payment)
 * - This function (corrects drift)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const TIME_ZONE = 'America/New_York';
const DRIFT_THRESHOLD_DOLLARS = 1.0;

export const reconcileBalances = functions.pubsub.schedule('0 2 * * 0') // Sunday 2 AM
    .timeZone(TIME_ZONE)
    .onRun(async () => {
        console.log('--- [reconcileBalances] Starting weekly balance reconciliation...');

        try {
            // 1. Get all users with role != guest (potential payroll participants)
            const usersSnapshot = await db.collection('users').get();
            const employeesSnapshot = await db.collection('employees').get();

            // Build ID mapping: canonical user ID -> all variant IDs
            const userMap: Record<string, {
                name: string;
                allIds: Set<string>;
                cachedBalance?: number;
                telegramId?: string;
            }> = {};

            for (const doc of usersSnapshot.docs) {
                const data = doc.data();
                const allIds = new Set<string>();
                allIds.add(doc.id);
                if (data.telegramId) allIds.add(String(data.telegramId));

                userMap[doc.id] = {
                    name: data.displayName || 'Unknown',
                    allIds,
                    cachedBalance: data.runningBalance,
                    telegramId: data.telegramId,
                };
            }

            // Add employees (bot-only workers) to mapping
            for (const doc of employeesSnapshot.docs) {
                const data = doc.data();
                if (data.telegramId) {
                    // Check if this telegramId already maps to a user
                    let found = false;
                    for (const [, info] of Object.entries(userMap)) {
                        if (info.allIds.has(String(data.telegramId))) {
                            info.allIds.add(doc.id);
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        userMap[doc.id] = {
                            name: data.name || data.displayName || 'Unknown',
                            allIds: new Set([doc.id, String(data.telegramId)]),
                            cachedBalance: undefined,
                            telegramId: String(data.telegramId),
                        };
                    }
                }
            }

            // 2. Fetch all work_sessions for current year (YTD)
            const yearStart = new Date(new Date().getFullYear(), 0, 1, 0, 0, 0, 0);
            const sessionsSnapshot = await db.collection('work_sessions')
                .where('endTime', '>=', admin.firestore.Timestamp.fromDate(yearStart))
                .get();

            // 3. Calculate actual balance per employee from sessions
            const actualBalances: Record<string, { earned: number; paid: number }> = {};

            for (const doc of sessionsSnapshot.docs) {
                const session = doc.data();
                if (session.isVoided) continue;

                const empId = String(session.employeeId);

                // Find canonical ID
                let canonicalId = empId;
                for (const [userId, info] of Object.entries(userMap)) {
                    if (info.allIds.has(empId)) {
                        canonicalId = userId;
                        break;
                    }
                }

                if (!actualBalances[canonicalId]) {
                    actualBalances[canonicalId] = { earned: 0, paid: 0 };
                }

                if (session.type === 'payment') {
                    actualBalances[canonicalId].paid += Math.abs(session.sessionEarnings || 0);
                } else if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    // Corrections can be positive or negative
                    actualBalances[canonicalId].earned += (session.sessionEarnings || 0);
                } else {
                    // Regular work session, overtime adjustment
                    actualBalances[canonicalId].earned += (session.sessionEarnings || 0);
                }
            }

            // 4. Compare and fix
            const batch = db.batch();
            let fixedCount = 0;
            let checkedCount = 0;
            const driftAlerts: string[] = [];

            for (const [userId, info] of Object.entries(userMap)) {
                const actual = actualBalances[userId];
                if (!actual) continue; // No sessions for this employee

                const actualBalance = parseFloat((actual.earned - actual.paid).toFixed(2));
                const cachedBalance = info.cachedBalance;

                checkedCount++;

                if (cachedBalance === undefined) {
                    // No cached balance yet — initialize it
                    batch.update(db.collection('users').doc(userId), {
                        runningBalance: actualBalance,
                        runningBalanceUpdatedAt: admin.firestore.Timestamp.now(),
                        ytdEarned: parseFloat(actual.earned.toFixed(2)),
                        ytdPaid: parseFloat(actual.paid.toFixed(2)),
                    });
                    fixedCount++;
                    console.log(`[reconcileBalances] Initialized ${info.name}: balance=$${actualBalance}`);
                } else {
                    const drift = Math.abs(actualBalance - cachedBalance);

                    if (drift > DRIFT_THRESHOLD_DOLLARS) {
                        // Drift detected — fix it
                        batch.update(db.collection('users').doc(userId), {
                            runningBalance: actualBalance,
                            runningBalanceUpdatedAt: admin.firestore.Timestamp.now(),
                            ytdEarned: parseFloat(actual.earned.toFixed(2)),
                            ytdPaid: parseFloat(actual.paid.toFixed(2)),
                            lastReconciliationDrift: parseFloat(drift.toFixed(2)),
                        });
                        fixedCount++;

                        const alertMsg = `${info.name}: cached=$${cachedBalance.toFixed(2)} vs actual=$${actualBalance.toFixed(2)} (drift=$${drift.toFixed(2)})`;
                        driftAlerts.push(alertMsg);
                        console.warn(`[reconcileBalances] DRIFT: ${alertMsg}`);
                    } else {
                        // No significant drift — just update YTD totals
                        batch.update(db.collection('users').doc(userId), {
                            runningBalanceUpdatedAt: admin.firestore.Timestamp.now(),
                            ytdEarned: parseFloat(actual.earned.toFixed(2)),
                            ytdPaid: parseFloat(actual.paid.toFixed(2)),
                        });
                    }
                }
            }

            if (fixedCount > 0 || checkedCount > 0) {
                await batch.commit();
            }

            // 5. Send admin alert if there were drift issues
            if (driftAlerts.length > 0) {
                try {
                    // Find admin user(s)
                    const adminUsers = usersSnapshot.docs.filter(d => d.data().role === 'admin');
                    for (const adminDoc of adminUsers) {
                        const adminTgId = adminDoc.data().telegramChatId || adminDoc.data().telegramId;
                        if (adminTgId) {
                            const { sendMessage } = require('../triggers/telegram/telegramUtils');
                            const msg = `--- <b>Balance Reconciliation Alert</b>\n\n` +
                                `${driftAlerts.length} employee(s) had balance drift >$${DRIFT_THRESHOLD_DOLLARS}:\n\n` +
                                driftAlerts.map(a => `- ${a}`).join('\n') +
                                `\n\nAll balances have been corrected automatically.`;
                            await sendMessage(adminTgId, msg, { parse_mode: 'HTML' });
                        }
                    }
                } catch (notifyErr) {
                    console.error('[reconcileBalances] Failed to notify admin:', notifyErr);
                }
            }

            console.log(`[reconcileBalances] Complete. Checked: ${checkedCount}, Fixed: ${fixedCount}, Drift alerts: ${driftAlerts.length}`);

        } catch (error) {
            console.error('[reconcileBalances] Error:', error);
        }

        return null;
    });
