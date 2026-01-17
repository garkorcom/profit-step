/**
 * @fileoverview Mobile-first модальное окно создания задачи
 * 
 * Features:
 * - Full-screen на мобильных
 * - Save & Add More с сохранением persistent полей
 * - Task Templates для быстрого заполнения
 * - Touch-friendly controls (44px min)
 * - Real-time validation
 */

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    Box,
    Typography,
    TextField,
    Button,
    IconButton,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    InputAdornment,
    ButtonGroup,
    Autocomplete,
    CircularProgress,
    useTheme,
    useMediaQuery,
    Divider,
} from '@mui/material';
import {
    Close as CloseIcon,
    Person as PersonIcon,
    People as PeopleIcon,
    Add as AddIcon,
    Remove as RemoveIcon,
    CalendarToday as CalendarIcon,
    AccessTime as TimeIcon,
} from '@mui/icons-material';
// Using native HTML5 date inputs instead of MUI DatePicker
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import { useAuth } from '../../../auth/AuthContext';
import toast from 'react-hot-toast';

import { useTaskForm } from './useTaskForm';
import {
    CreateTaskModalProps,
    CreateTaskDTO,
    TASK_TEMPLATES,
    TIME_PRESETS,
} from './CreateTaskModal.types';

// Touch target styles
const touchTargetSx = {
    minHeight: 48,
    '& .MuiInputBase-root': { minHeight: 48 },
};

interface Client {
    id: string;
    name: string;
    company?: string;
}

interface Employee {
    id: string;
    displayName: string;
    photoURL?: string;
    department?: string;
}

