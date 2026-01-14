import React, { useEffect, useState, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Grid, Card, CardContent, Button, TextField,
    Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem,
    Tooltip, IconButton, Checkbox, FormControlLabel
} from '@mui/material';
import { collection, query, orderBy, getDocs, where, Timestamp, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import PrintIcon from '@mui/icons-material/Print';
import DeleteIcon from '@mui/icons-material/Delete';
import { PayrollReport } from './PayrollReport';

// ... (existing code)

import { WorkSession } from '../../types/timeTracking.types';

interface Employee {
    id: string;
    name: string;
    hourlyRate?: number;
    photoUrl?: string; // Added for avatar if needed later
}

const FinancePage: React.FC = () => {
    // Ledger now consists of WorkSessions (regular, correction, manual_adjustment)
    const [entries, setEntries] = useState<WorkSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState<Date>(subDays(startOfDay(new Date()), 30));
    const [endDate, setEndDate] = useState<Date>(endOfDay(new Date()));

    // Adjustment Dialog
    const [openAdjDialog, setOpenAdjDialog] = useState(false);
    const [adjEmployee, setAdjEmployee] = useState('');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjDesc, setAdjDesc] = useState('');

    // Void Dialog
    const [voidTarget, setVoidTarget] = useState<WorkSession | null>(null);
    const [voidReason, setVoidReason] = useState('');

    // Rates Dialog
    const [openRatesDialog, setOpenRatesDialog] = useState(false);
    const [employees, setEmployees] = useState<Employee[]>([]);

    // Payroll Report
    const [showReport, setShowReport] = useState(false);

    useEffect(() => {
        fetchLedger();
        fetchEmployees();
    }, [startDate, endDate]);

    const fetchLedger = async () => {
        setLoading(true);
        try {
            // Ensure we are querying the correct range
            const start = startOfDay(startDate);
            const end = endOfDay(endDate);

            // Query work_sessions within the date range
            // Note: We fetch all and filter client-side for finalizationStatus
            // to avoid needing a composite index and to handle legacy data
            const q = query(
                collection(db, 'work_sessions'),
                where('startTime', '>=', Timestamp.fromDate(start)),
                where('startTime', '<=', Timestamp.fromDate(end)),
                orderBy('startTime', 'desc')
            );

            const snapshot = await getDocs(q);
            const allSessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as WorkSession));

            // Filter to only show finalized or processed sessions (or legacy sessions without status)
            // Sessions from today/yesterday are still within edit window and won't appear
            const getStartOfDay = (date: Date): Date => {
                const d = new Date(date);
                d.setHours(0, 0, 0, 0);
                return d;
            };

            const today = getStartOfDay(new Date());
            const dayBeforeYesterday = new Date(today);
            dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
            dayBeforeYesterday.setHours(23, 59, 59, 999); // End of day-before-yesterday

            const finalizedSessions = allSessions.filter(session => {
                // Always show corrections and manual adjustments
                if (session.type === 'correction' || session.type === 'manual_adjustment') {
                    return true;
                }

                // If explicitly finalized or processed, show it
                if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') {
                    return true;
                }

                // For legacy data without finalizationStatus, check if from day-before-yesterday or earlier
                if (!session.finalizationStatus || session.finalizationStatus === 'pending') {
                    const sessionDate = new Date((session.startTime?.seconds || 0) * 1000);
                    return sessionDate <= dayBeforeYesterday;
                }

                return false;
            });

            setEntries(finalizedSessions);
        } catch (error) {
            console.error("Error fetching ledger:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchEmployees = async () => {
        try {
            // Try specific 'employees' collection first (contains rates)
            const empSnap = await getDocs(collection(db, 'employees'));
            if (!empSnap.empty) {
                setEmployees(empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
                return;
            }
        } catch (e) {
            console.warn("Error fetching employees collection (permissions?), attempting fallback to users...", e);
        }

        // Fallback 1: Users collection (for basic names)
        try {
            const userSnap = await getDocs(collection(db, 'users'));
            if (!userSnap.empty) {
                setEmployees(userSnap.docs.map(d => ({
                    id: d.id,
                    name: d.data().displayName || d.data().name || 'Unknown',
                    ...d.data()
                } as Employee)));
            }
        } catch (e) {
            console.error("Error fetching users collection", e);
        }
    };

    // Fallback 2: Populate employees from Ledger Entries if fetch fails completely (e.g. strict permissions)
    useEffect(() => {
        if (employees.length === 0 && entries.length > 0) {
            const derived = new Map<string, Employee>();
            entries.forEach(e => {
                if (e.employeeId && e.employeeName) {
                    derived.set(String(e.employeeId), {
                        id: String(e.employeeId),
                        name: e.employeeName,
                        hourlyRate: e.hourlyRate || 0
                    });
                }
            });
            if (derived.size > 0) {
                setEmployees(Array.from(derived.values()).sort((a, b) => a.name.localeCompare(b.name)));
            }
        }
    }, [employees.length, entries]);

    const handleAddAdjustment = async () => {
        if (!adjEmployee || !adjAmount || !adjDesc) return;

        try {
            const employee = employees.find(e => e.id === adjEmployee);

            // Create a specialized WorkSession for adjustment
            const adjustmentSession: Partial<WorkSession> = {
                type: 'manual_adjustment',
                startTime: Timestamp.now(), // Recorded at current time
                employeeId: adjEmployee,
                employeeName: employee?.name || 'Unknown',
                clientName: 'Manual Adjustment', // Placeholder or allow selection?
                clientId: 'manual_adj',
                status: 'completed', // Adjustments are instantly completed
                durationMinutes: 0, // No time, just money
                hourlyRate: 0,
                sessionEarnings: parseFloat(adjAmount),
                description: adjDesc,
            };

            await addDoc(collection(db, 'work_sessions'), adjustmentSession);

            setOpenAdjDialog(false);
            setAdjEmployee('');
            setAdjAmount('');
            setAdjDesc('');
            fetchLedger();
        } catch (error) {
            console.error("Error adding adjustment:", error);
            alert("Failed to add adjustment");
        }
    };

    const handleUpdateRate = async (empId: string, newRate: string) => {
        const rate = parseFloat(newRate);
        if (isNaN(rate)) return;

        try {
            // Updating the 'employees' collection which stores the rates
            await updateDoc(doc(db, 'employees', empId), { hourlyRate: rate });
            setEmployees(prev => prev.map(e => e.id === empId ? { ...e, hourlyRate: rate } : e));
        } catch (error) {
            console.error("Error updating rate:", error);
        }
    };

    const handleVoidSubmit = async () => {
        if (!voidTarget || !voidReason) return;

        try {
            // 1. Create Negative Correction
            const correction: Partial<WorkSession> = {
                type: 'correction',
                relatedSessionId: voidTarget.id,
                startTime: Timestamp.now(),
                employeeId: voidTarget.employeeId,
                employeeName: voidTarget.employeeName,
                clientId: voidTarget.clientId || 'void',
                clientName: voidTarget.clientName || 'Voided Record',

                // Negate
                durationMinutes: -(voidTarget.durationMinutes || 0),
                sessionEarnings: -(voidTarget.sessionEarnings || 0),
                hourlyRate: voidTarget.hourlyRate,

                status: 'completed',
                description: `VOID REF: ${voidTarget.description || '-'}`,
                correctionNote: `Voided: ${voidReason}`,
                isVoided: true, // This logic is tricky. The correction ITSELF acts as the voiding transaction. 
                // But maybe we want to hide THIS negating entry from "Active" lists too? 
                // For Finance, we want to see it to balance the math. 
                // Let's leave isVoided false for the CORRECTION itself, so it counts.
                // The ORIGINAL gets isVoided = true for visual strikethrough.
            };

            await addDoc(collection(db, 'work_sessions'), correction);

            // 2. Mark Original as Voided (Soft Delete)
            await updateDoc(doc(db, 'work_sessions', voidTarget.id), {
                isVoided: true,
                voidReason: voidReason
            });

            setVoidTarget(null);
            setVoidReason('');
            fetchLedger();
            alert("Record deleted (voided) successfully.");
        } catch (error) {
            console.error("Error voiding record:", error);
            alert("Failed to delete record.");
        }
    };



    // Filter State
    const [filterEmployee, setFilterEmployee] = useState('all');
    const [filterClient, setFilterClient] = useState('all');
    const [hideVoided, setHideVoided] = useState(true);

    // Derived State
    const uniqueClients = useMemo(() => {
        const clients = new Set(entries.map(e => e.clientName).filter(Boolean));
        return Array.from(clients).sort();
    }, [entries]);

    const uniqueEmployees = useMemo(() => {
        const emps = new Map<string, string>();
        entries.forEach(e => {
            if (e.employeeId && e.employeeName) {
                emps.set(String(e.employeeId), e.employeeName);
            }
        });
        return Array.from(emps.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [entries]);

    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            if (hideVoided && entry.isVoided) return false;

            const matchesEmployee = filterEmployee === 'all' || String(entry.employeeId) === filterEmployee;
            const matchesClient = filterClient === 'all' || entry.clientName === filterClient;

            if (!matchesEmployee || !matchesClient) return false;

            if (hideVoided) {
                if (entry.isVoided) return false;
                if (entry.type === 'correction' && (entry.description?.startsWith('VOID REF:') || entry.correctionNote?.startsWith('Voided:'))) {
                    return false;
                }
            }
            return true;
        });
    }, [entries, filterEmployee, filterClient, hideVoided]);

    const stats = useMemo(() => {
        const totalMoney = filteredEntries.reduce((sum, e) => sum + (e.sessionEarnings || 0), 0);
        const totalHours = filteredEntries.reduce((sum, e) => {
            return sum + (e.durationMinutes || 0);
        }, 0) / 60;
        return { total: totalMoney, hours: totalHours };
    }, [filteredEntries]);

    const breakdowns = useMemo(() => {
        const byEmployee: Record<string, { hours: number, money: number, name: string }> = {};
        const byClient: Record<string, { hours: number, money: number }> = {};

        filteredEntries.forEach(e => {
            // Employee Breakdown
            const empId = String(e.employeeId);
            if (!byEmployee[empId]) {
                byEmployee[empId] = { hours: 0, money: 0, name: e.employeeName };
            }
            byEmployee[empId].hours += (e.durationMinutes || 0) / 60;
            byEmployee[empId].money += (e.sessionEarnings || 0);

            // Client Breakdown
            const client = e.clientName || 'Unknown';
            if (!byClient[client]) byClient[client] = { hours: 0, money: 0 };
            byClient[client].hours += (e.durationMinutes || 0) / 60;
            byClient[client].money += (e.sessionEarnings || 0);
        });

        return {
            employee: Object.values(byEmployee).sort((a, b) => b.money - a.money),
            client: Object.entries(byClient)
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.money - a.money)
        };
    }, [filteredEntries]);

    const getRowColor = (entry: WorkSession) => {
        if (entry.type === 'correction') return 'rgba(255, 152, 0, 0.08)'; // Light Orange
        if (entry.type === 'manual_adjustment') return 'rgba(33, 150, 243, 0.08)'; // Light Blue
        return 'inherit';
    };

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h4" fontWeight="bold">Finance & Payroll</Typography>
                <Box display="flex" gap={2}>
                    <Button
                        startIcon={<PrintIcon />}
                        variant="outlined"
                        onClick={() => setShowReport(true)}
                    >
                        Print Report
                    </Button>
                    <Button
                        startIcon={<SettingsIcon />}
                        variant="outlined"
                        onClick={() => setOpenRatesDialog(true)}
                    >
                        Employee Rates
                    </Button>
                    <Button
                        startIcon={<AddIcon />}
                        variant="contained"
                        onClick={() => setOpenAdjDialog(true)}
                    >
                        Add Ad-hoc Adjustment
                    </Button>
                </Box>
            </Box>

            {/* Stats */}
            {/* Stats */}
            <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 300 }}>
                    <Card sx={{ bgcolor: '#2196f3', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Payroll (Period)</Typography>
                            <Typography variant="h3" fontWeight="bold">${stats.total.toFixed(2)}</Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 300 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Total Hours Paid</Typography>
                            <Typography variant="h4" fontWeight="bold">{stats.hours.toFixed(1)} h</Typography>
                        </CardContent>
                    </Card>
                </Box>
            </Box>

            {/* Filters & Breakdowns */}
            <Box display="flex" flexWrap="wrap" gap={3} mb={3}>
                {/* Left: Filters */}
                <Box sx={{ flex: { xs: '1 1 100%', md: '0 0 40%' } }}>
                    <Paper sx={{ p: 2 }}>
                        <Typography variant="subtitle2" gutterBottom fontWeight="bold">Filters</Typography>
                        <Box display="flex" flexDirection="column" gap={2}>
                            <Box display="flex" gap={2}>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Client</InputLabel>
                                    <Select
                                        value={filterClient}
                                        label="Client"
                                        onChange={(e) => setFilterClient(e.target.value)}
                                    >
                                        <MenuItem value="all">All Clients</MenuItem>
                                        {uniqueClients.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                    </Select>
                                </FormControl>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Employee</InputLabel>
                                    <Select
                                        value={filterEmployee}
                                        label="Employee"
                                        onChange={(e) => setFilterEmployee(e.target.value)}
                                    >
                                        <MenuItem value="all">All Employees</MenuItem>
                                        {uniqueEmployees.map(e => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            </Box>
                            <Box display="flex" gap={2} alignItems="center">
                                <FormControlLabel
                                    control={<Checkbox checked={hideVoided} onChange={(e) => setHideVoided(e.target.checked)} size="small" />}
                                    label={<Typography variant="body2">Hide Voided & Deleted</Typography>}
                                />
                                {/* Date inputs were here before, moving them inline or keeping them separate? 
                                    The previous design had date filters in a separate Paper. 
                                    I will keep them separate or merge them? 
                                    Let's keep the dedicated Date Paper below for "Period Control" 
                                    and this Paper for "Data Filtering". 
                                */}
                            </Box>
                        </Box>
                    </Paper>
                </Box>

                {/* Right: Breakdowns */}
                <Box sx={{ flex: 1, minWidth: 300 }}>
                    <Paper sx={{ p: 2, height: '100%', overflow: 'hidden' }}>
                        <Typography variant="subtitle2" gutterBottom fontWeight="bold">Breakdown (Filtered)</Typography>
                        <Box display="flex" gap={3} sx={{ overflowX: 'auto' }}>
                            {/* Employee Breakdown */}
                            <Box flex={1} minWidth={200}>
                                <Table size="small">
                                    <TableHead><TableRow><TableCell>Employee</TableCell><TableCell align="right">Hours</TableCell><TableCell align="right">Pay</TableCell></TableRow></TableHead>
                                    <TableBody>
                                        {breakdowns.employee.slice(0, 5).map(b => (
                                            <TableRow key={b.name}>
                                                <TableCell variant="head" sx={{ py: 0.5 }}>{b.name}</TableCell>
                                                <TableCell align="right" sx={{ py: 0.5 }}>{b.hours.toFixed(1)}</TableCell>
                                                <TableCell align="right" sx={{ py: 0.5 }}>${b.money.toFixed(0)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>

                            {/* Client Breakdown */}
                            <Box flex={1} minWidth={200}>
                                <Table size="small">
                                    <TableHead><TableRow><TableCell>Client</TableCell><TableCell align="right">Hours</TableCell><TableCell align="right">Cost</TableCell></TableRow></TableHead>
                                    <TableBody>
                                        {breakdowns.client.slice(0, 5).map(b => (
                                            <TableRow key={b.name}>
                                                <TableCell variant="head" sx={{ py: 0.5 }}>{b.name}</TableCell>
                                                <TableCell align="right" sx={{ py: 0.5 }}>{b.hours.toFixed(1)}</TableCell>
                                                <TableCell align="right" sx={{ py: 0.5 }}>${b.money.toFixed(0)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </Box>
                        </Box>
                    </Paper>
                </Box>
            </Box>

            {/* Date Filters (Existing) */}
            <Paper sx={{ p: 2, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Box sx={{ width: { xs: '100%', md: '25%' } }}>
                        <TextField
                            label="Start Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(startDate, 'yyyy-MM-dd')}
                            onChange={(e) => setStartDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Box>
                    <Box sx={{ width: { xs: '100%', md: '25%' } }}>
                        <TextField
                            label="End Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(endDate, 'yyyy-MM-dd')}
                            onChange={(e) => setEndDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Box>
                </Box>
            </Paper>

            {/* Ledger Table */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Employee</TableCell>
                            <TableCell>Client / Context</TableCell>
                            <TableCell>Description / Notes</TableCell>
                            <TableCell align="right">Duration</TableCell>
                            <TableCell align="right">Rate</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={9} align="center"><CircularProgress /></TableCell>
                            </TableRow>
                        ) : filteredEntries.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={9} align="center">No records found (Check filters)</TableCell>
                            </TableRow>
                        ) : (
                            filteredEntries.map((entry) => {
                                const isCorrection = entry.type === 'correction';
                                const isAdjustment = entry.type === 'manual_adjustment';
                                const date = entry.startTime ? new Date(entry.startTime.seconds * 1000) : new Date();
                                const isVoided = entry.isVoided;

                                return (
                                    <TableRow
                                        key={entry.id}
                                        hover
                                        sx={{
                                            bgcolor: getRowColor(entry),
                                            textDecoration: isVoided ? 'line-through' : 'none',
                                            opacity: isVoided ? 0.6 : 1
                                        }}
                                    >
                                        <TableCell>
                                            <Typography variant="body2" fontWeight="bold">
                                                {date.toLocaleDateString()}
                                            </Typography>
                                            <Typography variant="caption" color="textSecondary">
                                                {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </Typography>
                                            {isVoided && <Typography variant="caption" color="error" display="block">DELETED</Typography>}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={entry.type === 'correction' ? 'Correction' : entry.type === 'manual_adjustment' ? 'Adj.' : 'Session'}
                                                color={isCorrection ? 'warning' : isAdjustment ? 'info' : 'default'}
                                                size="small"
                                                variant={isCorrection || isAdjustment ? 'filled' : 'outlined'}
                                            />
                                        </TableCell>
                                        <TableCell>{entry.employeeName}</TableCell>
                                        <TableCell>{entry.clientName}</TableCell>
                                        <TableCell>
                                            <Tooltip title={isVoided ? `REASON: ${entry.voidReason}` : (entry.description || '')}>
                                                <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                                                    {isCorrection ? (entry.correctionNote || entry.description) : entry.description}
                                                </Typography>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell align="right">
                                            {entry.durationMinutes ? `${(entry.durationMinutes / 60).toFixed(2)}h` : '-'}
                                        </TableCell>
                                        <TableCell align="right">
                                            {entry.hourlyRate ? `$${entry.hourlyRate}` : '-'}
                                        </TableCell>
                                        <TableCell align="right" sx={{ fontWeight: 'bold', color: (entry.sessionEarnings || 0) >= 0 ? 'green' : 'red' }}>
                                            ${(entry.sessionEarnings || 0).toFixed(2)}
                                        </TableCell>
                                        <TableCell align="right">
                                            {!isVoided && (
                                                <IconButton size="small" color="error" onClick={() => {
                                                    setVoidTarget(entry);
                                                    setVoidReason('');
                                                }}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Adjustment Dialog */}
            <Dialog open={openAdjDialog} onClose={() => setOpenAdjDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Add Manual Adjustment</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Employee</InputLabel>
                            <Select
                                value={adjEmployee}
                                label="Employee"
                                onChange={(e) => setAdjEmployee(e.target.value)}
                            >
                                {employees.map(emp => (
                                    <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Amount ($)"
                            type="number"
                            fullWidth
                            size="small"
                            helperText="Use negative for deductions (e.g. -50)"
                            value={adjAmount}
                            onChange={(e) => setAdjAmount(e.target.value)}
                        />
                        <TextField
                            label="Reason / Description"
                            fullWidth
                            multiline
                            rows={2}
                            size="small"
                            value={adjDesc}
                            onChange={(e) => setAdjDesc(e.target.value)}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenAdjDialog(false)}>Cancel</Button>
                    <Button onClick={handleAddAdjustment} variant="contained">Save</Button>
                </DialogActions>
            </Dialog>

            {/* Void Reason Dialog */}
            <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Delete Reason</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                        Why are you deleting this record? This will create a correction entry to zero out the balance and mark this record as deleted.
                    </Typography>
                    <TextField
                        autoFocus
                        margin="dense"
                        label="Reason for deletion"
                        fullWidth
                        multiline
                        rows={3}
                        value={voidReason}
                        onChange={(e) => setVoidReason(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setVoidTarget(null)}>Cancel</Button>
                    <Button
                        onClick={handleVoidSubmit}
                        variant="contained"
                        color="error"
                        disabled={!voidReason.trim()}
                    >
                        Delete Record
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Rates Dialog */}
            <Dialog open={openRatesDialog} onClose={() => setOpenRatesDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Manage Hourly Rates</DialogTitle>
                <DialogContent>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Employee</TableCell>
                                <TableCell>Current Rate ($/h)</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {employees.map(emp => (
                                <TableRow key={emp.id}>
                                    <TableCell>{emp.name}</TableCell>
                                    <TableCell>
                                        <TextField
                                            type="number"
                                            size="small"
                                            defaultValue={emp.hourlyRate || 0}
                                            onBlur={(e) => handleUpdateRate(emp.id, e.target.value)}
                                            InputProps={{ startAdornment: <Typography sx={{ mr: 1 }}>$</Typography> }}
                                            sx={{ width: 100 }}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenRatesDialog(false)}>Close</Button>
                </DialogActions>
            </Dialog>
            {/* Payroll Report Overlay */}
            {showReport && (
                <PayrollReport
                    entries={filteredEntries}
                    onClose={() => setShowReport(false)}
                />
            )}
        </Container>
    );
};

export default FinancePage;
