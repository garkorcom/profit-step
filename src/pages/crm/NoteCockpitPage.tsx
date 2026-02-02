/**
 * @fileoverview Cockpit View - Unified task processing page
 * 
 * Features:
 * - Sticky header with stage, timer, actions
 * - Main content: title, description, checklist, attachments
 * - Control panel: project, team, schedule, finance
 * 
 * @module pages/crm/NoteCockpitPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Box, Typography, TextField, Button, IconButton, Paper,
    Breadcrumbs, Link, Chip, Select, MenuItem, FormControl,
    InputLabel, Autocomplete, Avatar, Divider, Checkbox,
    FormControlLabel, InputAdornment, Tooltip, CircularProgress,
    Dialog, DialogTitle, DialogContent, DialogActions, Alert,
    List, ListItem, ListItemIcon, ListItemText, Tab, Tabs
} from '@mui/material';
import {
    ArrowBack as BackIcon,
    PlayArrow as PlayIcon,
    Pause as PauseIcon,
    Save as SaveIcon,
    Archive as ArchiveIcon,
    AutoAwesome as AIIcon,
    Add as AddIcon,
    CallSplit as SplitIcon,
    DragIndicator as DragIcon,
    AttachFile as AttachIcon,
    AccessTime as TimeIcon,
    Person as PersonIcon,
    CalendarToday as CalendarIcon,
    AttachMoney as MoneyIcon,
    CheckCircle as CheckIcon,
    Warning as WarningIcon
} from '@mui/icons-material';
import { doc, getDoc, updateDoc, onSnapshot, Timestamp, collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/firebase';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

type NoteStage = 'inbox' | 'processing' | 'ready' | 'planning' | 'execution' | 'review' | 'done' | 'archived';

interface ChecklistItem {
    id: string;
    text: string;
    isDone: boolean;
}

interface Note {
    id: string;
    stage: NoteStage;
    title: string;
    description?: string;
    checklist?: ChecklistItem[];
    projectId?: string;
    projectName?: string;
    clientId?: string;
    clientName?: string;
    assigneeIds?: string[];
    assigneeNames?: string[];
    controllerId?: string;
    controllerName?: string;
    schedule?: {
        start?: Timestamp;
        end?: Timestamp;
        controlAt?: Timestamp;
    };
    financials?: {
        price?: number;
        actualCost?: number;
        aiSuggestedPrice?: number;
    };
    isNeedsEstimate?: boolean;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    siteLocation?: string;
    activeTimer?: {
        sessionId: string;
        startedAt: Timestamp;
        employeeId: string;
        employeeName: string;
    };
    ownerId: string;
    ownerName?: string;
    createdAt: Timestamp;
    updatedAt?: Timestamp;
    /** ID of GTD Task if this note was converted */
    convertedToTaskId?: string;
}

interface User {
    id: string;
    displayName: string;
    avatarUrl?: string;
}

interface Project {
    id: string;
    name: string;
    clientId?: string;
    clientName?: string;
}

const STAGE_OPTIONS: { value: NoteStage; label: string; color: string }[] = [
    { value: 'inbox', label: 'Inbox', color: '#9e9e9e' },
    { value: 'ready', label: 'Ready', color: '#2196f3' },
    { value: 'planning', label: 'Planning', color: '#ff9800' },
    { value: 'execution', label: 'Execution', color: '#4caf50' },
    { value: 'review', label: 'Review', color: '#9c27b0' },
    { value: 'done', label: 'Done', color: '#00c853' },
];

