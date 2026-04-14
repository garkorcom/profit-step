import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Card, CardContent, Button, TextField,
    Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem,
    Tooltip, IconButton, Checkbox, FormControlLabel, TablePagination, Tabs, Tab
} from '@mui/material';
import { InvoicesTab } from '../../components/finance/invoices/InvoicesTab';
import { ExpensesTab } from '../../components/finance/expenses/ExpensesTab';
import { collection, query, orderBy, getDocs, where, Timestamp, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { startOfDay, endOfDay, subDays, format, isValid } from 'date-fns';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import PrintIcon from '@mui/icons-material/Print';
import DeleteIcon from '@mui/icons-material/Delete';
import PaymentIcon from '@mui/icons-material/Payment';
import { PayrollReport } from './PayrollReport';

// ... (existing code)

import { WorkSession } from '../../types/timeTracking.types';
import { calculatePayrollBuckets } from '../../utils/payroll';

const PnLView = React.lazy(() => import('../../components/finance/PnLView'));

interface Employee {
    id: string;
    name: string;
    hourlyRate?: number;
    photoUrl?: string; // Added for avatar if needed later
}

// Cost entry interface
interface CostEntry {
    id: string;
    userId: string;
    userName: string;
    clientId: string;
    clientName: string;
    category: string;
    categoryLabel: string;
    amount: number;
    originalAmount: number;
    receiptPhotoUrl: string;
    description?: string;
    createdAt: Timestamp;
    status: string;
}

const FinancePage: React.FC = () => {
    const [tabIndex, setTabIndex] = useState(0);

    // Ledger now consists of WorkSessions (regular, correction, manual_adjustment)
    const [entries, setEntries] = useState<WorkSession[]>([]);
    const [costs, setCosts] = useState<CostEntry[]>([]);
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

    // Mapping: telegramId (string) -> user doc ID (UID)
    const telegramIdToUidRef = useRef<Map<string, string>>(new Map());
    // Mapping: user doc ID (UID) -> canonical displayName
    const uidToNameRef = useRef<Map<string, string>>(new Map());

    // Payroll Report
    const [showReport, setShowReport] = useState(false);

    // Payment Dialog
    const [openPaymentDialog, setOpenPaymentDialog] = useState(false);
    const [paymentEmployee, setPaymentEmployee] = useState('');
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentNote, setPaymentNote] = useState('');
    const [paymentDate, setPaymentDate] = useState<Date>(new Date());

    // Employee Payment History Dialog
    const [historyEmployee, setHistoryEmployee] = useState<{ id: string; name: string } | null>(null);

    useEffect(() => {
        const loadData = async () => {
            await fetchEmployees(); // Must run first to build telegramId mapping
            await fetchLedger();    // Uses the mapping to normalize
            fetchCosts();
        };
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

            // Normalize employeeId: map Telegram IDs to user UIDs
            const normalized = finalizedSessions.map(session => {
                const rawId = String(session.employeeId);
                const mappedUid = telegramIdToUidRef.current.get(rawId);
                if (mappedUid) {
                    return {
                        ...session,
                        employeeId: mappedUid,
                        employeeName: uidToNameRef.current.get(mappedUid) || session.employeeName
                    };
                }
                // Also normalize name if employeeId is already a UID
                if (uidToNameRef.current.has(rawId)) {
                    return {
                        ...session,
                        employeeName: uidToNameRef.current.get(rawId) || session.employeeName
                    };
                }
                return session;
            });

            setEntries(normalized);
        } catch (error) {
            console.error("Error fetching ledger:", error);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Fetch employees/workers from Firestore.
     * 
     * UNIFIED RATE SYSTEM (2026-01-26):
     * - Previously used separate 'employees' collection for rates
     * - Now unified with 'users' collection to sync with Timer/Bot
     * - Timer (useSessionManager) reads from users.hourlyRate
     * - Bot (onWorkerBotMessage) reads from users.hourlyRate with employees fallback
     * - FinancePage now updates users.hourlyRate directly
     */
    const fetchEmployees = async () => {
        // Unified: use 'users' collection for both profiles and rates
        try {
            const userSnap = await getDocs(collection(db, 'users'));
            if (!userSnap.empty) {
                // Build telegramId -> UID and UID -> name mappings for normalization
                const tgMap = new Map<string, string>();
                const nameMap = new Map<string, string>();

                const emps = userSnap.docs.map(d => {
                    const data = d.data();
                    const name = data.displayName || data.name || 'Unknown';
                    nameMap.set(d.id, name);
                    if (data.telegramId) {
                        tgMap.set(String(data.telegramId), d.id);
                    }
                    return {
                        id: d.id,
                        name,
                        hourlyRate: data.hourlyRate || 0,
                        ...data
                    } as Employee;
                });

                telegramIdToUidRef.current = tgMap;
                uidToNameRef.current = nameMap;
                setEmployees(emps);
            }
        } catch (e) {
            console.error("Error fetching users collection", e);
        }
    };

    const fetchCosts = async () => {
        try {
            const start = startOfDay(startDate);
            const end = endOfDay(endDate);

            const q = query(
                collection(db, 'costs'),
                where('createdAt', '>=', Timestamp.fromDate(start)),
                where('createdAt', '<=', Timestamp.fromDate(end)),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            setCosts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CostEntry)));
        } catch (e) {
            console.error("Error fetching costs:", e);
        }
    };

    // Fallback: If users collection fetch fails, derive employees from session entries
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

    // Pagination
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Confirmation
    const [confirmAction, setConfirmAction] = useState<{ type: 'payment' | 'adjustment'; summary: string; execute: () => Promise<void> } | null>(null);

    const handleAddAdjustment = async () => {
        if (!adjEmployee || !adjAmount || !adjDesc) return;

        try {
            const employee = uniqueEmployees.find(e => e.id === adjEmployee) || employees.find(e => e.id === adjEmployee);
            const amt = parseFloat(adjAmount);

            setConfirmAction({
                type: 'adjustment',
                summary: `${employee?.name || 'Unknown'}: ${amt >= 0 ? '+' : ''}$${amt.toFixed(2)} — ${adjDesc}`,
                execute: async () => {
                    const adjustmentSession: Partial<WorkSession> = {
                        type: 'manual_adjustment',
                        startTime: Timestamp.now(),
                        employeeId: adjEmployee,
                        employeeName: employee?.name || 'Unknown',
                        clientName: 'Manual Adjustment',
                        clientId: 'manual_adj',
                        status: 'completed',
                        finalizationStatus: 'finalized',
                        durationMinutes: 0,
                        hourlyRate: 0,
                        sessionEarnings: amt,
                        description: adjDesc,
                    };

                    await addDoc(collection(db, 'work_sessions'), adjustmentSession);

                    setOpenAdjDialog(false);
                    setAdjEmployee('');
                    setAdjAmount('');
                    setAdjDesc('');
                    fetchLedger();
                }
            });
        } catch (error) {
            console.error("Error adding adjustment:", error);
            alert("Failed to add adjustment");
        }
    };

    const handleUpdateRate = async (empId: string, newRate: string) => {
        const rate = parseFloat(newRate);
        if (isNaN(rate)) return;

        try {
            // Unified: update rate in 'users' collection (same as timer reads)
            await updateDoc(doc(db, 'users', empId), { hourlyRate: rate });
            setEmployees(prev => prev.map(e => e.id === empId ? { ...e, hourlyRate: rate } : e));
        } catch (error) {
            console.error("Error updating rate:", error);
        }
    };

    const handleAddPayment = async () => {
        if (!paymentEmployee || !paymentAmount) return;

        try {
            const employee = uniqueEmployees.find(e => e.id === paymentEmployee) || employees.find(e => e.id === paymentEmployee);
            const amount = parseFloat(paymentAmount);

            setConfirmAction({
                type: 'payment',
                summary: `${employee?.name || 'Unknown'}: -$${Math.abs(amount).toFixed(2)} (${format(paymentDate, 'dd.MM.yyyy')})${paymentNote ? ` — ${paymentNote}` : ''}`,
                execute: async () => {
                    const paymentSession: Partial<WorkSession> = {
                        type: 'payment',
                        startTime: Timestamp.fromDate(paymentDate),
                        employeeId: paymentEmployee,
                        employeeName: employee?.name || 'Unknown',
                        clientName: 'Payment',
                        clientId: 'payment',
                        status: 'completed',
                        finalizationStatus: 'finalized',
                        durationMinutes: 0,
                        hourlyRate: 0,
                        sessionEarnings: -Math.abs(amount),
                        description: paymentNote || 'Salary payment',
                    };

                    await addDoc(collection(db, 'work_sessions'), paymentSession);

                    setOpenPaymentDialog(false);
                    setPaymentEmployee('');
                    setPaymentAmount('');
                    setPaymentNote('');
                    setPaymentDate(new Date());
                    fetchLedger();
                }
            });
        } catch (error) {
            console.error("Error adding payment:", error);
            alert("Failed to add payment");
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
                isVoided: false, // Correction must stay visible to balance the math
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
    const SYNTHETIC_CLIENTS = useMemo(() => new Set(['Manual Adjustment', 'Payment', 'Voided Record']), []);

    const uniqueClients = useMemo(() => {
        const clients = new Set(entries.map(e => e.clientName).filter(c => c && !SYNTHETIC_CLIENTS.has(c)));
        return Array.from(clients).sort();
    }, [entries, SYNTHETIC_CLIENTS]);

    const uniqueEmployees = useMemo(() => {
        // First pass: collect by employeeId
        const empsById = new Map<string, string>();
        entries.forEach(e => {
            if (e.employeeId && e.employeeName) {
                empsById.set(String(e.employeeId), e.employeeName);
            }
        });

        // Second pass: deduplicate by normalized name (trim + lowercase)
        // This catches cases where the same person has sessions with different IDs
        // (e.g. Telegram ID not linked to user record)
        const byNormalizedName = new Map<string, { id: string; name: string }>();
        empsById.forEach((name, id) => {
            // Strip invisible/whitespace characters and normalize
            const cleanName = name.replace(/[\u200B-\u200D\uFEFF\u3164\s]+/g, ' ').trim();
            const normalizedKey = cleanName.toLowerCase();
            if (!byNormalizedName.has(normalizedKey)) {
                byNormalizedName.set(normalizedKey, { id, name: cleanName });
            }
            // If already exists, keep the first one (which is typically the canonical UID)
        });

        return Array.from(byNormalizedName.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [entries]);

    // Build a mapping from each canonical employee ID to ALL associated IDs
    // This is needed because the same person can have sessions under different IDs
    const employeeIdGroups = useMemo(() => {
        const groups = new Map<string, Set<string>>();
        // Map each name -> all IDs, then map canonical ID -> all IDs for that name
        const nameToIds = new Map<string, Set<string>>();
        entries.forEach(e => {
            if (e.employeeId && e.employeeName) {
                const cleanName = e.employeeName.replace(/[\u200B-\u200D\uFEFF\u3164\s]+/g, ' ').trim().toLowerCase();
                if (!nameToIds.has(cleanName)) nameToIds.set(cleanName, new Set());
                nameToIds.get(cleanName)!.add(String(e.employeeId));
            }
        });
        // For each uniqueEmployee, find all IDs that share the same normalized name
        uniqueEmployees.forEach(emp => {
            const normalizedName = emp.name.toLowerCase();
            const allIds = nameToIds.get(normalizedName) || new Set([emp.id]);
            groups.set(emp.id, allIds);
        });
        return groups;
    }, [entries, uniqueEmployees]);

    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            if (hideVoided && entry.isVoided) return false;

            // Use employeeIdGroups to match all IDs for a deduped employee
            const matchesEmployee = filterEmployee === 'all' ||
                (employeeIdGroups.get(filterEmployee)?.has(String(entry.employeeId)) ?? String(entry.employeeId) === filterEmployee);
            const matchesClient = filterClient === 'all' || entry.clientName === filterClient;

            if (!matchesEmployee || !matchesClient) return false;

            if (hideVoided && entry.type === 'correction' &&
                (entry.description?.startsWith('VOID REF:') || entry.correctionNote?.startsWith('Voided:'))) {
                return false;
            }
            return true;
        });
    }, [entries, filterEmployee, filterClient, hideVoided, employeeIdGroups]);

    // Reset page on filter change
    useEffect(() => { setPage(0); }, [filterEmployee, filterClient, hideVoided]);

    const stats = useMemo(() => {
        // Filter costs by employee if specific employee is selected
        const filteredCosts = filterEmployee === 'all'
            ? costs
            : costs.filter(c => {
                const groupIds = employeeIdGroups.get(filterEmployee);
                return groupIds?.has(c.userId) ?? c.userId === filterEmployee;
            });
        const expensesTotal = filteredCosts.reduce((sum, c) => sum + Math.abs(c.amount), 0);

        // Unified payroll calculation (single source of truth)
        const buckets = calculatePayrollBuckets(filteredEntries, expensesTotal);

        return {
            salary: buckets.salary,
            payments: buckets.payments,
            adjustments: buckets.adjustments,
            expenses: buckets.expenses,
            balance: buckets.balance,
            hours: buckets.totalHours,
            costsCount: filteredCosts.length
        };
    }, [filteredEntries, costs, filterEmployee, employeeIdGroups]);

    const breakdowns = useMemo(() => {
        // Build reverse map: any raw ID → canonical ID
        const rawToCanonical = new Map<string, string>();
        employeeIdGroups.forEach((allIds, canonicalId) => {
            allIds.forEach(rawId => rawToCanonical.set(rawId, canonicalId));
        });

        const byEmployee: Record<string, { hours: number, money: number, rate: number, name: string }> = {};
        const byClient: Record<string, { hours: number, money: number }> = {};

        filteredEntries.forEach(e => {
            const type = e.type || 'regular';
            // Skip payments and corrections for breakdown salary columns
            const isWorkSession = (type === 'regular' || !e.type) && !e.isVoided;

            // Employee Breakdown — use canonical ID
            const rawId = String(e.employeeId);
            const canonicalId = rawToCanonical.get(rawId) || rawId;
            const canonicalName = uniqueEmployees.find(u => u.id === canonicalId)?.name || e.employeeName;
            if (!byEmployee[canonicalId]) {
                byEmployee[canonicalId] = { hours: 0, money: 0, rate: 0, name: canonicalName };
            }
            if (isWorkSession) {
                byEmployee[canonicalId].hours += (e.durationMinutes || 0) / 60;
                byEmployee[canonicalId].money += (e.sessionEarnings || 0);
                if (e.hourlyRate) byEmployee[canonicalId].rate = e.hourlyRate;
            }

            // Client Breakdown — only work sessions, exclude synthetic
            const client = e.clientName || 'Unknown';
            if (isWorkSession && !SYNTHETIC_CLIENTS.has(client)) {
                if (!byClient[client]) byClient[client] = { hours: 0, money: 0 };
                byClient[client].hours += (e.durationMinutes || 0) / 60;
                byClient[client].money += (e.sessionEarnings || 0);
            }
        });

        return {
            employee: Object.values(byEmployee).sort((a, b) => b.money - a.money),
            client: Object.entries(byClient)
                .map(([name, data]) => ({ name, ...data }))
                .sort((a, b) => b.money - a.money)
        };
    }, [filteredEntries, employeeIdGroups, uniqueEmployees, SYNTHETIC_CLIENTS]);

    const getRowColor = (entry: WorkSession) => {
        if (entry.type === 'payment') return 'rgba(76, 175, 80, 0.08)'; // Light Green
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
                    <Button
                        startIcon={<PaymentIcon />}
                        variant="contained"
                        color="success"
                        onClick={() => setOpenPaymentDialog(true)}
                    >
                        Add Payment
                    </Button>
                </Box>
            </Box>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={tabIndex} onChange={(e, v) => setTabIndex(v)} aria-label="finance tabs">
                    <Tab label="Overview (Payroll)" />
                    <Tab label="Invoices (Billing)" />
                    <Tab label="Expenses" />
                    <Tab label="P&L" />
                </Tabs>
            </Box>

            {tabIndex === 0 && (
                <Box>
                    {/* Stats — all cards use the same filtered period */}
                    <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
                        <Box sx={{ flex: 1, minWidth: 160 }}>
                            <Card sx={{ bgcolor: '#2196f3', color: 'white', height: '100%' }}>
                                <CardContent>
                                    <Tooltip title="Начислено за период (только рабочие сессии, без voided)" arrow>
                                        <Typography variant="body2" sx={{ opacity: 0.8 }}>Salary</Typography>
                                    </Tooltip>
                                    <Typography variant="h4" fontWeight="bold">${stats.salary.toFixed(2)}</Typography>
                                </CardContent>
                            </Card>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 160 }}>
                            <Card sx={{ bgcolor: '#9e9e9e', color: 'white', height: '100%' }}>
                                <CardContent>
                                    <Tooltip title="Выплаты за период" arrow>
                                        <Typography variant="body2" sx={{ opacity: 0.8 }}>Payments</Typography>
                                    </Tooltip>
                                    <Typography variant="h4" fontWeight="bold">${stats.payments.toFixed(2)}</Typography>
                                </CardContent>
                            </Card>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 160 }}>
                            <Card sx={{ bgcolor: '#ff9800', color: 'white', height: '100%' }}>
                                <CardContent>
                                    <Typography variant="body2" sx={{ opacity: 0.8 }}>Expenses ({stats.costsCount})</Typography>
                                    <Typography variant="h4" fontWeight="bold">${stats.expenses.toFixed(2)}</Typography>
                                </CardContent>
                            </Card>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 160 }}>
                            <Card sx={{ bgcolor: stats.balance >= 0 ? '#4caf50' : '#f44336', color: 'white', height: '100%' }}>
                                <CardContent>
                                    <Tooltip title={`Salary ($${stats.salary.toFixed(0)}) ${stats.adjustments !== 0 ? `+ Adj ($${stats.adjustments.toFixed(0)}) ` : ''}- Payments ($${stats.payments.toFixed(0)}) - Expenses ($${stats.expenses.toFixed(0)})`} arrow>
                                        <Typography variant="body2" sx={{ opacity: 0.8 }}>Balance</Typography>
                                    </Tooltip>
                                    <Typography variant="h4" fontWeight="bold">${stats.balance.toFixed(2)}</Typography>
                                </CardContent>
                            </Card>
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 160 }}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Typography color="textSecondary" variant="body2">Total Hours</Typography>
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
                                    <Box flex={1} minWidth={250}>
                                        <Table size="small">
                                            <TableHead><TableRow><TableCell>Employee</TableCell><TableCell align="right">Hours</TableCell><TableCell align="right">$/h</TableCell><TableCell align="right">Salary</TableCell></TableRow></TableHead>
                                            <TableBody>
                                                {breakdowns.employee.slice(0, 5).map(b => (
                                                    <TableRow key={b.name}>
                                                        <TableCell variant="head" sx={{ py: 0.5 }}>{b.name}</TableCell>
                                                        <TableCell align="right" sx={{ py: 0.5 }}>{b.hours.toFixed(1)}</TableCell>
                                                        <TableCell align="right" sx={{ py: 0.5 }}>${b.rate}</TableCell>
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
                                    onChange={(e) => {
                                        const d = new Date(e.target.value);
                                        if (isValid(d)) setStartDate(d);
                                    }}
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
                                    onChange={(e) => {
                                        const d = new Date(e.target.value);
                                        if (isValid(d)) setEndDate(d);
                                    }}
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
                                    filteredEntries
                                        .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                                        .map((entry) => {
                                            const isCorrection = entry.type === 'correction';
                                            const isAdjustment = entry.type === 'manual_adjustment';
                                            const isPayment = entry.type === 'payment';
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
                                                            label={isPayment ? 'Payment' : isCorrection ? 'Correction' : isAdjustment ? 'Adj.' : 'Session'}
                                                            color={isPayment ? 'success' : isCorrection ? 'warning' : isAdjustment ? 'info' : 'default'}
                                                            size="small"
                                                            variant={isPayment || isCorrection || isAdjustment ? 'filled' : 'outlined'}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography
                                                            variant="body2"
                                                            sx={{
                                                                cursor: 'pointer',
                                                                color: 'primary.main',
                                                                '&:hover': { textDecoration: 'underline' }
                                                            }}
                                                            onClick={() => setHistoryEmployee({
                                                                id: String(entry.employeeId),
                                                                name: entry.employeeName
                                                            })}
                                                        >
                                                            {entry.employeeName}
                                                        </Typography>
                                                    </TableCell>
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
                        <TablePagination
                            component="div"
                            count={filteredEntries.length}
                            page={page}
                            onPageChange={(_, newPage) => setPage(newPage)}
                            rowsPerPage={rowsPerPage}
                            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                            rowsPerPageOptions={[10, 25, 50, 100]}
                            labelRowsPerPage="Записей:"
                        />
                    </TableContainer>
                </Box>
            )}

            {tabIndex === 1 && <InvoicesTab />}
            {tabIndex === 2 && (
                <ExpensesTab
                    costs={costs}
                    loading={loading}
                    startDate={startDate}
                    endDate={endDate}
                />
            )}
            {tabIndex === 3 && (
                <React.Suspense fallback={<CircularProgress sx={{ mt: 4, display: 'block', mx: 'auto' }} />}>
                    <PnLView startDate={startDate} endDate={endDate} />
                </React.Suspense>
            )}

            {/* Confirmation Dialog */}
            <Dialog open={!!confirmAction} onClose={() => setConfirmAction(null)} maxWidth="xs" fullWidth>
                <DialogTitle>
                    {confirmAction?.type === 'payment' ? '✅ Подтвердить платёж' : '✅ Подтвердить корректировку'}
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ mt: 1 }}>{confirmAction?.summary}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmAction(null)}>Отмена</Button>
                    <Button
                        variant="contained"
                        color={confirmAction?.type === 'payment' ? 'success' : 'primary'}
                        onClick={async () => {
                            try {
                                await confirmAction?.execute();
                            } catch (error) {
                                console.error('Confirm action failed:', error);
                                alert('Operation failed');
                            } finally {
                                setConfirmAction(null);
                            }
                        }}
                    >
                        Подтвердить
                    </Button>
                </DialogActions>
            </Dialog>

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
                                {uniqueEmployees.map(emp => (
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
                                            key={`${emp.id}-${emp.hourlyRate}`}
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

            {/* Payment Dialog */}
            <Dialog open={openPaymentDialog} onClose={() => setOpenPaymentDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Add Payment</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <FormControl fullWidth size="small" required>
                            <InputLabel>Employee</InputLabel>
                            <Select
                                value={paymentEmployee}
                                label="Employee"
                                onChange={(e) => setPaymentEmployee(e.target.value)}
                            >
                                {uniqueEmployees.map(emp => (
                                    <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Payment Date"
                            type="date"
                            fullWidth
                            size="small"
                            value={format(paymentDate, 'yyyy-MM-dd')}
                            onChange={(e) => setPaymentDate(e.target.value ? new Date(e.target.value) : new Date())}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            label="Amount ($)"
                            type="number"
                            fullWidth
                            size="small"
                            required
                            helperText="Enter payment amount (can be negative for deductions)"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                        />
                        <TextField
                            label="Note (optional)"
                            fullWidth
                            multiline
                            rows={2}
                            size="small"
                            value={paymentNote}
                            onChange={(e) => setPaymentNote(e.target.value)}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenPaymentDialog(false)}>Cancel</Button>
                    <Button
                        onClick={handleAddPayment}
                        variant="contained"
                        color="success"
                        disabled={!paymentEmployee || !paymentAmount}
                    >
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Payroll Report Overlay */}
            {showReport && (
                <PayrollReport
                    entries={filteredEntries}
                    onClose={() => setShowReport(false)}
                    employeeIdGroups={employeeIdGroups}
                    uniqueEmployees={uniqueEmployees}
                />
            )}

            {/* Employee Payment History Dialog */}
            <Dialog
                open={!!historyEmployee}
                onClose={() => setHistoryEmployee(null)}
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>
                    💰 История платежей: {historyEmployee?.name}
                </DialogTitle>
                <DialogContent>
                    {historyEmployee && (() => {
                        const groupIds = employeeIdGroups.get(historyEmployee.id);
                        // Use filteredEntries (respects date range filters) instead of entries (all-time)
                        const employeeEntries = filteredEntries.filter(e =>
                            groupIds?.has(String(e.employeeId)) ?? String(e.employeeId) === historyEmployee.id
                        );
                        const payments = employeeEntries.filter(e => e.type === 'payment');
                        const adjustments = employeeEntries.filter(e => e.type === 'manual_adjustment');

                        // Use unified payroll calculation
                        const buckets = calculatePayrollBuckets(employeeEntries);
                        const totalEarned = buckets.salary;
                        const totalPaid = buckets.payments;
                        const totalAdj = buckets.adjustments;
                        const balance = buckets.balance;

                        return (
                            <Box>
                                {/* Summary Cards */}
                                <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                                    <Paper sx={{ p: 2, flex: 1, minWidth: 120, bgcolor: '#e3f2fd' }}>
                                        <Typography variant="caption" color="text.secondary">Заработано</Typography>
                                        <Typography variant="h6" fontWeight="bold" color="info.main">
                                            ${totalEarned.toFixed(2)}
                                        </Typography>
                                    </Paper>
                                    <Paper sx={{ p: 2, flex: 1, minWidth: 120, bgcolor: '#fff3e0' }}>
                                        <Typography variant="caption" color="text.secondary">Выплачено</Typography>
                                        <Typography variant="h6" fontWeight="bold" color="warning.main">
                                            ${totalPaid.toFixed(2)}
                                        </Typography>
                                    </Paper>
                                    <Paper sx={{ p: 2, flex: 1, minWidth: 120, bgcolor: balance >= 0 ? '#e8f5e9' : '#ffebee' }}>
                                        <Typography variant="caption" color="text.secondary">Баланс</Typography>
                                        <Typography variant="h6" fontWeight="bold" color={balance >= 0 ? 'success.main' : 'error.main'}>
                                            ${balance.toFixed(2)}
                                        </Typography>
                                    </Paper>
                                </Box>

                                {/* Payments Table */}
                                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                    Платежи ({payments.length})
                                </Typography>
                                {payments.length > 0 ? (
                                    <TableContainer component={Paper} sx={{ mb: 3 }}>
                                        <Table size="small">
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell>Дата</TableCell>
                                                    <TableCell>Сумма</TableCell>
                                                    <TableCell>Примечание</TableCell>
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {payments.map(p => (
                                                    <TableRow key={p.id}>
                                                        <TableCell>
                                                            {new Date(p.startTime.seconds * 1000).toLocaleDateString()}
                                                        </TableCell>
                                                        <TableCell sx={{ color: 'success.main', fontWeight: 'bold' }}>
                                                            ${Math.abs(p.sessionEarnings || 0).toFixed(2)}
                                                        </TableCell>
                                                        <TableCell>{p.description}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                ) : (
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                                        Нет платежей
                                    </Typography>
                                )}

                                {/* Adjustments */}
                                {adjustments.length > 0 && (
                                    <>
                                        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                                            Корректировки ({adjustments.length})
                                        </Typography>
                                        <TableContainer component={Paper}>
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell>Дата</TableCell>
                                                        <TableCell>Сумма</TableCell>
                                                        <TableCell>Описание</TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {adjustments.map(a => (
                                                        <TableRow key={a.id}>
                                                            <TableCell>
                                                                {new Date(a.startTime.seconds * 1000).toLocaleDateString()}
                                                            </TableCell>
                                                            <TableCell sx={{
                                                                color: (a.sessionEarnings || 0) >= 0 ? 'success.main' : 'error.main',
                                                                fontWeight: 'bold'
                                                            }}>
                                                                ${(a.sessionEarnings || 0).toFixed(2)}
                                                            </TableCell>
                                                            <TableCell>{a.description}</TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    </>
                                )}
                            </Box>
                        );
                    })()}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setHistoryEmployee(null)}>Закрыть</Button>
                    <Button
                        variant="contained"
                        color="success"
                        onClick={() => {
                            setPaymentEmployee(historyEmployee?.id || '');
                            setOpenPaymentDialog(true);
                            setHistoryEmployee(null);
                        }}
                    >
                        + Добавить платёж
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default FinancePage;
