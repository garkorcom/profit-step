import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { GTDTask } from '../../types/gtd.types';
import { startOfDay, isBefore } from 'date-fns';

export interface UrgentTask {
    id: string;
    title: string;
    assignee: string;
    deadline?: Date;
    priority: 'high' | 'medium' | 'low' | 'none';
}

export interface DashboardTasksData {
    inProgress: number;
    overdue: number;
    completedToday: number;
    urgentTasks: UrgentTask[];
    loading: boolean;
}

export const useDashboardTasks = (companyId: string | undefined): DashboardTasksData => {
    const [data, setData] = useState<DashboardTasksData>({
        inProgress: 0,
        overdue: 0,
        completedToday: 0,
        urgentTasks: [],
        loading: true
    });

    useEffect(() => {
        const now = new Date();
        const startOfToday = startOfDay(now);

        const tasksRef = collection(db, 'gtd_tasks');

        // We use two separate listeners: one for active tasks, one for completed today.
        // This avoids fetching all historical 'done' tasks.
        const activeTasksQuery = query(
            tasksRef,
            where('status', 'in', ['inbox', 'next_action', 'waiting', 'projects', 'estimate'])
        );

        // Note: For completed tasks, we need a composite index if we combine status and completedAt.
        // It's safer to query status == 'done' and filter client side if the db isn't huge, OR just fetch where completedAt >= startOfDay if it exists uniquely.
        // Wait, completedAt is only on 'done' tasks, so we can just query where('completedAt', '>=', startOfToday)
        const completedTasksQuery = query(
            tasksRef,
            where('completedAt', '>=', Timestamp.fromDate(startOfToday))
        );

        let activeSnapshotData: GTDTask[] = [];
        let completedTodayCount = 0;
        let activeReady = false;
        let completedReady = false;

        const safeGetDate = (val: any) => {
            if (!val) return null;
            if (typeof val.toDate === 'function') return val.toDate();
            if (val.seconds) return new Date(val.seconds * 1000);
            if (val instanceof Date) return val;
            return new Date(val);
        };

        const processAggregations = () => {
            if (!activeReady || !completedReady) return;

            let inProgress = 0;
            let overdueCount = 0;
            const urgent: UrgentTask[] = [];

            activeSnapshotData.forEach(task => {
                // In progress
                if (task.status === 'next_action' || task.status === 'inbox' || task.status === 'estimate') {
                    inProgress++;
                }

                const taskDueDate = safeGetDate(task.dueDate);

                // Check overdue
                if (taskDueDate && isBefore(taskDueDate, now)) {
                    overdueCount++;
                }

                // Collect urgent
                if (task.priority === 'high' || (taskDueDate && isBefore(taskDueDate, new Date(now.getTime() + 86400000 * 2)))) { // high priority or due within 2 days
                    urgent.push({
                        id: task.id,
                        title: task.title,
                        assignee: task.assigneeName || task.ownerName || 'Unassigned',
                        deadline: taskDueDate,
                        priority: task.priority
                    });
                }
            });

            // Sort urgent tasks: overdue first, then nearest deadline, then priority High
            urgent.sort((a, b) => {
                if (a.deadline && b.deadline) {
                    return a.deadline.getTime() - b.deadline.getTime();
                }
                if (a.deadline) return -1;
                if (b.deadline) return 1;
                if (a.priority === 'high' && b.priority !== 'high') return -1;
                if (a.priority !== 'high' && b.priority === 'high') return 1;
                return 0;
            });

            setData({
                inProgress,
                overdue: overdueCount,
                completedToday: completedTodayCount,
                urgentTasks: urgent.slice(0, 5), // top 5
                loading: false
            });
        };

        const unsubActive = onSnapshot(activeTasksQuery, (snapshot) => {
            activeSnapshotData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GTDTask));
            activeReady = true;
            processAggregations();
        }, (err) => {
            console.error('Error fetching active tasks:', err);
            activeReady = true;
            processAggregations();
        });

        const unsubCompleted = onSnapshot(completedTasksQuery, (snapshot) => {
            // Further filter just in case status is not 'done'
            const valid = snapshot.docs.filter(doc => doc.data().status === 'done');
            completedTodayCount = valid.length;
            completedReady = true;
            processAggregations();
        }, (err) => {
            console.error('Error fetching completed tasks:', err);
            completedReady = true;
            processAggregations();
        });

        return () => {
            unsubActive();
            unsubCompleted();
        };
    }, [companyId]);

    return data;
};
