import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { WorkSessionData } from '../../hooks/useActiveSession';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

interface ActiveSessionIndicatorProps {
    session: WorkSessionData;
}

const ActiveSessionIndicator: React.FC<ActiveSessionIndicatorProps> = ({ session }) => {
    const [elapsed, setElapsed] = useState<string>('00:00');
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();

    // Timer Logic
    useEffect(() => {
        if (!session.startTime) return;

        const updateTimer = () => {
            const now = new Date().getTime();
            const start = session.startTime.toMillis();
            let diff = now - start;

            // Subtract completed breaks
            if (session.totalBreakMinutes) {
                diff -= session.totalBreakMinutes * 60 * 1000;
            }

            // Subtract ongoing break if paused
            if (session.status === 'paused' && session.lastBreakStart) {
                diff -= (now - session.lastBreakStart.toMillis());
            }

            if (diff < 0) diff = 0;

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

            setElapsed(`${hours}h ${minutes}m`);
        };

        const interval = setInterval(updateTimer, 60000); // Update every minute
        updateTimer(); // Initial call

        return () => clearInterval(interval);
    }, [session.startTime, session.totalBreakMinutes, session.status, session.lastBreakStart]);

    const handleStop = async () => {
        try {
            const sessionRef = doc(db, 'work_sessions', session.id);
            const endTime = Timestamp.now();
            const startTime = session.startTime;
            let diffArr = 0;
            if (startTime) {
                diffArr = endTime.toMillis() - startTime.toMillis();
            }
            const durationMinutes = Math.round(diffArr / 1000 / 60);

            // Calculate earnings if rate exists
            const rate = session.hourlyRate || 0;
            const hours = durationMinutes / 60;
            const earnings = parseFloat((hours * rate).toFixed(2));

            await updateDoc(sessionRef, {
                status: 'completed',
                endTime: endTime,
                durationMinutes: durationMinutes,
                sessionEarnings: earnings
            });

            toast.success("Active session stopped", { icon: '⏹️' });
            setOpen(false);
        } catch (error) {
            console.error("Error stopping session:", error);
            toast.error("Failed to stop session");
        }
    };

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    bgcolor: 'primary.light',
                    color: 'white',
                    px: 1.5,
                    py: 0.5,
                    borderRadius: 2,
                    mx: 1,
                    transition: 'all 0.2s',
                    '&:hover': { bgcolor: 'primary.main', transform: 'scale(1.02)' }
                }}
                onClick={() => {
                    if (session.relatedTaskId) {
                        navigate(`/crm/gtd/${session.relatedTaskId}`);
                    } else {
                        setOpen(true);
                    }
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setOpen(true);
                }}
            >
                <AccessTimeIcon sx={{ fontSize: 16, mr: 1, animation: session.status === 'active' ? 'pulse 2s infinite' : 'none', color: session.status === 'paused' ? 'warning.main' : 'inherit' }} />
                <Typography variant="caption" fontWeight="bold" sx={{ mr: 1, color: session.status === 'paused' ? 'warning.main' : 'inherit' }}>
                    {session.status === 'paused' ? '⏸ ' : ''}{elapsed}
                </Typography>
                <Typography variant="caption" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.description || session.clientName || 'Working...'}
                </Typography>
            </Box>

            <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Active Session</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} pt={1}>
                        <Box>
                            <Typography variant="caption" color="text.secondary">Task / Description</Typography>
                            <Typography variant="body1" fontWeight="medium">
                                {session.description || 'No description'}
                            </Typography>
                        </Box>
                        <Box>
                            <Typography variant="caption" color="text.secondary">Client</Typography>
                            <Typography variant="body2">
                                {session.clientName || 'No Client'}
                            </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={1}>
                            <AccessTimeIcon color="action" />
                            <Typography variant="h4" color="primary.main">
                                {elapsed}
                            </Typography>
                        </Box>
                        {/* Future: Add Pause button here if needed */}
                    </Box>
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
                    <Box>
                        {session.relatedTaskId && (
                            <Button
                                color="info"
                                startIcon={<OpenInNewIcon />}
                                onClick={() => {
                                    setOpen(false);
                                    navigate(`/crm/gtd/${session.relatedTaskId}`);
                                }}
                            >
                                К Задаче
                            </Button>
                        )}
                    </Box>
                    <Box display="flex" gap={1}>
                        <Button onClick={() => setOpen(false)}>Close</Button>
                        <Button
                            onClick={handleStop}
                            variant="contained"
                            color="error"
                            startIcon={<StopIcon />}
                        >
                            Stop Work
                        </Button>
                    </Box>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ActiveSessionIndicator;
