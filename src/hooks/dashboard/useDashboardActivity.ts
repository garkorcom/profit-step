import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { formatDistanceToNowStrict } from 'date-fns';
import { ru } from 'date-fns/locale';

export type ActivityType = 'login' | 'deal_created' | 'task_completed' | 'estimate_created' | 'payment' | 'user_registered';

export interface ActivityEvent {
    id: string;
    type: ActivityType;
    user: {
        id: string;
        name: string;
        avatar?: string;
    };
    action: string;
    target?: {
        id: string;
        title: string;
        link: string;
    };
    timestamp: Date;
    timeAgo: string;
    icon: string;
}

export interface DashboardActivityData {
    activities: ActivityEvent[];
    loading: boolean;
}

export const useDashboardActivity = (filterType: string = 'all'): DashboardActivityData => {
    const [data, setData] = useState<DashboardActivityData>({
        activities: [],
        loading: true
    });

    useEffect(() => {
        let isMounted = true;

        const fetchActivities = async () => {
            try {
                // Since there's no single audit_events collection on the client yet, 
                // we synthesize the feed by querying the most recent items from key collections 
                // and merging them. This is a common NoSQL pattern for "Recent Activity" 
                // without a dedicated Fan-Out collection.

                const fetchLimit = 15;
                const events: ActivityEvent[] = [];

                // 1. Fetch recent Tasks Completed
                if (filterType === 'all' || filterType === 'tasks') {
                    const tasksSnap = await getDocs(query(collection(db, 'gtd_tasks'), orderBy('completedAt', 'desc'), limit(10)));
                    tasksSnap.forEach(doc => {
                        const task = doc.data();
                        if (task.status === 'done' && task.completedAt) {
                            events.push({
                                id: `task_${doc.id}`,
                                type: 'task_completed',
                                user: {
                                    id: task.assigneeId || task.ownerId || 'system',
                                    name: task.assigneeName || task.ownerName || 'Пользователь'
                                },
                                action: 'завершил задачу',
                                target: {
                                    id: doc.id,
                                    title: task.title,
                                    link: `/crm/tasks?view=board`
                                },
                                timestamp: task.completedAt.toDate(),
                                timeAgo: '',
                                icon: '✓'
                            });
                        }
                    });
                }

                // 2. Fetch recent Deals
                if (filterType === 'all' || filterType === 'deals') {
                    const leadsSnap = await getDocs(query(collection(db, 'leads'), orderBy('createdAt', 'desc'), limit(10)));
                    leadsSnap.forEach(doc => {
                        const lead = doc.data();
                        if (lead.createdAt) {
                            events.push({
                                id: `deal_${doc.id}`,
                                type: 'deal_created',
                                user: {
                                    id: 'system',
                                    name: 'Система' // Leads often come from landing page
                                },
                                action: 'новая заявка (лид)',
                                target: {
                                    id: doc.id,
                                    title: lead.name || 'Без имени',
                                    link: `/crm/deals`
                                },
                                timestamp: typeof lead.createdAt.toDate === 'function' ? lead.createdAt.toDate() : new Date(lead.createdAt.seconds * 1000),
                                timeAgo: '',
                                icon: '🤝'
                            });
                        }
                    });
                }

                // 3. Fetch recent Payments/Finance
                if (filterType === 'all' || filterType === 'finance') {
                    const txSnap = await getDocs(query(collection(db, 'bank_transactions'), orderBy('date', 'desc'), limit(10)));
                    txSnap.forEach(doc => {
                        const tx = doc.data();
                        events.push({
                            id: `tx_${doc.id}`,
                            type: 'payment',
                            user: {
                                id: 'bank',
                                name: 'Банк'
                            },
                            action: tx.amount > 0 ? 'поступление' : 'списание',
                            target: {
                                id: doc.id,
                                title: `${tx.amount > 0 ? '+' : ''}${tx.amount} — ${tx.vendor || 'Транзакция'}`,
                                link: `/crm/finance`
                            },
                            timestamp: typeof tx.date.toDate === 'function' ? tx.date.toDate() : new Date(tx.date.seconds * 1000),
                            timeAgo: '',
                            icon: '💰'
                        });
                    });
                }

                // 4. Fetch recent Users (Registration)
                if (filterType === 'all' || filterType === 'users') {
                    const usersSnap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(5)));
                    usersSnap.forEach(doc => {
                        const user = doc.data();
                        if (user.createdAt) {
                            events.push({
                                id: `user_${doc.id}`,
                                type: 'user_registered',
                                user: {
                                    id: doc.id,
                                    name: user.displayName || 'Новый пользователь'
                                },
                                action: 'зарегистрировался в системе',
                                timestamp: typeof user.createdAt.toDate === 'function' ? user.createdAt.toDate() : new Date(user.createdAt.seconds * 1000),
                                timeAgo: '',
                                icon: '👤'
                            });
                        }
                    });
                }

                // Sort all events globally by timestamp descending
                events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

                // Take top 15 and format timeAgo
                const finalEvents = events.slice(0, fetchLimit).map(evt => ({
                    ...evt,
                    timeAgo: formatDistanceToNowStrict(evt.timestamp, { addSuffix: true, locale: ru })
                }));

                if (isMounted) {
                    setData({ activities: finalEvents, loading: false });
                }

            } catch (error) {
                console.error('Error fetching activity feed:', error);
                if (isMounted) {
                    setData(prev => ({ ...prev, loading: false }));
                }
            }
        };

        fetchActivities();

        // Optional: Polling every 60s since we use getDocs instead of onSnapshot for synthesis
        const intervalId = setInterval(fetchActivities, 60000);

        return () => {
            isMounted = false;
            clearInterval(intervalId);
        };
    }, [filterType]);

    return data;
};
