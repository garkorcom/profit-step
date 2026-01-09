import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    FormControl, InputLabel, Select, MenuItem, Grid, Typography, Alert, Box
} from '@mui/material';
import { WorkSession } from '../../types/timeTracking.types';
import { Timestamp } from 'firebase/firestore';

interface CorrectionSessionDialogProps {
    open: boolean;
    session: WorkSession | null;
    onClose: () => void;
    onSave: (correction: Partial<WorkSession>) => Promise<void>;
}

const CorrectionSessionDialog: React.FC<CorrectionSessionDialogProps> = ({ open, session, onClose, onSave }) => {
    // We display the "Target" state (what the user wants the session to look like)
    // But we calculate the Difference.
    const [clientName, setClientName] = useState('');
    const [description, setDescription] = useState('');
    const [hourlyRate, setHourlyRate] = useState<string>('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [correctionNode, setCorrectionNote] = useState('');

    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (session) {
            setClientName(session.clientName || '');
            setDescription(session.description || '');
            setHourlyRate(session.hourlyRate ? String(session.hourlyRate) : '');

            if (session.startTime) {
                setStartTime(new Date(session.startTime.seconds * 1000).toISOString().slice(0, 16));
            } else {
                setStartTime('');
            }

            if (session.endTime) {
                setEndTime(new Date(session.endTime.seconds * 1000).toISOString().slice(0, 16));
            } else {
                setEndTime('');
            }
            setCorrectionNote('');
        }
    }, [session]);

    const handleSave = async () => {
        if (!session) return;
        setSaving(true);
        try {
            // 1. Calculate Target Duration & Earnings
            let targetDurationMinutes = session.durationMinutes || 0;

            const startObj = startTime ? new Date(startTime) : null;
            const endObj = endTime ? new Date(endTime) : null;

            if (startObj && endObj) {
                const diffMs = endObj.getTime() - startObj.getTime();
                targetDurationMinutes = Math.floor(diffMs / 1000 / 60);
            }

            const targetRate = hourlyRate ? parseFloat(hourlyRate) : (session.hourlyRate || 0);
            let targetEarnings = 0;
            if (targetRate > 0 && targetDurationMinutes > 0) {
                targetEarnings = parseFloat(((targetDurationMinutes / 60) * targetRate).toFixed(2));
            }

            // 2. Calculate Deltas
            const originalDuration = session.durationMinutes || 0;
            const originalEarnings = session.sessionEarnings || 0;

            const deltaMinutes = targetDurationMinutes - originalDuration;
            const deltaEarnings = targetEarnings - originalEarnings;

            // 3. Construct Correction Object
            // Only proceed if there is a meaningful change
            if (deltaMinutes === 0 && deltaEarnings === 0 && clientName === session.clientName && description === session.description) {
                onClose();
                setSaving(false);
                return;
            }

            const correction: Partial<WorkSession> = {
                type: 'correction',
                relatedSessionId: session.id,
                startTime: Timestamp.now(), // Ledger date is NOW
                employeeId: session.employeeId,
                employeeName: session.employeeName,
                clientId: session.clientId,
                clientName: clientName, // Use updated client name

                // The correction itself has the DELTA duration/earnings
                durationMinutes: deltaMinutes,
                sessionEarnings: parseFloat(deltaEarnings.toFixed(2)),
                hourlyRate: targetRate, // Store the rate used for this correction calculation

                status: 'completed',
                description: `Correction: ${description}`,
                correctionNote: correctionNode || 'Manual correction via UI',
            };

            await onSave(correction);
            onClose();
        } catch (error) {
            console.error("Error saving correction:", error);
        } finally {
            setSaving(false);
        }
    };

    if (!session) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Correct Session</DialogTitle>
            <DialogContent>
                <Alert severity="info" sx={{ mb: 2 }}>
                    Changes created here will be saved as a separate <strong>Correction Entry</strong>.
                    The original session will remain unchanged.
                </Alert>

                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="Correction Note (Why are you changing this?)"
                        fullWidth
                        required
                        value={correctionNode}
                        onChange={(e) => setCorrectionNote(e.target.value)}
                        placeholder="e.g. Forgot to clock out"
                    />

                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="Client / Object"
                            fullWidth
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            sx={{ flex: 2 }}
                        />
                        <TextField
                            label="Hourly Rate ($)"
                            type="number"
                            fullWidth
                            value={hourlyRate}
                            onChange={(e) => setHourlyRate(e.target.value)}
                            sx={{ flex: 1 }}
                        />
                    </Box>

                    <TextField
                        label="Description"
                        fullWidth
                        multiline
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="Start Time"
                            type="datetime-local"
                            fullWidth
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            label="End Time"
                            type="datetime-local"
                            fullWidth
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} variant="contained" disabled={saving || !correctionNode}>
                    {saving ? 'Saving...' : 'Create Correction'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default CorrectionSessionDialog;
