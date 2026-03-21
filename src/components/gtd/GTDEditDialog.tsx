import React, { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, FormControl, InputLabel, Select, MenuItem,
    Box, Chip, Typography, Grid, Accordion, AccordionSummary, AccordionDetails,
    Avatar, Autocomplete, Tooltip, InputAdornment, Link, IconButton, useTheme, alpha
} from '@mui/material';
import { format as formatDate } from 'date-fns';
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
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import LaunchIcon from '@mui/icons-material/Launch';
import { useForm, Controller } from 'react-hook-form';
import { GTDTask, GTDStatus, GTDPriority, PRIORITY_COLORS, ChecklistItem, TaskAttachment } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { Timestamp, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useClientUsageHistory } from '../../hooks/useClientUsageHistory';
import GlobalContactQuickAdd from '../contacts/GlobalContactQuickAdd';
import GTDSubtasksTable from './GTDSubtasksTable';
import { WorkSessionData } from '../../hooks/useActiveSession';

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
    /** All raw tasks for subtask filtering */
    allTasks?: GTDTask[];
    /** Add a subtask to the current task */
    onAddSubtask?: (parentTaskId: string, title: string, budgetAmount?: number) => Promise<void>;
    /** Start time tracking session */
    onStartSession?: (task: GTDTask) => void;
    /** Stop active session */
    onStopSession?: (task: GTDTask) => void;
    /** Currently active session */
    activeSession?: WorkSessionData | null;
}