const PRIORITY_OPTIONS = [
    { value: 'low', label: 'Low', color: '#9e9e9e' },
    { value: 'medium', label: 'Medium', color: '#ff9800' },
    { value: 'high', label: 'High', color: '#f44336' },
    { value: 'urgent', label: 'Urgent', color: '#d50000' },
];

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const NoteCockpitPage: React.FC = () => {
    const { noteId } = useParams<{ noteId: string }>();
    const navigate = useNavigate();
    const { currentUser } = useAuth();

    // State
    const [note, setNote] = useState<Note | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [stage, setStage] = useState<NoteStage>('inbox');
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [projectId, setProjectId] = useState<string | null>(null);
    const [projectName, setProjectName] = useState<string | null>(null);
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
    const [controllerId, setControllerId] = useState<string | null>(null);
    const [price, setPrice] = useState<number | ''>('');
    const [isNeedsEstimate, setIsNeedsEstimate] = useState(false);
    const [priority, setPriority] = useState<string>('medium');
    const [siteLocation, setSiteLocation] = useState('');

    // Reference data
    const [projects, setProjects] = useState<Project[]>([]);
    const [users, setUsers] = useState<User[]>([]);

    // Timer state
    const [timerRunning, setTimerRunning] = useState(false);
    const [timerSeconds, setTimerSeconds] = useState(0);

    // AI state
    const [estimating, setEstimating] = useState(false);
    const [estimateResult, setEstimateResult] = useState<{ low: number; high: number; suggested: number } | null>(null);

    // Tab state
    const [activeTab, setActiveTab] = useState(0);

    // ─────────────────────────────────────────────────────────
    // LOAD DATA
    // ─────────────────────────────────────────────────────────

    useEffect(() => {
        if (!noteId) return;

        // Real-time subscription to note
        const unsubscribe = onSnapshot(doc(db, 'notes', noteId), (snap) => {
            if (snap.exists()) {
                const data = { id: snap.id, ...snap.data() } as Note;
                setNote(data);

                // Initialize form state
                setTitle(data.title || '');
                setDescription(data.description || '');
                setStage(data.stage);
                setChecklist(data.checklist || []);
                setProjectId(data.projectId || null);
                setProjectName(data.projectName || null);
                setAssigneeIds(data.assigneeIds || []);
                setControllerId(data.controllerId || null);
                setPrice(data.financials?.price || '');
                setIsNeedsEstimate(data.isNeedsEstimate || false);
                setPriority(data.priority || 'medium');
                setSiteLocation(data.siteLocation || '');

                // Timer state
                if (data.activeTimer) {
                    setTimerRunning(true);
                    const startTime = data.activeTimer.startedAt.toDate();
                    const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
                    setTimerSeconds(elapsed);
                } else {
                    setTimerRunning(false);
                }

                setLoading(false);
            }
        });

        // Load projects
        getDocs(query(collection(db, 'clients'), where('status', '!=', 'archived')))
            .then(snap => {
                setProjects(snap.docs.map(d => ({
                    id: d.id,
                    name: d.data().name,
                    clientId: d.id,
                    clientName: d.data().name
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
    }, [noteId]);

    // Timer tick
    useEffect(() => {
        if (!timerRunning) return;
        const interval = setInterval(() => {
            setTimerSeconds(s => s + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [timerRunning]);

    // ─────────────────────────────────────────────────────────
    // HANDLERS
    // ─────────────────────────────────────────────────────────

    const handleSave = async () => {
        if (!noteId) return;
        setSaving(true);

        try {
            await updateDoc(doc(db, 'notes', noteId), {
                title,
                description,
                stage,
                checklist,
                projectId,
                projectName,
                assigneeIds,
                controllerId,
                'financials.price': price || null,
                isNeedsEstimate,
                priority,
                siteLocation,
                updatedAt: Timestamp.now()
            });
            setHasChanges(false);
        } catch (error) {
            console.error('Save failed:', error);
        } finally {
            setSaving(false);
        }
    };

    // Save and promote to GTD Task
    const handleSaveAndPromote = async () => {
        if (!noteId || !currentUser || !note) return;
        setSaving(true);

        try {
            const mappedChecklist = checklist.map(item => ({
                id: item.id,
                text: item.text,
                completed: item.isDone,
                createdAt: Timestamp.now(),
            }));

            // If already has linked GTD task → UPDATE it
            if (note.convertedToTaskId) {
                await updateDoc(doc(db, 'gtd_tasks', note.convertedToTaskId), {
                    title,
                    description,
                    priority: priority || 'none',
                    checklistItems: mappedChecklist,
                    ...(projectId && {
                        projectId,
                        clientId: projectId,
                        clientName: projectName || ''
                    }),
                    ...(assigneeIds?.length && {
                        assigneeId: assigneeIds[0],
                        assigneeName: users.find(u => u.id === assigneeIds[0])?.displayName || ''
                    }),
                    updatedAt: Timestamp.now(),
                });

                // Update note too
                await updateDoc(doc(db, 'notes', noteId), {
                    title,
                    description,
                    checklist,
                    projectId,
                    projectName,
                    assigneeIds,
                    priority,
                    updatedAt: Timestamp.now()
                });
            } else {
                // Create NEW GTD task
                const newTask = {
                    title,
                    description,
                    status: 'inbox',
                    priority: priority || 'none',
                    createdAt: Timestamp.now(),
                    ownerId: currentUser.uid,
                    ownerName: currentUser.displayName || 'Unknown',
                    context: '',
                    ...(assigneeIds?.length && {
                        assigneeId: assigneeIds[0],
                        assigneeName: users.find(u => u.id === assigneeIds[0])?.displayName || ''
                    }),
                    ...(projectId && {
                        projectId,
                        clientId: projectId,
                        clientName: projectName || ''
                    }),
                    checklistItems: mappedChecklist,
                    sourceNoteId: noteId,
                };

                const taskRef = await addDoc(collection(db, 'gtd_tasks'), newTask);

                // Archive note & link to task
                await updateDoc(doc(db, 'notes', noteId), {
                    stage: 'archived' as NoteStage,
                    archivedAt: Timestamp.now(),
                    archivedReason: 'converted_to_task',
                    convertedToTaskId: taskRef.id
                });
            }

            setHasChanges(false);

            // Navigate to GTD board
            navigate('/crm/gtd');

        } catch (error) {
            console.error('Save & promote failed:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleStageChange = (newStage: NoteStage) => {
        // Validation: can't leave inbox without project
        if (stage === 'inbox' && newStage !== 'inbox' && !projectId) {
            alert('Please select a project before moving out of Inbox');
            return;
        }
        setStage(newStage);
        setHasChanges(true);
    };

    const handleTimerToggle = async () => {
        if (!noteId || !currentUser) return;

        if (timerRunning) {
            // TODO: Pause timer - end current session
            alert('Pause functionality coming soon');
        } else {
            // Start timer - create session
            try {
                await addDoc(collection(db, 'sessions'), {
                    employeeId: currentUser.uid,
                    employeeName: currentUser.displayName || 'User',
                    clientId: projectId || '',
                    clientName: projectName || 'No Project',
                    relatedNoteId: noteId,
                    startTime: Timestamp.now(),
                    status: 'active',
                    hourlyRate: 25 // TODO: Get from user profile
                });
                setTimerRunning(true);
                setTimerSeconds(0);
            } catch (error) {
                console.error('Failed to start timer:', error);
            }
        }
    };

    const handleAIEstimate = async () => {
        if (!noteId) return;
        setEstimating(true);

        try {
            const generatePriceEstimate = httpsCallable(functions, 'generatePriceEstimate');
            const result = await generatePriceEstimate({ noteId });
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
            setPrice(estimateResult.suggested);
            setHasChanges(true);
            setEstimateResult(null);
        }
    };

    const handleChecklistToggle = (itemId: string) => {
        setChecklist(prev => prev.map(item =>
            item.id === itemId ? { ...item, isDone: !item.isDone } : item
        ));
        setHasChanges(true);
    };

    const handleAddChecklistItem = () => {
        const newItem: ChecklistItem = {
            id: crypto.randomUUID(),
            text: '',
            isDone: false
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

    if (!note) {
        return (
            <Box p={3}>
                <Alert severity="error">Note not found</Alert>
                <Button onClick={() => navigate('/crm/inbox')} sx={{ mt: 2 }}>
                    Back to Inbox
                </Button>
            </Box>
        );
    }

    const actualCost = note.financials?.actualCost || 0;
    const priceNum = typeof price === 'number' ? price : 0;
    const isLoss = actualCost > priceNum && priceNum > 0;

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
                        <IconButton onClick={() => navigate('/crm/inbox')}>
                            <BackIcon />
                        </IconButton>
                        <Breadcrumbs>
                            <Link
                                component="button"
                                variant="body2"
                                onClick={() => navigate('/crm/inbox')}
                                underline="hover"
                            >
                                Inbox
                            </Link>
                            {projectName && (
                                <Typography variant="body2" color="text.primary">
                                    {projectName}
                                </Typography>
                            )}
                        </Breadcrumbs>
                    </Box>

                    {/* Center: Stage Selector */}
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                        <Select
                            value={stage}
                            onChange={(e) => handleStageChange(e.target.value as NoteStage)}
                            sx={{
                                bgcolor: STAGE_OPTIONS.find(s => s.value === stage)?.color + '20',
                                '& .MuiSelect-select': { py: 1 }
                            }}
                        >
                            {STAGE_OPTIONS.map(opt => (
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
                        {/* Link to GTD Task (if converted) */}
                        {note?.convertedToTaskId && (
                            <Chip
                                label="📋 GTD Task"
                                color="info"
                                variant="outlined"
                                onClick={() => navigate(`/crm/gtd/${note.convertedToTaskId}`)}
                                sx={{ cursor: 'pointer' }}
                            />
                        )}

                        {/* Timer Button */}
                        <Button
                            variant={timerRunning ? 'contained' : 'outlined'}
                            color={timerRunning ? 'error' : 'success'}
                            startIcon={timerRunning ? <PauseIcon /> : <PlayIcon />}
                            onClick={handleTimerToggle}
                            sx={{
                                minWidth: 160,
                                animation: timerRunning ? 'pulse 1.5s infinite' : 'none',
                                '@keyframes pulse': {
                                    '0%': { opacity: 1 },
                                    '50%': { opacity: 0.7 },
                                    '100%': { opacity: 1 },
                                }
                            }}
                        >
                            {timerRunning ? formatTime(timerSeconds) : 'Start Work'}
                        </Button>

                        {/* Save Draft Button */}
                        <Button
                            variant="outlined"
                            startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                            onClick={handleSave}
                            disabled={!hasChanges || saving}
                        >
                            Save Draft
                        </Button>

                        {/* Save & Create/Update GTD Task Button */}
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={saving ? <CircularProgress size={16} /> : <CheckIcon />}
                            onClick={handleSaveAndPromote}
                            disabled={saving}
                        >
                            {note?.convertedToTaskId ? 'Update GTD Task' : 'Save & Create Task'}
                        </Button>

                        {/* Archive Button */}
                        <IconButton color="default">
                            <ArchiveIcon />
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
                                Checklist ({checklist.filter(i => i.isDone).length}/{checklist.length})
                            </Typography>

                            <List dense>
                                {checklist.map((item, index) => (
                                    <ListItem
                                        key={item.id}
                                        sx={{
                                            bgcolor: item.isDone ? 'action.hover' : 'transparent',
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
                                            checked={item.isDone}
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
                                                textDecoration: item.isDone ? 'line-through' : 'none',
                                                opacity: item.isDone ? 0.6 : 1
                                            }}
                                        />
                                        <Tooltip title="Split to new task">
                                            <IconButton size="small">
                                                <SplitIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
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
                                        {note.activeTimer
                                            ? `🟢 ${note.activeTimer.employeeName} is working...`
                                            : 'No active work sessions'
                                        }
                                    </Typography>
                                    {actualCost > 0 && (
                                        <Typography variant="body2" sx={{ mt: 1 }}>
                                            Total labor cost: <strong>${actualCost.toFixed(2)}</strong>
                                        </Typography>
                                    )}
                                </Box>
                            )}
                        </Paper>
                    </Box>

                    {/* RIGHT COLUMN: Control Panel (35%) */}
                    <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 35%' }, minWidth: 0 }}>
                        <Paper sx={{ p: 3 }}>
                            {/* Block A: Context */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                📍 Context
                            </Typography>

                            <Autocomplete
                                value={projects.find(p => p.id === projectId) || null}
                                options={projects}
                                getOptionLabel={(opt) => opt.name}
                                onChange={(_, newVal) => {
                                    setProjectId(newVal?.id || null);
                                    setProjectName(newVal?.name || null);
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Project"
                                        size="small"
                                        error={stage !== 'inbox' && !projectId}
                                    />
                                )}
                                sx={{ mb: 2 }}
                            />

                            <TextField
                                fullWidth
                                size="small"
                                label="Location (Floor/Room)"
                                value={siteLocation}
                                onChange={(e) => { setSiteLocation(e.target.value); setHasChanges(true); }}
                                sx={{ mb: 3 }}
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Block B: Team */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                👥 Team
                            </Typography>

                            <Autocomplete
                                multiple
                                value={users.filter(u => assigneeIds.includes(u.id))}
                                options={users}
                                getOptionLabel={(opt) => opt.displayName}
                                onChange={(_, newVal) => {
                                    setAssigneeIds(newVal.map(u => u.id));
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Assignees" size="small" />
                                )}
                                renderOption={(props, option) => (
                                    <li {...props}>
                                        <Avatar sx={{ width: 24, height: 24, mr: 1 }}>
                                            {option.displayName[0]}
                                        </Avatar>
                                        {option.displayName}
                                    </li>
                                )}
                                sx={{ mb: 2 }}
                            />

                            <Autocomplete
                                value={users.find(u => u.id === controllerId) || null}
                                options={users}
                                getOptionLabel={(opt) => opt.displayName}
                                onChange={(_, newVal) => {
                                    setControllerId(newVal?.id || null);
                                    setHasChanges(true);
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Controller" size="small" />
                                )}
                                sx={{ mb: 3 }}
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Block C: Priority */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                🎯 Priority
                            </Typography>

                            <FormControl fullWidth size="small" sx={{ mb: 3 }}>
                                <Select
                                    value={priority}
                                    onChange={(e) => { setPriority(e.target.value); setHasChanges(true); }}
                                >
                                    {PRIORITY_OPTIONS.map(opt => (
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

                            <Divider sx={{ my: 2 }} />

                            {/* Block D: Finance */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                💰 Finance
                            </Typography>

                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={isNeedsEstimate}
                                        onChange={(e) => { setIsNeedsEstimate(e.target.checked); setHasChanges(true); }}
                                    />
                                }
                                label="Requires estimate"
                                sx={{ mb: 2 }}
                            />

                            <TextField
                                fullWidth
                                size="small"
                                label="Price (Client)"
                                type="number"
                                value={price}
                                onChange={(e) => { setPrice(e.target.value ? Number(e.target.value) : ''); setHasChanges(true); }}
                                InputProps={{
                                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <Tooltip title="AI Estimate">
                                                <IconButton
                                                    size="small"
                                                    onClick={handleAIEstimate}
                                                    disabled={estimating}
                                                >
                                                    {estimating ? <CircularProgress size={16} /> : <AIIcon />}
                                                </IconButton>
                                            </Tooltip>
                                        </InputAdornment>
                                    )
                                }}
                                sx={{ mb: 2 }}
                            />

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
                                    Market: ${estimateResult.low} - ${estimateResult.high}
                                </Alert>
                            )}

                            <Box
                                sx={{
                                    p: 2,
                                    bgcolor: isLoss ? 'error.main' : 'grey.100',
                                    color: isLoss ? 'white' : 'text.primary',
                                    borderRadius: 1
                                }}
                            >
                                <Typography variant="caption" display="block">
                                    Actual Cost
                                </Typography>
                                <Typography variant="h5">
                                    ${actualCost.toFixed(2)}
                                    {isLoss && <WarningIcon sx={{ ml: 1, fontSize: 20 }} />}
                                </Typography>
                            </Box>
                        </Paper>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};

export default NoteCockpitPage;
