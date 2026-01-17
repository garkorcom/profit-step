/**
 * @fileoverview Mobile-first диалог быстрого добавления GTD задачи
 * 
 * Features:
 * - Full-screen на мобильных, диалог на desktop
 * - Task Templates для быстрого заполнения
 * - Save & Add More с сохранением клиента/исполнителя
 * - Touch-friendly controls (48px min height)
 * - Приоритеты с emoji индикаторами
 */

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Box,
    Typography,
    TextField,
    Button,
    IconButton,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    useTheme,
    useMediaQuery,
    Divider,
} from '@mui/material';
import {
    Close as CloseIcon,
    Person as PersonIcon,
    People as PeopleIcon,
} from '@mui/icons-material';
import toast from 'react-hot-toast';

import { GTDStatus, GTDPriority } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';

// Task templates for quick fill
const TASK_TEMPLATES = [
    { id: 'call', name: 'Звонок', icon: '📞' },
    { id: 'meeting', name: 'Встреча', icon: '🤝' },
    { id: 'email', name: 'Email', icon: '📧' },
    { id: 'review', name: 'Проверка', icon: '✅' },
    { id: 'prepare', name: 'Подготовка', icon: '📋' },
];

interface GTDQuickAddDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (title: string, columnId: GTDStatus, clientId?: string, assigneeId?: string, priority?: GTDPriority) => void;
    targetColumn: GTDStatus;
    clients: Client[];
    users: UserProfile[];
}

