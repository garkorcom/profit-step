import React, { useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, FormControl, InputLabel, Select, MenuItem,
    Box, Chip, Typography
} from '@mui/material';
import FlagIcon from '@mui/icons-material/Flag';
import PersonIcon from '@mui/icons-material/Person';
import { useForm, Controller } from 'react-hook-form';
import { GTDTask, GTDStatus, GTD_COLUMNS, GTDPriority, PRIORITY_COLORS } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { Timestamp, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';

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
}

const CONTEXT_SUGGESTIONS = ['@home', '@work', '@computer', '@phone', '@errands', '@office'];

const PRIORITY_OPTIONS: { value: GTDPriority; label: string; color: string }[] = [
    { value: 'none', label: 'No priority', color: '#9ca3af' },
    { value: 'low', label: 'Low', color: PRIORITY_COLORS.low },
    { value: 'medium', label: 'Medium', color: PRIORITY_COLORS.medium },
    { value: 'high', label: 'High', color: PRIORITY_COLORS.high }
];

const GTDEditDialog: React.FC<GTDEditDialogProps> = ({ open, onClose, task, onSave, onDelete }) => {
    const { control, handleSubmit, reset, setValue, watch } = useForm<FormData>();
    const currentContext = watch('context');
    const [users, setUsers] = React.useState<UserProfile[]>([]);
    const [clients, setClients] = React.useState<Client[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            // Fetch users for assignee dropdown
            const usersQ = query(collection(db, 'users'), orderBy('displayName'));
            const usersSnap = await getDocs(usersQ);
            setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)));

            // Fetch clients
            const clientQ = query(collection(db, 'clients'), orderBy('name'));
            const clientSnap = await getDocs(clientQ);
            setClients(clientSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
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
                dueDate: task.dueDate ? new Date(task.dueDate.seconds * 1000).toISOString().split('T')[0] : ''
            });
        }
    }, [task, reset]);

    const onSubmit = async (data: FormData) => {
        if (!task) return;

        const selectedClient = clients.find(c => c.id === data.clientId);
        const selectedAssignee = users.find(u => u.id === data.assigneeId);

        // Build updates object, filtering out empty optional fields
        const updates: Record<string, any> = {
            title: data.title,
            description: data.description || '',
            context: data.context || '',
            status: data.status,
            priority: data.priority || 'none',
        };

        // Only include optional fields if they have a value
        if (data.clientId) {
            updates.clientId = data.clientId;
            updates.clientName = selectedClient?.name || '';
        }
        if (data.assigneeId) {
            updates.assigneeId = data.assigneeId;
            updates.assigneeName = selectedAssignee?.displayName || '';
        }
        if (data.dueDate) updates.dueDate = Timestamp.fromDate(new Date(data.dueDate));

        await onSave(task.id, updates as Partial<GTDTask>);
        onClose();
    };

    const handleDelete = async () => {
        if (!task) return;
        if (window.confirm("Are you sure you want to delete this task?")) {
            await onDelete(task.id);
            onClose();
        }
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <form onSubmit={handleSubmit(onSubmit)}>
                <DialogTitle>Edit Task</DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" gap={2} mt={1}>
                        <Controller
                            name="title"
                            control={control}
                            rules={{ required: true }}
                            render={({ field }) => (
                                <TextField {...field} label="Title" fullWidth autoFocus />
                            )}
                        />

                        <Controller
                            name="status"
                            control={control}
                            render={({ field }) => (
                                <FormControl fullWidth size="small">
                                    <InputLabel>List / Status</InputLabel>
                                    <Select {...field} label="List / Status">
                                        {GTD_COLUMNS.map(col => (
                                            <MenuItem key={col.id} value={col.id}>{col.title}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}
                        />



                        {/* Assignee Selector */}
                        <Controller
                            name="assigneeId"
                            control={control}
                            render={({ field }) => (
                                <FormControl fullWidth size="small">
                                    <InputLabel>Assignee (Optional)</InputLabel>
                                    <Select {...field} label="Assignee (Optional)" displayEmpty>
                                        <MenuItem value=""><em>None</em></MenuItem>
                                        {users.map(u => (
                                            <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}
                        />

                        {/* Client Selector */}
                        <Controller
                            name="clientId"
                            control={control}
                            render={({ field }) => (
                                <FormControl fullWidth size="small">
                                    <InputLabel>Client (Optional)</InputLabel>
                                    <Select
                                        {...field}
                                        label="Client (Optional)"
                                        displayEmpty
                                        startAdornment={field.value ? <PersonIcon sx={{ mr: 1, color: 'primary.main' }} /> : null}
                                    >
                                        <MenuItem value=""><em>None</em></MenuItem>
                                        {clients.map(c => (
                                            <MenuItem key={c.id} value={c.id}>
                                                {c.name} {c.type === 'company' ? '🏢' : '👤'}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}
                        />

                        {/* Priority Selector */}
                        <Controller
                            name="priority"
                            control={control}
                            render={({ field }) => (
                                <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                        Priority
                                    </Typography>
                                    <Box display="flex" gap={1} flexWrap="wrap">
                                        {PRIORITY_OPTIONS.map(opt => (
                                            <Chip
                                                key={opt.value}
                                                icon={opt.value !== 'none' ? <FlagIcon sx={{ fontSize: 16, color: `${opt.color} !important` }} /> : undefined}
                                                label={opt.label}
                                                size="small"
                                                onClick={() => field.onChange(opt.value)}
                                                sx={{
                                                    bgcolor: field.value === opt.value ? `${opt.color}20` : 'transparent',
                                                    border: `1px solid ${field.value === opt.value ? opt.color : '#e5e7eb'}`,
                                                    color: field.value === opt.value ? opt.color : 'text.secondary',
                                                    cursor: 'pointer',
                                                    '&:hover': { bgcolor: `${opt.color}10` }
                                                }}
                                            />
                                        ))}
                                    </Box>
                                </Box>
                            )}
                        />

                        <Box>
                            <Controller
                                name="context"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="Context (e.g., @work)"
                                        fullWidth
                                        size="small"
                                        helperText="Select or type a context"
                                    />
                                )}
                            />
                            <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                                {CONTEXT_SUGGESTIONS.map(ctx => (
                                    <Chip
                                        key={ctx}
                                        label={ctx}
                                        size="small"
                                        onClick={() => setValue('context', ctx)}
                                        color={currentContext === ctx ? 'primary' : 'default'}
                                        variant={currentContext === ctx ? 'filled' : 'outlined'}
                                    />
                                ))}
                            </Box>
                        </Box>

                        <Controller
                            name="dueDate"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Due Date"
                                    type="date"
                                    fullWidth
                                    InputLabelProps={{ shrink: true }}
                                />
                            )}
                        />

                        <Controller
                            name="description"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Notes"
                                    fullWidth
                                    multiline
                                    rows={3}
                                />
                            )}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDelete} color="error" sx={{ mr: 'auto' }}>Delete</Button>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button type="submit" variant="contained">Save</Button>
                </DialogActions>
            </form >
        </Dialog >
    );
};

export default GTDEditDialog;
