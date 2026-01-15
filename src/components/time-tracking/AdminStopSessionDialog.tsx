import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    Typography, Box, Chip, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio
} from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import { WorkSession } from '../../types/timeTracking.types';

interface AdminStopSessionDialogProps {
    open: boolean;
    session: WorkSession | null;
    onClose: () => void;
    onConfirm: (session: WorkSession, reason: string, endTime: Date) => Promise<void>;
}

const PRESET_REASONS = [
    { label: 'Сотрудник забыл остановить', value: 'forgot_to_stop' },
    { label: 'Сел телефон сотрудника', value: 'phone_died' },
    { label: 'Другое', value: 'other' }
];

const AdminStopSessionDialog: React.FC<AdminStopSessionDialogProps> = ({
    open,
    session,
    onClose,
    onConfirm
}) => {
    const [selectedReason, setSelectedReason] = useState('forgot_to_stop');
    const [customReason, setCustomReason] = useState('');
    const [useCustomTime, setUseCustomTime] = useState(false);
    const [customEndTime, setCustomEndTime] = useState('');
    const [saving, setSaving] = useState(false);

    // Reset form when dialog opens
    useEffect(() => {
        if (open) {
            setSelectedReason('forgot_to_stop');
            setCustomReason('');
            setUseCustomTime(false);
            setCustomEndTime(new Date().toISOString().slice(0, 16));
        }
    }, [open]);

    const getReasonText = (): string => {
        if (selectedReason === 'other') {
            return customReason.trim() || 'Остановлено администратором';
        }
        return PRESET_REASONS.find(r => r.value === selectedReason)?.label || selectedReason;
    };

    const getEndTime = (): Date => {
        if (useCustomTime && customEndTime) {
            return new Date(customEndTime);
        }
        return new Date();
    };

    const isValidEndTime = (): boolean => {
        if (!useCustomTime) return true;
        if (!session?.startTime) return true;

        const endTime = new Date(customEndTime);
        const startTime = new Date(session.startTime.seconds * 1000);
        const now = new Date();

        // End time must be >= start time and <= now
        return endTime >= startTime && endTime <= now;
    };

    const canSubmit = (): boolean => {
        if (selectedReason === 'other' && !customReason.trim()) return false;
        if (!isValidEndTime()) return false;
        return true;
    };

    const handleConfirm = async () => {
        if (!session || !canSubmit()) return;

        setSaving(true);
        try {
            await onConfirm(session, getReasonText(), getEndTime());
            onClose();
        } catch (error) {
            console.error('Error stopping session:', error);
        } finally {
            setSaving(false);
        }
    };

    if (!session) return null;

    const sessionStart = session.startTime ? new Date(session.startTime.seconds * 1000) : null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <StopIcon color="error" />
                Остановить сессию (Admin)
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    {/* Session Info */}
                    <Box sx={{ bgcolor: 'grey.100', p: 2, borderRadius: 1 }}>
                        <Typography variant="body2" color="text.secondary">Сотрудник</Typography>
                        <Typography variant="body1" fontWeight="medium">{session.employeeName}</Typography>

                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Клиент</Typography>
                        <Typography variant="body1">{session.clientName || 'Без клиента'}</Typography>

                        {sessionStart && (
                            <>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Начало</Typography>
                                <Typography variant="body1">{sessionStart.toLocaleString()}</Typography>
                            </>
                        )}
                    </Box>

                    {/* End Time Selection */}
                    <FormControl>
                        <FormLabel>Время остановки</FormLabel>
                        <RadioGroup
                            value={useCustomTime ? 'custom' : 'now'}
                            onChange={(e) => setUseCustomTime(e.target.value === 'custom')}
                        >
                            <FormControlLabel value="now" control={<Radio />} label="Сейчас" />
                            <FormControlLabel value="custom" control={<Radio />} label="Указать время" />
                        </RadioGroup>
                    </FormControl>

                    {useCustomTime && (
                        <TextField
                            label="Время остановки"
                            type="datetime-local"
                            value={customEndTime}
                            onChange={(e) => setCustomEndTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                            error={!isValidEndTime()}
                            helperText={!isValidEndTime() ? 'Время должно быть между началом сессии и текущим моментом' : ''}
                            inputProps={{
                                max: new Date().toISOString().slice(0, 16),
                                min: sessionStart ? new Date(sessionStart.getTime() - sessionStart.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : undefined
                            }}
                        />
                    )}

                    {/* Reason Selection */}
                    <FormControl>
                        <FormLabel>Причина остановки</FormLabel>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                            {PRESET_REASONS.map(reason => (
                                <Chip
                                    key={reason.value}
                                    label={reason.label}
                                    onClick={() => setSelectedReason(reason.value)}
                                    color={selectedReason === reason.value ? 'primary' : 'default'}
                                    variant={selectedReason === reason.value ? 'filled' : 'outlined'}
                                />
                            ))}
                        </Box>
                    </FormControl>

                    {selectedReason === 'other' && (
                        <TextField
                            label="Укажите причину"
                            value={customReason}
                            onChange={(e) => setCustomReason(e.target.value)}
                            fullWidth
                            required
                            placeholder="Опишите причину остановки..."
                        />
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>Отмена</Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    color="error"
                    disabled={saving || !canSubmit()}
                    startIcon={<StopIcon />}
                >
                    {saving ? 'Останавливаю...' : 'Остановить'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AdminStopSessionDialog;
