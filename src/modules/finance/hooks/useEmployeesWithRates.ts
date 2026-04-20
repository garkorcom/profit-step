import { useCallback, useEffect, useState } from 'react';

import {
    fetchEmployeeDirectory,
    Employee,
    EmployeeDirectory,
} from '../api/financeApi';

interface UseEmployeesResult extends EmployeeDirectory {
    loading: boolean;
    error: string | null;
    /** Manually refresh from Firestore; returns the fresh directory. */
    refresh: () => Promise<EmployeeDirectory>;
    /** Optimistic local override (e.g. after rate edit) — doesn't refetch. */
    setEmployees: (updater: (prev: Employee[]) => Employee[]) => void;
}

/**
 * Load the unified users-collection directory (source of truth for
 * display names + hourlyRate + telegramId). Runs once on mount; caller
 * can `refresh()` after edits.
 *
 * Extracted from `FinancePage.tsx` (see
 * `docs/finance-module/ISOLATION_PLAN.md`).
 */
export function useEmployeesWithRates(): UseEmployeesResult {
    const [employees, setEmployeesState] = useState<Employee[]>([]);
    const [telegramIdToUid, setTelegramIdToUid] = useState<Map<string, string>>(
        new Map()
    );
    const [uidToName, setUidToName] = useState<Map<string, string>>(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async (): Promise<EmployeeDirectory> => {
        setLoading(true);
        setError(null);
        try {
            const dir = await fetchEmployeeDirectory();
            setEmployeesState(dir.employees);
            setTelegramIdToUid(dir.telegramIdToUid);
            setUidToName(dir.uidToName);
            return dir;
        } catch (e) {
            console.error('useEmployeesWithRates: fetch failed', e);
            setError(e instanceof Error ? e.message : 'Fetch failed');
            return {
                employees: [],
                telegramIdToUid: new Map(),
                uidToName: new Map(),
            };
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const setEmployees = useCallback(
        (updater: (prev: Employee[]) => Employee[]) => {
            setEmployeesState(prev => updater(prev));
        },
        []
    );

    return {
        employees,
        telegramIdToUid,
        uidToName,
        loading,
        error,
        refresh,
        setEmployees,
    };
}
