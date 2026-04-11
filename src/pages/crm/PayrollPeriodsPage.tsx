import React, { useState, useEffect, useMemo } from 'react';
import {
    Container, Typography, Box, Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Button, Chip, CircularProgress, Alert, Dialog,
    DialogTitle, DialogContent, DialogActions, DialogContentText
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import DownloadIcon from '@mui/icons-material/Download';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase/firebase';
import { format, subMonths } from 'date-fns';
import { PayrollPeriod, getPeriodId, getPeriodDateRange } from '../../types/payroll.types';
import { errorMessage } from '../../utils/errorMessage';

interface ClosePayrollPeriodResponse {
    period?: {
        totalSessions?: number;
        totalHours?: number;
        totalAmount?: number;
    };
}

/**
 * Payroll Periods Management Page
 * 
 * Shows list of payroll periods with ability to close open periods.
 */
const PayrollPeriodsPage: React.FC = () => {
    const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
    const [loading, setLoading] = useState(true);
    const [closing, setClosing] = useState(false);
    const [locking, setLocking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Close / Lock period dialogs
    const [closePeriodDialog, setClosePeriodDialog] = useState<string | null>(null);
    const [lockPeriodDialog, setLockPeriodDialog] = useState<string | null>(null);

    // Generate list of last 12 months
    const recentPeriodIds = useMemo(() => {
        const ids: string[] = [];
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const date = subMonths(now, i);
            ids.push(getPeriodId(date));
        }
        return ids;
    }, []);

    useEffect(() => {
        fetchPeriods();
    }, []);

    const fetchPeriods = async () => {
        setLoading(true);
        try {
            const q = query(collection(db, 'payroll_periods'), orderBy('year', 'desc'), orderBy('month', 'desc'));
            const snapshot = await getDocs(q);
            const fetchedPeriods = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PayrollPeriod));
            setPeriods(fetchedPeriods);
        } catch (err) {
            console.error('Error fetching periods:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleClosePeriod = async (periodId: string) => {
        setClosing(true);
        setError(null);
        setSuccess(null);
        setClosePeriodDialog(null);

        try {
            const closePayrollPeriod = httpsCallable(functions, 'closePayrollPeriod');
            const result = await closePayrollPeriod({ periodId });
            const data = result.data as ClosePayrollPeriodResponse;

            setSuccess(`Period ${periodId} closed! Sessions: ${data.period?.totalSessions}, Hours: ${data.period?.totalHours}, Amount: $${data.period?.totalAmount}`);
            fetchPeriods(); // Refresh list
        } catch (err: unknown) {
            console.error('Error closing period:', err);
            setError(errorMessage(err) || 'Failed to close period');
        } finally {
            setClosing(false);
        }
    };

    const handleLockPeriod = async (periodId: string) => {
        setLocking(true);
        setError(null);
        setSuccess(null);
        setLockPeriodDialog(null);

        try {
            const lockPayrollPeriod = httpsCallable(functions, 'lockPayrollPeriod');
            await lockPayrollPeriod({ periodId });
            setSuccess(`Period ${periodId} locked! No further changes allowed.`);
            fetchPeriods();
        } catch (err: unknown) {
            console.error('Error locking period:', err);
            setError(errorMessage(err) || 'Failed to lock period');
        } finally {
            setLocking(false);
        }
    };

    const getStatusChip = (period: PayrollPeriod | undefined) => {
        if (!period) {
            return <Chip label="Not Created" size="small" color="default" icon={<PendingIcon />} />;
        }
        switch (period.status) {
            case 'paid':
                return <Chip label="Paid" size="small" color="success" icon={<CheckCircleIcon />} />;
            case 'locked':
                return <Chip label="Locked" size="small" color="error" icon={<LockIcon />} />;
            case 'closed':
                return <Chip label="Closed" size="small" color="primary" icon={<LockOpenIcon />} />;
            default:
                return <Chip label="Open" size="small" color="warning" icon={<PendingIcon />} />;
        }
    };

    const getPeriodData = (periodId: string): PayrollPeriod | undefined => {
        return periods.find(p => p.id === periodId);
    };

    const formatPeriodName = (periodId: string): string => {
        const { start } = getPeriodDateRange(periodId);
        return format(start, 'MMMM yyyy');
    };

    const canClose = (periodId: string): boolean => {
        const period = getPeriodData(periodId);
        if (period?.status === 'closed' || period?.status === 'paid') return false;

        // Can only close past months (not current month)
        const { end } = getPeriodDateRange(periodId);
        return end < new Date();
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            <Typography variant="h4" sx={{ mb: 3 }}>
                💰 Payroll Periods
            </Typography>

            {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

            {loading ? (
                <Box display="flex" justifyContent="center" py={4}>
                    <CircularProgress />
                </Box>
            ) : (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                                <TableCell><strong>Period</strong></TableCell>
                                <TableCell><strong>Status</strong></TableCell>
                                <TableCell align="right"><strong>Sessions</strong></TableCell>
                                <TableCell align="right"><strong>Hours</strong></TableCell>
                                <TableCell align="right"><strong>Amount</strong></TableCell>
                                <TableCell align="right"><strong>Employees</strong></TableCell>
                                <TableCell align="center"><strong>Actions</strong></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {recentPeriodIds.map(periodId => {
                                const period = getPeriodData(periodId);
                                const showClose = canClose(periodId);

                                return (
                                    <TableRow key={periodId} hover>
                                        <TableCell>
                                            <Typography fontWeight={500}>
                                                {formatPeriodName(periodId)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {periodId}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>{getStatusChip(period)}</TableCell>
                                        <TableCell align="right">{period?.totalSessions ?? '-'}</TableCell>
                                        <TableCell align="right">{period?.totalHours?.toFixed(1) ?? '-'}</TableCell>
                                        <TableCell align="right">
                                            {period?.totalAmount ? `$${period.totalAmount.toFixed(2)}` : '-'}
                                        </TableCell>
                                        <TableCell align="right">{period?.employeeCount ?? '-'}</TableCell>
                                        <TableCell align="center">
                                            <Box display="flex" gap={1} justifyContent="center" alignItems="center" flexWrap="wrap">
                                                {showClose && (
                                                    <Button
                                                        variant="contained"
                                                        size="small"
                                                        color="warning"
                                                        disabled={closing || locking}
                                                        onClick={() => setClosePeriodDialog(periodId)}
                                                    >
                                                        Close
                                                    </Button>
                                                )}
                                                {period?.status === 'closed' && (
                                                    <Button
                                                        variant="outlined"
                                                        size="small"
                                                        color="error"
                                                        startIcon={<LockIcon />}
                                                        disabled={closing || locking}
                                                        onClick={() => setLockPeriodDialog(periodId)}
                                                    >
                                                        Lock
                                                    </Button>
                                                )}
                                                {period?.status === 'locked' && (
                                                    <Typography variant="caption" color="error.main">
                                                        Locked {period.lockedAt?.toDate?.()?.toLocaleDateString() || ''}
                                                    </Typography>
                                                )}
                                                {period?.status === 'paid' && (
                                                    <Typography variant="caption" color="success.main">
                                                        Paid {period.paidAt?.toDate?.()?.toLocaleDateString() || ''}
                                                    </Typography>
                                                )}
                                            </Box>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Close Period Confirmation Dialog */}
            <Dialog open={!!closePeriodDialog} onClose={() => setClosePeriodDialog(null)}>
                <DialogTitle>Close Payroll Period?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to close <strong>{closePeriodDialog && formatPeriodName(closePeriodDialog)}</strong>?
                        <br /><br />
                        This will:
                        <ul>
                            <li>Aggregate all finalized sessions</li>
                            <li>Mark sessions as "processed"</li>
                            <li>Lock the period from further changes</li>
                        </ul>
                        This action cannot be undone.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setClosePeriodDialog(null)}>Cancel</Button>
                    <Button
                        onClick={() => closePeriodDialog && handleClosePeriod(closePeriodDialog)}
                        variant="contained"
                        color="warning"
                        disabled={closing}
                    >
                        {closing ? 'Closing...' : 'Close Period'}
                    </Button>
                </DialogActions>
            </Dialog>
            {/* Lock Period Confirmation Dialog */}
            <Dialog open={!!lockPeriodDialog} onClose={() => setLockPeriodDialog(null)}>
                <DialogTitle>Lock Payroll Period?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to <strong>lock</strong> <strong>{lockPeriodDialog && formatPeriodName(lockPeriodDialog)}</strong>?
                        <br /><br />
                        This will:
                        <ul>
                            <li>Prevent any new sessions from being added to this period</li>
                            <li>Block corrections and adjustments</li>
                            <li>Flag any backdated sessions as violations</li>
                        </ul>
                        <strong>This cannot be undone without database admin access.</strong>
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setLockPeriodDialog(null)}>Cancel</Button>
                    <Button
                        onClick={() => lockPeriodDialog && handleLockPeriod(lockPeriodDialog)}
                        variant="contained"
                        color="error"
                        startIcon={<LockIcon />}
                        disabled={locking}
                    >
                        {locking ? 'Locking...' : 'Lock Period'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default PayrollPeriodsPage;
