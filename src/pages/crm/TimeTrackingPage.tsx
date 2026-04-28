import React, { useEffect, useState, useMemo, useRef } from 'react';
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
import { useAuth } from '../../auth/AuthContext';
import toast from 'react-hot-toast';

// Extracted Components
import {
    TimeTrackingFilters,
    TimeTrackingSummary,
    TimeTrackingCharts,
    TimeTrackingTable,
    TimeTrackingAnalytics,
} from '../../components/time-tracking';

// Dialogs
import LocationMap from '../../components/crm/LocationMap';
import EditSessionDialog from '../../components/crm/EditSessionDialog';
import CreateSessionDialog from '../../components/crm/CreateSessionDialog';
import EmployeeDetailsDialog from '../../components/crm/EmployeeDetailsDialog';
import AdminStopSessionDialog from '../../components/time-tracking/AdminStopSessionDialog';
import AdminStartSessionDialog from '../../components/time-tracking/AdminStartSessionDialog';
import { BotLogsViewer } from '../../components/crm/BotLogsViewer';

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
    const [filterEmployeeId, setFilterEmployeeId] = useState('');
    const [filterClient, setFilterClient] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');

    // View Mode
    const [viewMode, setViewMode] = useState<'list' | 'map'>('list');

    // Dialogs
    const [selectedEmployee, setSelectedEmployee] = useState<{ id: string, name: string } | null>(null);
    const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
    const [editSession, setEditSession] = useState<WorkSession | null>(null);
    const [adminStopSession, setAdminStopSession] = useState<WorkSession | null>(null);
    const [adminStartSession, setAdminStartSession] = useState<WorkSession | null>(null);
    const [botLogsWorker, setBotLogsWorker] = useState<{ id: string, name: string } | null>(null);

    // Auth
    const { currentUser, userProfile } = useAuth();
    const isAdmin = userProfile?.role === 'admin';
    // PR #95 companion: tightened rules require `companyId` on every
    // work_sessions write (create + update). Surface the field once here
    // so the handlers below can guard + include it consistently.
    const companyId = userProfile?.companyId;

    // Refresh trigger
    const [refreshKey, setRefreshKey] = useState(0);

    // Employee identity normalization maps
    const telegramIdToUidRef = useRef<Map<string, string>>(new Map());
    const uidToNameRef = useRef<Map<string, string>>(new Map());

    // --- Handlers ---

    const handleEditSession = async (sessionId: string, updates: Partial<WorkSession>) => {
        if (!companyId) {
            alert("Cannot save: missing company. Please re-login.");
            return;
        }
        try {
            // PR #95 companion: include companyId so legacy docs missing the
            // field self-heal on next edit + tightened rule passes.
            await updateDoc(doc(db, 'work_sessions', sessionId), { ...updates, companyId });
            setRefreshKey(prev => prev + 1);
            setEditSession(null);
        } catch (error) {
            console.error("Error saving session edit:", error);
            alert("Failed to save changes");
        }
    };

    const handleVoidSession = async (session: WorkSession) => {
        if (!window.confirm("ARE YOU SURE you want to DELETE/VOID this session?\n\nThis will create a negative correction entry. The action is irreversible.")) {
            return;
        }
        if (!companyId) {
            alert("Cannot void: missing company. Please re-login.");
            return;
        }

        try {
            // PR #95 companion: companyId required by tightened work_sessions rules.
            const voidCorrection: Partial<WorkSession> = {
                employeeId: session.employeeId,
                employeeName: session.employeeName,
                clientId: session.clientId,
                clientName: session.clientName,
                companyId,
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
                voidReason: 'Manual void by admin',
                companyId // self-heal legacy docs missing the field
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
        if (!companyId) {
            alert("Cannot stop sessions: missing company. Please re-login.");
            return;
        }

        const activeSessions = sessions.filter(s => s.status === 'active');
        const now = Timestamp.now();

        for (const session of activeSessions) {
            const durMs = now.toMillis() - session.startTime.toMillis();
            const durationMinutes = Math.round(durMs / 60000);
            await updateDoc(doc(db, 'work_sessions', session.id), {
                status: 'auto_closed',
                endTime: now,
                durationMinutes,
                companyId // PR #95 companion: heal legacy docs + satisfy tightened update rule
            });
        }

        setRefreshKey(prev => prev + 1);
        alert(`Stopped ${activeSessions.length} sessions.`);
    };

    // Admin: Stop a specific session
    const handleAdminStopSession = async (session: WorkSession, reason: string, endTime: Date) => {
        if (!companyId) {
            toast.error('Cannot stop session: missing company. Please re-login.');
            return;
        }
        try {
            const endTs = Timestamp.fromDate(endTime);
            const startTime = session.startTime;
            const durMs = endTs.toMillis() - startTime.toMillis();
            const durationMinutes = Math.max(0, Math.round(durMs / 60000));

            const rate = session.hourlyRate || 0;
            const sessionEarnings = parseFloat(((durationMinutes / 60) * rate).toFixed(2));

            await updateDoc(doc(db, 'work_sessions', session.id), {
                status: 'completed',
                endTime: endTs,
                durationMinutes,
                sessionEarnings,
                stoppedByAdmin: true,
                adminStopReason: reason,
                adminStopperId: currentUser?.uid,
                companyId // PR #95 companion: heal legacy docs + satisfy tightened update rule
            });

            toast.success(`Сессия остановлена: ${session.employeeName}`, { icon: '⏹️' });
            setRefreshKey(prev => prev + 1);
            setAdminStopSession(null);
        } catch (error) {
            console.error('Error stopping session:', error);
            toast.error('Ошибка остановки сессии');
        }
    };

    // Admin: Start a session for employee
    const handleAdminStartSession = async (
        employeeId: string | number,
        employeeName: string,
        clientId: string,
        clientName: string,
        reason: string,
        startTime: Date
    ) => {
        if (!companyId) {
            toast.error('Cannot start session: missing company. Please re-login.');
            return;
        }
        try {
            // Get employee hourly rate from users collection by odooId
            let hourlyRate = 0;
            const usersQuery = query(
                collection(db, 'users'),
                where('odooId', '==', employeeId)
            );
            const userSnapshot = await getDocs(usersQuery);
            if (!userSnapshot.empty) {
                hourlyRate = userSnapshot.docs[0].data().hourlyRate || 0;
            }

            await addDoc(collection(db, 'work_sessions'), {
                employeeId,
                employeeName,
                clientId,
                clientName,
                companyId, // PR #95 companion: required by tightened rules
                startTime: Timestamp.fromDate(startTime),
                status: 'active',
                hourlyRate,
                startedByAdmin: true,
                adminStartReason: reason,
                adminStarterId: currentUser?.uid
            });

            toast.success(`Сессия запущена: ${employeeName}`, { icon: '▶️' });
            setRefreshKey(prev => prev + 1);
            setAdminStartSession(null);
        } catch (error) {
            console.error('Error starting session:', error);
            toast.error('Ошибка запуска сессии');
        }
    };

    // --- Data Fetching ---

    useEffect(() => {
        const fetchSessions = async () => {
            setLoading(true);
            try {
                // First, build employee identity mapping if not yet built
                if (telegramIdToUidRef.current.size === 0) {
                    try {
                        const usersSnap = await getDocs(collection(db, 'users'));
                        const tgMap = new Map<string, string>();
                        const nameMap = new Map<string, string>();
                        usersSnap.docs.forEach(d => {
                            const data = d.data();
                            const name = data.displayName || data.name || 'Unknown';
                            nameMap.set(d.id, name);
                            if (data.telegramId) {
                                tgMap.set(String(data.telegramId), d.id);
                            }
                        });
                        telegramIdToUidRef.current = tgMap;
                        uidToNameRef.current = nameMap;
                    } catch (e) {
                        console.error('Error fetching users for normalization:', e);
                    }
                }

                const startTs = Timestamp.fromDate(startDate);
                const endTs = Timestamp.fromDate(endDate);

                const q = query(
                    collection(db, 'work_sessions'),
                    where('startTime', '>=', startTs),
                    where('startTime', '<=', endTs),
                    orderBy('startTime', 'desc')
                );

                const snapshot = await getDocs(q);
                const rawData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as WorkSession[];

                // Normalize employeeId: map Telegram numeric IDs to user UIDs
                const data = rawData.map(session => {
                    const rawId = String(session.employeeId);
                    const mappedUid = telegramIdToUidRef.current.get(rawId);
                    if (mappedUid) {
                        return {
                            ...session,
                            employeeId: mappedUid,
                            employeeName: uidToNameRef.current.get(mappedUid) || session.employeeName
                        };
                    }
                    if (uidToNameRef.current.has(rawId)) {
                        return {
                            ...session,
                            employeeName: uidToNameRef.current.get(rawId) || session.employeeName
                        };
                    }
                    return session;
                });

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

    // Group employees by ID to avoid duplicates from name variations
    const uniqueEmployees = useMemo(() => {
        // First pass: collect by employeeId
        const empMap = new Map<string, string>();
        sessions.forEach(s => {
            if (s.employeeId && s.employeeName) {
                empMap.set(String(s.employeeId), s.employeeName);
            }
        });

        // Second pass: deduplicate by normalized name
        const byNormalizedName = new Map<string, { id: string; name: string }>();
        empMap.forEach((name, id) => {
            const cleanName = name.replace(/[\u200B-\u200D\uFEFF\u3164\s]+/g, ' ').trim();
            const normalizedKey = cleanName.toLowerCase();
            if (!byNormalizedName.has(normalizedKey)) {
                byNormalizedName.set(normalizedKey, { id, name: cleanName });
            }
        });

        return Array.from(byNormalizedName.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [sessions]);

    // Build mapping from canonical employee ID to all associated IDs
    const employeeIdGroups = useMemo(() => {
        const groups = new Map<string, Set<string>>();
        const nameToIds = new Map<string, Set<string>>();
        sessions.forEach(s => {
            if (s.employeeId && s.employeeName) {
                const cleanName = s.employeeName.replace(/[\u200B-\u200D\uFEFF\u3164\s]+/g, ' ').trim().toLowerCase();
                if (!nameToIds.has(cleanName)) nameToIds.set(cleanName, new Set());
                nameToIds.get(cleanName)!.add(String(s.employeeId));
            }
        });
        uniqueEmployees.forEach(emp => {
            const normalizedName = emp.name.toLowerCase();
            const allIds = nameToIds.get(normalizedName) || new Set([emp.id]);
            groups.set(emp.id, allIds);
        });
        return groups;
    }, [sessions, uniqueEmployees]);

    const uniqueClients = useMemo(() =>
        Array.from(new Set(sessions.map(s => s.clientName))).sort(),
        [sessions]
    );

    const filteredSessions = useMemo(() => {
        // Helper to check if session is from today or yesterday (awaiting review)
        const isAwaitingReview = (session: WorkSession): boolean => {
            if (!session.startTime) return false;
            if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') return false;
            if (session.type === 'correction') return false;

            const sessionDate = new Date(session.startTime.seconds * 1000);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            return sessionDate >= yesterday;
        };

        return sessions.filter(s => {
            // Exclude finance-only entries from Time Tracking
            // These are visible only in Finance page
            if (['payment', 'correction', 'manual_adjustment'].includes(s.type || '')) {
                return false;
            }

            // Use employeeIdGroups to match all IDs for a deduped employee
            const matchEmployee = filterEmployeeId
                ? (employeeIdGroups.get(filterEmployeeId)?.has(String(s.employeeId)) ?? String(s.employeeId) === filterEmployeeId)
                : true;
            const matchClient = filterClient ? s.clientName === filterClient : true;

            // Enhanced status filtering
            let matchStatus = true;
            if (filterStatus !== 'all') {
                switch (filterStatus) {
                    case 'awaiting_review':
                        matchStatus = isAwaitingReview(s);
                        break;
                    case 'auto_closed':
                        matchStatus = s.autoClosed === true;
                        break;
                    case 'edited':
                        matchStatus = s.isManuallyEdited === true;
                        break;
                    default:
                        matchStatus = s.status === filterStatus;
                }
            }

            return matchEmployee && matchClient && matchStatus;
        });
    }, [sessions, filterEmployeeId, filterClient, filterStatus, employeeIdGroups]);

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
                filterEmployeeId={filterEmployeeId}
                filterClient={filterClient}
                uniqueEmployees={uniqueEmployees}
                uniqueClients={uniqueClients}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onStatusChange={setFilterStatus}
                onEmployeeIdChange={setFilterEmployeeId}
                onClientChange={setFilterClient}
            />

            {/* Summary Cards */}
            <TimeTrackingSummary
                totalHours={stats.totalHours}
                activeSessions={stats.activeSessions}
                totalBreakMinutes={stats.totalBreakMinutes}
                sessionCount={stats.sessionCount}
            />

            {/* Analytics Section */}
            <TimeTrackingAnalytics
                sessions={filteredSessions}
                startDate={startDate}
                endDate={endDate}
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
                    onEditSession={(session) => setEditSession(session)}
                    onDeleteSession={handleVoidSession}
                    onEmployeeClick={(emp) => setSelectedEmployee(emp)}
                    isAdmin={isAdmin}
                    onAdminStopSession={(session) => setAdminStopSession(session)}
                    onAdminStartSession={(session) => setAdminStartSession(session)}
                    onViewBotLogs={(id, name) => setBotLogsWorker({ id, name })}
                />
            )}

            <EditSessionDialog
                open={!!editSession}
                session={editSession}
                onClose={() => setEditSession(null)}
                onSave={handleEditSession}
                currentUserId={currentUser?.uid}
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

            {/* Admin Dialogs */}
            <AdminStopSessionDialog
                open={!!adminStopSession}
                session={adminStopSession}
                onClose={() => setAdminStopSession(null)}
                onConfirm={handleAdminStopSession}
            />

            <AdminStartSessionDialog
                open={!!adminStartSession}
                preselectedEmployee={adminStartSession ? {
                    id: adminStartSession.employeeId,
                    name: adminStartSession.employeeName
                } : undefined}
                onClose={() => setAdminStartSession(null)}
                onConfirm={handleAdminStartSession}
            />

            <BotLogsViewer
                open={!!botLogsWorker}
                onClose={() => setBotLogsWorker(null)}
                workerId={botLogsWorker?.id || ''}
                workerName={botLogsWorker?.name || ''}
            />
        </Container>
    );
};

export default TimeTrackingPage;
