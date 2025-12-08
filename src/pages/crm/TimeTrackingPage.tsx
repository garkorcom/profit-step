import React, { useEffect, useState, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Grid, Card, CardContent, FormControl, InputLabel, Select,
    MenuItem, Avatar, Tooltip, IconButton, Tabs, Tab, Button, Link as MuiLink, TextField
} from '@mui/material';
import { collection, query, orderBy, getDocs, where, Timestamp, doc, updateDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase/firebase'; // Added functions
import { httpsCallable } from 'firebase/functions'; // Added httpsCallable
import { WorkSession } from '../../types/timeTracking.types';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import GroupIcon from '@mui/icons-material/Group';
import TodayIcon from '@mui/icons-material/Today';
import CoffeeIcon from '@mui/icons-material/Coffee';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import MapIcon from '@mui/icons-material/Map';
import ListIcon from '@mui/icons-material/List';
import DownloadIcon from '@mui/icons-material/Download';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import EditIcon from '@mui/icons-material/Edit';
import StopCircleIcon from '@mui/icons-material/StopCircle'; // Added Icon
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell
} from 'recharts';
import { subDays, startOfDay, endOfDay, eachDayOfInterval, format } from 'date-fns';
import LocationMap from '../../components/crm/LocationMap';
import EditSessionDialog from '../../components/crm/EditSessionDialog';

// --- Components ---
const StatCard = ({ title, value, icon, color }: { title: string, value: string | number, icon: React.ReactNode, color: string }) => (
    <Card sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', p: 2, '&:last-child': { pb: 2 } }}>
            <Avatar sx={{ bgcolor: color, mr: 2 }}>{icon}</Avatar>
            <Box>
                <Typography color="textSecondary" variant="body2">{title}</Typography>
                <Typography variant="h5" fontWeight="bold">{value}</Typography>
            </Box>
        </CardContent>
    </Card>
);

