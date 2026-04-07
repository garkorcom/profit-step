/**
 * AI Reports Section for Dashboard
 * 
 * Shows 5 cards:
 * 1. Моя неделя - Personal work summary
 * 2. План на сегодня - AI-generated day plan
 * 3. Фирма - Company-wide stats
 * 4. По клиентам - Client breakdown
 * 5. Время - Active session / Today's time
 */

import React, { useEffect, useState } from 'react';
import {
    Box,
    Paper,
    Typography,
    Chip,
    Skeleton,
    LinearProgress,
} from '@mui/material';
import {
    Summarize as SummaryIcon,
    EventNote as PlanIcon,
    AccessTime as TimeIcon,
    Business as CompanyIcon,
    People as PeopleIcon,
} from '@mui/icons-material';
import { collection, query, where, getDocs, Timestamp, limit } from 'firebase/firestore';
import { db, functions } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { httpsCallable } from 'firebase/functions';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

interface WeekSummary {
    totalHours: number;
    sessionsCount: number;
    topClient: string | null;
    trend: 'up' | 'down' | 'same';
}

interface CompanySummary {
    totalHours: number;
    sessionsCount: number;
    employeesActive: number;
    topEmployee: string | null;
}

interface ClientBreakdown {
    name: string;
    hours: number;
    sessions: number;
    percentage: number;
}

interface DayPlan {
    greeting: string;
    slots: { startTime: string; endTime: string; title: string; priority: string }[];
    aiTip?: string;
}

interface TodayTime {
    activeSession: boolean;
    sessionClient?: string;
    sessionDuration?: number;
    todayTotal: number;
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const AIReportsSection: React.FC = () => {
    const { userProfile } = useAuth();
    const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
    const [companySummary, setCompanySummary] = useState<CompanySummary | null>(null);
    const [clientBreakdown, setClientBreakdown] = useState<ClientBreakdown[]>([]);
    const [dayPlan, setDayPlan] = useState<DayPlan | null>(null);
    const [todayTime, setTodayTime] = useState<TodayTime | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (userProfile?.id) {
            loadData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile?.id]);

