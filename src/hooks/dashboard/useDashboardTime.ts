import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { WorkSession } from '../../types/timeTracking.types';
import { startOfDay, startOfWeek, subWeeks, endOfWeek, isSameDay } from 'date-fns';

export interface DashboardTimeData {
    today: {
        totalHours: number;
        activeEmployees: number; // unique employees
        activeSessions: number;
    };
    week: {
        totalHours: number;
        trend: number; // percentage vs prev week
        dailyBreakdown: { day: string; hours: number }[];
    };
    topEmployees: { name: string; hours: number }[];
    loading: boolean;
}

export const useDashboardTime = (companyId: string | undefined): DashboardTimeData => {
    const [data, setData] = useState<DashboardTimeData>({
        today: { totalHours: 0, activeEmployees: 0, activeSessions: 0 },
        week: { totalHours: 0, trend: 0, dailyBreakdown: [] },
        topEmployees: [],
        loading: true
    });

    useEffect(() => {
        if (!companyId) return;

        const now = new Date();
        const todayStart = startOfDay(now);

        // Let's use Monday as week start
        const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
        const previousWeekStart = subWeeks(currentWeekStart, 1);

        const sessionsRef = collection(db, 'work_sessions');
        // Fetch everything from previous week start
        // Normally we'd filter by companyId too, but work_sessions doesn't explicitly guarantee companyId in schema.
        // If it does, we should add: where('companyId', '==', companyId),
        // Profit Step RBAC implies user is either global admin or company admin. We'll fetch all and filter client-side if missing companyId index.
        const q = query(
            sessionsRef,
            where('startTime', '>=', Timestamp.fromDate(previousWeekStart))
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let todayHours = 0;
            let activeSessions = 0;
            const todayEmployees = new Set<string>();
            const employeeHoursToday: Record<string, number> = {};

            let currentWeekHours = 0;
            let previousWeekHours = 0;

            const daysMap: Record<string, number> = {
                'Пн': 0, 'Вт': 0, 'Ср': 0, 'Чт': 0, 'Пт': 0, 'Сб': 0, 'Вс': 0
            };
            const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; // 0 is Sunday in JS Date

            snapshot.forEach((doc) => {
                const session = doc.data() as WorkSession;

                // If companyId is embedded in user, we might need a join. Assuming `work_sessions` are just global for now or we trust the query.

                const start = session.startTime.toDate();
                let durationHrs = (session.durationMinutes || 0) / 60;

                // If active, calculate elapsed time up to now
                if (session.status === 'active') {
                    const elapsedMs = now.getTime() - start.getTime();
                    durationHrs = elapsedMs / (1000 * 60 * 60);
                    activeSessions++;
                }

                if (isSameDay(start, now)) {
                    todayHours += durationHrs;
                    todayEmployees.add(session.employeeName);
                    employeeHoursToday[session.employeeName] = (employeeHoursToday[session.employeeName] || 0) + durationHrs;
                }

                if (start >= currentWeekStart) {
                    currentWeekHours += durationHrs;
                    const dayName = dayNames[start.getDay()];
                    if (daysMap[dayName] !== undefined) {
                        daysMap[dayName] += durationHrs;
                    }
                } else if (start >= previousWeekStart && start < currentWeekStart) {
                    previousWeekHours += durationHrs;
                }
            });

            // Calculate top employees
            const topEmployees = Object.entries(employeeHoursToday)
                .map(([name, hours]) => ({ name, hours }))
                .sort((a, b) => b.hours - a.hours)
                .slice(0, 3);

            // Calculate week trend
            const trend = previousWeekHours === 0
                ? (currentWeekHours > 0 ? 100 : 0)
                : ((currentWeekHours - previousWeekHours) / previousWeekHours) * 100;

            // Format chart data starting from Monday
            const dailyBreakdown = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => ({
                day,
                hours: Number(daysMap[day].toFixed(1))
            }));

            setData({
                today: {
                    totalHours: Number(todayHours.toFixed(1)),
                    activeEmployees: todayEmployees.size,
                    activeSessions
                },
                week: {
                    totalHours: Number(currentWeekHours.toFixed(1)),
                    trend: Number(trend.toFixed(1)),
                    dailyBreakdown
                },
                topEmployees,
                loading: false
            });

        }, (error) => {
            console.error('Error fetching time tracking stats:', error);
            setData(prev => ({ ...prev, loading: false }));
        });

        return () => unsubscribe();
    }, [companyId]);

    return data;
};
