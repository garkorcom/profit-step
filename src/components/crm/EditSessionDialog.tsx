import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    FormControl, InputLabel, Select, MenuItem, Typography, Alert, Box,
    CircularProgress
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import WarningIcon from '@mui/icons-material/Warning';
import { WorkSession } from '../../types/timeTracking.types';
import { Timestamp, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';

interface Client {
    id: string;
    name: string;
}

interface EditSessionDialogProps {
    open: boolean;
    session: WorkSession | null;
    onClose: () => void;
    onSave: (sessionId: string, updates: Partial<WorkSession>) => Promise<void>;
    currentUserId?: string;
}

/**
 * Gets the start of a day (midnight)
 */
const getStartOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

/**
 * Checks if a session is within the edit window (today or yesterday)
 * Sessions from day-before-yesterday and earlier cannot be edited
 */
const isWithinEditWindow = (session: WorkSession): boolean => {
    if (!session.startTime) return false;

    // Already finalized or processed
    if (session.finalizationStatus === 'finalized' || session.finalizationStatus === 'processed') {
        return false;
    }

    const sessionDate = new Date(session.startTime.seconds * 1000);
    const today = getStartOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Can edit if session is from today or yesterday
    return sessionDate >= yesterday;
};

/**
 * Gets user-friendly message about edit window status
 */
const getEditWindowMessage = (session: WorkSession): { message: string; isUrgent: boolean } => {
    if (!session.startTime) return { message: '', isUrgent: false };

    const sessionDate = new Date(session.startTime.seconds * 1000);
    const today = getStartOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sessionDay = getStartOfDay(sessionDate);

    if (sessionDay.getTime() === today.getTime()) {
        return { message: '✏️ Session from today — can be edited until tomorrow night', isUrgent: false };
    } else if (sessionDay.getTime() === yesterday.getTime()) {
        return { message: '⚠️ Session from yesterday — edit closes tonight at 1:00 AM!', isUrgent: true };
    }

    return { message: '', isUrgent: false };
};


const EditSessionDialog: React.FC<EditSessionDialogProps> = ({
    open,
    session,
    onClose,
    onSave,
    currentUserId
}) => {
    // Form state
    const [clientId, setClientId] = useState('');
    const [clientName, setClientName] = useState('');
    const [description, setDescription] = useState('');
    const [hourlyRate, setHourlyRate] = useState<string>('');
    const [startTime, setStartTime] = useState('');
    const [endTime, setEndTime] = useState('');
    const [editNote, setEditNote] = useState('');

    // UI state
    const [saving, setSaving] = useState(false);
    const [clients, setClients] = useState<Client[]>([]);
    const [loadingClients, setLoadingClients] = useState(false);

    // Fetch clients for dropdown
    useEffect(() => {
        if (open) {
            fetchClients();
        }
    }, [open]);

    const fetchClients = async () => {
        setLoadingClients(true);
        try {
            const snapshot = await getDocs(collection(db, 'clients'));
            const clientsList = snapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name || 'Unknown'
            }));
            setClients(clientsList.sort((a, b) => a.name.localeCompare(b.name)));
        } catch (error) {
            console.error('Error fetching clients:', error);
        } finally {
            setLoadingClients(false);
        }
    };

    // Initialize form when session changes
    useEffect(() => {
        if (session) {
            setClientId(session.clientId || '');
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
                // Default to current time if no end time (convenience for editing active sessions)
                setEndTime(new Date().toISOString().slice(0, 16));
            }
            setEditNote('');
        }
    }, [session]);

    const handleClientChange = (newClientId: string) => {
        setClientId(newClientId);
        const selectedClient = clients.find(c => c.id === newClientId);
        if (selectedClient) {
            setClientName(selectedClient.name);
        }
    };

    const handleSave = async () => {
        if (!session || !editNote.trim()) return;

        setSaving(true);
        try {
            // Use Cloud Function with server-side validation
            const functions = getFunctions();
            const updateWorkSession = httpsCallable(functions, 'updateWorkSession');

            const result = await updateWorkSession({
                sessionId: session.id,
                newStartTime: startTime ? new Date(startTime).toISOString() : new Date(session.startTime.seconds * 1000).toISOString(),
                newEndTime: endTime ? new Date(endTime).toISOString() : (session.endTime ? new Date(session.endTime.seconds * 1000).toISOString() : new Date().toISOString()),
                editNote: editNote.trim(),
                clientId: clientId,
                clientName: clientName,
                description: description,
            });

            const data = result.data as { success: boolean; message: string; durationMinutes?: number; sessionEarnings?: number };

            if (data.success) {
                toast.success(data.message || 'Сессия обновлена');
                onClose();
                // Notify parent to refresh (onSave is now just for refresh trigger)
                await onSave(session.id, {});
            }
        } catch (error: any) {
            console.error("Error saving edit:", error);
            // Parse Cloud Function error message
            const errorMessage = error.message || 'Ошибка сохранения';
            if (errorMessage.includes('14')) {
                toast.error('Смена не может превышать 14 часов');
            } else if (errorMessage.includes('Пересечение')) {
                toast.error(errorMessage);
            } else if (errorMessage.includes('processed')) {
                toast.error('Нельзя редактировать обработанную сессию');
            } else {
                toast.error(errorMessage);
            }
        } finally {
            setSaving(false);
        }
    };

    if (!session) return null;

    const canEdit = isWithinEditWindow(session);
    const { message: editWindowMessage, isUrgent } = getEditWindowMessage(session);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Session</DialogTitle>
            <DialogContent>
                {/* Edit Window Status */}
                {canEdit ? (
                    <Alert
                        severity={isUrgent ? "warning" : "info"}
                        icon={isUrgent ? <WarningIcon /> : <AccessTimeIcon />}
                        sx={{ mb: 2 }}
                    >
                        <Typography variant="body2">
                            {editWindowMessage}
                        </Typography>
                    </Alert>
                ) : (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        <Typography variant="body2">
                            🔒 <strong>Edit window expired.</strong> This session can no longer be modified.
                            {session.finalizationStatus === 'processed' && ' It has been processed for payroll.'}
                        </Typography>
                    </Alert>
                )}

                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Edit Note - Required */}
                    <TextField
                        label="Edit Reason *"
                        fullWidth
                        required
                        disabled={!canEdit}
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="e.g. Forgot to clock out, wrong client selected"
                        helperText="Explain why you are editing this session"
                    />

                    {/* Client Selection */}
                    <FormControl fullWidth disabled={!canEdit || loadingClients}>
                        <InputLabel>Client / Object</InputLabel>
                        <Select
                            value={clientId}
                            label="Client / Object"
                            onChange={(e) => handleClientChange(e.target.value)}
                        >
                            {loadingClients ? (
                                <MenuItem disabled>
                                    <CircularProgress size={16} sx={{ mr: 1 }} /> Loading...
                                </MenuItem>
                            ) : (
                                clients.map(client => (
                                    <MenuItem key={client.id} value={client.id}>
                                        {client.name}
                                    </MenuItem>
                                ))
                            )}
                        </Select>
                    </FormControl>

                    {/* Hourly Rate */}
                    <TextField
                        label="Hourly Rate ($)"
                        type="number"
                        fullWidth
                        disabled={!canEdit}
                        value={hourlyRate}
                        onChange={(e) => setHourlyRate(e.target.value)}
                        inputProps={{ min: 0, step: 0.01 }}
                    />

                    {/* Time Fields */}
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            label="Start Time"
                            type="datetime-local"
                            fullWidth
                            disabled={!canEdit}
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                        <TextField
                            label="End Time"
                            type="datetime-local"
                            fullWidth
                            disabled={!canEdit}
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    </Box>

                    {/* Description */}
                    <TextField
                        label="Description"
                        fullWidth
                        multiline
                        rows={2}
                        disabled={!canEdit}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    {/* Show original values if previously edited */}
                    {session.isManuallyEdited && (
                        <Alert severity="info" sx={{ mt: 1 }}>
                            <Typography variant="caption">
                                <strong>Previously edited on:</strong> {session.editedAt?.toDate().toLocaleString()}<br />
                                <strong>Reason:</strong> {session.editNote || '-'}
                            </Typography>
                        </Alert>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>Cancel</Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={saving || !canEdit || !editNote.trim()}
                    color={isUrgent ? "warning" : "primary"}
                >
                    {saving ? 'Saving...' : 'Save Changes'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default EditSessionDialog;
