import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    Box, FormControl, InputLabel, Select, MenuItem, CircularProgress,
    FormLabel, RadioGroup, FormControlLabel, Radio
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

interface Client {
    id: string;
    name: string;
}

interface Employee {
    odooId: number | string;
    displayName: string;
}

interface AdminStartSessionDialogProps {
    open: boolean;
    preselectedEmployee?: { id: string | number; name: string };
    onClose: () => void;
    onConfirm: (employeeId: string | number, employeeName: string, clientId: string, clientName: string, reason: string, startTime: Date) => Promise<void>;
}

const AdminStartSessionDialog: React.FC<AdminStartSessionDialogProps> = ({
    open,
    preselectedEmployee,
    onClose,
    onConfirm
}) => {
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | number>('');
    const [selectedEmployeeName, setSelectedEmployeeName] = useState('');
    const [selectedClientId, setSelectedClientId] = useState('');
    const [selectedClientName, setSelectedClientName] = useState('');
    const [reason, setReason] = useState('');
    const [useCustomTime, setUseCustomTime] = useState(false);
    const [customStartTime, setCustomStartTime] = useState('');

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(false);
    const [loadingClients, setLoadingClients] = useState(false);
    const [saving, setSaving] = useState(false);

    // Fetch employees and clients
    useEffect(() => {
        if (open) {
            fetchEmployees();
            fetchClients();
            setCustomStartTime(new Date().toISOString().slice(0, 16));
            setReason('');
            setUseCustomTime(false);

            if (preselectedEmployee) {
                setSelectedEmployeeId(preselectedEmployee.id);
                setSelectedEmployeeName(preselectedEmployee.name);
            } else {
                setSelectedEmployeeId('');
                setSelectedEmployeeName('');
            }
            setSelectedClientId('');
            setSelectedClientName('');
        }
    }, [open, preselectedEmployee]);

    const fetchEmployees = async () => {
        setLoadingEmployees(true);
        try {
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('status', '==', 'active'));
            const snapshot = await getDocs(q);
            const list: Employee[] = snapshot.docs
                .filter(doc => doc.data().odooId)
                .map(doc => ({
                    odooId: doc.data().odooId,
                    displayName: doc.data().displayName || doc.data().email || 'Unknown'
                }));
            setEmployees(list.sort((a, b) => a.displayName.localeCompare(b.displayName)));
        } catch (error) {
            console.error('Error fetching employees:', error);
        } finally {
            setLoadingEmployees(false);
        }
    };

    const fetchClients = async () => {
        setLoadingClients(true);
        try {
            const snapshot = await getDocs(collection(db, 'clients'));
            const list = snapshot.docs.map(doc => ({
                id: doc.id,
                name: doc.data().name || 'Unknown'
            }));
            setClients(list.sort((a, b) => a.name.localeCompare(b.name)));
        } catch (error) {
            console.error('Error fetching clients:', error);
        } finally {
            setLoadingClients(false);
        }
    };

    const handleEmployeeChange = (employeeId: string | number) => {
        setSelectedEmployeeId(employeeId);
        const emp = employees.find(e => e.odooId === employeeId);
        setSelectedEmployeeName(emp?.displayName || '');
    };

    const handleClientChange = (clientId: string) => {
        setSelectedClientId(clientId);
        const client = clients.find(c => c.id === clientId);
        setSelectedClientName(client?.name || '');
    };

    const getStartTime = (): Date => {
        if (useCustomTime && customStartTime) {
            return new Date(customStartTime);
        }
        return new Date();
    };

    const canSubmit = (): boolean => {
        return !!selectedEmployeeId && !!selectedClientId && !!reason.trim();
    };

    const handleConfirm = async () => {
        if (!canSubmit()) return;

        setSaving(true);
        try {
            await onConfirm(
                selectedEmployeeId,
                selectedEmployeeName,
                selectedClientId,
                selectedClientName,
                reason.trim(),
                getStartTime()
            );
            onClose();
        } catch (error) {
            console.error('Error starting session:', error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <PlayArrowIcon color="success" />
                Запустить сессию (Admin)
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    {/* Employee Selection */}
                    <FormControl fullWidth disabled={loadingEmployees || !!preselectedEmployee}>
                        <InputLabel>Сотрудник</InputLabel>
                        <Select
                            value={selectedEmployeeId}
                            label="Сотрудник"
                            onChange={(e) => handleEmployeeChange(e.target.value)}
                        >
                            {loadingEmployees ? (
                                <MenuItem disabled>
                                    <CircularProgress size={16} sx={{ mr: 1 }} /> Загрузка...
                                </MenuItem>
                            ) : (
                                employees.map(emp => (
                                    <MenuItem key={emp.odooId} value={emp.odooId}>
                                        {emp.displayName}
                                    </MenuItem>
                                ))
                            )}
                        </Select>
                    </FormControl>

                    {/* Client Selection */}
                    <FormControl fullWidth disabled={loadingClients}>
                        <InputLabel>Клиент / Объект</InputLabel>
                        <Select
                            value={selectedClientId}
                            label="Клиент / Объект"
                            onChange={(e) => handleClientChange(e.target.value)}
                        >
                            {loadingClients ? (
                                <MenuItem disabled>
                                    <CircularProgress size={16} sx={{ mr: 1 }} /> Загрузка...
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

                    {/* Start Time Selection */}
                    <FormControl>
                        <FormLabel>Время начала</FormLabel>
                        <RadioGroup
                            value={useCustomTime ? 'custom' : 'now'}
                            onChange={(e) => setUseCustomTime(e.target.value === 'custom')}
                        >
                            <FormControlLabel value="now" control={<Radio />} label="Сейчас" />
                            <FormControlLabel value="custom" control={<Radio />} label="Указать время (раньше или позже)" />
                        </RadioGroup>
                    </FormControl>

                    {useCustomTime && (
                        <TextField
                            label="Время начала"
                            type="datetime-local"
                            value={customStartTime}
                            onChange={(e) => setCustomStartTime(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                            helperText="Можно указать любое время"
                        />
                    )}

                    {/* Reason */}
                    <TextField
                        label="Причина запуска администратором *"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        fullWidth
                        required
                        multiline
                        rows={2}
                        placeholder="Например: сотрудник забыл телефон, начал работу раньше..."
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={saving}>Отмена</Button>
                <Button
                    onClick={handleConfirm}
                    variant="contained"
                    color="success"
                    disabled={saving || !canSubmit()}
                    startIcon={<PlayArrowIcon />}
                >
                    {saving ? 'Запускаю...' : 'Запустить'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AdminStartSessionDialog;