interface FormData {
    title: string;
    description: string;
    memo: string;
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

const GTDEditDialog: React.FC<GTDEditDialogProps> = ({ open, onClose, task, onSave, onDelete, propUsers, propClients, allTasks, onAddSubtask, onStartSession, onStopSession, activeSession }) => {
    const theme = useTheme();
    const { userProfile } = useAuth(); // Corrected usage check
    const { control, handleSubmit, reset, setValue, watch } = useForm<FormData>();
    const [startTime, setStartTime] = useState<string>('');
    const currentStatus = watch('status');
    const currentPriority = watch('priority');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const currentContext = watch('context'); // Kept for logic if needed
    const currentClientId = watch('clientId');

    const [users, setUsers] = useState<UserProfile[]>(propUsers || []);
    const [clients, setClients] = useState<Client[]>(propClients || []);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [expanded, setExpanded] = useState<boolean>(false);
    const [resourcesExpanded, setResourcesExpanded] = useState<boolean>(false);
    const { trackUsage, sortClients } = useClientUsageHistory(userProfile?.id);

    const [hours, setHours] = useState('');

    // Contacts Integration
    const [contacts, setContacts] = useState<any[]>([]);
    const [linkedContactIds, setLinkedContactIds] = useState<string[]>([]);
    const [globalContactOpen, setGlobalContactOpen] = useState(false);

    // Checklist State
    const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
    const [newChecklistText, setNewChecklistText] = useState('');

    // Attachments State
    const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
    const [newAttachmentUrl, setNewAttachmentUrl] = useState('');
    const [newAttachmentTitle, setNewAttachmentTitle] = useState('');

    // Co-assignees state
    const [coAssignees, setCoAssignees] = useState<Array<{ id: string; name: string; role: 'executor' | 'reviewer' | 'observer' }>>([]);


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
                memo: task.memo || '',
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

            // Default to '1' hour if missing
            setHours(task.estimatedDurationMinutes ? String(task.estimatedDurationMinutes / 60) : '1');
            setLinkedContactIds(task.linkedContactIds || []);

            // Initialize checklist
            setChecklistItems(task.checklistItems || []);
            setNewChecklistText('');

            // Initialize Attachments
            setAttachments(task.attachments || []);
            setNewAttachmentUrl('');
            setNewAttachmentTitle('');

            // Initialize co-assignees
            setCoAssignees((task.coAssignees || []).map((ca: any) => ({
                id: ca.id,
                name: ca.name,
                role: ca.role || 'executor'
            })));
        }
    }, [task, reset, userProfile]);

    // Auto-sync contacts based on clientId
    useEffect(() => {
        if (currentClientId && contacts.length > 0) {
            const clientContactIds = contacts
                .filter(c => c.linkedProjects && c.linkedProjects.includes(currentClientId))
                .map(c => c.id);

            const newIds = clientContactIds.filter(id => !linkedContactIds.includes(id));
            if (newIds.length > 0) {
                setLinkedContactIds(prev => [...prev, ...newIds]);
            }
        }
    }, [currentClientId, contacts, linkedContactIds]);

    const onSubmit = async (data: FormData) => {
        if (!task) return;

        const selectedClient = clients.find(c => c.id === data.clientId);
        const selectedAssignee = users.find(u => u.id === data.assigneeId);

        // Phantom Create Protection (8.3)
        if (!data.title?.trim()) {
            alert('Заголовок задачи не может быть пустым');
            return;
        }



        // Edit Collision Prevention (8.1)
        // Only set fields that actually changed! Saves bandwidth and prevents overwriting 
        // a Telegram Bot status update while writing a long description.
        const updates: Partial<GTDTask> = { updatedAt: Timestamp.now() };

        if (data.title.trim() !== task.title) updates.title = data.title.trim();
        if ((data.description || '') !== (task.description || '')) updates.description = data.description || '';
        if ((data.memo || '') !== (task.memo || '')) updates.memo = data.memo || '';
        if ((data.context || '') !== (task.context || '')) updates.context = data.context || '';
        
        if (data.status !== task.status) updates.status = data.status;
        if ((data.priority || 'none') !== (task.priority || 'none')) updates.priority = data.priority || 'none';

        if ((data.clientId || null) !== (task.clientId || null)) {
            updates.clientId = (data.clientId || null) as any;
            updates.clientName = (data.clientId ? (selectedClient?.name || '') : null) as any;
        }
        
        if ((data.assigneeId || null) !== (task.assigneeId || null)) {
            updates.assigneeId = (data.assigneeId || null) as any;
            updates.assigneeName = (data.assigneeId ? (selectedAssignee?.displayName || '') : null) as any;
        }

        // Always update dates and arrays if explicitly firing save
        updates.dueDate = data.dueDate ? Timestamp.fromDate(new Date(data.dueDate + 'T00:00:00')) : null as any;
        updates.estimatedDurationMinutes = data.estimatedDurationMinutes ? Number(data.estimatedDurationMinutes) : null as any;

        if (data.startDate) {
            const dateObj = new Date(data.startDate + 'T00:00:00');
            if (startTime) {
                const [hh, mm] = startTime.split(':').map(Number);
                dateObj.setHours(hh, mm);
            }
            updates.startDate = Timestamp.fromDate(dateObj);
        } else {
            (updates as any).startDate = null;
        }

        if (data.status === 'estimate' && task.status !== 'estimate') {
            updates.needsEstimate = true;
        }

        if (data.status === 'done' && task.status !== 'done') {
            updates.completedAt = Timestamp.now();
        }
        if (data.status !== 'done' && task.status === 'done') {
            (updates as any).completedAt = null;
        }

        if (hours) updates.estimatedDurationMinutes = Math.round(Number(hours) * 60);

        // Arrays
        updates.checklistItems = checklistItems.length > 0 ? checklistItems : [];
        updates.attachments = attachments.length > 0 ? attachments : [];
        updates.linkedContactIds = linkedContactIds;
        updates.coAssignees = coAssignees.length > 0 ? coAssignees : [];
        (updates as any).coAssigneeIds = coAssignees.map(c => c.id);

        if (Object.keys(updates).length <= 1) {
            // Nothing changed!
            onClose();
            return;
        }

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
            <form 
                onSubmit={handleSubmit(onSubmit)}
                onKeyDown={(e) => {
                    // Smart Shortcuts (8.4) - Cmd+Enter to save immediately
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                        e.preventDefault();
                        handleSubmit(onSubmit)();
                    }
                }}
            >
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

                        {/* 4.1 Memo / Дополнительное описание */}
                        <Controller
                            name="memo"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Дополнительное описание (Memo)"
                                    placeholder="Детали задачи, ссылки или уточнения..."
                                    multiline
                                    rows={2}
                                    fullWidth
                                    size="small"
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

                        {/* 4.8. Attachments Section */}
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
                                <InsertLinkIcon fontSize="small" /> Ссылки на документы (Google Drive, Docs и др.)
                            </Typography>

                            {attachments.length > 0 && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                                    {attachments.map((att) => (
                                        <Box key={att.id} sx={{ display: 'flex', alignItems: 'center', p: 0.5, gap: 1, border: '1px solid #e0e0e0', borderRadius: 1.5, bgcolor: '#fafafa' }}>
                                            <Box sx={{ flex: 1, overflow: 'hidden' }}>
                                                <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                                    {att.title || 'Вложение'}
                                                </Typography>
                                                <Link href={att.url} target="_blank" rel="noopener noreferrer" variant="caption" sx={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', color: 'primary.main' }}>
                                                    {att.url}
                                                </Link>
                                            </Box>
                                            <IconButton size="small" component="a" href={att.url} target="_blank" rel="noopener noreferrer" sx={{ color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                                                <LaunchIcon fontSize="small" />
                                            </IconButton>
                                            <IconButton size="small" onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                                                <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                        </Box>
                                    ))}
                                </Box>
                            )}

                            {/* Add new attachment row */}
                            <Grid container spacing={1} alignItems="center">
                                <Grid size={{ xs: 5 }}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        placeholder="Название (опц.)"
                                        value={newAttachmentTitle}
                                        onChange={(e) => setNewAttachmentTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') e.preventDefault();
                                        }}
                                    />
                                </Grid>
                                <Grid size={{ xs: 7 }}>
                                    <TextField
                                        fullWidth
                                        size="small"
                                        placeholder="https://docs.google.com/..."
                                        value={newAttachmentUrl}
                                        onChange={(e) => setNewAttachmentUrl(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newAttachmentUrl.trim()) {
                                                e.preventDefault();
                                                const url = newAttachmentUrl.trim() || '';
                                                if (url) {
                                                    setAttachments(prev => [...prev, { id: nanoid(10), url: url.startsWith('http') ? url : `https://${url}`, title: newAttachmentTitle.trim() || 'Ссылка' }]);
                                                    setNewAttachmentUrl('');
                                                    setNewAttachmentTitle('');
                                                }
                                            }
                                        }}
                                        InputProps={{
                                            endAdornment: (
                                                <IconButton
                                                    size="small"
                                                    onClick={() => {
                                                        const url = newAttachmentUrl.trim() || '';
                                                        if (url) {
                                                            setAttachments(prev => [...prev, { id: nanoid(10), url: url.startsWith('http') ? url : `https://${url}`, title: newAttachmentTitle.trim() || 'Ссылка' }]);
                                                            setNewAttachmentUrl('');
                                                            setNewAttachmentTitle('');
                                                        }
                                                    }}
                                                    disabled={!newAttachmentUrl.trim()}
                                                >
                                                    <AddIcon fontSize="small" />
                                                </IconButton>
                                            )
                                        }}
                                    />
                                </Grid>
                            </Grid>
                        </Box>

                        {/* 4.9 Subtasks / Progress Tracking Table */}
                        {task && allTasks && onAddSubtask && (
                            <GTDSubtasksTable
                                parentTaskId={task.id}
                                allTasks={allTasks}
                                onUpdateTask={async (taskId, updates) => await onSave(taskId, updates)}
                                onDeleteTask={async (taskId) => await onDelete(taskId)}
                                onAddSubtask={onAddSubtask}
                                onStartSession={onStartSession}
                                onStopSession={onStopSession}
                                activeSession={activeSession}
                            />
                        )}

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
                                </Box>
                            </AccordionDetails>
                        </Accordion>

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
                                                InputProps={{
                                                    startAdornment: <PlayArrowIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />,
                                                    endAdornment: (
                                                        <InputAdornment position="end">
                                                            <Tooltip title="Установить на сегодня">
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() => {
                                                                        setValue('startDate', formatDate(new Date(), 'yyyy-MM-dd'), { shouldDirty: true });
                                                                    }}
                                                                >
                                                                    <Typography variant="caption" color="primary" fontWeight="bold">СЕГ</Typography>
                                                                </IconButton>
                                                            </Tooltip>
                                                        </InputAdornment>
                                                    )
                                                }}
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
                                        {/* Display Selected Client's Contact Info if available */}
                                        {(() => {
                                            const selectedClient = clients.find(c => c.id === currentClientId);
                                            if (!selectedClient) return null;
                                            return (
                                                <Accordion
                                                    variant="outlined"
                                                    sx={{
                                                        bgcolor: 'rgba(25, 118, 210, 0.04)',
                                                        borderColor: 'primary.light',
                                                        '&:before': { display: 'none' }
                                                    }}
                                                >
                                                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                        <Box display="flex" alignItems="center" gap={2}>
                                                            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: '1rem' }}>
                                                                {selectedClient.name?.charAt(0)}
                                                            </Avatar>
                                                            <Box>
                                                                <Typography variant="caption" color="primary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold', display: 'block', lineHeight: 1 }}>Клиент Задачи</Typography>
                                                                <Typography variant="subtitle2" fontWeight={600}>{selectedClient.name}</Typography>
                                                            </Box>
                                                        </Box>
                                                    </AccordionSummary>
                                                    <AccordionDetails sx={{ pt: 0 }}>
                                                        <Box display="flex" flexDirection="column" gap={0.5}>
                                                            {selectedClient.phone && (
                                                                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                                                        <Link href={`tel:${selectedClient.phone}`} underline="hover" color="primary.main" fontWeight={500}>📞 {selectedClient.phone}</Link>
                                                                    </Typography>
                                                                    <IconButton component="a" size="small" href={`https://wa.me/${selectedClient.phone.replace(/\\D/g, '')}`} target="_blank" rel="noopener noreferrer" color="success" sx={{ padding: '2px' }} title="WhatsApp">
                                                                        <WhatsAppIcon fontSize="small" sx={{ fontSize: 18 }} />
                                                                    </IconButton>
                                                                </Box>
                                                            )}
                                                            {selectedClient.email && (
                                                                <Typography variant="body2">
                                                                    <Link href={`mailto:${selectedClient.email}`} underline="hover" color="info.main">✉️ {selectedClient.email}</Link>
                                                                </Typography>
                                                            )}
                                                            {selectedClient.contacts && selectedClient.contacts.length > 0 && (
                                                                <Box mt={1}>
                                                                    <Typography variant="caption" color="text.secondary">Доп. контакты клиента:</Typography>
                                                                    {selectedClient.contacts.map((cc: any, i: number) => (
                                                                        <Box key={i} display="flex" alignItems="center" gap={1} mt={0.5}>
                                                                            <Typography variant="body2">
                                                                                {cc.name} {cc.position ? `(${cc.position})` : ''}: <Link href={`tel:${cc.phone}`} underline="hover" color="primary.main">📞 {cc.phone}</Link>
                                                                            </Typography>
                                                                        </Box>
                                                                    ))}
                                                                </Box>
                                                            )}
                                                            {(!selectedClient.phone && !selectedClient.email && (!selectedClient.contacts || selectedClient.contacts.length === 0)) && (
                                                                <Typography variant="body2" color="text.secondary">Нет контактных данных уровня клиента</Typography>
                                                            )}
                                                        </Box>
                                                    </AccordionDetails>
                                                </Accordion>
                                            );
                                        })()}

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
                    <Tooltip title={(task?.totalTimeSpentMinutes || 0) > 0 ? "Удаление запрещено: по задаче зафиксировано оплаченное время. Перенесите её в Archive." : ""}>
                        <span>
                            <Button 
                                onClick={() => setDeleteConfirmOpen(true)} 
                                color="error" 
                                size="small"
                                disabled={(task?.totalTimeSpentMinutes || 0) > 0}
                            >
                                Delete Task
                            </Button>
                        </span>
                    </Tooltip>
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
                currentProjectId={currentClientId || undefined}
                onContactAdded={(newContact) => {
                    setContacts(prev => [...prev, newContact].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '')));
                    if (newContact.id) setLinkedContactIds(prev => [...prev, newContact.id!]);
                }}
            />
        </Dialog>
    );
};

export default GTDEditDialog;
