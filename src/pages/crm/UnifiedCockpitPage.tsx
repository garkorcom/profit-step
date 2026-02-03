/**
 * @fileoverview UnifiedCockpitPage - Single page for all task details
 * 
 * Works with gtd_tasks collection directly.
 * Replaces both NoteCockpitPage and GTDTaskDetailsPage.
 * 
 * Features:
 * - Sticky header with status, timer, actions
 * - Main content: title, description, checklist
 * - Control panel: client, team, schedule, finance
 * 
 * @module pages/crm/UnifiedCockpitPage
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, TextField, Button, IconButton, Paper,
    Breadcrumbs, Link, Chip, Select, MenuItem, FormControl,
    Autocomplete, Avatar, Divider, Checkbox,
    FormControlLabel, InputAdornment, Tooltip, CircularProgress,
    Alert, List, ListItem, ListItemIcon, Tab, Tabs
} from '@mui/material';
import {
    ArrowBack as BackIcon,
    PlayArrow as PlayIcon,
    Stop as StopIcon,
    Save as SaveIcon,
    Delete as DeleteIcon,
    AutoAwesome as AIIcon,
    Add as AddIcon,
    DragIndicator as DragIcon,
    AccessTime as TimeIcon,
    Person as PersonIcon,
} from '@mui/icons-material';
import { doc, updateDoc, onSnapshot, Timestamp, collection, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/firebase';
import { GTDTask, GTDStatus, GTDPriority, ChecklistItem, PRIORITY_COLORS } from '../../types/gtd.types';
import { useSessionManager } from '../../hooks/useSessionManager';

// ═══════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════

interface User {
    id: string;
    displayName: string;
    avatarUrl?: string;
}

interface Client {
    id: string;
    name: string;
}

const STATUS_OPTIONS: { value: GTDStatus; label: string; color: string }[] = [
    { value: 'inbox', label: 'Inbox', color: '#9e9e9e' },
    { value: 'next_action', label: 'Next Actions', color: '#2196f3' },
    { value: 'projects', label: 'Projects', color: '#ff9800' },
    { value: 'waiting', label: 'Waiting', color: '#9c27b0' },
    { value: 'estimate', label: 'Estimate', color: '#00bcd4' },
    { value: 'done', label: 'Done', color: '#00c853' },
];

const PRIORITY_OPTIONS: { value: GTDPriority; label: string; color: string }[] = [
    { value: 'none', label: 'None', color: '#9e9e9e' },
    { value: 'low', label: 'Low', color: '#3b82f6' },
    { value: 'medium', label: 'Medium', color: '#f59e0b' },
    { value: 'high', label: 'High', color: '#ef4444' },
];

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const UnifiedCockpitPage: React.FC = () => {
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    // Session manager for timer
    const { activeSession, startSession, stopSession, loading: sessionLoading } = useSessionManager(
        currentUser?.uid,
        currentUser?.displayName || undefined
    );

    // Timer elapsed seconds (calculated from activeSession)
    const [timerSeconds, setTimerSeconds] = useState(0);

    // State
    const [task, setTask] = useState<GTDTask | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<GTDStatus>('inbox');
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [clientId, setClientId] = useState<string | null>(null);
    const [clientName, setClientName] = useState<string | null>(null);
    const [assigneeId, setAssigneeId] = useState<string | null>(null);
    const [assigneeName, setAssigneeName] = useState<string | null>(null);
    const [estimatedCost, setEstimatedCost] = useState<number | ''>('');
    const [needsEstimate, setNeedsEstimate] = useState(false);
    const [priority, setPriority] = useState<GTDPriority>('none');

    // Reference data
    const [clients, setClients] = useState<Client[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    // AI state
    const [estimating, setEstimating] = useState(false);
    const [estimateResult, setEstimateResult] = useState<{ low: number; high: number; suggested: number } | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState(0);

    // ─────────────────────────────────────────────────────────
    // LOAD DATA
    // ─────────────────────────────────────────────────────────

    useEffect(() => {
        if (!taskId) return;

        // Real-time subscription to task
        const unsubscribe = onSnapshot(doc(db, 'gtd_tasks', taskId), (snap) => {
            if (snap.exists()) {
                const data = { id: snap.id, ...snap.data() } as GTDTask;
                setTask(data);

                // Initialize form state
                setTitle(data.title || '');
                setDescription(data.description || '');
                setStatus(data.status);
                setChecklist(data.checklistItems || []);
                setClientId(data.clientId || null);
                setClientName(data.clientName || null);
                setAssigneeId(data.assigneeId || null);
                setAssigneeName(data.assigneeName || null);
                setEstimatedCost(data.estimatedCost || '');
                setNeedsEstimate(data.needsEstimate || false);
                setPriority(data.priority || 'none');

                setLoading(false);
            }
        });

        // Load clients
        getDocs(query(collection(db, 'clients'), where('status', '!=', 'archived')))
            .then(snap => {
                setClients(snap.docs.map(d => ({
                    id: d.id,
                    name: d.data().name
                })));
            });

        // Load users
        getDocs(query(collection(db, 'users'), where('status', '==', 'active')))
            .then(snap => {
                setUsers(snap.docs.map(d => ({
                    id: d.id,
                    displayName: d.data().displayName,
                    avatarUrl: d.data().avatarUrl
                })));
            });

        return () => unsubscribe();
    }, [taskId]);

    // Timer tick - calculate elapsed time from activeSession startTime
    useEffect(() => {
        const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;
        if (!isTimerRunningForThisTask || !activeSession?.startTime) {
            setTimerSeconds(0);
            return;
        }

        // Initial calculation
        const startTime = activeSession.startTime.toDate();
        const updateTimer = () => {
            const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
            setTimerSeconds(elapsed);
        };
        updateTimer();

        // Tick every second
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [activeSession, taskId]);

    // ─────────────────────────────────────────────────────────
    // HANDLERS
    // ─────────────────────────────────────────────────────────

    const handleSave = async () => {
        if (!taskId) return;
        setSaving(true);

        try {
            await updateDoc(doc(db, 'gtd_tasks', taskId), {
                title,
                description,
                status,
                checklistItems: checklist,
                clientId: clientId || null,
                clientName: clientName || null,
                assigneeId: assigneeId || null,
                assigneeName: assigneeName || null,
                estimatedCost: estimatedCost || null,
                needsEstimate,
                priority,
                updatedAt: Timestamp.now()
            });
            setHasChanges(false);
        } catch (error) {
            console.error('Save failed:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = (newStatus: GTDStatus) => {
        setStatus(newStatus);
        setHasChanges(true);
    };

    const handleTimerToggle = async () => {
        if (!taskId || !currentUser || !task) return;

        const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;

        if (isTimerRunningForThisTask) {
            await stopSession();
        } else {
            // Pass task object for startSession
            await startSession({
                id: taskId,
                title,
                clientId: clientId || '',
                clientName: clientName || '',
            } as GTDTask);
        }
    };

    const handleAIEstimate = async () => {
        if (!taskId) return;
        setEstimating(true);

        try {
            const generatePriceEstimate = httpsCallable(functions, 'generatePriceEstimate');
            const result = await generatePriceEstimate({ taskId });
            const data = result.data as { lowPrice: number; highPrice: number; suggestedPrice: number };
            setEstimateResult({
                low: data.lowPrice,
                high: data.highPrice,
                suggested: data.suggestedPrice
            });
        } catch (error) {
            console.error('Estimate failed:', error);
        } finally {
            setEstimating(false);
        }
    };

    const applyEstimate = () => {
        if (estimateResult) {
            setEstimatedCost(estimateResult.suggested);
            setHasChanges(true);
            setEstimateResult(null);
        }
    };

    const handleChecklistToggle = (itemId: string) => {
        setChecklist(prev => prev.map(item =>
            item.id === itemId ? { ...item, completed: !item.completed } : item
        ));
        setHasChanges(true);
    };

    const handleAddChecklistItem = () => {
        const newItem: ChecklistItem = {
            id: crypto.randomUUID(),
            text: '',
            completed: false,
            createdAt: Timestamp.now()
        };
        setChecklist(prev => [...prev, newItem]);
        setHasChanges(true);
    };

    const handleChecklistTextChange = (itemId: string, text: string) => {
        setChecklist(prev => prev.map(item =>
            item.id === itemId ? { ...item, text } : item
        ));
        setHasChanges(true);
    };

    const handleDelete = async () => {
        if (!taskId) return;
        if (!window.confirm('Delete this task?')) return;

        await deleteDoc(doc(db, 'gtd_tasks', taskId));
        navigate('/crm/gtd');
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // ─────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                <CircularProgress />
            </Box>
        );
    }

    if (!task) {
        return (
            <Box p={3}>
                <Alert severity="error">Task not found</Alert>
                <Button onClick={() => navigate('/crm/gtd')} sx={{ mt: 2 }}>
                    Back to Cockpit
                </Button>
            </Box>
        );
    }

    const isTimerRunningForThisTask = activeSession?.relatedTaskId === taskId;

    return (
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* ═══════════════════════════════════════════════════════════ */}
            {/* STICKY HEADER */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <Paper
                elevation={2}
                sx={{
                    p: 2,
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    borderRadius: 0
                }}
            >
                <Box display="flex" alignItems="center" justifyContent="space-between">
                    {/* Left: Navigation */}
                    <Box display="flex" alignItems="center" gap={2}>
                        <IconButton onClick={() => navigate('/crm/gtd')}>
                            <BackIcon />
                        </IconButton>
                        <Breadcrumbs>
                            <Link
                                component="button"
                                variant="body2"
                                onClick={() => navigate('/crm/gtd')}
                                underline="hover"
                            >
                                Cockpit
                            </Link>
                            {clientName && (
                                <Typography variant="body2" color="text.primary">
                                    {clientName}
                                </Typography>
                            )}
                        </Breadcrumbs>
                    </Box>

                    {/* Center: Status Selector */}
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <Select
                            value={status}
                            onChange={(e) => handleStatusChange(e.target.value as GTDStatus)}
                            sx={{
                                bgcolor: STATUS_OPTIONS.find(s => s.value === status)?.color + '20',
                                '& .MuiSelect-select': { py: 1 }
                            }}
                        >
                            {STATUS_OPTIONS.map(opt => (
                                <MenuItem key={opt.value} value={opt.value}>
                                    <Chip
                                        size="small"
                                        label={opt.label}
                                        sx={{ bgcolor: opt.color + '30', color: opt.color }}
                                    />
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Right: Timer & Actions */}
                    <Box display="flex" alignItems="center" gap={2}>
                        {/* Source Audio Link */}
                        {task?.sourceAudioUrl && (
                            <Chip
                                label="🎙️ Voice"
                                color="info"
                                variant="outlined"
                                component="a"
                                href={task.sourceAudioUrl}
                                target="_blank"
                                clickable
                            />
                        )}

                        {/* Timer Button */}
                        <Button
                            variant={isTimerRunningForThisTask ? 'contained' : 'outlined'}
                            color={isTimerRunningForThisTask ? 'error' : 'success'}
                            startIcon={isTimerRunningForThisTask ? <StopIcon /> : <PlayIcon />}
                            onClick={handleTimerToggle}
                            sx={{
                                minWidth: 160,
                                animation: isTimerRunningForThisTask ? 'pulse 1.5s infinite' : 'none',
                                '@keyframes pulse': {
                                    '0%': { opacity: 1 },
                                    '50%': { opacity: 0.7 },
                                    '100%': { opacity: 1 },
                                }
                            }}
                        >
                            {isTimerRunningForThisTask ? formatTime(timerSeconds) : 'Start Work'}
                        </Button>

                        {/* Save Button */}
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                            onClick={handleSave}
                            disabled={!hasChanges || saving}
                        >
                            Save
                        </Button>

                        {/* Delete Button */}
                        <IconButton color="error" onClick={handleDelete}>
                            <DeleteIcon />
                        </IconButton>
                    </Box>
                </Box>
            </Paper>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* MAIN CONTENT AREA (2 columns) */}
            {/* ═══════════════════════════════════════════════════════════ */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
                    {/* LEFT COLUMN: Content (65%) */}
                    <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 65%' }, minWidth: 0 }}>
                        <Paper sx={{ p: 3 }}>
                            {/* Title */}
                            <TextField
                                fullWidth
                                variant="standard"
                                placeholder="Task title..."
                                value={title}
                                onChange={(e) => { setTitle(e.target.value); setHasChanges(true); }}
                                InputProps={{
                                    sx: { fontSize: '1.5rem', fontWeight: 600 }
                                }}
                                sx={{ mb: 2 }}
                            />

                            {/* Description */}
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                variant="outlined"
                                placeholder="Task description..."
                                value={description}
                                onChange={(e) => { setDescription(e.target.value); setHasChanges(true); }}
                                sx={{ mb: 3 }}
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Checklist */}
                            <Typography variant="h6" gutterBottom>
                                Checklist ({checklist.filter(i => i.completed).length}/{checklist.length})
                            </Typography>

                            <List dense>
                                {checklist.map((item, index) => (
                                    <ListItem
                                        key={item.id}
                                        sx={{
                                            bgcolor: item.completed ? 'action.hover' : 'transparent',
                                            borderRadius: 1,
                                            mb: 0.5
                                        }}
                                    >
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                            <IconButton size="small" sx={{ cursor: 'grab' }}>
                                                <DragIcon fontSize="small" />
                                            </IconButton>
                                        </ListItemIcon>
                                        <Checkbox
                                            checked={item.completed}
                                            onChange={() => handleChecklistToggle(item.id)}
                                            size="small"
                                        />
                                        <TextField
                                            fullWidth
                                            variant="standard"
                                            value={item.text}
                                            onChange={(e) => handleChecklistTextChange(item.id, e.target.value)}
                                            placeholder={`Step ${index + 1}`}
                                            sx={{
                                                textDecoration: item.completed ? 'line-through' : 'none',
                                                opacity: item.completed ? 0.6 : 1
                                            }}
                                        />
                                    </ListItem>
                                ))}
                            </List>

                            <Button
                                startIcon={<AddIcon />}
                                onClick={handleAddChecklistItem}
                                sx={{ mt: 1 }}
                            >
                                Add step
                            </Button>

                            <Divider sx={{ my: 3 }} />

                            {/* Activity Tabs */}
                            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
                                <Tab icon={<TimeIcon />} label="Work Log" />
                                <Tab icon={<PersonIcon />} label="History" />
                            </Tabs>

                            {activeTab === 0 && (
                                <Box sx={{ py: 2 }}>
                                    <Typography color="text.secondary">
                                        {isTimerRunningForThisTask
                                            ? `🟢 Working...`
                                            : 'No active work session'
                                        }
                                    </Typography>
                                    {task.totalTimeSpentMinutes && task.totalTimeSpentMinutes > 0 && (
                                        <Typography variant="body2" sx={{ mt: 1 }}>
                                            Total time: <strong>{Math.round(task.totalTimeSpentMinutes / 60)}h {task.totalTimeSpentMinutes % 60}m</strong>
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </Paper>
                    </Box>

                    {/* RIGHT COLUMN: Control Panel (35%) */}
                    <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 35%' }, minWidth: 0 }}>
                        <Paper sx={{ p: 3 }}>
                            {/* Block A: Client */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                🏢 Client
                            </Typography>

                            <Autocomplete
                                value={clients.find(c => c.id === clientId) || null}
                                options={clients}
                                getOptionLabel={(opt) => opt.name}
                                onChange={(_, newVal) => {
                                    setClientId(newVal?.id || null);
                                    setClientName(newVal?.name || null);
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Client"
                                        size="small"
                                    />
                                )}
                                sx={{ mb: 3 }}
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Block B: Team */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                👤 Assignee
                            </Typography>

                            <Autocomplete
                                value={users.find(u => u.id === assigneeId) || null}
                                options={users}
                                getOptionLabel={(opt) => opt.displayName}
                                onChange={(_, newVal) => {
                                    setAssigneeId(newVal?.id || null);
                                    setAssigneeName(newVal?.displayName || null);
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Assignee" size="small" />
                                )}
                                renderOption={(props, option) => (
                                    <li {...props}>
                                        <Avatar sx={{ width: 24, height: 24, mr: 1 }} src={option.avatarUrl}>
                                            {option.displayName?.charAt(0)}
                                        </Avatar>
                                        {option.displayName}
                                    </li>
                                )}
                                sx={{ mb: 3 }}
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Block C: Priority */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                🎯 Priority
                            </Typography>

                            <Box display="flex" gap={1} flexWrap="wrap" mb={3}>
                                {PRIORITY_OPTIONS.map(opt => (
                                    <Chip
                                        key={opt.value}
                                        label={opt.label}
                                        onClick={() => { setPriority(opt.value); setHasChanges(true); }}
                                        sx={{
                                            bgcolor: priority === opt.value ? opt.color : 'transparent',
                                            color: priority === opt.value ? 'white' : opt.color,
                                            border: `1px solid ${opt.color}`,
                                            cursor: 'pointer'
                                        }}
                                    />
                                ))}
                            </Box>

                            <Divider sx={{ my: 2 }} />

                            {/* Block D: Finance */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                💰 Finance
                            </Typography>

                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={needsEstimate}
                                        onChange={(e) => { setNeedsEstimate(e.target.checked); setHasChanges(true); }}
                                    />
                                }
                                label="Needs estimate"
                                sx={{ mb: 2 }}
                            />

                            <TextField
                                fullWidth
                                size="small"
                                label="Estimated Cost"
                                type="number"
                                value={estimatedCost}
                                onChange={(e) => { setEstimatedCost(e.target.value ? Number(e.target.value) : ''); setHasChanges(true); }}
                                InputProps={{
                                    startAdornment: <InputAdornment position="start">$</InputAdornment>
                                }}
                                sx={{ mb: 2 }}
                            />

                            {/* AI Estimate */}
                            <Button
                                fullWidth
                                variant="outlined"
                                startIcon={estimating ? <CircularProgress size={16} /> : <AIIcon />}
                                onClick={handleAIEstimate}
                                disabled={estimating}
                                sx={{ mb: 2 }}
                            >
                                {estimating ? 'Estimating...' : 'AI Estimate'}
                            </Button>

                            {estimateResult && (
                                <Alert
                                    severity="info"
                                    action={
                                        <Button size="small" onClick={applyEstimate}>
                                            Apply
                                        </Button>
                                    }
                                    sx={{ mb: 2 }}
                                >
                                    AI suggests: ${estimateResult.suggested}
                                    <br />
                                    <Typography variant="caption">
                                        Range: ${estimateResult.low} - ${estimateResult.high}
                                    </Typography>
                                </Alert>
                            )}
                        </Paper>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};

export default UnifiedCockpitPage;
