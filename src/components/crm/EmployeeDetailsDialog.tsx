import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button,
    Typography, Box, TextField, Tabs, Tab, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, Paper,
    CircularProgress, Chip, InputAdornment, List, ListItem, ListItemText, Divider
} from '@mui/material';
import { Timestamp, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db, functions } from '../../firebase/firebase';
import { httpsCallable } from 'firebase/functions';
import { updateEmployeeRate, getRateHistory, RateHistoryEntry, getEmployeeDetails } from '../../api/rateApi';
import { useAuth } from '../../auth/AuthContext';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import HistoryIcon from '@mui/icons-material/History';
import ChatIcon from '@mui/icons-material/Chat';

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

    // Message Tab State
    const [messageText, setMessageText] = useState('');
    const [messagesHistory, setMessagesHistory] = useState<any[]>([]);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (open && employeeId) {
            loadData();
            if (tabValue === 2) {
                loadMessages();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, employeeId, tabValue]);

    const loadMessages = async () => {
        try {
            const q = query(
                collection(db, 'worker_messages'),
                where('employeeId', '==', employeeId),
                orderBy('timestamp', 'desc')
            );
            const snapshot = await getDocs(q);
            setMessagesHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (error) {
            console.error('Failed to load messages history', error);
        }
    };

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
            await updateEmployeeRate(
                employeeId,
                rateNum,
                currentUser.uid,
                isPlatformUser,
                currentUser.displayName || 'Admin'
            );
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

    const handleSendMessage = async () => {
        if (!messageText.trim()) return;
        setSending(true);
        try {
            const sendWorkerMessage = httpsCallable(functions, 'sendWorkerMessage');
            await sendWorkerMessage({
                employeeId,
                message: messageText.trim()
            });
            alert('Сообщение успешно отправлено!');
            setMessageText('');
            loadMessages();
        } catch (error: any) {
            console.error('Error sending message:', error);
            alert(`Ошибка: ${error.message || 'Не удалось отправить сообщение'}`);
        } finally {
            setSending(false);
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
                        <Tab icon={<ChatIcon />} label="Message" iconPosition="start" />
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
                                disabled={!currentUser}
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
                                    <TableCell>Changed At</TableCell>
                                    <TableCell>Change</TableCell>
                                    <TableCell>Changed By</TableCell>
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
                                                <Box display="flex" alignItems="center" gap={1}>
                                                    {entry.previousRate !== undefined && (
                                                        <Chip label={`$${entry.previousRate}`} size="small" variant="outlined" style={{ opacity: 0.6 }} />
                                                    )}
                                                    {entry.previousRate !== undefined && <span>→</span>}
                                                    <Chip label={`$${entry.rate}`} size="small" color="primary" variant="outlined" />
                                                </Box>
                                            </TableCell>
                                            <TableCell sx={{ fontSize: '0.85rem' }}>
                                                {entry.setByName ? (
                                                    <Typography variant="body2">{entry.setByName}</Typography>
                                                ) : (
                                                    <Typography variant="caption" color="text.secondary" title={entry.setBy}>ID: {entry.setBy?.substring(0, 8)}...</Typography>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}

                {/* TAB 2: MESSAGES */}
                {tabValue === 2 && (
                    <Box>
                        <Typography variant="subtitle1" gutterBottom>Send Message to Telegram</Typography>
                        <Box display="flex" flexDirection="column" gap={2} mb={3}>
                            <TextField
                                label="Message text"
                                multiline
                                rows={3}
                                value={messageText}
                                onChange={(e) => setMessageText(e.target.value)}
                                placeholder="Напишите сообщение работнику..."
                                fullWidth
                                disabled={sending || !currentUser}
                            />
                            <Button
                                variant="contained"
                                onClick={handleSendMessage}
                                disabled={sending || !messageText.trim()}
                                sx={{ alignSelf: 'flex-start' }}
                                startIcon={sending && <CircularProgress size={16} />}
                            >
                                {sending ? 'Sending...' : 'Send Message'}
                            </Button>
                        </Box>

                        <Typography variant="subtitle2" gutterBottom>History</Typography>
                        <Paper variant="outlined" sx={{ maxHeight: 300, overflow: 'auto' }}>
                            <List dense>
                                {messagesHistory.length === 0 ? (
                                    <ListItem><ListItemText primary="No messages found" /></ListItem>
                                ) : (
                                    messagesHistory.map((msg, index) => (
                                        <React.Fragment key={msg.id}>
                                            <ListItem alignItems="flex-start">
                                                <ListItemText
                                                    primary={msg.message}
                                                    secondary={`Sent on ${formatDate(msg.timestamp)}`}
                                                />
                                            </ListItem>
                                            {index < messagesHistory.length - 1 && <Divider component="li" />}
                                        </React.Fragment>
                                    ))
                                )}
                            </List>
                        </Paper>
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default EmployeeDetailsDialog;
