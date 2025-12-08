import { Task } from '../types/fsm.types';
import { TimeLog } from '../types/fsm.types';

/**
 * Calculates Gross Margin and Margin Percentage for a list of tasks.
 */
export const calculateGrossMargin = (tasks: Task[]) => {
    let totalSales = 0;
    let totalCost = 0;

    tasks.forEach(task => {
        totalSales += task.salesPrice || 0;
        totalCost += task.totalCost || 0;
    });

    const grossMargin = totalSales - totalCost;
    const marginPercent = totalSales > 0 ? (grossMargin / totalSales) * 100 : 0;

    return {
        totalSales,
        totalCost,
        grossMargin,
        marginPercent
    };
};

/**
 * Aggregates user hours from a list of time logs.
 * Useful for quick client-side daily/weekly summaries.
 */
export const aggregateUserHours = (logs: TimeLog[]) => {
    const userStats: Record<string, { workMinutes: number; travelMinutes: number }> = {};

    logs.forEach(log => {
        if (!log.durationMinutes) return;

        if (!userStats[log.userId]) {
            userStats[log.userId] = { workMinutes: 0, travelMinutes: 0 };
        }

        if (log.type === 'work') {
            userStats[log.userId].workMinutes += log.durationMinutes;
        } else {
            userStats[log.userId].travelMinutes += log.durationMinutes;
        }
    });

    return userStats;
};

/**
 * Formats currency
 */
export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
};

/**
 * Formats duration in HH:mm
 */
export const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
};