const TimeTrackingPage: React.FC = () => {
    const [sessions, setSessions] = useState<WorkSession[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [startDate, setStartDate] = useState<Date>(subDays(startOfDay(new Date()), 6));
    const [endDate, setEndDate] = useState<Date>(endOfDay(new Date()));
    const [filterEmployee, setFilterEmployee] = useState('');
    const [filterClient, setFilterClient] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');

    // View
    const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
    const [editingSession, setEditingSession] = useState<WorkSession | null>(null);

    const handleSaveSession = async (sessionId: string, updates: Partial<WorkSession>) => {
        try {
            const sessionRef = doc(db, 'work_sessions', sessionId);
            await updateDoc(sessionRef, updates);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...updates } : s));
        } catch (error) {
            console.error("Error updating session:", error);
            alert("Failed to update session");
        }
    };

    const handleExportCSV = () => {
        // Use filtered sessions for export
        const dataToExport = filteredSessions;
        const headers = ["Date", "Employee", "Client", "Start Time", "End Time", "Duration (m)", "Breaks (m)", "Description", "Status"];
        const csvContent = [
            headers.join(","),
            ...dataToExport.map(s => [
                s.startTime ? new Date(s.startTime.seconds * 1000).toLocaleDateString() : '',
                `"${s.employeeName}"`,
                `"${s.clientName}"`,
                s.startTime ? new Date(s.startTime.seconds * 1000).toLocaleTimeString() : '',
                s.endTime ? new Date(s.endTime.seconds * 1000).toLocaleTimeString() : '',
                s.durationMinutes || 0,
                s.totalBreakMinutes || 0,
                `"${s.description || ''}"`,
                s.status
            ].join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `time_tracking_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleForceStopAll = async () => {
        if (!window.confirm("⚠️ ВНИМАНИЕ: Вы уверены, что хотите принудительно завершить ВСЕ активные сессии всех сотрудников?\n\nЭто действие нельзя отменить.")) {
            return;
        }

        try {
            const forceFinishFn = httpsCallable(functions, 'forceFinishAllSessions');
            const result = await forceFinishFn();
            const data = result.data as any;
            alert(data.message);
            window.location.reload();
        } catch (error: any) {
            console.error("Error stopping sessions:", error);
            alert("Error: " + error.message);
        }
    };

    // --- Data Fetching ---
    useEffect(() => {
        const fetchSessions = async () => {
            setLoading(true);
            try {
                // Ensure dates are valid Firestore timestamps
                const start = startOfDay(startDate);
                const end = endOfDay(endDate);

                const q = query(
                    collection(db, 'work_sessions'),
                    where('startTime', '>=', Timestamp.fromDate(start)),
                    where('startTime', '<=', Timestamp.fromDate(end)),
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
    }, [startDate, endDate]);

    // --- Filtering & Stats ---

    // 1. Get unique values for dropdowns (from loaded data)
    const uniqueEmployees = useMemo(() => Array.from(new Set(sessions.map(s => s.employeeName))).sort(), [sessions]);
    const uniqueClients = useMemo(() => Array.from(new Set(sessions.map(s => s.clientName))).sort(), [sessions]);

    // 2. Filter sessions
    const filteredSessions = useMemo(() => {
        return sessions.filter(s => {
            const matchEmployee = filterEmployee ? s.employeeName === filterEmployee : true;
            const matchClient = filterClient ? s.clientName === filterClient : true;
            const matchStatus = filterStatus !== 'all' ? s.status === filterStatus : true;
            return matchEmployee && matchClient && matchStatus;
        });
    }, [sessions, filterEmployee, filterClient, filterStatus]);

    // 3. Calculate Stats based on FILTERED sessions
    const stats = useMemo(() => {
        let totalMinutes = 0;
        let activeSessionsCount = 0;
        let totalBreakMinutes = 0;
        const clientDuration: Record<string, number> = {};
        const dailyMinutes: Record<string, number> = {};

        filteredSessions.forEach(session => {
            // Total Duration
            if (session.durationMinutes) {
                totalMinutes += session.durationMinutes;

                // Client Distribution
                const client = session.clientName || 'Unknown';
                clientDuration[client] = (clientDuration[client] || 0) + session.durationMinutes;

                // Daily Activity
                if (session.endTime) {
                    const dateKey = new Date(session.endTime.seconds * 1000).toLocaleDateString();
                    dailyMinutes[dateKey] = (dailyMinutes[dateKey] || 0) + session.durationMinutes;
                }
            }

            // Active Count
            if (session.status === 'active') {
                activeSessionsCount++;
            }

            // Total Breaks
            if (session.totalBreakMinutes) {
                totalBreakMinutes += session.totalBreakMinutes;
            }
        });

        // Format for Charts
        const clientDistribution = Object.keys(clientDuration).map(key => ({
            name: key,
            value: clientDuration[key]
        }));

        // Daily Chart - ensure contiguous days within range
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

    // --- Helpers ---
    const formatDuration = (minutes?: number) => {
        if (!minutes) return '-';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}h ${m}m`;
    };

    const formatDate = (timestamp?: Timestamp) => {
        if (!timestamp) return '-';
        return new Date(timestamp.seconds * 1000).toLocaleDateString();
    };

    const formatTime = (timestamp?: Timestamp) => {
        if (!timestamp) return '-';
        return new Date(timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'active': return 'success';
            case 'completed': return 'default';
            case 'paused': return 'warning';
            default: return 'default';
        }
    };

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

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
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h4" fontWeight="bold">Time Tracking</Typography>
                <Box display="flex" gap={2}>
                    <Button
                        startIcon={<DownloadIcon />}
                        variant="outlined"
                        onClick={handleExportCSV}
                        disabled={sessions.length === 0}
                    >
                        Export CSV
                    </Button>
                    {/* Stop All Button */}
                    <Button
                        startIcon={<StopCircleIcon />}
                        variant="contained"
                        color="error"
                        onClick={handleForceStopAll}
                    >
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

            {/* Filters Bar */}
            <Paper sx={{ p: 2, mb: 4 }}>
                <Grid container spacing={2} alignItems="center">
                    <Grid size={{ xs: 12, md: 3 }}>
                        <TextField
                            label="Start Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(startDate, 'yyyy-MM-dd')}
                            onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 3 }}>
                        <TextField
                            label="End Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(endDate, 'yyyy-MM-dd')}
                            onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 2 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Status</InputLabel>
                            <Select
                                value={filterStatus}
                                label="Status"
                                onChange={(e) => setFilterStatus(e.target.value)}
                            >
                                <MenuItem value="all">All Statuses</MenuItem>
                                <MenuItem value="active">Active</MenuItem>
                                <MenuItem value="completed">Completed</MenuItem>
                                <MenuItem value="paused">Paused</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12, md: 2 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Employee</InputLabel>
                            <Select
                                value={filterEmployee}
                                label="Employee"
                                onChange={(e) => setFilterEmployee(e.target.value)}
                                displayEmpty
                            >
                                <MenuItem value="">All Employees</MenuItem>
                                {uniqueEmployees.map(name => (
                                    <MenuItem key={name} value={name}>{name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12, md: 2 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Client / Project</InputLabel>
                            <Select
                                value={filterClient}
                                label="Client / Project"
                                onChange={(e) => setFilterClient(e.target.value)}
                                displayEmpty
                            >
                                <MenuItem value="">All Clients</MenuItem>
                                {uniqueClients.map(name => (
                                    <MenuItem key={name} value={name}>{name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
            </Paper>

            {/* Dashboard Cards */}
            <Grid container spacing={3} mb={4}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="Total Hours"
                        value={stats.totalHours}
                        icon={<AccessTimeIcon />}
                        color="#1976d2"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="Active Employees"
                        value={stats.activeSessions}
                        icon={<GroupIcon />}
                        color="#2e7d32"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="Total Breaks"
                        value={`${Math.floor(stats.totalBreakMinutes / 60)}h ${stats.totalBreakMinutes % 60}m`}
                        icon={<CoffeeIcon />}
                        color="#ed6c02"
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                    <StatCard
                        title="Total Sessions"
                        value={stats.sessionCount}
                        icon={<TodayIcon />}
                        color="#9c27b0"
                    />
                </Grid>
            </Grid>

            {/* Charts (Only in List Mode for now) */}
            {viewMode === 'list' && (
                <Grid container spacing={3} mb={4}>
                    <Grid size={{ xs: 12, md: 8 }}>
                        <Paper sx={{ p: 3, height: 400 }}>
                            <Typography variant="h6" gutterBottom>Daily Activity (Hours)</Typography>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.dailyActivity}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="date" />
                                    <YAxis />
                                    <RechartsTooltip />
                                    <Bar dataKey="hours" fill="#1976d2" radius={[4, 4, 0, 0]} name="Hours Worked" />
                                </BarChart>
                            </ResponsiveContainer>
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, md: 4 }}>
                        <Paper sx={{ p: 3, height: 400 }}>
                            <Typography variant="h6" gutterBottom>Client Distribution</Typography>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={stats.clientDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={100}
                                        fill="#8884d8"
                                        paddingAngle={5}
                                        dataKey="value"
                                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                                    >
                                        {stats.clientDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip />
                                </PieChart>
                            </ResponsiveContainer>
                        </Paper>
                    </Grid>
                </Grid>
            )}

            {/* Map Mode */}
            {viewMode === 'map' && (
                <LocationMap sessions={filteredSessions} />
            )}

            {/* List Mode Table */}
            {viewMode === 'list' && (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Date</TableCell>
                                <TableCell>Employee</TableCell>
                                <TableCell>Client / Object</TableCell>
                                <TableCell>Time Log</TableCell>
                                <TableCell>Duration</TableCell>
                                <TableCell>Description</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell align="right">Details</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredSessions.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} align="center">No work sessions found for this period</TableCell>
                                </TableRow>
                            ) : (
                                filteredSessions.map((session) => (
                                    <TableRow key={session.id} hover>
                                        <TableCell>
                                            {formatDate(session.startTime)}
                                        </TableCell>
                                        <TableCell>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Avatar sx={{ width: 24, height: 24, fontSize: '0.8rem' }}>
                                                    {session.employeeName?.[0] || '?'}
                                                </Avatar>
                                                <Typography variant="body2">{session.employeeName}</Typography>
                                            </Box>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight="medium">
                                                {session.clientName}
                                            </Typography>
                                            {session.startLocation && (
                                                <MuiLink
                                                    href={`https://www.google.com/maps?q=${session.startLocation.latitude},${session.startLocation.longitude}`}
                                                    target="_blank"
                                                    underline="hover"
                                                    sx={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: 'gray' }}
                                                >
                                                    <LocationOnIcon fontSize="inherit" sx={{ mr: 0.5 }} /> Map
                                                </MuiLink>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2">
                                                {formatTime(session.startTime)} - {session.status === 'active' ? 'Now' : formatTime(session.endTime)}
                                            </Typography>
                                            {session.breaks && session.breaks.length > 0 && (
                                                <Tooltip title={`${session.breaks.length} breaks taken`}>
                                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center' }}>
                                                        <AccessTimeIcon fontSize="inherit" sx={{ mr: 0.5 }} />
                                                        Break: {formatDuration(session.totalBreakMinutes)}
                                                    </Typography>
                                                </Tooltip>
                                            )}
                                        </TableCell>
                                        <TableCell sx={{ fontWeight: 'bold' }}>
                                            {formatDuration(session.durationMinutes)}
                                        </TableCell>
                                        <TableCell>
                                            {session.description ? (
                                                <Tooltip title={session.description}>
                                                    <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                                        {session.description}
                                                    </Typography>
                                                </Tooltip>
                                            ) : (
                                                <Typography variant="caption" color="text.secondary">-</Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={session.status === 'paused' ? 'On Break' : session.status}
                                                color={getStatusColor(session.status)}
                                                size="small"
                                                variant="outlined"
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            <Box display="flex" justifyContent="flex-end" gap={0.5}>
                                                {session.startPhotoUrl ? (
                                                    <MuiLink href={session.startPhotoUrl} target="_blank">
                                                        <Chip icon={<PhotoCameraIcon />} label="Start" size="small" clickable color="primary" variant="outlined" />
                                                    </MuiLink>
                                                ) : session.startPhotoId && (
                                                    <Tooltip title="Photo ID only (Old)">
                                                        <Chip icon={<PhotoCameraIcon />} label="Start" size="small" />
                                                    </Tooltip>
                                                )}

                                                {session.endPhotoUrl ? (
                                                    <MuiLink href={session.endPhotoUrl} target="_blank">
                                                        <Chip icon={<PhotoCameraIcon />} label="End" size="small" clickable color="primary" variant="outlined" />
                                                    </MuiLink>
                                                ) : session.endPhotoId && (
                                                    <Tooltip title="Photo ID only (Old)">
                                                        <Chip icon={<PhotoCameraIcon />} label="End" size="small" />
                                                    </Tooltip>
                                                )}

                                                <IconButton size="small" onClick={() => {
                                                    const sevenDaysAgo = subDays(new Date(), 7);
                                                    if (session.startTime.toDate() < sevenDaysAgo) {
                                                        alert("⚠️ You cannot edit sessions older than 7 days.");
                                                        return;
                                                    }
                                                    setEditingSession(session);
                                                }}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <EditSessionDialog
                open={!!editingSession}
                session={editingSession}
                onClose={() => setEditingSession(null)}
                onSave={handleSaveSession}
            />
        </Container>
    );
};

export default TimeTrackingPage;
