import React, { useEffect, useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, IconButton,
    Typography, Box, CircularProgress, List, ListItem,
    ListItemText, Divider
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { collection, query, where, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

interface BotLog {
    id: string;
    action: string;
    details: Record<string, unknown>;
    timestamp: Timestamp | Date | string | null;
}

interface BotLogsViewerProps {
    open: boolean;
    onClose: () => void;
    workerId: string | number;
    workerName: string;
}

export const BotLogsViewer: React.FC<BotLogsViewerProps> = ({ open, onClose, workerId, workerName }) => {
    const [logs, setLogs] = useState<BotLog[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open || !workerId) return;

        const fetchLogs = async () => {
            setLoading(true);
            try {
                // query by workerId (Platform User ID or Telegram ID depending on how it was logged)
                const q = query(
                    collection(db, 'bot_logs'),
                    where('workerId', '==', workerId),
                    orderBy('timestamp', 'desc'),
                    limit(50)
                );

                const snapshot = await getDocs(q);
                const fetchedLogs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as BotLog[];

                setLogs(fetchedLogs);
            } catch (err) {
                console.error("Error fetching bot logs:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchLogs();
    }, [open, workerId]);

    const formatTime = (ts: Timestamp | Date | string | null) => {
        if (!ts) return '';
        let d: Date;
        if (ts instanceof Date) {
            d = ts;
        } else if (typeof ts === 'string') {
            d = new Date(ts);
        } else if (typeof (ts as Timestamp).toDate === 'function') {
            d = (ts as Timestamp).toDate();
        } else {
            return '';
        }
        return d.toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6">История Бота: {workerName}</Typography>
                    <IconButton onClick={onClose} size="small">
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers>
                {loading ? (
                    <Box display="flex" justifyContent="center" p={4}>
                        <CircularProgress />
                    </Box>
                ) : logs.length === 0 ? (
                    <Typography color="textSecondary" align="center" py={4}>
                        Логов для этого сотрудника пока нет.
                    </Typography>
                ) : (
                    <List disablePadding>
                        {logs.map((log, index) => (
                            <React.Fragment key={log.id}>
                                <ListItem alignItems="flex-start" sx={{ px: 0, py: 1.5 }}>
                                    <ListItemText
                                        primary={
                                            <Box display="flex" justifyContent="space-between" mb={0.5}>
                                                <Typography variant="subtitle2" fontWeight="bold" color="primary">
                                                    {log.action}
                                                </Typography>
                                                <Typography variant="caption" color="textSecondary">
                                                    {formatTime(log.timestamp)}
                                                </Typography>
                                            </Box>
                                        }
                                        secondary={
                                            <Box sx={{
                                                bgcolor: 'background.default',
                                                p: 1,
                                                borderRadius: 1,
                                                mt: 0.5,
                                                fontFamily: 'monospace',
                                                fontSize: '0.75rem',
                                                overflowX: 'auto'
                                            }}>
                                                {log.details ? JSON.stringify(log.details, null, 2) : 'No details'}
                                            </Box>
                                        }
                                    />
                                </ListItem>
                                {index < logs.length - 1 && <Divider component="li" />}
                            </React.Fragment>
                        ))}
                    </List>
                )}
            </DialogContent>
        </Dialog>
    );
};
