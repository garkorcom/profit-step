/**
 * @fileoverview useTasksMasonry — Data hook for Touch Board
 * 
 * Reuses gtd_tasks Firestore collection. Flattens all statuses into
 * grouped sections: Timeline (Overdue/Today/Tomorrow/Later/Done)
 * or Context (@Calls, @Office, etc.).
 * 
 * Provides: markDone, deleteTask, quickAdd, multi-select state.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    collection, query, where, onSnapshot,
    doc, updateDoc, deleteDoc, addDoc, Timestamp, or,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../auth/AuthContext';
import { GTDTask, GTDStatus, GTDPriority } from '../types/gtd.types';

// ============================================
// TYPES
// ============================================

export type GroupMode = 'timeline' | 'context';

export interface TaskGroup {
    id: string;
    label: string;
    emoji: string;
    color: string;
    tasks: GTDTask[];
}

// ============================================
// DATE HELPERS
// ============================================

const startOfDay = (d: Date): Date => {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    return r;
};

const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

const isOverdue = (dueDate: Timestamp | undefined, now: Date): boolean => {
    if (!dueDate) return false;
    return new Date(dueDate.seconds * 1000) < startOfDay(now);
};

const isToday = (dueDate: Timestamp | undefined, now: Date): boolean => {
    if (!dueDate) return false;
    return isSameDay(new Date(dueDate.seconds * 1000), now);
};

const isTomorrow = (dueDate: Timestamp | undefined, now: Date): boolean => {
    if (!dueDate) return false;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return isSameDay(new Date(dueDate.seconds * 1000), tomorrow);
};

const isThisWeek = (dueDate: Timestamp | undefined, now: Date): boolean => {
    if (!dueDate) return false;
    const due = new Date(dueDate.seconds * 1000);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    return due <= endOfWeek && due > now;
};

// ============================================
// GROUPING LOGIC
// ============================================

const groupByTimeline = (tasks: GTDTask[], expandDone: boolean): { groups: TaskGroup[]; totalDoneCount: number } => {
    const now = new Date();
    const groups: TaskGroup[] = [
        { id: 'overdue_today', label: 'Overdue & Today', emoji: '🔴', color: '#FF3B30', tasks: [] },
        { id: 'tomorrow', label: 'Tomorrow', emoji: '🟡', color: '#FF9500', tasks: [] },
        { id: 'this_week', label: 'This Week', emoji: '📅', color: '#007AFF', tasks: [] },
        { id: 'later', label: 'Later / No Date', emoji: '📦', color: '#8E8E93', tasks: [] },
        { id: 'done', label: 'Done', emoji: '✅', color: '#34C759', tasks: [] },
    ];

    tasks.forEach(task => {
        if (task.status === 'done') {
            groups[4].tasks.push(task);
        } else if (isOverdue(task.dueDate, now) || isToday(task.dueDate, now)) {
            groups[0].tasks.push(task);
        } else if (isTomorrow(task.dueDate, now)) {
            groups[1].tasks.push(task);
        } else if (isThisWeek(task.dueDate, now)) {
            groups[2].tasks.push(task);
        } else {
            groups[3].tasks.push(task);
        }
    });

    // Sort Done by completedAt desc, limit to 5 unless expanded
    const doneGroup = groups[4];
    const totalDoneCount = doneGroup.tasks.length;
    if (doneGroup.tasks.length > 0) {
        doneGroup.tasks.sort((a, b) => {
            const aTime = a.completedAt?.toMillis?.() ?? 0;
            const bTime = b.completedAt?.toMillis?.() ?? 0;
            return bTime - aTime;
        });
        if (!expandDone) {
            doneGroup.tasks = doneGroup.tasks.slice(0, 5);
        }
        doneGroup.label = expandDone
            ? `Done (${totalDoneCount})`
            : `Done (${Math.min(5, totalDoneCount)} из ${totalDoneCount})`;
    }

    return { groups: groups.filter(g => g.tasks.length > 0), totalDoneCount };
};

const groupByContext = (tasks: GTDTask[]): TaskGroup[] => {
    const contextMap = new Map<string, GTDTask[]>();

    tasks.forEach(task => {
        if (task.status === 'done') return; // skip done in context view
        const ctx = task.context?.trim() || 'No Context';
        if (!contextMap.has(ctx)) {
            contextMap.set(ctx, []);
        }
        contextMap.get(ctx)!.push(task);
    });

    const CONTEXT_COLORS: Record<string, { emoji: string; color: string }> = {
        '@calls': { emoji: '📞', color: '#FF9500' },
        '@office': { emoji: '🏢', color: '#007AFF' },
        '@computer': { emoji: '💻', color: '#5856D6' },
        '@home': { emoji: '🏠', color: '#34C759' },
        '@errands': { emoji: '🏃', color: '#FF3B30' },
        '@phone': { emoji: '📱', color: '#FF2D55' },
        '@work': { emoji: '🔨', color: '#FF9500' },
    };

    return Array.from(contextMap.entries()).map(([ctx, tasks]) => {
        const key = ctx.toLowerCase();
        const meta = CONTEXT_COLORS[key] || { emoji: '📋', color: '#8E8E93' };
        return {
            id: ctx,
            label: ctx,
            emoji: meta.emoji,
            color: meta.color,
            tasks,
        };
    }).sort((a, b) => b.tasks.length - a.tasks.length);
};

// ============================================
// HOOK
// ============================================

export const useTasksMasonry = () => {
    const { currentUser } = useAuth();
    const [allTasks, setAllTasks] = useState<GTDTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [groupMode, setGroupMode] = useState<GroupMode>('timeline');
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedDone, setExpandedDone] = useState(false);

    // Multi-select
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectMode, setSelectMode] = useState(false);

    // ── Firestore subscription ──
    useEffect(() => {
        if (!currentUser) return;
        setLoading(true);

        const q = query(
            collection(db, 'gtd_tasks'),
            or(
                where('ownerId', '==', currentUser.uid),
                where('assigneeId', '==', currentUser.uid),
                where('coAssigneeIds', 'array-contains', currentUser.uid)
            )
        );

        const unsub = onSnapshot(q, (snapshot) => {
            const tasks: GTDTask[] = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
            } as GTDTask));

            // Sort by priority then by due date
            tasks.sort((a, b) => {
                const priorityOrder: Record<GTDPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };
                const pa = priorityOrder[a.priority] ?? 3;
                const pb = priorityOrder[b.priority] ?? 3;
                if (pa !== pb) return pa - pb;
                // Then by due date (earlier first)
                const da = a.dueDate?.seconds || Infinity;
                const db2 = b.dueDate?.seconds || Infinity;
                return da - db2;
            });

            setAllTasks(tasks);
            setLoading(false);
        }, (error) => {
            console.error('[TasksMasonry] Subscription error:', error);
            setLoading(false);
        });

        return unsub;
    }, [currentUser]);

    // ── Filtered + Grouped data ──
    const filteredTasks = useMemo(() => {
        if (!searchQuery.trim()) return allTasks;
        const q = searchQuery.toLowerCase().trim();
        return allTasks.filter(t =>
            t.title.toLowerCase().includes(q) ||
            (t.context || '').toLowerCase().includes(q) ||
            (t.clientName || '').toLowerCase().includes(q)
        );
    }, [allTasks, searchQuery]);

    const { groups, totalDoneCount } = useMemo(() => {
        if (groupMode === 'timeline') {
            return groupByTimeline(filteredTasks, expandedDone);
        }
        return { groups: groupByContext(filteredTasks), totalDoneCount: 0 };
    }, [filteredTasks, groupMode, expandedDone]);

    const toggleExpandDone = useCallback(() => {
        setExpandedDone(prev => !prev);
    }, []);

    // ── Stats ──
    const stats = useMemo(() => {
        const active = allTasks.filter(t => t.status !== 'done');
        const overdue = allTasks.filter(t => t.status !== 'done' && isOverdue(t.dueDate, new Date()));
        const today = allTasks.filter(t => t.status !== 'done' && isToday(t.dueDate, new Date()));
        return {
            total: allTasks.length,
            active: active.length,
            overdue: overdue.length,
            dueToday: today.length,
            done: allTasks.length - active.length,
        };
    }, [allTasks]);

    // ── Actions ──
    const markDone = useCallback(async (taskId: string) => {
        if (!currentUser) return;
        await updateDoc(doc(db, 'gtd_tasks', taskId), {
            status: 'done' as GTDStatus,
            completedAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
    }, [currentUser]);

    const markUndone = useCallback(async (taskId: string) => {
        if (!currentUser) return;
        await updateDoc(doc(db, 'gtd_tasks', taskId), {
            status: 'next_action' as GTDStatus,
            completedAt: null,
            updatedAt: Timestamp.now(),
        });
    }, [currentUser]);

    const removeTask = useCallback(async (taskId: string) => {
        if (!currentUser) return;
        await deleteDoc(doc(db, 'gtd_tasks', taskId));
    }, [currentUser]);

    const quickAdd = useCallback(async (payload: {
        title: string;
        priority?: GTDPriority;
        context?: string;
        clientId?: string;
        clientName?: string;
        status?: GTDStatus;
        dueDate?: string; // yyyy-MM-dd
    }) => {
        if (!currentUser || !payload.title.trim()) return;
        const taskData: Record<string, unknown> = {
            title: payload.title.trim(),
            status: (payload.status || 'inbox') as GTDStatus,
            priority: payload.priority || 'none' as GTDPriority,
            context: payload.context || '',
            clientId: payload.clientId || '',
            clientName: payload.clientName || '',
            description: '',
            ownerId: currentUser.uid,
            ownerName: currentUser.displayName || 'Unknown',
            createdAt: Timestamp.now(),
        };
        if (payload.dueDate) {
            taskData.dueDate = Timestamp.fromDate(new Date(payload.dueDate + 'T00:00:00'));
        }
        await addDoc(collection(db, 'gtd_tasks'), taskData);
    }, [currentUser]);

    // ── Move task (for drag-and-drop) ──
    const moveTask = useCallback(async (taskId: string, targetGroupId: string) => {
        if (!currentUser) return;
        const updates: Record<string, unknown> = { updatedAt: Timestamp.now() };

        // Handle target group mapping
        if (targetGroupId === 'done') {
            updates.status = 'done' as GTDStatus;
            updates.completedAt = Timestamp.now();
        } else if (targetGroupId === 'overdue_today') {
            updates.status = 'next_action' as GTDStatus;
            updates.dueDate = Timestamp.now(); // Set to today
            updates.completedAt = null;
        } else if (targetGroupId === 'tomorrow') {
            updates.status = 'next_action' as GTDStatus;
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            updates.dueDate = Timestamp.fromDate(tomorrow);
            updates.completedAt = null;
        } else if (targetGroupId === 'this_week') {
            updates.status = 'next_action' as GTDStatus;
            const endOfWeek = new Date();
            endOfWeek.setDate(endOfWeek.getDate() + (5 - endOfWeek.getDay())); // Friday
            updates.dueDate = Timestamp.fromDate(endOfWeek);
            updates.completedAt = null;
        } else if (targetGroupId === 'later') {
            updates.status = 'next_action' as GTDStatus;
            updates.dueDate = null;
            updates.completedAt = null;
        } else {
            // Context-mode grouping → set context
            updates.context = targetGroupId === 'No Context' ? '' : targetGroupId;
        }

        await updateDoc(doc(db, 'gtd_tasks', taskId), updates);
    }, [currentUser]);

    // ── Multi-select ──
    const toggleSelect = useCallback((taskId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            if (next.size === 0) setSelectMode(false);
            return next;
        });
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectMode(false);
    }, []);

    const bulkMarkDone = useCallback(async () => {
        const promises = Array.from(selectedIds).map(id => markDone(id));
        await Promise.all(promises);
        clearSelection();
    }, [selectedIds, markDone, clearSelection]);

    const bulkDelete = useCallback(async () => {
        const promises = Array.from(selectedIds).map(id => removeTask(id));
        await Promise.all(promises);
        clearSelection();
    }, [selectedIds, removeTask, clearSelection]);

    return {
        groups,
        stats,
        loading,
        groupMode,
        setGroupMode,
        markDone,
        markUndone,
        removeTask,
        quickAdd,
        moveTask,
        // Search
        searchQuery,
        setSearchQuery,
        // Done expansion
        expandedDone,
        toggleExpandDone,
        totalDoneCount,
        // Multi-select
        selectMode,
        setSelectMode,
        selectedIds,
        toggleSelect,
        clearSelection,
        bulkMarkDone,
        bulkDelete,
    };
};
