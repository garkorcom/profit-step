/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 🚨 PROD-CRITICAL — time-tracking / finance module                        ║
 * ║                                                                          ║
 * ║ DO NOT MODIFY without explicit approval from Denis in chat.              ║
 * ║                                                                          ║
 * ║ This file participates in real workers' hours and money calculation.   ║
 * ║ A one-line firestore.rules tightening without code/index/backfill        ║
 * ║ companions caused the 6-hour outage of incident 2026-04-28.              ║
 * ║                                                                          ║
 * ║ Before touching this file:                                               ║
 * ║   1. Read ~/.claude/projects/-Users-denysharbuzov-Projects-profit-step/  ║
 * ║      memory/feedback_no_touch_time_finance.md                            ║
 * ║   2. Get explicit "ok" from Denis IN THE CURRENT SESSION.                ║
 * ║   3. If RLS-related: plan backfill + code-audit + indexes + deploy order ║
 * ║      together (see feedback_rls_three_part_change.md).                   ║
 * ║   4. Run functions/scripts/backup-finance-and-time.js BEFORE any write.  ║
 * ║                                                                          ║
 * ║ "Just refactoring / cleaning up / adding types" is NOT a reason to       ║
 * ║ skip step 2. Stop and ask first.                                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { useCallback, useEffect, useState } from 'react';

import { WorkSession } from '../../../types/timeTracking.types';
import {
    CostEntry,
    EmployeeDirectory,
    fetchCosts,
    fetchWorkSessions,
    normalizeSessionIdentities,
} from '../api/financeApi';
import { filterReportableSessions } from '../services/financeFilters';

interface UseFinanceLedgerArgs {
    startDate: Date;
    endDate: Date;
    /**
     * Directory is needed BEFORE sessions so we can normalise legacy
     * Telegram-only employeeIds onto canonical UIDs. Pass `null` while
     * the directory is still loading — the hook will skip its fetch.
     */
    directory: EmployeeDirectory | null;
    /**
     * Caller's companyId — required by RLS read rule on work_sessions
     * (PR #95). Pass `userProfile.companyId` from `useAuth()`.
     */
    companyId: string | undefined;
}

interface UseFinanceLedgerResult {
    entries: WorkSession[];
    costs: CostEntry[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

/**
 * Load the reportable ledger (work_sessions + costs) for the current
 * date window. Depends on the employee directory to normalise identities
 * (Telegram chat id → user UID). Re-fetches whenever the date range or
 * directory identity changes.
 *
 * Extracted from `FinancePage.tsx` (see
 * `docs/finance-module/ISOLATION_PLAN.md`).
 */
export function useFinanceLedger({
    startDate,
    endDate,
    directory,
    companyId,
}: UseFinanceLedgerArgs): UseFinanceLedgerResult {
    const [entries, setEntries] = useState<WorkSession[]>([]);
    const [costs, setCosts] = useState<CostEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!directory) {
            // Don't fetch sessions without a directory — identities would
            // not be normalised, causing drifting filter rows.
            return;
        }
        if (!companyId) {
            // RLS read rule requires companyId on every work_sessions doc;
            // skip until auth profile resolves.
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const [sessions, costsData] = await Promise.all([
                fetchWorkSessions(startDate, endDate, companyId),
                fetchCosts(startDate, endDate),
            ]);

            const reportable = filterReportableSessions(sessions);
            const normalized = normalizeSessionIdentities(reportable, directory);

            setEntries(normalized);
            setCosts(costsData);
        } catch (e) {
            console.error('useFinanceLedger: fetch failed', e);
            setError(e instanceof Error ? e.message : 'Fetch failed');
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, directory, companyId]);

    useEffect(() => {
        load();
    }, [load]);

    return { entries, costs, loading, error, refresh: load };
}
