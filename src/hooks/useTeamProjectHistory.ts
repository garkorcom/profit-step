import { useCallback, useMemo } from 'react';

interface UsageEntry {
    count: number;
    lastUsed: number; // timestamp ms
}

/** clientId → { userId → UsageEntry } */
type ProjectTeamMap = Record<string, Record<string, UsageEntry>>;

type HasId = { id: string };

const STORAGE_KEY_PREFIX = 'gtd_team_project_';

/**
 * Hook to track which team members are assigned to tasks per project.
 * Data persisted in localStorage per current user.
 */
export function useTeamProjectHistory(currentUserId: string | undefined) {
    const storageKey = `${STORAGE_KEY_PREFIX}${currentUserId || 'anon'}`;

    const getMap = useCallback((): ProjectTeamMap => {
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? JSON.parse(raw) : {};
        } catch {
            return {};
        }
    }, [storageKey]);

    /** Record that an assignee was given a task for this project */
    const trackAssignment = useCallback((clientId: string, assigneeId: string) => {
        if (!clientId || !assigneeId) return;
        const map = getMap();
        if (!map[clientId]) map[clientId] = {};
        const prev = map[clientId][assigneeId] || { count: 0, lastUsed: 0 };
        map[clientId][assigneeId] = {
            count: prev.count + 1,
            lastUsed: Date.now(),
        };
        try {
            localStorage.setItem(storageKey, JSON.stringify(map));
        } catch { /* quota exceeded — ignore */ }
    }, [storageKey, getMap]);

    /** Sort team members for a specific project: most-assigned + most-recent first */
    const sortTeamForProject = useCallback(<T extends HasId>(
        clientId: string | null,
        users: T[],
    ): T[] => {
        if (!clientId) return users;
        const map = getMap();
        const projectMap = map[clientId] || {};
        const now = Date.now();
        const DAY = 86_400_000;

        const scored = users.map(u => {
            const entry = projectMap[u.id];
            if (!entry) return { user: u, score: 0 };

            const age = now - entry.lastUsed;
            let recency = 0;
            if (age < DAY) recency = 50;
            else if (age < 3 * DAY) recency = 30;
            else if (age < 7 * DAY) recency = 15;
            else if (age < 30 * DAY) recency = 5;

            return { user: u, score: entry.count * 10 + recency };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.user);
    }, [getMap]);

    /** Top N team members with usage history for this project */
    const getTopTeamForProject = useCallback(<T extends HasId>(
        clientId: string | null,
        users: T[],
        n: number = 4,
    ): { top: T[]; rest: T[] } => {
        if (!clientId) return { top: [], rest: users };
        const sorted = sortTeamForProject(clientId, users);
        const map = getMap();
        const projectMap = map[clientId] || {};
        const withUsage = sorted.filter(u => projectMap[u.id]?.count > 0);
        const topIds = new Set(withUsage.slice(0, n).map(u => u.id));
        return {
            top: withUsage.slice(0, n),
            rest: sorted.filter(u => !topIds.has(u.id)),
        };
    }, [sortTeamForProject, getMap]);

    return useMemo(() => ({
        trackAssignment,
        sortTeamForProject,
        getTopTeamForProject,
    }), [trackAssignment, sortTeamForProject, getTopTeamForProject]);
}
