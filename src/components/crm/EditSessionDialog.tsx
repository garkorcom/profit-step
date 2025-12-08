import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    FormControl, InputLabel, Select, MenuItem, Grid
} from '@mui/material';
import { WorkSession } from '../../types/timeTracking.types';
import { Timestamp } from 'firebase/firestore';

interface EditSessionDialogProps {
    open: boolean;
    session: WorkSession | null;
    onClose: () => void;
    onSave: (sessionId: string, updates: Partial<WorkSession>) => Promise<void>;
}

const EditSessionDialog: React.FC<EditSessionDialogProps> = ({ open, session, onClose, onSave }) => {
    const [clientName, setClientName] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<'active' | 'completed' | 'paused' | 'auto_closed'>('completed');
    // Using string for datetime-local input (YYYY-MM-DDThh:mm)
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (session) {
            setClientName(session.clientName || '');
            setDescription(session.description || '');
            setStatus(session.status);

            // Format timestamps for input
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
        }
    }, [session]);

    const handleSave = async () => {
        if (!session) return;
        setSaving(true);
        try {
            const updates: Partial<WorkSession> = {
                clientName,
                description,
                status
            };

            if (startTime) {
                updates.startTime = Timestamp.fromDate(new Date(startTime));
            }
            if (endTime) {
                updates.endTime = Timestamp.fromDate(new Date(endTime));
            }

            // Recalculate duration if both exist
            if (updates.startTime && updates.endTime) {
                const diffMs = updates.endTime.toMillis() - updates.startTime.toMillis();
                updates.durationMinutes = Math.floor(diffMs / 1000 / 60);
            } else if (updates.startTime && session.endTime) { // Only start updated
                const diffMs = session.endTime.toMillis() - updates.startTime.toMillis();
                updates.durationMinutes = Math.floor(diffMs / 1000 / 60);
            } else if (session.startTime && updates.endTime) { // Only end updated
                const diffMs = updates.endTime.toMillis() - session.startTime.toMillis();
                updates.durationMinutes = Math.floor(diffMs / 1000 / 60);
            }

            await onSave(session.id, updates);
            onClose();
        } catch (error) {
            console.error("Error saving session:", error);
            // Optionally show error (toast)
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Session</DialogTitle>
            <DialogContent>
                <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid size={{ xs: 12 }}>
                        <TextField
                            label="Client / Object"
                            fullWidth
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                        />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                        <TextField
                            label="Description"
                            fullWidth
                            multiline
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                        <TextField
                            label="Start Time"
                            type="datetime-local"
                            fullWidth
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                        <TextField
                            label="End Time"
                            type="datetime-local"
                            fullWidth
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                        <FormControl fullWidth>
                            <InputLabel>Status</InputLabel>
                            <Select
                                value={status}
                                label="Status"
                                onChange={(e) => setStatus(e.target.value as any)}
                            >
                                <MenuItem value="active">Active</MenuItem>
                                <MenuItem value="completed">Completed</MenuItem>
                                <MenuItem value="paused">Paused</MenuItem>
                                <MenuItem value="auto_closed">Auto Closed</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} variant="contained" disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default EditSessionDialog;
