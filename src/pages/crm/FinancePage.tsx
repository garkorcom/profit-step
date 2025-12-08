import React, { useEffect, useState, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Chip, CircularProgress, Grid, Card, CardContent, Button, TextField,
    Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem,
    Avatar
} from '@mui/material';
import { collection, query, orderBy, getDocs, where, Timestamp, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';

interface PayrollEntry {
    id: string;
    type: 'work_session' | 'adjustment';
    date: Timestamp;
    employeeName: string;
    clientName: string;
    hours: number;
    hourlyRate: number;
    amount: number;
    description: string;
}

interface Employee {
    id: string;
    name: string;
    hourlyRate?: number;
}

const FinancePage: React.FC = () => {
    const [entries, setEntries] = useState<PayrollEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [startDate, setStartDate] = useState<Date>(subDays(startOfDay(new Date()), 30));
    const [endDate, setEndDate] = useState<Date>(endOfDay(new Date()));

    // Adjustment Dialog
    const [openAdjDialog, setOpenAdjDialog] = useState(false);
    const [adjEmployee, setAdjEmployee] = useState('');
    const [adjAmount, setAdjAmount] = useState('');
    const [adjDesc, setAdjDesc] = useState('');

    // Rates Dialog
    const [openRatesDialog, setOpenRatesDialog] = useState(false);
    const [employees, setEmployees] = useState<Employee[]>([]);

    useEffect(() => {
        fetchLedger();
        fetchEmployees();
    }, [startDate, endDate]);

    const fetchLedger = async () => {
        setLoading(true);
        try {
            const start = startOfDay(startDate);
            const end = endOfDay(endDate);

            const q = query(
                collection(db, 'payroll_ledger'),
                where('date', '>=', Timestamp.fromDate(start)),
                where('date', '<=', Timestamp.fromDate(end)),
                orderBy('date', 'desc')
            );

            const snapshot = await getDocs(q);
            setEntries(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PayrollEntry)));
        } catch (error) {
            console.error("Error fetching payroll:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchEmployees = async () => {
        const snap = await getDocs(collection(db, 'employees'));
        setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() } as Employee)));
    };

    const handleAddAdjustment = async () => {
        if (!adjEmployee || !adjAmount || !adjDesc) return;

        try {
            const employee = employees.find(e => e.id === adjEmployee);
            await addDoc(collection(db, 'payroll_ledger'), {
                type: 'adjustment',
                date: Timestamp.now(),
                processedAt: Timestamp.now(),
                employeeId: adjEmployee,
                employeeName: employee?.name || 'Unknown',
                clientName: 'Manual Adjustment',
                hours: 0,
                hourlyRate: 0,
                amount: parseFloat(adjAmount),
                description: adjDesc
            });
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
            await updateDoc(doc(db, 'employees', empId), { hourlyRate: rate });
            setEmployees(prev => prev.map(e => e.id === empId ? { ...e, hourlyRate: rate } : e));
        } catch (error) {
            console.error("Error updating rate:", error);
        }
    };

    const stats = useMemo(() => {
        const total = entries.reduce((sum, e) => sum + (e.amount || 0), 0);
        const hours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
        return { total, hours };
    }, [entries]);

    return (
        <Container maxWidth="xl" sx={{ py: 4 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
                <Typography variant="h4" fontWeight="bold">Finance & Payroll</Typography>
                <Box display="flex" gap={2}>
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
                        Add Adjustment
                    </Button>
                </Box>
            </Box>

            {/* Stats */}
            <Grid container spacing={3} mb={4}>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ bgcolor: '#1976d2', color: 'white' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Payroll (Period)</Typography>
                            <Typography variant="h3" fontWeight="bold">${stats.total.toFixed(2)}</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Total Hours Paid</Typography>
                            <Typography variant="h4" fontWeight="bold">{stats.hours.toFixed(1)} h</Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Filters */}
            <Paper sx={{ p: 2, mb: 3 }}>
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
                </Grid>
            </Paper>

            {/* Ledger Table */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Date</TableCell>
                            <TableCell>Employee</TableCell>
                            <TableCell>Type</TableCell>
                            <TableCell>Description</TableCell>
                            <TableCell align="right">Hours</TableCell>
                            <TableCell align="right">Rate</TableCell>
                            <TableCell align="right">Amount</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center"><CircularProgress /></TableCell>
                            </TableRow>
                        ) : entries.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} align="center">No records found</TableCell>
                            </TableRow>
                        ) : (
                            entries.map((entry) => (
                                <TableRow key={entry.id} hover>
                                    <TableCell>{new Date(entry.date.seconds * 1000).toLocaleDateString()}</TableCell>
                                    <TableCell>{entry.employeeName}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={entry.type === 'work_session' ? 'Work' : 'Adjustment'}
                                            color={entry.type === 'work_session' ? 'primary' : 'secondary'}
                                            size="small"
                                            variant="outlined"
                                        />
                                    </TableCell>
                                    <TableCell>{entry.description}</TableCell>
                                    <TableCell align="right">{entry.hours > 0 ? entry.hours : '-'}</TableCell>
                                    <TableCell align="right">{entry.hourlyRate > 0 ? `$${entry.hourlyRate}` : '-'}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold', color: entry.amount >= 0 ? 'green' : 'red' }}>
                                        ${entry.amount.toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            ))
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
        </Container>
    );
};

export default FinancePage;
