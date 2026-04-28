/**
 * Worker's own ledger — queries work_sessions filtered by employeeId.
 * Unlike the admin `useFinanceLedger`, this hook is scoped to a single
 * worker, so the query is cheap (one composite index hit) and doesn't
 * leak other employees' data into worker-facing UI.
 *
 * Handles the Telegram-id ↔ UID dual-identity case: a worker's sessions
 * may appear under the Telegram chat id (from bot) AND under the user's
 * UID (from web). Both are queried in parallel and deduplicated by
 * doc id, then filtered + buckets computed with the same canonical
 * helpers the FinancePage uses.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    collection,
    getDocs,
    query,
    where,
    Timestamp,
} from 'firebase/firestore';
import { startOfDay, endOfDay } from 'date-fns';

import { db } from '../../../firebase/firebase';
import { WorkSession } from '../../../types/timeTracking.types';
import {
    calculatePayrollBuckets,
    filterReportableSessions,
    type PayrollBuckets,
} from '../../finance';

interface UseWorkerLedgerArgs {
    userId?: string;
    /** Worker's Telegram id (legacy employeeId for bot-originated sessions). */
    telegramId?: string | number;
    startDate: Date;
    endDate: Date;
    /**
     * Caller's companyId — required by RLS read rule on work_sessions
     * (PR #95). Pass `userProfile.companyId` from `useAuth()`.
     */
    companyId?: string;
}

interface UseWorkerLedgerResult {
    /** All reportable sessions in the range, newest first. */
    entries: WorkSession[];
    /** Salary/payments/adjustments/balance + totalHours for the range. */
    buckets: PayrollBuckets;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useWorkerLedger({
    userId,
    telegramId,
    startDate,
    endDate,
    companyId,
}: UseWorkerLedgerArgs): UseWorkerLedgerResult {
    const [entries, setEntries] = useState<WorkSession[]>([]);
    const [buckets, setBuckets] = useState<PayrollBuckets>({
        salary: 0,
        payments: 0,
        adjustments: 0,
        expenses: 0,
        balance: 0,
        totalMinutes: 0,
        totalHours: 0,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!userId) {
            setLoading(false);
            return;
        }
        if (!companyId) {
            // RLS read rule (PR #95) requires companyId on every doc; skip
            // until auth profile resolves.
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            // Query under both identity variants in parallel and dedup by id
            // (same pattern the Telegram bot uses — see sessionManager.ts).
            const ids = new Set<string>([userId]);
            if (telegramId) ids.add(String(telegramId));

            const start = Timestamp.fromDate(startOfDay(startDate));
            const end = Timestamp.fromDate(endOfDay(endDate));

            // No orderBy — sorted client-side by startTime DESC below. Matches
            // existing `employeeId ASC + startTime ASC` composite index
            // (firestore.indexes.json). Avoids needing a new DESC index for
            // this one query path.
            //
            // companyId filter REQUIRED — RLS read rule (PR #95).
            const snapshots = await Promise.all(
                Array.from(ids).map(id =>
                    getDocs(
                        query(
                            collection(db, 'work_sessions'),
                            where('companyId', '==', companyId),
                            where('employeeId', '==', id),
                            where('startTime', '>=', start),
                            where('startTime', '<=', end)
                        )
                    )
                )
            );

            const byId = new Map<string, WorkSession>();
            for (const snap of snapshots) {
                for (const d of snap.docs) {
                    if (!byId.has(d.id)) {
                        byId.set(d.id, { id: d.id, ...d.data() } as WorkSession);
                    }
                }
            }

            const all = Array.from(byId.values()).sort(
                (a, b) =>
                    (b.startTime?.toMillis() ?? 0) - (a.startTime?.toMillis() ?? 0)
            );
            const reportable = filterReportableSessions(all);
            setEntries(reportable);
            setBuckets(calculatePayrollBuckets(reportable));
        } catch (e) {
            console.error('useWorkerLedger: fetch failed', e);
            setError(e instanceof Error ? e.message : 'Fetch failed');
        } finally {
            setLoading(false);
        }
    }, [userId, telegramId, startDate, endDate, companyId]);

    useEffect(() => {
        load();
    }, [load]);

    return { entries, buckets, loading, error, refresh: load };
}
