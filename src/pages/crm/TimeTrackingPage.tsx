import React, { useEffect, useState, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Button, Tabs, Tab,
    CircularProgress
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import AddIcon from '@mui/icons-material/Add';
import ListIcon from '@mui/icons-material/ViewList';
import MapIcon from '@mui/icons-material/Map';

import { subDays, startOfDay, endOfDay, eachDayOfInterval, format } from 'date-fns';
import { collection, query, where, getDocs, orderBy, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { WorkSession } from '../../types/timeTracking.types';

// Extracted Components
import {
    TimeTrackingFilters,
    TimeTrackingSummary,
    TimeTrackingCharts,
    TimeTrackingTable
} from '../../components/time-tracking';

// Dialogs
import LocationMap from '../../components/crm/LocationMap';
import CorrectionSessionDialog from '../../components/crm/CorrectionSessionDialog';
import CreateSessionDialog from '../../components/crm/CreateSessionDialog';
import EmployeeDetailsDialog from '../../components/crm/EmployeeDetailsDialog';

/**
 * Time Tracking Page
 * 
 * Displays work sessions with filtering, statistics, charts, and data table.
 * Supports List and Map views.
 */
const TimeTrackingPage: React.FC = () => {
    // --- State ---
    const [sessions, setSessions] = useState<WorkSession[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [startDate, setStartDate] = useState<Date>(subDays(startOfDay(new Date()), 6));
    const [endDate, setEndDate] = useState<Date>(endOfDay(new Date()));
    const [filterEmployee, setFilterEmployee] = useState('');
    const [filterClient, setFilterClient] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');

    // View Mode
    const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

    // Dialogs
    const [selectedEmployee, setSelectedEmployee] = useState<{ id: string, name: string } | null>(null);
    const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
    const [correctionSession, setCorrectionSession] = useState<WorkSession | null>(null);

    // Refresh trigger
    const [refreshKey, setRefreshKey] = useState(0);

    // --- Handlers ---

    const handleCorrection = async (correction: Partial<WorkSession>) => {
        try {
            await addDoc(collection(db, 'work_sessions'), correction);
            setRefreshKey(prev => prev + 1);
            alert("Correction saved successfully as a new ledger entry.");
        } catch (error) {
            console.error("Error saving correction:", error);
            alert("Failed to save correction");
        }
    };

    const handleVoidSession = async (session: WorkSession) => {
        if (!window.confirm("ARE YOU SURE you want to DELETE/VOID this session?\n\nThis will create a negative correction entry. The action is irreversible.")) {
            return;
        }

        try {
            const voidCorrection: Partial<WorkSession> = {
                employeeId: session.employeeId,
                employeeName: session.employeeName,
                clientId: session.clientId,
                clientName: session.clientName,
                startTime: Timestamp.now(),
                endTime: Timestamp.now(),
                durationMinutes: -(session.durationMinutes || 0),
                sessionEarnings: -(session.sessionEarnings || 0),
                hourlyRate: session.hourlyRate,
                status: 'completed',
                type: 'correction',
                relatedSessionId: session.id,
                correctionNote: `Void of session from ${session.startTime?.toDate().toLocaleDateString()}`,
                description: `VOID: ${session.description || 'No description'}`
            };
            await addDoc(collection(db, 'work_sessions'), voidCorrection);

            await updateDoc(doc(db, 'work_sessions', session.id), {
                isVoided: true,
                voidReason: 'Manual void by admin'
            });

            setRefreshKey(prev => prev + 1);
            alert("Session voided successfully.");
        } catch (error) {
            console.error("Error voiding session:", error);
            alert("Failed to void session");
        }
    };

    const handleExportCSV = () => {
        const headers = ['Date', 'Employee', 'Client', 'Start', 'End', 'Duration (min)', 'Description', 'Status', 'Type'];
        const rows = sessions.map(s => [
            s.startTime ? new Date(s.startTime.seconds * 1000).toLocaleDateString() : '',
            s.employeeName,
            s.clientName,
            s.startTime ? new Date(s.startTime.seconds * 1000).toLocaleTimeString() : '',
            s.endTime ? new Date(s.endTime.seconds * 1000).toLocaleTimeString() : '',
            s.durationMinutes || '',
            s.description || '',
            s.status,
            s.type || 'regular'
        ]);

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `time_tracking_${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
    };

    const handleForceStopAll = async () => {
        if (!window.confirm("Are you sure you want to stop ALL active sessions? This is an admin action.")) return;

        const activeSessions = sessions.filter(s => s.status === 'active');
        const now = Timestamp.now();

        for (const session of activeSessions) {
            const durMs = now.toMillis() - session.startTime.toMillis();
            const durationMinutes = Math.round(durMs / 60000);
            await updateDoc(doc(db, 'work_sessions', session.id), {
                status: 'auto_closed',
                endTime: now,
                durationMinutes
            });
        }

        setRefreshKey(prev => prev + 1);
        alert(`Stopped ${activeSessions.length} sessions.`);
    };

    // --- Data Fetching ---

    useEffect(() => {
        const fetchSessions = async () => {
            setLoading(true);
            try {
                const startTs = Timestamp.fromDate(startDate);
                const endTs = Timestamp.fromDate(endDate);

                const q = query(
                    collection(db, 'work_sessions'),
                    where('startTime', '>=', startTs),
                    where('startTime', '<=', endTs),
                    orderBy('startTime', 'desc')
                );

                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as WorkSession[];

                setSessions(data);
            } catch (error) {
                console.error('Error fetching work sessions:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchSessions();
    }, [startDate, endDate, refreshKey]);

    // --- Computed Values ---

    const uniqueEmployees = useMemo(() =>
        Array.from(new Set(sessions.map(s => s.employeeName))).sort(),
        [sessions]
    );

    const uniqueClients = useMemo(() =>
        Array.from(new Set(sessions.map(s => s.clientName))).sort(),
        [sessions]
    );

    const filteredSessions = useMemo(() => {
        return sessions.filter(s => {
            const matchEmployee = filterEmployee ? s.employeeName === filterEmployee : true;
            const matchClient = filterClient ? s.clientName === filterClient : true;
            const matchStatus = filterStatus !== 'all' ? s.status === filterStatus : true;
            return matchEmployee && matchClient && matchStatus;
        });
    }, [sessions, filterEmployee, filterClient, filterStatus]);

    const stats = useMemo(() => {
        let totalMinutes = 0;
        let activeSessionsCount = 0;
        let totalBreakMinutes = 0;
        const clientDuration: Record<string, number> = {};
        const dailyMinutes: Record<string, number> = {};

        filteredSessions.forEach(session => {
            if (session.durationMinutes) {
                totalMinutes += session.durationMinutes;

                const client = session.clientName || 'Unknown';
                clientDuration[client] = (clientDuration[client] || 0) + session.durationMinutes;

                const timeRef = session.endTime || session.startTime;
                if (timeRef) {
                    const dateKey = new Date(timeRef.seconds * 1000).toLocaleDateString();
                    dailyMinutes[dateKey] = (dailyMinutes[dateKey] || 0) + session.durationMinutes;
                }
            }

            if (session.status === 'active' && session.type !== 'correction') {
                activeSessionsCount++;
            }

            if (session.totalBreakMinutes) {
                totalBreakMinutes += session.totalBreakMinutes;
            }
        });

        const clientDistribution = Object.keys(clientDuration).map(key => ({
            name: key,
            value: clientDuration[key]
        }));

        const interval = eachDayOfInterval({ start: startDate, end: endDate });
        const dailyActivity = interval.map(date => {
            const key = date.toLocaleDateString();
            return {
                date: format(date, 'MMM dd'),
                hours: parseFloat(((dailyMinutes[key] || 0) / 60).toFixed(1))
            };
        });

        return {
            totalHours: Number((totalMinutes / 60).toFixed(1)),
            activeSessions: activeSessionsCount,
            totalBreakMinutes,
            sessionCount: filteredSessions.length,
            dailyActivity,
            clientDistribution
        };
    }, [filteredSessions, startDate, endDate]);

    // --- Render ---

    if (loading && sessions.length === 0) {
        return (
            <Container maxWidth="xl" sx={{ mt: 4 }}>
                <Box display="flex" justifyContent="center">
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h4" fontWeight="bold">Time Tracking</Typography>
                <Box display="flex" gap={2}>
                    <Button startIcon={<AddIcon />} variant="contained" color="success" onClick={() => setIsCreateSessionOpen(true)}>
                        Add Session
                    </Button>
                    <Button startIcon={<DownloadIcon />} variant="outlined" onClick={handleExportCSV} disabled={sessions.length === 0}>
                        Export CSV
                    </Button>
                    <Button startIcon={<StopCircleIcon />} variant="contained" color="warning" onClick={handleForceStopAll}>
                        Stop All
                    </Button>
                    <Paper>
                        <Tabs value={viewMode} onChange={(e, v) => setViewMode(v as 'list' | 'map')} sx={{ minHeight: 48 }}>
                            <Tab icon={<ListIcon />} iconPosition="start" label="List" value="list" sx={{ minHeight: 48 }} />
                            <Tab icon={<MapIcon />} iconPosition="start" label="Map" value="map" sx={{ minHeight: 48 }} />
                        </Tabs>
                    </Paper>
                </Box>
            </Box>

            {/* Filters */}
            <TimeTrackingFilters
                startDate={startDate}
                endDate={endDate}
                filterStatus={filterStatus}
                filterEmployee={filterEmployee}
                filterClient={filterClient}
                uniqueEmployees={uniqueEmployees}
                uniqueClients={uniqueClients}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onStatusChange={setFilterStatus}
                onEmployeeChange={setFilterEmployee}
                onClientChange={setFilterClient}
            />

            {/* Summary Cards */}
            <TimeTrackingSummary
                totalHours={stats.totalHours}
                activeSessions={stats.activeSessions}
                totalBreakMinutes={stats.totalBreakMinutes}
                sessionCount={stats.sessionCount}
            />

            {/* Charts (List Mode Only) */}
            {viewMode === 'list' && (
                <TimeTrackingCharts
                    dailyActivity={stats.dailyActivity}
                    clientDistribution={stats.clientDistribution}
                />
            )}

            {/* Map Mode */}
            {viewMode === 'map' && (
                <LocationMap sessions={filteredSessions} />
            )}

            {/* Table (List Mode Only) */}
            {viewMode === 'list' && (
                <TimeTrackingTable
                    sessions={filteredSessions}
                    onEditSession={(session) => setCorrectionSession(session)}
                    onDeleteSession={handleVoidSession}
                    onEmployeeClick={(emp) => setSelectedEmployee(emp)}
                />
            )}

            {/* Dialogs */}
            <CorrectionSessionDialog
                open={!!correctionSession}
                session={correctionSession}
                onClose={() => setCorrectionSession(null)}
                onSave={handleCorrection}
            />

            <CreateSessionDialog
                open={isCreateSessionOpen}
                onClose={() => setIsCreateSessionOpen(false)}
                onSessionCreated={() => setRefreshKey(prev => prev + 1)}
            />

            <EmployeeDetailsDialog
                open={!!selectedEmployee}
                onClose={() => setSelectedEmployee(null)}
                employeeId={selectedEmployee?.id || ''}
                employeeName={selectedEmployee?.name || ''}
            />
        </Container>
    );
};

export default TimeTrackingPage;