    const loadData = async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadWeekSummary(),
                loadCompanySummary(),
                loadDayPlan(),
                loadTodayTime(),
            ]);
        } catch (error) {
            console.error('Failed to load AI reports:', error);
        } finally {
            setLoading(false);
        }
    };

    // ─────────────────────────────────────────────────────────
    // MY WEEK SUMMARY
    // ─────────────────────────────────────────────────────────
    const loadWeekSummary = async () => {
        if (!userProfile?.id) return;

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        try {
            const sessionsQuery = query(
                collection(db, 'work_sessions'),
                where('platformUserId', '==', userProfile.id),
                where('status', '==', 'completed'),
                where('endTime', '>=', Timestamp.fromDate(weekAgo))
            );

            const snapshot = await getDocs(sessionsQuery);
            let totalMinutes = 0;
            const clientCounts: Record<string, number> = {};

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                totalMinutes += data.totalMinutes || 0;
                if (data.clientName) {
                    clientCounts[data.clientName] = (clientCounts[data.clientName] || 0) + 1;
                }
            });

            const topClient = Object.entries(clientCounts)
                .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

            setWeekSummary({
                totalHours: Math.round(totalMinutes / 60 * 10) / 10,
                sessionsCount: snapshot.size,
                topClient,
                trend: snapshot.size > 5 ? 'up' : snapshot.size < 3 ? 'down' : 'same'
            });
        } catch (error) {
            console.error('Failed to load week summary:', error);
            setWeekSummary({ totalHours: 0, sessionsCount: 0, topClient: null, trend: 'same' });
        }
    };

    // ─────────────────────────────────────────────────────────
    // COMPANY-WIDE SUMMARY
    // ─────────────────────────────────────────────────────────
    const loadCompanySummary = async () => {
        if (!userProfile?.companyId) return;

        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        try {
            // Get all completed sessions for the company
            const sessionsQuery = query(
                collection(db, 'work_sessions'),
                where('companyId', '==', userProfile.companyId),
                where('status', '==', 'completed'),
                where('endTime', '>=', Timestamp.fromDate(weekAgo))
            );

            const snapshot = await getDocs(sessionsQuery);
            let totalMinutes = 0;
            const employeeHours: Record<string, { name: string; minutes: number }> = {};
            const clientHours: Record<string, { hours: number; sessions: number }> = {};

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                const minutes = data.totalMinutes || 0;
                totalMinutes += minutes;

                // Track per employee
                const empId = data.platformUserId || data.employeeId;
                const empName = data.employeeName || data.displayName || 'Unknown';
                if (empId) {
                    if (!employeeHours[empId]) {
                        employeeHours[empId] = { name: empName, minutes: 0 };
                    }
                    employeeHours[empId].minutes += minutes;
                }

                // Track per client
                const clientName = data.clientName || 'Без клиента';
                if (!clientHours[clientName]) {
                    clientHours[clientName] = { hours: 0, sessions: 0 };
                }
                clientHours[clientName].hours += minutes / 60;
                clientHours[clientName].sessions += 1;
            });

            // Find top employee
            const topEmployee = Object.values(employeeHours)
                .sort((a, b) => b.minutes - a.minutes)[0]?.name || null;

            setCompanySummary({
                totalHours: Math.round(totalMinutes / 60 * 10) / 10,
                sessionsCount: snapshot.size,
                employeesActive: Object.keys(employeeHours).length,
                topEmployee
            });

            // Build client breakdown
            const totalHours = totalMinutes / 60;
            const breakdown = Object.entries(clientHours)
                .map(([name, data]) => ({
                    name,
                    hours: Math.round(data.hours * 10) / 10,
                    sessions: data.sessions,
                    percentage: totalHours > 0 ? Math.round((data.hours / totalHours) * 100) : 0
                }))
                .sort((a, b) => b.hours - a.hours)
                .slice(0, 5);

            setClientBreakdown(breakdown);

        } catch (error) {
            console.error('Failed to load company summary:', error);
            setCompanySummary({ totalHours: 0, sessionsCount: 0, employeesActive: 0, topEmployee: null });
            setClientBreakdown([]);
        }
    };

    // ─────────────────────────────────────────────────────────
    // DAY PLAN
    // ─────────────────────────────────────────────────────────
    const loadDayPlan = async () => {
        if (!userProfile?.id) return;

        try {
            const generateDayPlan = httpsCallable(functions, 'generateDayPlan');
            const result = await generateDayPlan({ type: 'day', userId: userProfile.id });
            setDayPlan(result.data as DayPlan);
        } catch (error) {
            console.error('Failed to load day plan:', error);
            setDayPlan({
                greeting: '📋 План на сегодня',
                slots: [],
                aiTip: 'Добавь задачи через /task в боте'
            });
        }
    };

    // ─────────────────────────────────────────────────────────
    // TODAY TIME
    // ─────────────────────────────────────────────────────────
    const loadTodayTime = async () => {
        if (!userProfile?.id) return;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        try {
            const activeQuery = query(
                collection(db, 'work_sessions'),
                where('platformUserId', '==', userProfile.id),
                where('status', '==', 'active'),
                limit(1)
            );

            const activeSnapshot = await getDocs(activeQuery);
            let activeSession = false;
            let sessionClient = '';
            let sessionDuration = 0;

            if (!activeSnapshot.empty) {
                const data = activeSnapshot.docs[0].data();
                activeSession = true;
                sessionClient = data.clientName || 'Работа';
                if (data.startTime) {
                    sessionDuration = Math.round((Date.now() - data.startTime.toDate().getTime()) / 60000);
                }
            }

            const todayQuery = query(
                collection(db, 'work_sessions'),
                where('platformUserId', '==', userProfile.id),
                where('status', '==', 'completed'),
                where('startTime', '>=', Timestamp.fromDate(todayStart))
            );

            const todaySnapshot = await getDocs(todayQuery);
            let todayTotal = 0;
            todaySnapshot.docs.forEach(doc => {
                todayTotal += doc.data().totalMinutes || 0;
            });

            setTodayTime({
                activeSession,
                sessionClient,
                sessionDuration,
                todayTotal: Math.round(todayTotal)
            });
        } catch (error) {
            console.error('Failed to load today time:', error);
            setTodayTime({ activeSession: false, todayTotal: 0 });
        }
    };

    // ─────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────
    const formatDuration = (minutes: number): string => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h}ч ${m}м` : `${m}м`;
    };

    // ─────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────
    return (
        <Box sx={{ mb: 4 }}>
            {/* ═══ ROW 1: Personal Stats ═══ */}
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                👤 Мои отчёты
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 4 }}>
                {/* Моя неделя */}
                <Paper sx={{ p: 2.5, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                        <SummaryIcon />
                        <Typography variant="subtitle1" fontWeight="bold">Моя неделя</Typography>
                    </Box>
                    {loading ? (
                        <Skeleton variant="rectangular" height={60} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                    ) : weekSummary && (
                        <>
                            <Typography variant="h3" fontWeight="bold">{weekSummary.totalHours}ч</Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                <Chip size="small" label={`${weekSummary.sessionsCount} сессий`} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />
                                {weekSummary.topClient && <Chip size="small" label={weekSummary.topClient} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />}
                            </Box>
                        </>
                    )}
                </Paper>

                {/* План на сегодня */}
                <Paper sx={{ p: 2.5, background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', color: 'white', borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                        <PlanIcon />
                        <Typography variant="subtitle1" fontWeight="bold">План на сегодня</Typography>
                    </Box>
                    {loading ? (
                        <Skeleton variant="rectangular" height={60} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                    ) : dayPlan && (
                        <>
                            {dayPlan.slots.length > 0 ? (
                                <>
                                    <Typography variant="h3" fontWeight="bold">{dayPlan.slots.length}</Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.9 }}>задач запланировано</Typography>
                                </>
                            ) : (
                                <>
                                    <Typography variant="h4" sx={{ opacity: 0.8 }}>📭</Typography>
                                    <Typography variant="body2">{dayPlan.aiTip || 'Нет задач'}</Typography>
                                </>
                            )}
                        </>
                    )}
                </Paper>

                {/* Время сегодня */}
                <Paper sx={{ p: 2.5, background: todayTime?.activeSession ? 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' : 'linear-gradient(135deg, #373B44 0%, #4286f4 100%)', color: 'white', borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                        <TimeIcon />
                        <Typography variant="subtitle1" fontWeight="bold">{todayTime?.activeSession ? 'Активная сессия' : 'Время сегодня'}</Typography>
                    </Box>
                    {loading ? (
                        <Skeleton variant="rectangular" height={60} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                    ) : todayTime && (
                        <>
                            {todayTime.activeSession ? (
                                <>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 12, height: 12, bgcolor: '#4ade80', borderRadius: '50%', animation: 'pulse 2s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.5 }, '100%': { opacity: 1 } } }} />
                                        <Typography variant="h4" fontWeight="bold">{formatDuration(todayTime.sessionDuration || 0)}</Typography>
                                    </Box>
                                    <Typography variant="body2" sx={{ opacity: 0.9 }}>📍 {todayTime.sessionClient}</Typography>
                                </>
                            ) : (
                                <>
                                    <Typography variant="h3" fontWeight="bold">{formatDuration(todayTime.todayTotal)}</Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.9 }}>отработано сегодня</Typography>
                                </>
                            )}
                        </>
                    )}
                </Paper>
            </Box>

            {/* ═══ ROW 2: Company Stats ═══ */}
            <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                🏢 Фирма (неделя)
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' }, gap: 2 }}>
                {/* Company Total */}
                <Paper sx={{ p: 2.5, background: 'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)', color: 'white', borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                        <CompanyIcon />
                        <Typography variant="subtitle1" fontWeight="bold">Все сотрудники</Typography>
                    </Box>
                    {loading ? (
                        <Skeleton variant="rectangular" height={80} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
                    ) : companySummary && (
                        <>
                            <Typography variant="h3" fontWeight="bold">{companySummary.totalHours}ч</Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                <Chip size="small" icon={<PeopleIcon sx={{ color: 'white !important' }} />} label={`${companySummary.employeesActive} сотрудников`} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />
                                <Chip size="small" label={`${companySummary.sessionsCount} сессий`} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white' }} />
                            </Box>
                            {companySummary.topEmployee && (
                                <Typography variant="caption" sx={{ opacity: 0.85, mt: 1, display: 'block' }}>
                                    ⭐ Топ: {companySummary.topEmployee}
                                </Typography>
                            )}
                        </>
                    )}
                </Paper>

                {/* Client Breakdown */}
                <Paper sx={{ p: 2.5, borderRadius: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
                        <Typography variant="subtitle1" fontWeight="bold">📊 По клиентам</Typography>
                    </Box>
                    {loading ? (
                        <Skeleton variant="rectangular" height={120} />
                    ) : clientBreakdown.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {clientBreakdown.map((client, i) => (
                                <Box key={i}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                        <Typography variant="body2" fontWeight="medium">
                                            {client.name}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {client.hours}ч ({client.sessions} сессий)
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
                                                bgcolor: i === 0 ? '#FF6B6B' : i === 1 ? '#4ECDC4' : '#45B7D1'
                                            }
                                        }}
                                    />
                                </Box>
                            ))}
                        </Box>
                    ) : (
                        <Typography variant="body2" color="text.secondary">
                            Нет данных за эту неделю
                        </Typography>
                    )}
                </Paper>
            </Box>
        </Box>
    );
};

export default AIReportsSection;
