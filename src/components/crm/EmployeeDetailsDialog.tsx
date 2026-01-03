import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button,
    Typography, Box, TextField, Tabs, Tab, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, Paper,
    CircularProgress, Chip, InputAdornment
} from '@mui/material';
import { Timestamp } from 'firebase/firestore';
import { updateEmployeeRate, getRateHistory, RateHistoryEntry, getEmployeeDetails } from '../../api/rateApi';
import { useAuth } from '../../auth/AuthContext'; // Fixed path
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import HistoryIcon from '@mui/icons-material/History';
import ListAltIcon from '@mui/icons-material/ListAlt';

interface EmployeeDetailsDialogProps {
    open: boolean;
    onClose: () => void;
    // We pass basic info we have from the row
    employeeId: string;
    employeeName: string;
    // We try to guess if it's a platform user or simple employee based on data or try both
    // For simplicity in this app, let's assume we check 'employees' first (common for workers) or check the ID format.
    // Ideally the session object should tell us. For now we will try to look up.
}

const EmployeeDetailsDialog: React.FC<EmployeeDetailsDialogProps> = ({ open, onClose, employeeId, employeeName }) => {
    const { currentUser } = useAuth();
    const [tabValue, setTabValue] = useState(0);
    const [loading, setLoading] = useState(false);

    // Data
    const [currentRate, setCurrentRate] = useState<number | string>('');
    const [newRate, setNewRate] = useState<string>('');
    const [history, setHistory] = useState<RateHistoryEntry[]>([]);

    // Employee Metadata
    const [isPlatformUser, setIsPlatformUser] = useState(false); // Default to employees collection

    useEffect(() => {
        if (open && employeeId) {
            loadData();
        }
    }, [open, employeeId]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Try to find in 'employees' first (since this is Time Tracking for workers)
            // If not found, try 'users'
            // NOTE: In a real app we'd pass the type 'platform' vs 'worker' from the session. 
            // Here we do a quick check or assume 'employees' for simplicity if the ID is numeric (telegram ID).
            // A common pattern is Telegram IDs are numbers, Auth IDs are strings (28 chars).

            let isUser = false;
            let details = await getEmployeeDetails(employeeId, false); // Try employees

            if (!details) {
                details = await getEmployeeDetails(employeeId, true); // Try users
                if (details) isUser = true;
            }

            setIsPlatformUser(isUser);

            if (details) {
                setCurrentRate(details.hourlyRate || 0);
                setNewRate(String(details.hourlyRate || 0));

                // 2. Load History
                const hist = await getRateHistory(employeeId, isUser);
                setHistory(hist);
            }

        } catch (error) {
            console.error("Failed to load employee details", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveRate = async () => {
        if (!currentUser) return;
        const rateNum = parseFloat(newRate);
        if (isNaN(rateNum) || rateNum < 0) {
            alert("Please enter a valid rate");
            return;
        }

        try {
            setLoading(true);
            await updateEmployeeRate(employeeId, rateNum, currentUser.uid, isPlatformUser);
            setCurrentRate(rateNum);

            // Refresh history
            const hist = await getRateHistory(employeeId, isPlatformUser);
            setHistory(hist);

            alert("Rate updated successfully");
        } catch (e) {
            console.error(e);
            alert("Failed to update rate");
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (ts: Timestamp) => {
        if (!ts) return '-';
        return new Date(ts.seconds * 1000).toLocaleString();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                <Box>
                    <Typography variant="h6">{employeeName}</Typography>
                    <Typography variant="caption" color="text.secondary">ID: {employeeId}</Typography>
                </Box>
            </DialogTitle>
            <DialogContent>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                    <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
                        <Tab icon={<AttachMoneyIcon />} label="Rate Management" iconPosition="start" />
                        <Tab icon={<HistoryIcon />} label="Rate History" iconPosition="start" />
                        {/* <Tab icon={<ListAltIcon />} label="Sessions" iconPosition="start" /> */}
                    </Tabs>
                </Box>

                {loading && <CircularProgress size={24} sx={{ mb: 2 }} />}

                {/* TAB 0: RATE MANAGEMENT */}
                {tabValue === 0 && (
                    <Box component={Paper} p={3} variant="outlined">
                        <Typography variant="subtitle1" gutterBottom>Current Hourly Rate</Typography>
                        <Box display="flex" alignItems="center" gap={2} mt={2}>
                            <TextField
                                label="Hourly Rate ($)"
                                type="number"
                                value={newRate}
                                onChange={(e) => setNewRate(e.target.value)}
                                InputProps={{
                                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                                }}
                            />
                            <Button
                                variant="contained"
                                onClick={handleSaveRate}
                                disabled={loading || parseFloat(newRate) === currentRate}
                            >
                                Update Rate
                            </Button>
                        </Box>

                        <Box mt={4}>
                            <Typography variant="body2" color="text.secondary">
                                * Changing the rate here will apply to all <b>future</b> sessions.
                                Past sessions will retain the rate they were started with.
                            </Typography>
                        </Box>
                    </Box>
                )}

                {/* TAB 1: HISTORY */}
                {tabValue === 1 && (
                    <TableContainer component={Paper} variant="outlined">
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Effective Date</TableCell>
                                    <TableCell>Rate</TableCell>
                                    <TableCell>Set By (Admin ID)</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {history.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} align="center">No history found</TableCell>
                                    </TableRow>
                                ) : (
                                    history.map((entry) => (
                                        <TableRow key={entry.id}>
                                            <TableCell>{formatDate(entry.effectiveDate)}</TableCell>
                                            <TableCell>
                                                <Chip label={`$${entry.rate}`} size="small" color="primary" variant="outlined" />
                                            </TableCell>
                                            <TableCell sx={{ fontSize: '0.75rem', color: 'gray' }}>{entry.setBy}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default EmployeeDetailsDialog;
