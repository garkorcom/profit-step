import { useCallback, useEffect, useState } from 'react';
import { tasktotimeApi } from '../api/tasktotimeApi';
import type { TaskDto } from '../api/tasktotimeApi';
import { buildHierarchyTree, type HierarchyNode } from '../pages/crm/tasktotime/hierarchy/utils';

export function useHierarchyTree(companyId: string | undefined) {
    const [tree, setTree] = useState<HierarchyNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const fetchTree = useCallback(async () => {
        if (!companyId) return;
        
        setLoading(true);
        setError(null);
        try {
            let allTasks: TaskDto[] = [];
            let cursor: string | null = null;

            // Fetch all tasks for the company (safe for Phase A, assuming < 1000 tasks)
            do {
                const res = await tasktotimeApi.listTasks({
                    companyId,
                    limit: 1000,
                    cursor: cursor ?? undefined,
                });
                allTasks = allTasks.concat(res.items);
                cursor = res.nextCursor;
            } while (cursor);

            // Assemble tree
            const roots = buildHierarchyTree(allTasks);

            setTree(roots);
        } catch (err) {
            console.error('Failed to fetch hierarchy', err);
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        fetchTree();
    }, [fetchTree]);

    return { tree, loading, error, refetch: fetchTree };
}
