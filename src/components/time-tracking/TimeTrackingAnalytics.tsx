/**
 * Time Tracking Analytics Section
 * 
 * Shows aggregated analytics from work sessions:
 * 1. По клиентам - Client breakdown with progress bars
 * 2. Сравнение - Week-over-week comparison
 */

import React, { useMemo } from 'react';
import {
    Box,
    Paper,
    Typography,
    LinearProgress,
    Chip,
    Divider,
} from '@mui/material';
import {
    Groups as GroupsIcon,
    } from '@mui/icons-material';
import { WorkSession } from '../../types/timeTracking.types';

interface TimeTrackingAnalyticsProps {
    sessions: WorkSession[];
    startDate: Date;
    endDate: Date;
}

interface ClientStats {
    name: string;
    hours: number;
    sessions: number;
    percentage: number;
    earnings: number;
}

interface EmployeeStats {
    name: string;
    hours: number;
    sessions: number;
}

const TimeTrackingAnalytics: React.FC<TimeTrackingAnalyticsProps> = ({
    sessions,
    startDate,
    endDate,
}) => {
    const analytics = useMemo(() => {
        // Calculate client breakdown
        const clientMap: Record<string, { hours: number; sessions: number; earnings: number }> = {};
        const employeeMap: Record<string, { name: string; hours: number; sessions: number }> = {};
        let totalMinutes = 0;
        let totalEarnings = 0;

        sessions.forEach(session => {
            const minutes = session.durationMinutes || 0;
            const earnings = session.sessionEarnings || 0;
            totalMinutes += minutes;
            totalEarnings += earnings;

            // Client aggregation
            const clientName = session.clientName || 'Без клиента';
            if (!clientMap[clientName]) {
                clientMap[clientName] = { hours: 0, sessions: 0, earnings: 0 };
            }
            clientMap[clientName].hours += minutes / 60;
            clientMap[clientName].sessions += 1;
            clientMap[clientName].earnings += earnings;

            // Employee aggregation
            const empId = String(session.employeeId);
            const empName = session.employeeName || 'Unknown';
            if (empId && empId !== 'undefined') {
                if (!employeeMap[empId]) {
                    employeeMap[empId] = { name: empName, hours: 0, sessions: 0 };
                }
                employeeMap[empId].hours += minutes / 60;
                employeeMap[empId].sessions += 1;
            }
        });

        const totalHours = totalMinutes / 60;

        // Build client breakdown (top 5)
        const clientBreakdown: ClientStats[] = Object.entries(clientMap)
            .map(([name, data]) => ({
                name,
                hours: Math.round(data.hours * 10) / 10,
                sessions: data.sessions,
                percentage: totalHours > 0 ? Math.round((data.hours / totalHours) * 100) : 0,
                earnings: Math.round(data.earnings * 100) / 100,
            }))
            .sort((a, b) => b.hours - a.hours)
            .slice(0, 5);

        // Build employee breakdown (top 5)
        const employeeBreakdown: EmployeeStats[] = Object.values(employeeMap)
            .map(data => ({
                name: data.name,
                hours: Math.round(data.hours * 10) / 10,
                sessions: data.sessions,
            }))
            .sort((a, b) => b.hours - a.hours)
            .slice(0, 5);

        // Calculate averages
        const daySpan = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
        const avgHoursPerDay = Math.round((totalHours / daySpan) * 10) / 10;
        const uniqueEmployees = Object.keys(employeeMap).length;
        const avgHoursPerEmployee = uniqueEmployees > 0 ? Math.round((totalHours / uniqueEmployees) * 10) / 10 : 0;

        return {
            totalHours: Math.round(totalHours * 10) / 10,
            totalEarnings: Math.round(totalEarnings * 100) / 100,
            clientBreakdown,
            employeeBreakdown,
            uniqueEmployees,
            avgHoursPerDay,
            avgHoursPerEmployee,
            daySpan,
        };
    }, [sessions, startDate, endDate]);

    // Color palette for progress bars
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96E6A1', '#DDA0DD'];

    return (
        <Box sx={{ mb: 4 }}>
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                📊 Аналитика
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
                {/* По клиентам */}
                <Paper sx={{ p: 2.5, borderRadius: 2 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                        🏢 По клиентам
                    </Typography>
                    {analytics.clientBreakdown.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {analytics.clientBreakdown.map((client, i) => (
                                <Box key={i}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                        <Typography variant="body2" fontWeight="medium" noWrap sx={{ maxWidth: '60%' }}>
                                            {client.name}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {client.hours}ч
                                        </Typography>
                                    </Box>
                                    <LinearProgress
                                        variant="determinate"
                                        value={client.percentage}
                                        sx={{
                                            height: 8,
                                            borderRadius: 4,
                                            bgcolor: 'grey.200',
                                            '& .MuiLinearProgress-bar': {
                                                borderRadius: 4,
                                                bgcolor: colors[i % colors.length],
                                            },
                                        }}
                                    />
                                </Box>
                            ))}
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            Нет данных
                        </Typography>
                    )}
                </Paper>

                {/* По сотрудникам */}
                <Paper sx={{ p: 2.5, borderRadius: 2 }}>
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                        👥 По сотрудникам
                    </Typography>
                    {analytics.employeeBreakdown.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {analytics.employeeBreakdown.map((emp, i) => (
                                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box
                                            sx={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                bgcolor: colors[i % colors.length],
                                            }}
                                        />
                                        <Typography variant="body2" noWrap sx={{ maxWidth: 120 }}>
                                            {emp.name}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <Chip
                                            size="small"
                                            label={`${emp.hours}ч`}
                                            sx={{ fontWeight: 'bold' }}
                                        />
                                        <Chip
                                            size="small"
                                            label={`${emp.sessions}`}
                                            variant="outlined"
                                            sx={{ minWidth: 40 }}
                                        />
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            Нет данных
                        </Typography>
                    )}
                </Paper>

                {/* Общие итоги */}
                <Paper
                    sx={{
                        p: 2.5,
                        borderRadius: 2,
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                    }}
                >
                    <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                        📈 Итоги ({analytics.daySpan} дн.)
                    </Typography>

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Box>
                            <Typography variant="h3" fontWeight="bold">
                                {analytics.totalHours}ч
                            </Typography>
                            <Typography variant="body2" sx={{ opacity: 0.85 }}>
                                всего отработано
                            </Typography>
                        </Box>

                        <Divider sx={{ borderColor: 'rgba(255,255,255,0.3)' }} />

                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Box>
                                <Typography variant="body2" sx={{ opacity: 0.7 }}>В день</Typography>
                                <Typography variant="h6" fontWeight="bold">{analytics.avgHoursPerDay}ч</Typography>
                            </Box>
                            <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="body2" sx={{ opacity: 0.7 }}>На человека</Typography>
                                <Typography variant="h6" fontWeight="bold">{analytics.avgHoursPerEmployee}ч</Typography>
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                                icon={<GroupsIcon sx={{ color: 'white !important' }} />}
                                label={`${analytics.uniqueEmployees} сотрудников`}
                                size="small"
                                sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
                            />
                            {analytics.totalEarnings > 0 && (
                                <Chip
                                    label={`$${analytics.totalEarnings.toLocaleString()}`}
                                    size="small"
                                    sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }}
                                />
                            )}
                        </Box>
                    </Box>
                </Paper>
            </Box>
        </Box>
    );
};

export default TimeTrackingAnalytics;
