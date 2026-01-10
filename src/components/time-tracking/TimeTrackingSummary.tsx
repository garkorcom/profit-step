import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import GroupIcon from '@mui/icons-material/Group';
import CoffeeIcon from '@mui/icons-material/Coffee';
import TodayIcon from '@mui/icons-material/Today';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    color: string;
}

/**
 * Individual stat card with icon
 */
const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color }) => (
    <Paper sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box
            sx={{
                width: 56,
                height: 56,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${color}20`,
                color: color
            }}
        >
            {icon}
        </Box>
        <Box>
            <Typography color="text.secondary" variant="body2">{title}</Typography>
            <Typography variant="h5" fontWeight="bold">{value}</Typography>
        </Box>
    </Paper>
);

interface TimeTrackingSummaryProps {
    totalHours: number;
    activeSessions: number;
    totalBreakMinutes: number;
    sessionCount: number;
}

/**
 * Summary cards row showing key metrics
 */
const TimeTrackingSummary: React.FC<TimeTrackingSummaryProps> = ({
    totalHours,
    activeSessions,
    totalBreakMinutes,
    sessionCount
}) => {
    const formatBreakTime = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}h ${m}m`;
    };

    return (
        <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 200 }}>
                <StatCard
                    title="Total Hours"
                    value={totalHours}
                    icon={<AccessTimeIcon />}
                    color="#1976d2"
                />
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
                <StatCard
                    title="Active Employees"
                    value={activeSessions}
                    icon={<GroupIcon />}
                    color="#2e7d32"
                />
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
                <StatCard
                    title="Total Breaks"
                    value={formatBreakTime(totalBreakMinutes)}
                    icon={<CoffeeIcon />}
                    color="#ed6c02"
                />
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
                <StatCard
                    title="Total Sessions"
                    value={sessionCount}
                    icon={<TodayIcon />}
                    color="#9c27b0"
                />
            </Box>
        </Box>
    );
};

export default TimeTrackingSummary;
