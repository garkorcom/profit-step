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
