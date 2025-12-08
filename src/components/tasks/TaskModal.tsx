import React, { useState, useEffect } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, MenuItem, Box, Typography,
    IconButton, Chip, List, ListItem, ListItemText, Divider
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import CloseIcon from '@mui/icons-material/Close';
import { Task, CreateTaskData, UpdateTaskData, TaskPriority, TaskStatus } from '../../types/task.types';
import { useAuth } from '../../auth/AuthContext';
import { Timestamp } from 'firebase/firestore';

interface TaskModalProps {
    open: boolean;
    onClose: () => void;
    task?: Task; // If provided, we are editing
    users: any[]; // List of users for assignment
    onSave: (data: CreateTaskData | UpdateTaskData) => Promise<void>;
    onDelete?: () => Promise<void>;
    onLogTime?: (duration: number) => Promise<void>;
}

const TaskModal: React.FC<TaskModalProps> = ({
    open, onClose, task, users, onSave, onDelete, onLogTime
}) => {
    const { currentUser } = useAuth();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [assigneeId, setAssigneeId] = useState('');

    // Timer state
    const [isTimerRunning, setIsTimerRunning] = useState(false);
    const [timerStart, setTimerStart] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (task) {
            setTitle(task.title);
            setDescription(task.description);
            setPriority(task.priority);
            setStatus(task.status);
            setAssigneeId(task.assigneeId || '');
        } else {
            // Reset for new task
            setTitle('');
            setDescription('');
            setPriority('medium');
            setStatus('todo');
            setAssigneeId('');
        }
    }, [task, open]);

    // Timer logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isTimerRunning && timerStart) {
            interval = setInterval(() => {
                setElapsed(Math.floor((Date.now() - timerStart) / 1000));
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isTimerRunning, timerStart]);

    const handleSave = async () => {
        const data: any = {
            title,
            description,
            priority,
            status,
            assigneeId: assigneeId || null,
        };
        await onSave(data);
        onClose();
    };

    const toggleTimer = async () => {
        if (isTimerRunning) {
            // Stop timer
            setIsTimerRunning(false);
            if (onLogTime) {
                await onLogTime(elapsed);
            }
            setElapsed(0);
            setTimerStart(null);
        } else {
            // Start timer
            setTimerStart(Date.now());
            setIsTimerRunning(true);
        }
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {task ? 'Edit Task' : 'New Task'}
                <IconButton onClick={onClose} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                <Box display="flex" flexDirection="column" gap={2}>
                    <TextField
                        label="Title"
                        fullWidth
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        required
                    />

                    <TextField
                        label="Description"
                        fullWidth
                        multiline
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    <Box display="flex" gap={2}>
                        <TextField
                            select
                            label="Priority"
                            value={priority}
                            onChange={(e) => setPriority(e.target.value as TaskPriority)}
                            fullWidth
                        >
                            <MenuItem value="low">Low</MenuItem>
                            <MenuItem value="medium">Medium</MenuItem>
                            <MenuItem value="high">High</MenuItem>
                        </TextField>

                        <TextField
                            select
                            label="Status"
                            value={status}
                            onChange={(e) => setStatus(e.target.value as TaskStatus)}
                            fullWidth
                        >
                            <MenuItem value="todo">To Do</MenuItem>
                            <MenuItem value="in-progress">In Progress</MenuItem>
                            <MenuItem value="done">Done</MenuItem>
                        </TextField>
                    </Box>

                    <TextField
                        select
                        label="Assignee"
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value)}
                        fullWidth
                    >
                        <MenuItem value="">Unassigned</MenuItem>
                        {users.map((user) => (
                            <MenuItem key={user.uid} value={user.uid}>
                                {user.displayName || user.email}
                            </MenuItem>
                        ))}
                    </TextField>

                    {/* Time Tracking Section - Only for existing tasks */}
                    {task && onLogTime && (
                        <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                <Typography variant="subtitle2">Time Tracking</Typography>
                                <Chip label={`Total: ${formatTime(task.totalTime)}`} size="small" />
                            </Box>

                            <Box display="flex" alignItems="center" gap={2}>
                                <Button
                                    variant={isTimerRunning ? "contained" : "outlined"}
                                    color={isTimerRunning ? "error" : "primary"}
                                    startIcon={isTimerRunning ? <StopIcon /> : <PlayArrowIcon />}
                                    onClick={toggleTimer}
                                    fullWidth
                                >
                                    {isTimerRunning ? `Stop (${formatTime(elapsed)})` : "Start Timer"}
                                </Button>
                            </Box>

                            {task.timeLogs && task.timeLogs.length > 0 && (
                                <Box mt={2}>
                                    <Typography variant="caption" color="text.secondary">Recent Logs</Typography>
                                    <List dense disablePadding>
                                        {task.timeLogs.slice(-3).map((log, index) => (
                                            <ListItem key={index} disableGutters>
                                                <ListItemText
                                                    primary={`Duration: ${formatTime(log.duration || 0)}`}
                                                    secondary={log.startTime instanceof Timestamp ? log.startTime.toDate().toLocaleString() : 'Unknown date'}
                                                />
                                            </ListItem>
                                        ))}
                                    </List>
                                </Box>
                            )}
                        </Box>
                    )}
                </Box>
            </DialogContent>

            <DialogActions>
                {task && onDelete && (
                    <Button onClick={onDelete} color="error" sx={{ mr: 'auto' }}>
                        Delete
                    </Button>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} variant="contained" color="primary">
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TaskModal;