const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
    open,
    onClose,
    onSuccess,
    defaultClientId,
    defaultDate,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const { userProfile, currentUser } = useAuth();

    const {
        formState,
        setField,
        validateForm,
        resetForm,
        applyTemplate,
        incrementPeople,
        decrementPeople,
        isValid,
        tasksCreatedInSession,
        incrementTasksCreated,
    } = useTaskForm(defaultClientId, defaultDate);

    // Data
    const [clients, setClients] = useState<Client[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loadingClients, setLoadingClients] = useState(true);

    // Load clients
    useEffect(() => {
        const loadClients = async () => {
            if (!userProfile?.companyId) return;

            try {
                const q = query(
                    collection(db, 'clients'),
                    where('companyId', '==', userProfile.companyId)
                );
                const snap = await getDocs(q);
                setClients(snap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Client[]);
            } catch (err) {
                console.error('Failed to load clients:', err);
            } finally {
                setLoadingClients(false);
            }
        };

        if (open) {
            loadClients();
        }
    }, [open, userProfile?.companyId]);

    // Load employees
    useEffect(() => {
        const loadEmployees = async () => {
            if (!userProfile?.companyId) return;

            try {
                const q = query(
                    collection(db, 'users'),
                    where('companyId', '==', userProfile.companyId),
                    where('status', '==', 'active')
                );
                const snap = await getDocs(q);
                setEmployees(snap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Employee[]);
            } catch (err) {
                console.error('Failed to load employees:', err);
            }
        };

        if (open && formState.assigneeType === 'employee') {
            loadEmployees();
        }
    }, [open, userProfile?.companyId, formState.assigneeType]);

    // Combine date + time
    const combineDateAndTime = (date: Date, time: string | null): Date => {
        if (!time) return date;
        const [hours, minutes] = time.split(':').map(Number);
        const result = new Date(date);
        result.setHours(hours, minutes, 0, 0);
        return result;
    };

    // Format date for input
    const formatDateForInput = (date: Date | null): string => {
        if (!date) return '';
        return date.toISOString().split('T')[0];
    };

    // Parse date from input
    const parseDateFromInput = (value: string): Date | null => {
        if (!value) return null;
        return new Date(value + 'T00:00:00');
    };

    // Save task
    const saveTask = async (): Promise<boolean> => {
        if (!validateForm() || !currentUser || !userProfile) return false;

        setField('saving', true);

        try {
            const taskData: CreateTaskDTO = {
                assigneeId: formState.assigneeType === 'self'
                    ? currentUser.uid
                    : formState.assigneeId!,
                clientId: formState.clientId!,
                description: formState.description,
                cost: formState.cost,
                peopleCount: formState.peopleCount,
                plannedHours: formState.plannedHours,
                startDate: combineDateAndTime(formState.startDate, formState.startTime),
                endDate: formState.endDate
                    ? combineDateAndTime(formState.endDate, formState.endTime)
                    : null,
                priority: formState.priority,
                status: 'pending',
                createdAt: new Date(),
                createdBy: currentUser.uid,
                companyId: userProfile.companyId,
            };

            await addDoc(collection(db, 'tasks'), taskData);
            return true;
        } catch (error) {
            console.error('Failed to create task:', error);
            toast.error('Ошибка при создании задачи');
            return false;
        } finally {
            setField('saving', false);
        }
    };

    // Save & Close
    const handleSaveAndClose = async () => {
        const success = await saveTask();
        if (success) {
            toast.success('Задача создана');
            onSuccess?.();
            onClose();
            resetForm();
        }
    };

    // Save & Add More (киллер-фича!)
    const handleSaveAndAddMore = async () => {
        const success = await saveTask();
        if (success) {
            incrementTasksCreated();

            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate(50);
            }

            toast.success('Задача создана. Форма готова к следующей', {
                icon: '✅',
                duration: 2000,
            });

            // Reset with persistent fields
            resetForm(true);

            // Focus on description
            setTimeout(() => {
                document.getElementById('task-description')?.focus();
            }, 100);

            onSuccess?.();
        }
    };

    // Handle close
    const handleClose = () => {
        resetForm();
        onClose();
    };

    // Selected client
    const selectedClient = clients.find(c => c.id === formState.clientId) || null;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullScreen={isMobile}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    m: isMobile ? 0 : 2,
                    maxHeight: isMobile ? '100%' : '90vh',
                }
            }}
        >
            {/* Header */}
            <DialogTitle sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
            }}>
                <Typography variant="h6">Новая задача</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {tasksCreatedInSession > 0 && (
                        <Chip
                            label={`Создано: ${tasksCreatedInSession}`}
                            color="success"
                            size="small"
                        />
                    )}
                    <IconButton onClick={handleClose} edge="end">
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>

            <DialogContent sx={{ p: 2, pb: 12 }}>
                {/* Task Templates */}
                <Box sx={{
                    display: 'flex',
                    gap: 1,
                    overflowX: 'auto',
                    pb: 2,
                    mx: -2,
                    px: 2,
                    '&::-webkit-scrollbar': { display: 'none' },
                }}>
                    {TASK_TEMPLATES.map(template => (
                        <Chip
                            key={template.id}
                            label={`${template.icon} ${template.name}`}
                            onClick={() => applyTemplate(template)}
                            variant={formState.templateId === template.id ? 'filled' : 'outlined'}
                            color={formState.templateId === template.id ? 'primary' : 'default'}
                            sx={{ flexShrink: 0 }}
                        />
                    ))}
                </Box>

                {/* Assignee */}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                    Исполнитель
                </Typography>
                <ToggleButtonGroup
                    value={formState.assigneeType}
                    exclusive
                    onChange={(_, val) => val && setField('assigneeType', val)}
                    fullWidth
                    sx={{ mb: 2 }}
                >
                    <ToggleButton value="self" sx={{ minHeight: 48 }}>
                        <PersonIcon sx={{ mr: 1 }} /> Я
                    </ToggleButton>
                    <ToggleButton value="employee" sx={{ minHeight: 48 }}>
                        <PeopleIcon sx={{ mr: 1 }} /> Сотрудник
                    </ToggleButton>
                </ToggleButtonGroup>

                {formState.assigneeType === 'employee' && (
                    <Autocomplete
                        options={employees}
                        getOptionLabel={(emp) => emp.displayName}
                        value={employees.find(e => e.id === formState.assigneeId) || null}
                        onChange={(_, emp) => setField('assigneeId', emp?.id || null)}
                        renderInput={(params) => (
                            <TextField {...params} placeholder="Поиск сотрудника..." sx={touchTargetSx} />
                        )}
                        sx={{ mb: 2 }}
                    />
                )}

                {/* Client */}
                <Autocomplete
                    options={clients}
                    loading={loadingClients}
                    getOptionLabel={(client) => client.name}
                    value={selectedClient}
                    onChange={(_, client) => setField('clientId', client?.id || null)}
                    renderInput={(params) => (
                        <TextField
                            {...params}
                            label="Клиент *"
                            placeholder="Поиск клиента..."
                            error={!!formState.errors.clientId}
                            helperText={formState.errors.clientId}
                            sx={touchTargetSx}
                        />
                    )}
                    sx={{ mb: 2 }}
                />

                {/* Description (MOVED UP - before finances) */}
                <TextField
                    id="task-description"
                    label="Описание задачи *"
                    multiline
                    rows={3}
                    fullWidth
                    value={formState.description}
                    onChange={(e) => setField('description', e.target.value)}
                    error={!!formState.errors.description}
                    helperText={formState.errors.description}
                    placeholder="Что нужно сделать?"
                    sx={{ mb: 3, ...touchTargetSx }}
                />

                <Divider sx={{ my: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                        Финансы и ресурсы
                    </Typography>
                </Divider>

                {/* Finances Grid */}
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 2,
                    mb: 2,
                }}>
                    {/* Cost */}
                    <TextField
                        label="Стоимость"
                        type="number"
                        inputMode="decimal"
                        value={formState.cost || ''}
                        onChange={(e) => setField('cost', Number(e.target.value) || 0)}
                        InputProps={{
                            startAdornment: <InputAdornment position="start">$</InputAdornment>
                        }}
                        sx={touchTargetSx}
                    />

                    {/* People Stepper */}
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            Людей
                        </Typography>
                        <ButtonGroup fullWidth sx={{ mt: 0.5 }}>
                            <Button
                                onClick={decrementPeople}
                                disabled={formState.peopleCount <= 1}
                                sx={{ minHeight: 48 }}
                            >
                                <RemoveIcon />
                            </Button>
                            <Box sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: 1,
                                borderColor: 'divider',
                            }}>
                                <Typography variant="h6">{formState.peopleCount}</Typography>
                            </Box>
                            <Button onClick={incrementPeople} sx={{ minHeight: 48 }}>
                                <AddIcon />
                            </Button>
                        </ButtonGroup>
                    </Box>
                </Box>

                {/* Planned Hours */}
                <TextField
                    label="Планируемые часы"
                    type="number"
                    inputMode="numeric"
                    fullWidth
                    value={formState.plannedHours || ''}
                    onChange={(e) => setField('plannedHours', Number(e.target.value) || 0)}
                    InputProps={{
                        endAdornment: <InputAdornment position="end">ч</InputAdornment>
                    }}
                    sx={{ mb: 3, ...touchTargetSx }}
                />

                <Divider sx={{ my: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                        Планирование
                    </Typography>
                </Divider>

                {/* Priority */}
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        Приоритет
                    </Typography>
                    <ToggleButtonGroup
                        value={formState.priority}
                        exclusive
                        onChange={(_, val) => val && setField('priority', val)}
                        fullWidth
                    >
                        <ToggleButton value="low" sx={{ minHeight: 44 }}>
                            🟢 Обычный
                        </ToggleButton>
                        <ToggleButton value="medium" sx={{ minHeight: 44 }}>
                            🟡 Средний
                        </ToggleButton>
                        <ToggleButton value="high" sx={{ minHeight: 44 }}>
                            🔴 Срочный
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                {/* Start Date + Time */}
                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                        label="Дата старта *"
                        type="date"
                        value={formatDateForInput(formState.startDate)}
                        onChange={(e) => {
                            const date = parseDateFromInput(e.target.value);
                            if (date) setField('startDate', date);
                        }}
                        fullWidth
                        error={!!formState.errors.startDate}
                        InputLabelProps={{ shrink: true }}
                        sx={touchTargetSx}
                    />
                    <TextField
                        label="Время"
                        type="time"
                        value={formState.startTime || ''}
                        onChange={(e) => setField('startTime', e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ width: 140, ...touchTargetSx }}
                    />
                </Box>

                {/* Time presets */}
                <Box sx={{ display: 'flex', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
                    {TIME_PRESETS.map(time => (
                        <Chip
                            key={time}
                            label={time}
                            size="small"
                            variant={formState.startTime === time ? 'filled' : 'outlined'}
                            onClick={() => setField('startTime', time)}
                        />
                    ))}
                </Box>

                {/* End Date + Time */}
                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                    <TextField
                        label="Дата окончания"
                        type="date"
                        value={formatDateForInput(formState.endDate)}
                        onChange={(e) => setField('endDate', parseDateFromInput(e.target.value))}
                        fullWidth
                        error={!!formState.errors.endDate}
                        helperText={formState.errors.endDate}
                        InputLabelProps={{ shrink: true }}
                        inputProps={{ min: formatDateForInput(formState.startDate) }}
                        sx={touchTargetSx}
                    />
                    <TextField
                        label="Время"
                        type="time"
                        value={formState.endTime || ''}
                        onChange={(e) => setField('endTime', e.target.value)}
                        disabled={!formState.endDate}
                        InputLabelProps={{ shrink: true }}
                        sx={{ width: 140, ...touchTargetSx }}
                    />
                </Box>
            </DialogContent>

            {/* Sticky Footer */}
            <Box
                sx={{
                    position: 'fixed',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    p: 2,
                    bgcolor: 'background.paper',
                    borderTop: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    gap: 2,
                    pb: 'calc(16px + env(safe-area-inset-bottom))',
                    zIndex: theme.zIndex.modal + 1,
                }}
            >
                <Button
                    variant="outlined"
                    onClick={handleSaveAndClose}
                    disabled={!isValid || formState.saving}
                    fullWidth
                    sx={{ minHeight: 48 }}
                >
                    {formState.saving ? <CircularProgress size={20} /> : 'Сохранить'}
                </Button>

                <Button
                    variant="contained"
                    onClick={handleSaveAndAddMore}
                    disabled={!isValid || formState.saving}
                    fullWidth
                    sx={{ minHeight: 48 }}
                >
                    + Ещё
                </Button>
            </Box>
        </Dialog>
    );
};

export default CreateTaskModal;
