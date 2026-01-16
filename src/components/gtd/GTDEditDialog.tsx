import React, { useEffect, useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, FormControl, InputLabel, Select, MenuItem,
    Box, Chip, Typography, Grid, Accordion, AccordionSummary, AccordionDetails,
    useTheme, alpha
} from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import PersonIcon from '@mui/icons-material/Person';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InboxIcon from '@mui/icons-material/Inbox';

import { useForm, Controller } from 'react-hook-form';
import { GTDTask, GTDStatus, GTD_COLUMNS, GTDPriority, PRIORITY_COLORS } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { Timestamp, collection, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';

interface GTDEditDialogProps {
    open: boolean;
    onClose: () => void;
    task: GTDTask | null;
    onSave: (taskId: string, data: Partial<GTDTask>) => Promise<void>;
    onDelete: (taskId: string) => Promise<void>;
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

const CONTEXT_SUGGESTIONS = ['@home', '@work', '@computer', '@phone', '@errands', '@office'];

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

const GTDEditDialog: React.FC<GTDEditDialogProps> = ({ open, onClose, task, onSave, onDelete }) => {
    const theme = useTheme();
    const { userProfile } = useAuth(); // Corrected usage check
    const { control, handleSubmit, reset, setValue, watch } = useForm<FormData>();
    const currentStatus = watch('status');
    const currentPriority = watch('priority');

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const currentContext = watch('context'); // Kept for logic if needed

    const [users, setUsers] = useState<UserProfile[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [expanded, setExpanded] = useState<boolean>(false);

    useEffect(() => {
        const fetchData = async () => {
            // Assignees (Users)
            try {
                const usersQ = query(collection(db, 'users'), orderBy('displayName'));
                const usersSnap = await getDocs(usersQ);
                setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));
            } catch (e) { console.error("Error fetching users", e); }

            // Clients (Optimized: fetch all for now, logic could be refined for big DBs)
            try {
                const clientQ = query(collection(db, 'clients'), orderBy('name'));
                const clientSnap = await getDocs(clientQ);
                setClients(clientSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
            } catch (e) { console.error("Error fetching clients", e); }
        };
        if (open) fetchData();
    }, [open]);

    useEffect(() => {
        if (task) {
            reset({
                title: task.title,
                description: task.description || '',
                context: task.context || '',
                clientId: task.clientId || '',
                assigneeId: task.assigneeId || '',
                status: task.status,
                priority: task.priority || 'none',
                dueDate: task.dueDate ? new Date(task.dueDate.seconds * 1000).toISOString().split('T')[0] : '',
                startDate: task.startDate ? new Date(task.startDate.seconds * 1000).toISOString().split('T')[0] : '',
                estimatedDurationMinutes: task.estimatedDurationMinutes || 0
            });
        }
    }, [task, reset]);

    const onSubmit = async (data: FormData) => {
        if (!task) return;

        const selectedClient = clients.find(c => c.id === data.clientId);
        const selectedAssignee = users.find(u => u.id === data.assigneeId);

        // Build updates object - avoid undefined values (Firestore doesn't accept them)
        const updates: Partial<GTDTask> = {
            title: data.title,
            description: data.description || '',
            context: data.context || '',
            status: data.status,
            priority: data.priority || 'none',
            updatedAt: Timestamp.now()
        };

        // Only set optional fields if they have values
        if (data.clientId) {
            updates.clientId = data.clientId;
            updates.clientName = selectedClient?.name || '';
        }
        if (data.assigneeId) {
            updates.assigneeId = data.assigneeId;
            updates.assigneeName = selectedAssignee?.displayName || '';
        }
        if (data.estimatedDurationMinutes) {
            updates.estimatedDurationMinutes = Number(data.estimatedDurationMinutes);
        }
        if (data.dueDate) {
            updates.dueDate = Timestamp.fromDate(new Date(data.dueDate));
        }
        if (data.startDate) {
            updates.startDate = Timestamp.fromDate(new Date(data.startDate));
        }

        // Auto-set completedAt if done
        if (data.status === 'done' && task.status !== 'done') {
            updates.completedAt = Timestamp.now();
        }

        try {
            await onSave(task.id, updates);
            onClose();
        } catch (error) {
            console.error('Error saving task:', error);
            alert('Ошибка сохранения задачи. Проверьте консоль.');
        }
    };

    const handleDelete = async () => {
        if (!task) return;
        if (window.confirm("Are you sure you want to delete this task?")) {
            await onDelete(task.id);
            onClose();
        }
    };

    const handleStatusClick = (status: GTDStatus) => {
        setValue('status', status);
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{
            sx: { borderRadius: 3, p: 1 }
        }}>
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogTitle sx={{ px: 2, pb: 1, pt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" fontWeight="bold">Quick Edit</Typography>
                    {task?.createdAt && (
                        <Typography variant="caption" color="text.secondary">
                            Created: {new Date(task.createdAt.seconds * 1000).toLocaleDateString()}
                        </Typography>
                    )}
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
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 6 }}>
                                <Controller
                                    name="startDate"
                                    control={control}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            label="Start Date"
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
                                <Controller
                                    name="dueDate"
                                    control={control}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            label="Deadline"
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
                                            label="Est. Duration (min)"
                                            type="number"
                                            fullWidth
                                            size="small"
                                            InputProps={{ startAdornment: <AccessTimeIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                                        />
                                    )}
                                />
                            </Grid>
                            <Grid size={{ xs: 6 }}>
                                {/* Placeholder for Reminder or Priority Summary */}
                                <Box display="flex" alignItems="center" height="100%" pl={1}>
                                    <Chip
                                        label={PRIORITY_OPTIONS.find(p => p.value === currentPriority)?.label || 'No Priority'}
                                        size="small"
                                        sx={{
                                            bgcolor: PRIORITY_OPTIONS.find(p => p.value === currentPriority)?.color + '20',
                                            color: PRIORITY_OPTIONS.find(p => p.value === currentPriority)?.color,
                                            fontWeight: 'bold'
                                        }}
                                    />
                                </Box>
                            </Grid>
                        </Grid>

                        {/* 4. Description */}
                        <Controller
                            name="description"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Description"
                                    multiline
                                    rows={3}
                                    fullWidth
                                    variant="outlined"
                                    size="small"
                                    sx={{ bgcolor: 'background.paper' }}
                                />
                            )}
                        />

                        {/* 5. Accordion (Secondary Fields) */}
                        <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} disableGutters elevation={0} sx={{ border: '1px solid #e0e0e0', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                <Typography variant="body2" color="text.secondary">More Options (Assignee, Client, Tags)</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Box display="flex" flexDirection="column" gap={2}>
                                    {/* Assignee & Client Row */}
                                    <Box display="flex" gap={2}>
                                        <Controller
                                            name="assigneeId"
                                            control={control}
                                            render={({ field }) => (
                                                <FormControl fullWidth size="small">
                                                    <InputLabel>Assignee</InputLabel>
                                                    <Select {...field} label="Assignee" displayEmpty>
                                                        <MenuItem value=""><em>None</em></MenuItem>
                                                        {users.map(u => (
                                                            <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                            )}
                                        />
                                        <Controller
                                            name="clientId"
                                            control={control}
                                            render={({ field }) => (
                                                <FormControl fullWidth size="small">
                                                    <InputLabel>Client</InputLabel>
                                                    <Select {...field} label="Client" displayEmpty>
                                                        <MenuItem value=""><em>None</em></MenuItem>
                                                        {clients.map(c => (
                                                            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                            )}
                                        />
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
                    <Button onClick={handleDelete} color="error" size="small">Delete Task</Button>
                    <Box flexGrow={1} />
                    <Button onClick={onClose} color="inherit">Cancel</Button>
                    <Button type="submit" variant="contained" disableElevation>Save Changes</Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default GTDEditDialog;
