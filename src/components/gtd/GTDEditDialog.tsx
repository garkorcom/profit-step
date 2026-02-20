import React, { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, FormControl, InputLabel, Select, MenuItem,
    Box, Chip, Typography, Grid, Accordion, AccordionSummary, AccordionDetails,
    useTheme, alpha, Paper, IconButton, InputAdornment, CircularProgress,
    Avatar, Autocomplete
} from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import PersonIcon from '@mui/icons-material/Person';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InboxIcon from '@mui/icons-material/Inbox';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';

import { useForm, Controller } from 'react-hook-form';
import { GTDTask, GTDStatus, GTDPriority, PRIORITY_COLORS, ChecklistItem } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { Timestamp, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { estimateTask } from '../../api/aiApi';
import { useClientUsageHistory } from '../../hooks/useClientUsageHistory';
import GlobalContactQuickAdd from '../contacts/GlobalContactQuickAdd';

interface GTDEditDialogProps {
    open: boolean;
    onClose: () => void;
    task: GTDTask | null;
    onSave: (taskId: string, data: Partial<GTDTask>) => Promise<void>;
    onDelete: (taskId: string) => Promise<void>;
    /** Pass from parent to avoid duplicate Firestore reads */
    propUsers?: UserProfile[];
    /** Pass from parent to avoid duplicate Firestore reads */
    propClients?: Client[];
}

interface FormData {
    title: string;
    description: string;
    context: string;
    clientId: string;
    assigneeId: string;
    status: GTDStatus;
    priority: GTDPriority;
    dueDate: string; // YYYY-MM-DD
    startDate: string; // YYYY-MM-DD
    estimatedDurationMinutes: number;
}



const PRIORITY_OPTIONS: { value: GTDPriority; label: string; color: string }[] = [
    { value: 'none', label: 'No priority', color: '#9ca3af' },
    { value: 'low', label: 'Low', color: PRIORITY_COLORS.low },
    { value: 'medium', label: 'Medium', color: PRIORITY_COLORS.medium },
    { value: 'high', label: 'High', color: PRIORITY_COLORS.high }
];

// Simplified Pipeline for Quick Edit
const STATUS_PIPELINE: { id: GTDStatus; label: string; icon: React.ReactNode }[] = [
    { id: 'inbox', label: 'Inbox', icon: <InboxIcon fontSize="small" /> },
    { id: 'next_action', label: 'Next', icon: <PlayArrowIcon fontSize="small" /> },
    { id: 'waiting', label: 'Waiting', icon: <AccessTimeIcon fontSize="small" /> },
    { id: 'done', label: 'Done', icon: <CheckCircleIcon fontSize="small" /> }
];

const GTDEditDialog: React.FC<GTDEditDialogProps> = ({ open, onClose, task, onSave, onDelete, propUsers, propClients }) => {
    const theme = useTheme();
    const { userProfile } = useAuth(); // Corrected usage check
    const { control, handleSubmit, reset, setValue, watch } = useForm<FormData>();
    const [startTime, setStartTime] = useState<string>('');
    const currentStatus = watch('status');
    const currentPriority = watch('priority');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const currentContext = watch('context'); // Kept for logic if needed

    const [users, setUsers] = useState<UserProfile[]>(propUsers || []);
    const [clients, setClients] = useState<Client[]>(propClients || []);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [expanded, setExpanded] = useState<boolean>(false);
    const [resourcesExpanded, setResourcesExpanded] = useState<boolean>(false);
    const { trackUsage, sortClients } = useClientUsageHistory(userProfile?.id);

    // AI & Resources State
    const [aiLoading, setAiLoading] = useState(false);
    const [crewSize, setCrewSize] = useState(1);
    const [hours, setHours] = useState('');
    const [cost, setCost] = useState('');
    const [aiReasoning, setAiReasoning] = useState('');
    const [localMaterials, setLocalMaterials] = useState<string[]>([]);
    const [localTools, setLocalTools] = useState<string[]>([]);
    const [newMaterial, setNewMaterial] = useState('');
    const [newTool, setNewTool] = useState('');
    const [hasAiData, setHasAiData] = useState(false);

    // Contacts Integration
    const [contacts, setContacts] = useState<any[]>([]);
    const [linkedContactIds, setLinkedContactIds] = useState<string[]>([]);
    const [globalContactOpen, setGlobalContactOpen] = useState(false);

    // Checklist State
    const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
    const [newChecklistText, setNewChecklistText] = useState('');

    // Co-assignees state
    const [coAssignees, setCoAssignees] = useState<Array<{ id: string; name: string; role: 'executor' | 'reviewer' | 'observer' }>>([]);

    const HOURLY_RATE = 95; // Default hourly rate

    // Sync from props when provided
    useEffect(() => {
        if (propUsers && propUsers.length > 0) setUsers(propUsers);
        if (propClients && propClients.length > 0) setClients(propClients);
    }, [propUsers, propClients]);

    useEffect(() => {
        const fetchData = async () => {
            // Only fetch if not provided via props
            if (!propUsers || propUsers.length === 0) {
                try {
                    const usersQ = query(collection(db, 'users'), orderBy('displayName'));
                    const usersSnap = await getDocs(usersQ);
                    setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
                } catch (e) { console.error("Error fetching users", e); }
            }
            if (!propClients || propClients.length === 0) {
                try {
                    const clientQ = query(collection(db, 'clients'), orderBy('name'));
                    const clientSnap = await getDocs(clientQ);
                    setClients(clientSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
                } catch (e) { console.error("Error fetching clients", e); }
            }
            try {
                const contactsQ = query(collection(db, 'contacts'), orderBy('name'));
                const contactsSnap = await getDocs(contactsQ);
                setContacts(contactsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (e) { console.error("Error fetching contacts", e); }
        };
        if (open) fetchData();
    }, [open, propUsers, propClients]);

    useEffect(() => {
        if (task) {
            // Helper to parse date field (can be Timestamp, string, or Date)
            const parseDateField = (d: any): Date | null => {
                if (!d) return null;
                if (d.seconds) return new Date(d.seconds * 1000);
                if (typeof d === 'string') return new Date(d);
                if (d instanceof Date) return d;
                return null;
            };

            const startDateTime = parseDateField(task.startDate);
            const dueDateParsed = parseDateField(task.dueDate);

            reset({
                title: task.title,
                description: task.description || '',
                context: task.context || '',
                clientId: task.clientId || '',
                // Default to current user if no assignee
                assigneeId: task.assigneeId || userProfile?.id || '',
                status: task.status,
                priority: task.priority || 'none',
                dueDate: dueDateParsed ? dueDateParsed.toISOString().split('T')[0] : '',
                startDate: startDateTime ? startDateTime.toISOString().split('T')[0] : '',
                // Default to 60 minutes (1 hour) if 0 or missing
                estimatedDurationMinutes: task.estimatedDurationMinutes || 60
            });

            if (startDateTime) {
                // Extract HH:MM
                const hh = String(startDateTime.getHours()).padStart(2, '0');
                const mm = String(startDateTime.getMinutes()).padStart(2, '0');
                setStartTime(`${hh}:${mm}`);
            } else {
                setStartTime('');
            }

            // Initialize AI-related state from task
            setCrewSize(task.crewSize || 1);
            // Default to '1' hour if missing
            setHours(task.estimatedDurationMinutes ? String(task.estimatedDurationMinutes / 60) : '1');
            setCost(task.estimatedCost ? String(task.estimatedCost) : '');
            setAiReasoning(task.aiReasoning || '');
            setLocalMaterials(task.selectedMaterials || task.aiMaterials || []);
            setLocalTools(task.selectedTools || task.aiTools || []);
            setHasAiData(!!task.aiEstimateUsed);
            setLinkedContactIds(task.linkedContactIds || []);

            // Initialize checklist
            setChecklistItems(task.checklistItems || []);
            setNewChecklistText('');

            // Initialize co-assignees
            setCoAssignees((task.coAssignees || []).map((ca: any) => ({
                id: ca.id,
                name: ca.name,
                role: ca.role || 'executor'
            })));
        }
    }, [task, reset, userProfile]);

    // AI Estimation Handler
    const handleAIEstimate = async () => {
        if (!task) return;

        const selectedAssignee = users.find(u => u.id === task.assigneeId);
        const employeeRole = selectedAssignee?.title || selectedAssignee?.role || 'Worker';
        const employeeRate = selectedAssignee?.hourlyRate || HOURLY_RATE;

        setAiLoading(true);

        try {
            const estimate = await estimateTask({
                task_description: task.title + (task.description ? '. ' + task.description : ''),
                employee_role: employeeRole,
                employee_hourly_rate: employeeRate,
                currency: 'USD',
            });

            setHours(String(estimate.estimated_hours));
            setCost(String(estimate.calculated_cost));
            setAiReasoning(estimate.reasoning || '');
            setLocalMaterials(estimate.suggested_materials || []);
            setLocalTools(estimate.suggested_tools || []);
            setHasAiData(true);

            // Haptic feedback
            if ('vibrate' in navigator) {
                navigator.vibrate([50, 30, 50]);
            }
        } catch (error) {
            console.error('AI Estimation failed:', error);
        } finally {
            setAiLoading(false);
        }
    };

    // Material/Tool handlers
    const addMaterial = () => {
        if (newMaterial.trim() && !localMaterials.includes(newMaterial.trim())) {
            setLocalMaterials([...localMaterials, newMaterial.trim()]);
            setNewMaterial('');
        }
    };

    const removeMaterial = (material: string) => {
        setLocalMaterials(localMaterials.filter(m => m !== material));
    };

    const addTool = () => {
        if (newTool.trim() && !localTools.includes(newTool.trim())) {
            setLocalTools([...localTools, newTool.trim()]);
            setNewTool('');
        }
    };

    const removeTool = (tool: string) => {
        setLocalTools(localTools.filter(t => t !== tool));
    };

    const onSubmit = async (data: FormData) => {
        if (!task) return;

        const selectedClient = clients.find(c => c.id === data.clientId);
        const selectedAssignee = users.find(u => u.id === data.assigneeId);

        // Build updates — ALWAYS set optional fields (null to clear)
        const updates: Partial<GTDTask> = {
            title: data.title,
            description: data.description || '',
            context: data.context || '',
            status: data.status,
            priority: data.priority || 'none',
            updatedAt: Timestamp.now(),
            // Always set client (null clears it)
            clientId: data.clientId || null,
            clientName: data.clientId ? (selectedClient?.name || '') : null,
            // Always set assignee (null clears it)
            assigneeId: data.assigneeId || null,
            assigneeName: data.assigneeId ? (selectedAssignee?.displayName || '') : null,
            // Always set dates (null clears them)
            dueDate: data.dueDate ? Timestamp.fromDate(new Date(data.dueDate + 'T00:00:00')) : null,
            estimatedDurationMinutes: data.estimatedDurationMinutes ? Number(data.estimatedDurationMinutes) : null,
        } as any;

        // Start date with optional time
        if (data.startDate) {
            const dateObj = new Date(data.startDate + 'T00:00:00');
            if (startTime) {
                const [hh, mm] = startTime.split(':').map(Number);
                dateObj.setHours(hh, mm);
            }
            (updates as any).startDate = Timestamp.fromDate(dateObj);
        } else {
            (updates as any).startDate = null;
        }

        // Handle "Needs Estimate" logic if status is 'estimate'
        if (data.status === 'estimate') {
            updates.needsEstimate = true;
        }

        // Auto-set completedAt if done
        if (data.status === 'done' && task.status !== 'done') {
            updates.completedAt = Timestamp.now();
        }
        // Clear completedAt if un-done
        if (data.status !== 'done' && task.status === 'done') {
            (updates as any).completedAt = null;
        }

        // AI & Resources fields
        if (hours) {
            updates.estimatedDurationMinutes = Math.round(Number(hours) * 60);
        }
        (updates as any).estimatedCost = cost ? Number(cost) : null;
        (updates as any).crewSize = crewSize > 0 ? crewSize : null;
        (updates as any).selectedMaterials = localMaterials.length > 0 ? localMaterials : [];
        (updates as any).selectedTools = localTools.length > 0 ? localTools : [];
        (updates as any).aiReasoning = aiReasoning || null;
        if (hasAiData) {
            updates.aiEstimateUsed = true;
        }

        // Checklist items
        updates.checklistItems = checklistItems.length > 0 ? checklistItems : [];

        // Linked Contacts
        updates.linkedContactIds = linkedContactIds;

        // Co-assignees
        updates.coAssignees = coAssignees.length > 0 ? coAssignees : [];
        (updates as any).coAssigneeIds = coAssignees.map(c => c.id);

        try {
            await onSave(task.id, updates);
            // Track client usage for smart sorting
            if (data.clientId) {
                trackUsage(data.clientId);
            }
            onClose();
        } catch (error) {
            console.error('Error saving task:', error);
            alert('Ошибка сохранения задачи. Проверьте консоль.');
        }
    };

    const handleDelete = async () => {
        if (!task) return;
        try {
            await onDelete(task.id);
            setDeleteConfirmOpen(false);
            onClose();
        } catch (error) {
            console.error('Error deleting task:', error);
        }
    };

    const handleStatusClick = (status: GTDStatus) => {
        setValue('status', status);
        // Auto-set completedAt when toggling to Done
        if (status === 'done' && task?.status !== 'done') {
            // completedAt will be set in onSubmit
        }
    };

    // Handle task acceptance by assignee
    const handleAcceptTask = async () => {
        if (!task || !userProfile) return;
        try {
            await onSave(task.id, {
                acceptedAt: Timestamp.now(),
                acceptedBy: userProfile.id
            });
        } catch (error) {
            console.error('Error accepting task:', error);
        }
    };

    // Check if current user can accept the task
    const canAcceptTask = task && userProfile &&
        task.assigneeId === userProfile.id &&
        task.ownerId !== userProfile.id &&
        !task.acceptedAt;

    const isTaskAccepted = !!task?.acceptedAt;

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{
            sx: { borderRadius: 3, p: 1 }
        }}>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogTitle sx={{ px: 2, pb: 1, pt: 2 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="h6" fontWeight="bold">Quick Edit</Typography>
                        <Box display="flex" alignItems="center" gap={1}>
                            {/* Accept Button or Status */}
                            {isTaskAccepted && (
                                <Chip
                                    size="small"
                                    icon={<CheckCircleIcon />}
                                    label="Принял ✓"
                                    color="success"
                                    variant="outlined"
                                />
                            )}
                            {canAcceptTask && (
                                <Button
                                    size="small"
                                    variant="contained"
                                    color="success"
                                    onClick={handleAcceptTask}
                                    startIcon={<CheckCircleIcon />}
                                    sx={{ borderRadius: 2 }}
                                >
                                    Принял
                                </Button>
                            )}
                        </Box>
                    </Box>
                    {/* Author and Created info */}
                    <Box display="flex" gap={2} mt={0.5}>
                        {task?.ownerName && (
                            <Typography variant="caption" color="text.secondary">
                                Автор: <strong>{task.ownerName}</strong>
                            </Typography>
                        )}
                        {task?.createdAt && (
                            <Typography variant="caption" color="text.secondary">
                                Создано: {new Date(task.createdAt.seconds * 1000).toLocaleDateString()}
                            </Typography>
                        )}
                    </Box>
                </DialogTitle>

                <DialogContent sx={{ px: 2, py: 1 }}>
                    <Box display="flex" flexDirection="column" gap={3}>

                        {/* 1. Status Pipeline */}
                        <Box sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            bgcolor: alpha(theme.palette.primary.main, 0.05),
                            p: 1,
                            borderRadius: 2
                        }}>
                            {STATUS_PIPELINE.map((step) => {
                                const isActive = currentStatus === step.id;
                                return (
                                    <Chip
                                        key={step.id}
                                        label={step.label}
                                        icon={step.icon as React.ReactElement}
                                        onClick={() => handleStatusClick(step.id)}
                                        color={isActive ? "primary" : "default"}
                                        variant={isActive ? "filled" : "outlined"}
                                        sx={{
                                            fontWeight: isActive ? 600 : 400,
                                            border: isActive ? 'none' : '1px solid transparent',
                                            '&:hover': { border: `1px solid ${theme.palette.primary.main}` }
                                        }}
                                    />
                                );
                            })}
                        </Box>

                        {/* 2. Main Title */}
                        <Controller
                            name="title"
                            control={control}
                            rules={{ required: true }}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    placeholder="Task Title"
                                    variant="standard"
                                    fullWidth
                                    InputProps={{ style: { fontSize: '1.2rem', fontWeight: 500 } }}
                                />
                            )}
                        />

                        {/* 3. Timeline Grid (2x2) */}
                        {/* Use Grid2 as Grid, expecting size prop instead of xs/item */}
                        {/* 3. Removed old Timeline Grid (Moved to bottom) */}

                        {/* 4. Description (Moved Up) */}
                        <Controller
                            name="description"
                            control={control}
                            rules={{ required: true }}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Что нужно сделать? *"
                                    placeholder="Опишите задачу..."
                                    multiline
                                    rows={3}
                                    fullWidth
                                    variant="outlined"
                                    sx={{ bgcolor: 'background.paper' }}
                                />
                            )}
                        />

                        {/* 4.5. Checklist Section */}
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
                                📋 Чек-лист {checklistItems.length > 0 && `(${checklistItems.filter(i => i.completed).length}/${checklistItems.length})`}
                            </Typography>

                            {checklistItems.length > 0 && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                                    {checklistItems.map((item) => (
                                        <Box
                                            key={item.id}
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.5,
                                                p: 0.75,
                                                borderRadius: 1.5,
                                                bgcolor: item.completed ? alpha(theme.palette.success.main, 0.08) : 'transparent',
                                                '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.08) },
                                                transition: 'all 0.2s',
                                            }}
                                        >
                                            <IconButton
                                                size="small"
                                                onClick={() => {
                                                    setChecklistItems(prev => prev.map(ci =>
                                                        ci.id === item.id
                                                            ? {
                                                                ...ci,
                                                                completed: !ci.completed,
                                                                completedAt: !ci.completed ? Timestamp.now() : undefined
                                                            }
                                                            : ci
                                                    ));
                                                }}
                                                sx={{ p: 0.5 }}
                                            >
                                                {item.completed
                                                    ? <CheckBoxIcon fontSize="small" color="success" />
                                                    : <CheckBoxOutlineBlankIcon fontSize="small" color="action" />
                                                }
                                            </IconButton>
                                            <Typography
                                                sx={{
                                                    flex: 1,
                                                    fontSize: '0.875rem',
                                                    textDecoration: item.completed ? 'line-through' : 'none',
                                                    color: item.completed ? 'text.secondary' : 'text.primary',
                                                }}
                                            >
                                                {item.text}
                                            </Typography>
                                            <IconButton
                                                size="small"
                                                onClick={() => setChecklistItems(prev => prev.filter(ci => ci.id !== item.id))}
                                                sx={{ p: 0.5, opacity: 0.5, '&:hover': { opacity: 1 } }}
                                            >
                                                <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    ))}
                                </Box>
                            )}

                            {/* Add new checklist item */}
                            <TextField
                                fullWidth
                                size="small"
                                value={newChecklistText}
                                onChange={(e) => setNewChecklistText(e.target.value)}
                                placeholder="Добавить пункт..."
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && newChecklistText.trim()) {
                                        e.preventDefault();
                                        const newItem: ChecklistItem = {
                                            id: nanoid(10),
                                            text: newChecklistText.trim(),
                                            completed: false,
                                            createdAt: Timestamp.now(),
                                        };
                                        setChecklistItems(prev => [...prev, newItem]);
                                        setNewChecklistText('');
                                    }
                                }}
                                InputProps={{
                                    endAdornment: (
                                        <IconButton
                                            size="small"
                                            onClick={() => {
                                                if (newChecklistText.trim()) {
                                                    const newItem: ChecklistItem = {
                                                        id: nanoid(10),
                                                        text: newChecklistText.trim(),
                                                        completed: false,
                                                        createdAt: Timestamp.now(),
                                                    };
                                                    setChecklistItems(prev => [...prev, newItem]);
                                                    setNewChecklistText('');
                                                }
                                            }}
                                            disabled={!newChecklistText.trim()}
                                        >
                                            <AddIcon fontSize="small" />
                                        </IconButton>
                                    )
                                }}
                            />
                        </Box>

                        {/* 5. Resources & Finance (Accordion) */}
                        <Accordion expanded={resourcesExpanded} onChange={() => setResourcesExpanded(!resourcesExpanded)} disableGutters elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: '8px !important', '&:before': { display: 'none' }, bgcolor: alpha(theme.palette.grey[500], 0.05) }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
                                    Ресурсы и финансы
                                </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Box display="flex" flexDirection="column" gap={2}>
                                    {/* Assignee Selection (Moved here) */}
                                    <Controller
                                        name="assigneeId"
                                        control={control}
                                        render={({ field }) => (
                                            <FormControl fullWidth size="small">
                                                <InputLabel>Исполнитель</InputLabel>
                                                <Select {...field} label="Исполнитель" displayEmpty>
                                                    <MenuItem value=""><em>Не назначен</em></MenuItem>
                                                    {users.map(u => (
                                                        <MenuItem key={u.id} value={u.id}>
                                                            <Box display="flex" alignItems="center" gap={1}>
                                                                <PersonIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                                                                {u.displayName}
                                                            </Box>
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        )}
                                    />

                                    {/* Co-assignees */}
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, mt: 1.5, display: 'block' }}>
                                        Соисполнители
                                    </Typography>
                                    {coAssignees.length > 0 && (
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                                            {coAssignees.map(ca => (
                                                <Box key={ca.id} display="flex" alignItems="center" gap={0.5}>
                                                    <Chip
                                                        label={ca.name}
                                                        size="small"
                                                        avatar={<Avatar sx={{ width: 18, height: 18 }}>{ca.name?.charAt(0)}</Avatar>}
                                                        onDelete={() => setCoAssignees(prev => prev.filter(c => c.id !== ca.id))}
                                                        sx={{ flexShrink: 0 }}
                                                    />
                                                    <Box
                                                        component="select"
                                                        value={ca.role}
                                                        onChange={(e: any) => setCoAssignees(prev => prev.map(c =>
                                                            c.id === ca.id ? { ...c, role: e.target.value } : c
                                                        ))}
                                                        style={{
                                                            border: '1px solid #ccc',
                                                            borderRadius: 4,
                                                            padding: '2px 4px',
                                                            fontSize: '0.7rem',
                                                            background: 'transparent',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        <option value="executor">Исполнитель</option>
                                                        <option value="reviewer">Ревьюер</option>
                                                        <option value="observer">Наблюдатель</option>
                                                    </Box>
                                                </Box>
                                            ))}
                                        </Box>
                                    )}
                                    <Autocomplete
                                        value={null}
                                        options={users.filter(u => !coAssignees.some(ca => ca.id === u.id))}
                                        getOptionLabel={(opt) => opt.displayName || ''}
                                        onChange={(_, newVal) => {
                                            if (newVal) {
                                                setCoAssignees(prev => [...prev, { id: newVal.id, name: newVal.displayName || '', role: 'executor' as const }]);
                                            }
                                        }}
                                        renderInput={(params) => (
                                            <TextField {...params} label="Добавить соисполнителя" size="small" />
                                        )}
                                        size="small"
                                        blurOnSelect
                                        clearOnBlur
                                        sx={{ mb: 1 }}
                                    />

                                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                                        {/* Crew Size Stepper */}
                                        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', borderRadius: 2, minWidth: 100 }}>
                                            <IconButton size="small" onClick={() => setCrewSize(Math.max(1, crewSize - 1))} disabled={crewSize <= 1}>
                                                <RemoveIcon fontSize="small" />
                                            </IconButton>
                                            <Box sx={{ flex: 1, textAlign: 'center', px: 1 }}>
                                                <Typography variant="body1" fontWeight={600}>{crewSize}</Typography>
                                                <Typography variant="caption" color="text.secondary">чел</Typography>
                                            </Box>
                                            <IconButton size="small" onClick={() => setCrewSize(Math.min(20, crewSize + 1))}>
                                                <AddIcon fontSize="small" />
                                            </IconButton>
                                        </Paper>

                                        {/* Hours */}
                                        <TextField
                                            type="number"
                                            inputMode="numeric"
                                            value={hours}
                                            onChange={(e) => setHours(e.target.value)}
                                            placeholder="Часы"
                                            size="small"
                                            sx={{ width: 100 }}
                                            InputProps={{
                                                endAdornment: <InputAdornment position="end">ч</InputAdornment>
                                            }}
                                        />

                                        {/* Cost */}
                                        <TextField
                                            type="number"
                                            inputMode="decimal"
                                            value={cost}
                                            onChange={(e) => setCost(e.target.value)}
                                            placeholder="Стоимость"
                                            size="small"
                                            sx={{ width: 120 }}
                                            InputProps={{
                                                startAdornment: <InputAdornment position="start">$</InputAdornment>
                                            }}
                                        />

                                        {/* Auto-calc hint */}
                                        {!cost && hours && (
                                            <Button
                                                size="small"
                                                onClick={() => setCost(String(Math.round(Number(hours) * crewSize * HOURLY_RATE)))}
                                                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                                            >
                                                💡 ${Math.round(Number(hours) * crewSize * HOURLY_RATE)}
                                            </Button>
                                        )}
                                    </Box>
                                </Box>
                            </AccordionDetails>
                        </Accordion>

                        {/* 6. AI Estimation */}
                        <Box sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05), p: 2, borderRadius: 2 }}>
                            {/* AI Button */}
                            <Button
                                fullWidth
                                variant="outlined"
                                onClick={handleAIEstimate}
                                disabled={aiLoading}
                                startIcon={aiLoading ? <CircularProgress size={18} /> : hasAiData ? <RefreshIcon /> : <AutoAwesomeIcon />}
                                sx={{
                                    py: 1,
                                    borderRadius: 2,
                                    borderStyle: 'dashed',
                                    borderColor: hasAiData ? 'success.main' : 'primary.main',
                                    color: hasAiData ? 'success.dark' : 'primary.main',
                                }}
                            >
                                {aiLoading ? 'AI анализирует...' : hasAiData ? '🔄 Перегенерировать AI' : '✨ AI-расчёт'}
                            </Button>

                            {/* AI Reasoning */}
                            {aiReasoning && (
                                <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: 'info.50', borderColor: 'info.200' }}>
                                    <Typography variant="caption" color="info.dark">
                                        💡 {aiReasoning}
                                    </Typography>
                                </Paper>
                            )}

                            {/* Materials */}
                            {(localMaterials.length > 0 || hasAiData) && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                        📦 Материалы
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                                        {localMaterials.map((m, i) => (
                                            <Chip
                                                key={i}
                                                label={m}
                                                size="small"
                                                onDelete={() => removeMaterial(m)}
                                                deleteIcon={<CloseIcon fontSize="small" />}
                                                color="primary"
                                                variant="outlined"
                                            />
                                        ))}
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <TextField
                                            size="small"
                                            placeholder="Добавить материал..."
                                            value={newMaterial}
                                            onChange={(e) => setNewMaterial(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addMaterial())}
                                            sx={{ flex: 1 }}
                                        />
                                        <IconButton onClick={addMaterial} color="primary" size="small">
                                            <AddIcon />
                                        </IconButton>
                                    </Box>
                                </Box>
                            )}

                            {/* Tools */}
                            {(localTools.length > 0 || hasAiData) && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                        🔧 Инструменты
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                                        {localTools.map((t, i) => (
                                            <Chip
                                                key={i}
                                                label={t}
                                                size="small"
                                                onDelete={() => removeTool(t)}
                                                deleteIcon={<CloseIcon fontSize="small" />}
                                                color="secondary"
                                                variant="outlined"
                                            />
                                        ))}
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <TextField
                                            size="small"
                                            placeholder="Добавить инструмент..."
                                            value={newTool}
                                            onChange={(e) => setNewTool(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTool())}
                                            sx={{ flex: 1 }}
                                        />
                                        <IconButton onClick={addTool} color="secondary" size="small">
                                            <AddIcon />
                                        </IconButton>
                                    </Box>
                                </Box>
                            )}
                        </Box>

                        {/* 6. Estimate Button */}
                        <Button
                            variant={currentStatus === 'estimate' ? "contained" : "outlined"}
                            color="secondary"
                            fullWidth
                            onClick={() => setValue('status', 'estimate')}
                            startIcon={<span style={{ fontSize: '1.2rem' }}>📐</span>}
                            sx={{ borderStyle: 'dashed', py: 1 }}
                        >
                            Требует просчёт (отправить в Estimate)
                        </Button>

                        {/* 7. When / Timing Section (Reorganized) */}
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                                Когда
                            </Typography>
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 6 }}>
                                    <Controller
                                        name="startDate"
                                        control={control}
                                        render={({ field }) => (
                                            <TextField
                                                {...field}
                                                label="Дата начала"
                                                type="date"
                                                fullWidth
                                                size="small"
                                                InputLabelProps={{ shrink: true }}
                                                InputProps={{ startAdornment: <PlayArrowIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                                            />
                                        )}
                                    />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <TextField
                                        label="Время начала (опц.)"
                                        type="time"
                                        fullWidth
                                        size="small"
                                        value={startTime}
                                        onChange={(e) => setStartTime(e.target.value)}
                                        InputLabelProps={{ shrink: true }}
                                    />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Controller
                                        name="dueDate"
                                        control={control}
                                        render={({ field }) => (
                                            <TextField
                                                {...field}
                                                label="Дедлайн"
                                                type="date"
                                                fullWidth
                                                size="small"
                                                InputLabelProps={{ shrink: true }}
                                                error={!!field.value && new Date(field.value) < new Date() && currentStatus !== 'done'}
                                                InputProps={{ startAdornment: <FlagIcon fontSize="small" sx={{ mr: 1, color: 'error.main' }} /> }}
                                            />
                                        )}
                                    />
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Controller
                                        name="estimatedDurationMinutes"
                                        control={control}
                                        render={({ field }) => (
                                            <TextField
                                                {...field}
                                                label="Длительность (мин)"
                                                type="number"
                                                fullWidth
                                                size="small"
                                                InputProps={{ startAdornment: <AccessTimeIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                                            />
                                        )}
                                    />
                                </Grid>
                            </Grid>
                        </Box>

                        {/* 7. Accordion (Secondary Fields) */}
                        <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} disableGutters elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography variant="body2" color="text.secondary">More Options (Assignee, Client, Tags)</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Box display="flex" flexDirection="column" gap={2}>
                                    {/* Client and Contacts Row */}
                                    <Box display="flex" flexDirection="column" gap={2}>
                                        <Controller
                                            name="clientId"
                                            control={control}
                                            render={({ field }) => (
                                                <FormControl fullWidth size="small">
                                                    <InputLabel>Client</InputLabel>
                                                    <Select {...field} label="Client" displayEmpty>
                                                        <MenuItem value=""><em>None</em></MenuItem>
                                                        {sortClients(clients).map(c => (
                                                            <MenuItem key={c.id} value={c.id}>{c.type === 'company' ? '🏢' : '👤'} {c.name}</MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                            )}
                                        />

                                        {/* Linked Contacts Selector */}
                                        <Autocomplete
                                            multiple
                                            size="small"
                                            options={contacts}
                                            getOptionLabel={(option) => option.name || 'Без имени'}
                                            value={contacts.filter(c => linkedContactIds.includes(c.id))}
                                            onChange={(_, newValue) => {
                                                setLinkedContactIds(newValue.map(v => v.id));
                                            }}
                                            renderInput={(params) => (
                                                <TextField
                                                    {...params}
                                                    label="Привязанные Контакты (Справочник)"
                                                    placeholder="Выберите контакты..."
                                                />
                                            )}
                                            renderTags={(value, getTagProps) =>
                                                value.map((option, index) => {
                                                    const props = getTagProps({ index });
                                                    // Extract key from props since it cannot be spread directly
                                                    const { key, ...otherProps } = props;
                                                    return (
                                                        <Chip
                                                            key={key}
                                                            label={option.name}
                                                            size="small"
                                                            avatar={<Avatar sx={{ width: 18, height: 18 }}>{option.name?.charAt(0)}</Avatar>}
                                                            {...otherProps}
                                                        />
                                                    );
                                                })
                                            }
                                        />

                                        <Button
                                            size="small"
                                            onClick={() => setGlobalContactOpen(true)}
                                            startIcon={<AddIcon />}
                                            sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
                                        >
                                            Создать новый контакт
                                        </Button>
                                    </Box>

                                    {/* Priority & Projects */}
                                    {/* Reusing Priority Selection logic from old dialog but simplified */}
                                    <Box>
                                        <Typography variant="caption" sx={{ mb: 1, display: 'block' }}>Priority</Typography>
                                        <Box display="flex" gap={1}>
                                            {PRIORITY_OPTIONS.map(opt => (
                                                <Chip
                                                    key={opt.value}
                                                    label={opt.label}
                                                    onClick={() => setValue('priority', opt.value)}
                                                    variant={currentPriority === opt.value ? 'filled' : 'outlined'}
                                                    sx={{
                                                        bgcolor: currentPriority === opt.value ? opt.color : 'transparent',
                                                        color: currentPriority === opt.value ? 'white' : 'text.primary',
                                                        borderColor: opt.color,
                                                        '&:hover': { bgcolor: alpha(opt.color, 0.1) }
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    </Box>

                                    <Controller
                                        name="context"
                                        control={control}
                                        render={({ field }) => (
                                            <TextField {...field} label="Context / Tags" size="small" fullWidth />
                                        )}
                                    />
                                </Box>
                            </AccordionDetails>
                        </Accordion>

                    </Box>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setDeleteConfirmOpen(true)} color="error" size="small">Delete Task</Button>
                    <Box flexGrow={1} />
                    <Button onClick={onClose} color="inherit">Cancel</Button>
                    <Button type="submit" variant="contained" disableElevation>Save Changes</Button>
                </DialogActions>
            </form>

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={deleteConfirmOpen}
                onClose={() => setDeleteConfirmOpen(false)}
                PaperProps={{
                    sx: {
                        borderRadius: 3,
                        maxWidth: 360,
                        mx: 'auto',
                    }
                }}
            >
                <DialogTitle sx={{ fontWeight: 700, fontSize: '17px', pb: 0.5 }}>
                    Удалить задачу?
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary">
                        Задача «{task?.title}» будет удалена безвозвратно.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setDeleteConfirmOpen(false)} color="inherit">Отмена</Button>
                    <Button onClick={handleDelete} color="error" variant="contained" disableElevation
                        sx={{ borderRadius: 2 }}
                    >
                        Удалить
                    </Button>
                </DialogActions>
            </Dialog>

            <GlobalContactQuickAdd
                open={globalContactOpen}
                onClose={() => setGlobalContactOpen(false)}
                onContactAdded={(newContact) => {
                    setContacts(prev => [...prev, newContact].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
                    if (newContact.id) setLinkedContactIds(prev => [...prev, newContact.id!]);
                }}
            />
        </Dialog>
    );
};

export default GTDEditDialog;
