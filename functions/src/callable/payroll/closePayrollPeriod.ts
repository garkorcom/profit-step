import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();

interface ClosePayrollPeriodRequest {
    periodId: string; // "2026-01"
}

interface AdvanceDeduction {
    employeeId: string;
    employeeName: string;
    advanceId: string;
    deductionAmount: number;
    advanceDescription: string;
}

interface ClosePayrollPeriodResponse {
    success: boolean;
    message: string;
    period?: {
        id: string;
        totalSessions: number;
        totalHours: number;
        totalAmount: number;
        totalAdvanceDeductions: number;
        employeeCount: number;
        advanceDeductions: AdvanceDeduction[];
    };
}

/**
 * Callable function to close a payroll period.
 * 
 * When closed:
 * 1. Updates all finalized sessions in the period with payrollPeriod = periodId
 * 2. Calculates aggregates (sessions, hours, amount, employees)
 * 3. Creates/updates the payroll_periods document
 * 4. Marks the period as 'closed'
 * 
 * Requirements:
 * - Only admin can close periods
 * - Cannot close a period that is already closed/paid
 * - All sessions in period must be finalized
 */
export const closePayrollPeriod = functions.https.onCall(
    async (data: ClosePayrollPeriodRequest, context): Promise<ClosePayrollPeriodResponse> => {
        // 1. Auth check
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
        }

        const adminUid = context.auth.uid;
        const { periodId } = data;

        // Validate periodId format (YYYY-MM)
        if (!periodId || !/^\d{4}-\d{2}$/.test(periodId)) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid period ID format. Expected YYYY-MM');
        }

        console.log(`📊 [closePayrollPeriod] Admin ${adminUid} closing period ${periodId}...`);

        try {
            // 2. Check admin role
            const adminDoc = await db.collection('users').doc(adminUid).get();
            if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
                throw new functions.https.HttpsError('permission-denied', 'Only admins can close payroll periods');
            }

            // 3. Check if period already exists and is closed
            const periodRef = db.collection('payroll_periods').doc(periodId);
            const periodDoc = await periodRef.get();

            if (periodDoc.exists) {
                const periodData = periodDoc.data();
                if (periodData?.status === 'closed' || periodData?.status === 'locked' || periodData?.status === 'paid') {
                    throw new functions.https.HttpsError('failed-precondition', `Period ${periodId} is already ${periodData.status}`);
                }
            }

            // 4. Calculate period date range
            const [year, month] = periodId.split('-').map(Number);
            const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
            const endDate = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month

            // 5. Fetch all finalized sessions in this period
            // B8 fix: use endTime (not startTime) — consistent with generateDailyPayroll
            // A session ending on the last day of the month belongs to that month
            const sessionsSnapshot = await db.collection('work_sessions')
                .where('endTime', '>=', admin.firestore.Timestamp.fromDate(startDate))
                .where('endTime', '<=', admin.firestore.Timestamp.fromDate(endDate))
                .get();

            if (sessionsSnapshot.empty) {
                throw new functions.https.HttpsError('failed-precondition', 'No sessions found in this period');
            }

            // 6. Check all sessions are finalized and calculate aggregates
            // B15 fix: normalize employee IDs (telegramId → UID mapping)
            const usersForIdMap = await db.collection('users').get();
            const telegramToUid: Record<string, string> = {};
            usersForIdMap.docs.forEach(doc => {
                const tgId = doc.data().telegramId;
                if (tgId) telegramToUid[String(tgId)] = doc.id;
            });
            const normalizeEmployeeId = (id: string | number): string => {
                const str = String(id);
                return telegramToUid[str] || str;
            };

            let totalSessions = 0;
            let totalMinutes = 0;
            let totalAmount = 0;
            const employeeSet = new Set<string>();
            const sessionsToUpdate: FirebaseFirestore.DocumentReference[] = [];

            for (const doc of sessionsSnapshot.docs) {
                const session = doc.data();

                // Skip corrections, adjustments, and payments (they're separate from work sessions)
                if (session.type === 'correction' || session.type === 'manual_adjustment' || session.type === 'payment') {
                    continue;
                }

                // B7 fix: skip voided sessions (they have correction entries that zero them out)
                if (session.isVoided) {
                    continue;
                }

                // Check if session is finalized
                if (session.finalizationStatus !== 'finalized' && session.finalizationStatus !== 'processed') {
                    // Check if session is old enough (fallback for legacy data)
                    const sessionDate = session.startTime?.toDate();
                    if (!sessionDate) continue;

                    const dayBeforeYesterday = new Date();
                    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
                    dayBeforeYesterday.setHours(23, 59, 59, 999);

                    if (sessionDate > dayBeforeYesterday) {
                        throw new functions.https.HttpsError(
                            'failed-precondition',
                            'Some sessions are still within edit window. Wait until all sessions are finalized.'
                        );
                    }
                }

                totalSessions++;
                totalMinutes += session.durationMinutes || 0;
                totalAmount += session.sessionEarnings || 0;
                employeeSet.add(normalizeEmployeeId(session.employeeId));
                sessionsToUpdate.push(doc.ref);
            }

            const totalHours = parseFloat((totalMinutes / 60).toFixed(2));
            totalAmount = parseFloat(totalAmount.toFixed(2));

            // ════════════════════════════════════════════════
            // 6b. Auto-deduct outstanding advances (PO) from payroll
            // FLSA guard: never deduct below FL minimum wage ($13.00/h)
            // ════════════════════════════════════════════════
            const FL_MIN_WAGE = 13.00;
            const advanceDeductions: AdvanceDeduction[] = [];
            let totalAdvanceDeductions = 0;

            // Aggregate gross earnings per employee for min-wage guard
            const employeeGross: Record<string, { gross: number; hours: number; name: string }> = {};
            for (const doc of sessionsSnapshot.docs) {
                const s = doc.data();
                if (s.type === 'correction' || s.type === 'manual_adjustment' || s.type === 'payment') continue;
                if (s.isVoided) continue;
                const eid = normalizeEmployeeId(s.employeeId);
                if (!employeeGross[eid]) {
                    employeeGross[eid] = { gross: 0, hours: 0, name: s.employeeName || 'Unknown' };
                }
                employeeGross[eid].gross += (s.sessionEarnings || 0);
                employeeGross[eid].hours += (s.durationMinutes || 0) / 60;
            }

            // Query open advances for employees who worked this period
            const employeeIds = Object.keys(employeeGross);
            if (employeeIds.length > 0) {
                try {
                    const advancesSnapshot = await db.collection('advance_accounts')
                        .where('status', '==', 'open')
                        .get();

                    if (!advancesSnapshot.empty) {
                        // Fetch all active transactions to compute balances
                        const txSnapshot = await db.collection('advance_transactions')
                            .where('status', '==', 'active')
                            .get();

                        const txByAdvance: Record<string, number> = {};
                        txSnapshot.docs.forEach(td => {
                            const tx = td.data();
                            txByAdvance[tx.advanceId] = (txByAdvance[tx.advanceId] || 0) + (tx.amount || 0);
                        });

                        for (const advDoc of advancesSnapshot.docs) {
                            const adv = advDoc.data();
                            const advEmpId = normalizeEmployeeId(adv.employeeId);

                            // Only deduct for employees who worked this period
                            if (!employeeGross[advEmpId]) continue;

                            const advanceBalance = (adv.amount || 0) - (txByAdvance[advDoc.id] || 0);
                            if (advanceBalance <= 0) continue; // Fully settled

                            const empData = employeeGross[advEmpId];
                            // Max deductible = gross - (hours × min_wage)
                            const minWageFloor = empData.hours * FL_MIN_WAGE;
                            const maxDeductible = Math.max(0, empData.gross - minWageFloor);

                            if (maxDeductible <= 0) {
                                console.log(`[closePayrollPeriod] Cannot deduct from ${empData.name}: gross $${empData.gross.toFixed(2)} too close to min wage floor $${minWageFloor.toFixed(2)}`);
                                continue;
                            }

                            // Deduct the lesser of: advance balance or max deductible
                            const deductionAmount = parseFloat(Math.min(advanceBalance, maxDeductible).toFixed(2));

                            advanceDeductions.push({
                                employeeId: advEmpId,
                                employeeName: empData.name,
                                advanceId: advDoc.id,
                                deductionAmount,
                                advanceDescription: adv.description || 'PO',
                            });

                            totalAdvanceDeductions += deductionAmount;

                            // Reduce max deductible for subsequent advances of same employee
                            employeeGross[advEmpId].gross -= deductionAmount;
                        }
                    }
                } catch (advErr) {
                    console.error('[closePayrollPeriod] Advance deduction query error (non-fatal):', advErr);
                    // Non-fatal: period still closes, just without auto-deductions
                }
            }

            // 7. Update sessions with payrollPeriod and mark as processed
            const batch = db.batch();

            for (const ref of sessionsToUpdate) {
                batch.update(ref, {
                    payrollPeriod: periodId,
                    finalizationStatus: 'processed',
                    processedAt: admin.firestore.Timestamp.now()
                });
            }

            // 7b. Create advance deduction entries
            for (const ded of advanceDeductions) {
                // Create negative work_session for deduction (shows in ledger)
                const dedSessionId = `adv_deduction_${ded.advanceId}_${periodId}`;
                batch.set(db.collection('work_sessions').doc(dedSessionId), {
                    type: 'manual_adjustment',
                    employeeId: ded.employeeId,
                    employeeName: ded.employeeName,
                    clientName: 'Advance Deduction',
                    clientId: 'advance_deduction',
                    status: 'completed',
                    finalizationStatus: 'processed',
                    startTime: admin.firestore.Timestamp.now(),
                    endTime: admin.firestore.Timestamp.now(),
                    durationMinutes: 0,
                    hourlyRate: 0,
                    sessionEarnings: -ded.deductionAmount,
                    description: `PO deduction: ${ded.advanceDescription} (period ${periodId})`,
                    payrollPeriod: periodId,
                    processedAt: admin.firestore.Timestamp.now(),
                    advanceId: ded.advanceId,
                    createdBy: `system:closePayrollPeriod`,
                });

                // Create advance_transaction for tracking
                const txId = `payroll_ded_${ded.advanceId}_${periodId}`;
                batch.set(db.collection('advance_transactions').doc(txId), {
                    advanceId: ded.advanceId,
                    employeeId: ded.employeeId,
                    employeeName: ded.employeeName,
                    type: 'payroll_deduction',
                    amount: ded.deductionAmount,
                    description: `Auto-deducted from payroll period ${periodId}`,
                    hasReceipt: false,
                    createdBy: adminUid,
                    createdAt: admin.firestore.Timestamp.now(),
                    status: 'active',
                });

                // Update running balance on user doc
                batch.set(db.collection('users').doc(ded.employeeId), {
                    runningBalance: admin.firestore.FieldValue.increment(-ded.deductionAmount),
                    runningBalanceUpdatedAt: admin.firestore.Timestamp.now(),
                }, { merge: true });

                console.log(`[closePayrollPeriod] Advance deduction: ${ded.employeeName} -$${ded.deductionAmount} from PO ${ded.advanceId}`);
            }

            // 8. Create/update period document
            const periodData = {
                id: periodId,
                year,
                month,
                status: 'closed',
                startDate: admin.firestore.Timestamp.fromDate(startDate),
                endDate: admin.firestore.Timestamp.fromDate(endDate),
                totalSessions,
                totalHours,
                totalAmount,
                totalAdvanceDeductions: parseFloat(totalAdvanceDeductions.toFixed(2)),
                totalNetAmount: parseFloat((totalAmount - totalAdvanceDeductions).toFixed(2)),
                employeeCount: employeeSet.size,
                closedAt: admin.firestore.Timestamp.now(),
                closedBy: adminUid,
                ...(periodDoc.exists ? {} : { createdAt: admin.firestore.Timestamp.now() })
            };

            batch.set(periodRef, periodData, { merge: true });

            await batch.commit();

            const deductionsSummary = advanceDeductions.length > 0
                ? ` Advance deductions: ${advanceDeductions.length} totaling $${totalAdvanceDeductions.toFixed(2)}.`
                : '';
            console.log(`✅ [closePayrollPeriod] Period ${periodId} closed. Sessions: ${totalSessions}, Hours: ${totalHours}, Gross: $${totalAmount}, Net: $${(totalAmount - totalAdvanceDeductions).toFixed(2)}.${deductionsSummary}`);

            return {
                success: true,
                message: `Period ${periodId} closed successfully`,
                period: {
                    id: periodId,
                    totalSessions,
                    totalHours,
                    totalAmount,
                    totalAdvanceDeductions: parseFloat(totalAdvanceDeductions.toFixed(2)),
                    employeeCount: employeeSet.size,
                    advanceDeductions,
                }
            };

        } catch (error: any) {
            console.error(`❌ [closePayrollPeriod] Error:`, error);

            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            throw new functions.https.HttpsError('internal', `Failed to close period: ${error.message}`);
        }
    }
);