const GTDQuickAddDialog: React.FC<GTDQuickAddDialogProps> = ({
    open,
    onClose,
    onAdd,
    targetColumn,
    clients,
    users,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

    // Form state
    const [title, setTitle] = useState('');
    const [clientId, setClientId] = useState('');
    const [assigneeId, setAssigneeId] = useState('');
    const [priority, setPriority] = useState<GTDPriority>('none');
    const [saving, setSaving] = useState(false);
    const [tasksCreated, setTasksCreated] = useState(0);

    // Persistent values for "Save & Add More"
    const [persistentClientId, setPersistentClientId] = useState('');
    const [persistentAssigneeId, setPersistentAssigneeId] = useState('');

    // Reset on open
    useEffect(() => {
        if (open) {
            setTitle('');
            setClientId(persistentClientId);
            setAssigneeId(persistentAssigneeId);
            setPriority('none');
        }
    }, [open, persistentClientId, persistentAssigneeId]);

    // Reset counter on close
    useEffect(() => {
        if (!open) {
            setTasksCreated(0);
        }
    }, [open]);

    const handleSave = async (addMore: boolean) => {
        if (!title.trim()) return;

        setSaving(true);
        try {
            await onAdd(
                title.trim(),
                targetColumn,
                clientId || undefined,
                assigneeId || undefined,
                priority !== 'none' ? priority : undefined
            );

            if (addMore) {
                // Save & Add More
                setPersistentClientId(clientId);
                setPersistentAssigneeId(assigneeId);
                setTasksCreated(prev => prev + 1);

                // Haptic feedback
                if ('vibrate' in navigator) {
                    navigator.vibrate(50);
                }

                toast.success('Задача создана! Добавьте следующую', {
                    duration: 1500,
                    icon: '✅',
                });

                // Reset for next task
                setTitle('');
                setPriority('none');

                // Focus title input
                setTimeout(() => {
                    document.getElementById('gtd-task-title')?.focus();
                }, 100);
            } else {
                // Save & Close
                toast.success('Задача добавлена');
                handleClose();
            }
        } catch (error) {
            console.error('Failed to add task:', error);
            toast.error('Ошибка при создании задачи');
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        setTitle('');
        setClientId('');
        setAssigneeId('');
        setPriority('none');
        setPersistentClientId('');
        setPersistentAssigneeId('');
        onClose();
    };

    const applyTemplate = (template: typeof TASK_TEMPLATES[0]) => {
        setTitle(prev => prev ? `${prev} - ${template.name}` : template.name);
    };

    const getColumnName = (col: GTDStatus): string => {
        const names: Record<GTDStatus, string> = {
            inbox: 'Inbox',
            next_action: 'Next Actions',
            waiting: 'Waiting For',
            projects: 'Projects',
            someday: 'Someday',
            done: 'Done',
        };
        return names[col] || col;
    };

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
                    borderRadius: isMobile ? 0 : 3,
                }
            }}
        >
            {/* Header */}
            <DialogTitle sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                pb: 1,
                borderBottom: 1,
                borderColor: 'divider',
            }}>
                <Box>
                    <Typography variant="h6" component="span">
                        Добавить в {getColumnName(targetColumn)}
                    </Typography>
                    {tasksCreated > 0 && (
                        <Chip
                            label={`+${tasksCreated}`}
                            color="success"
                            size="small"
                            sx={{ ml: 1 }}
                        />
                    )}
                </Box>
                <IconButton onClick={handleClose} edge="end">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Templates */}
                <Box sx={{
                    display: 'flex',
                    gap: 1,
                    overflowX: 'auto',
                    pb: 1,
                    mx: -2,
                    px: 2,
                    '&::-webkit-scrollbar': { display: 'none' },
                }}>
                    {TASK_TEMPLATES.map(template => (
                        <Chip
                            key={template.id}
                            label={`${template.icon} ${template.name}`}
                            onClick={() => applyTemplate(template)}
                            variant="outlined"
                            sx={{ flexShrink: 0 }}
                        />
                    ))}
                </Box>

                {/* Title */}
                <TextField
                    id="gtd-task-title"
                    autoFocus
                    fullWidth
                    label="Название задачи *"
                    placeholder="Что нужно сделать?"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && title.trim() && !e.shiftKey) {
                            e.preventDefault();
                            handleSave(false);
                        }
                    }}
                    sx={{ '& .MuiInputBase-root': { minHeight: 48 } }}
                />

                {/* Priority */}
                <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                        Приоритет
                    </Typography>
                    <ToggleButtonGroup
                        value={priority}
                        exclusive
                        onChange={(_, val) => val !== null && setPriority(val)}
                        fullWidth
                        size="small"
                    >
                        <ToggleButton value="none" sx={{ minHeight: 40 }}>
                            ⚪ Нет
                        </ToggleButton>
                        <ToggleButton value="low" sx={{ minHeight: 40 }}>
                            🔵 Низкий
                        </ToggleButton>
                        <ToggleButton value="medium" sx={{ minHeight: 40 }}>
                            🟡 Средний
                        </ToggleButton>
                        <ToggleButton value="high" sx={{ minHeight: 40 }}>
                            🔴 Высокий
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                <Divider />

                {/* Client & Assignee */}
                <Box sx={{ display: 'flex', gap: 2, flexDirection: isMobile ? 'column' : 'row' }}>
                    <FormControl fullWidth size="small">
                        <InputLabel>Клиент</InputLabel>
                        <Select
                            value={clientId}
                            label="Клиент"
                            onChange={(e) => setClientId(e.target.value)}
                            sx={{ minHeight: 48 }}
                        >
                            <MenuItem value=""><em>Не выбран</em></MenuItem>
                            {clients.map(c => (
                                <MenuItem key={c.id} value={c.id}>
                                    {c.type === 'company' ? '🏢' : '👤'} {c.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth size="small">
                        <InputLabel>Исполнитель</InputLabel>
                        <Select
                            value={assigneeId}
                            label="Исполнитель"
                            onChange={(e) => setAssigneeId(e.target.value)}
                            sx={{ minHeight: 48 }}
                        >
                            <MenuItem value=""><em>Не выбран</em></MenuItem>
                            {users.map(u => (
                                <MenuItem key={u.id} value={u.id}>
                                    {u.displayName}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
            </DialogContent>

            {/* Footer with two buttons */}
            <DialogActions sx={{
                p: 2,
                gap: 1,
                borderTop: 1,
                borderColor: 'divider',
                flexDirection: isMobile ? 'column' : 'row',
            }}>
                <Button
                    variant="outlined"
                    onClick={() => handleSave(false)}
                    disabled={!title.trim() || saving}
                    fullWidth={isMobile}
                    sx={{ minHeight: 48 }}
                >
                    {saving ? <CircularProgress size={20} /> : 'Сохранить'}
                </Button>
                <Button
                    variant="contained"
                    onClick={() => handleSave(true)}
                    disabled={!title.trim() || saving}
                    fullWidth={isMobile}
                    sx={{ minHeight: 48 }}
                >
                    + Сохранить и добавить ещё
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default GTDQuickAddDialog;
