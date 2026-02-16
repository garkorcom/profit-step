import { useCallback, useMemo } from 'react';

/** Any object with an `id` field */
type HasId = { id: string };

interface UsageEntry {
    count: number;
    lastUsed: number; // timestamp ms
}

type UsageMap = Record<string, UsageEntry>;

const STORAGE_KEY_PREFIX = 'gtd_client_usage_';

/**
 * Hook to track and sort clients by usage frequency + recency.
 * Data persisted in localStorage per user.
 * Generic: works with any type that has `{ id: string }`.
 */
export function useClientUsageHistory(userId: string | undefined) {
    const storageKey = `${STORAGE_KEY_PREFIX}${userId || 'anon'}`;

    const getUsageMap = useCallback((): UsageMap => {
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }, [storageKey]);

    /** Record that a client was selected */
    const trackUsage = useCallback((clientId: string) => {
        if (!clientId) return;
        const map = getUsageMap();
        const prev = map[clientId] || { count: 0, lastUsed: 0 };
        map[clientId] = {
            count: prev.count + 1,
            lastUsed: Date.now(),
        };
        try {
            localStorage.setItem(storageKey, JSON.stringify(map));
        } catch { /* quota exceeded — ignore */ }
    }, [storageKey, getUsageMap]);

    /** Sort clients: most-used + most-recent first */
    const sortClients = useCallback(<T extends HasId>(clients: T[]): T[] => {
        const map = getUsageMap();
        const now = Date.now();
        const DAY = 86_400_000;

        const scored = clients.map(c => {
            const entry = map[c.id];
            if (!entry) return { client: c, score: 0 };

            const age = now - entry.lastUsed;
            let recency = 0;
            if (age < DAY) recency = 50;          // today
            else if (age < 3 * DAY) recency = 30; // last 3 days
            else if (age < 7 * DAY) recency = 15; // last week
            else if (age < 30 * DAY) recency = 5; // last month

            return {
                client: c,
                score: entry.count * 10 + recency,
            };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.client);
    }, [getUsageMap]);

    /** Top N clients that have usage history */
    const getTopClients = useCallback(<T extends HasId>(clients: T[], n: number = 5): {
        top: T[];
        rest: T[];
    } => {
        const sorted = sortClients(clients);
        const map = getUsageMap();
        // Only clients with actual usage go into "top"
        const withUsage = sorted.filter(c => map[c.id]?.count > 0);
        return {
            top: withUsage.slice(0, n),
            rest: sorted.filter(c => !withUsage.slice(0, n).includes(c)),
        };
    }, [sortClients, getUsageMap]);

    return useMemo(() => ({
        trackUsage,
        sortClients,
        getTopClients,
    }), [trackUsage, sortClients, getTopClients]);
}
