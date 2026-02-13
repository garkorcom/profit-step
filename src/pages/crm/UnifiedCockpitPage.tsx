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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    Box, Typography, TextField, Button, IconButton, Paper,
    Breadcrumbs, Link, Chip, Select, MenuItem, FormControl,
    Autocomplete, Avatar, Divider, Checkbox,
    FormControlLabel, InputAdornment, Tooltip, CircularProgress,
    Alert, List, ListItem, ListItemIcon, Tab, Tabs, Stack
} from '@mui/material';
import {
    ArrowBack as BackIcon,
    PlayArrow as PlayIcon,
    Stop as StopIcon,
    Delete as DeleteIcon,
    AutoAwesome as AIIcon,
    Add as AddIcon,
    DragIndicator as DragIcon,
    AccessTime as TimeIcon,
    Person as PersonIcon,
    CalendarMonth as CalendarIcon,
    Schedule as ScheduleIcon,
    Inventory as InventoryIcon,
} from '@mui/icons-material';
import { doc, updateDoc, onSnapshot, Timestamp, collection, getDocs, query, where, deleteDoc, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/firebase';
import { GTDTask, GTDStatus, GTDPriority, ChecklistItem, PRIORITY_COLORS } from '../../types/gtd.types';
import { useSessionManager } from '../../hooks/useSessionManager';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import TaskMaterialsTab from '../../components/crm/TaskMaterialsTab';
import { TaskMaterial } from '../../types/inventory.types';
import { calculateMaterialsCost } from '../../features/inventory/inventoryService';

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
// WORK SESSIONS LIST (sub-component)
// ═══════════════════════════════════════════════════════════

const WorkSessionsList: React.FC<{ taskId: string }> = ({ taskId }) => {
    const [sessions, setSessions] = useState<any[]>([]);
    const [loadingSessions, setLoadingSessions] = useState(true);

    useEffect(() => {
        if (!taskId) return;
        setLoadingSessions(true);

        getDocs(
            query(
                collection(db, 'work_sessions'),
                where('relatedTaskId', '==', taskId),
                orderBy('startTime', 'desc')
            )
        ).then(snap => {
            setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoadingSessions(false);
        }).catch(() => {
            setLoadingSessions(false);
        });
    }, [taskId]);

    if (loadingSessions) return <CircularProgress size={20} />;
    if (sessions.length === 0) return null;

    // Group by worker for summary
    const workerSummary = sessions.reduce<Record<string, { name: string; totalMinutes: number; totalEarnings: number; count: number }>>((acc, s) => {
        const name = s.workerName || s.userName || 'Работник';
        const start = s.startTime?.toDate ? s.startTime.toDate() : null;
        const end = s.endTime?.toDate ? s.endTime.toDate() : null;
        const duration = s.durationMinutes || (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0);
        if (!acc[name]) acc[name] = { name, totalMinutes: 0, totalEarnings: 0, count: 0 };
        acc[name].totalMinutes += duration;
        acc[name].totalEarnings += s.earnings || 0;
        acc[name].count += 1;
        return acc;
    }, {});

    const workerList = Object.values(workerSummary).sort((a, b) => b.totalMinutes - a.totalMinutes);
    const totalMinutes = workerList.reduce((s, w) => s + w.totalMinutes, 0);
    const totalEarnings = workerList.reduce((s, w) => s + w.totalEarnings, 0);

    return (
        <Box sx={{ mt: 1 }}>
            {/* Per-worker summary */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                    👥 Кто сколько работал
                </Typography>
                {workerList.map(w => {
                    const pct = totalMinutes > 0 ? Math.round((w.totalMinutes / totalMinutes) * 100) : 0;
                    return (
                        <Box key={w.name} sx={{ mb: 1.5 }}>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                                <Box display="flex" alignItems="center" gap={1}>
                                    <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                                        {w.name.charAt(0).toUpperCase()}
                                    </Avatar>
                                    <Typography variant="body2" fontWeight={500}>{w.name}</Typography>
                                    <Chip label={`${w.count} сес.`} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
                                </Box>
                                <Box textAlign="right">
                                    <Typography variant="body2" fontWeight={600}>
                                        {Math.floor(w.totalMinutes / 60)}ч {w.totalMinutes % 60}м
                                    </Typography>
                                    {w.totalEarnings > 0 && (
                                        <Typography variant="caption" color="success.main">
                                            ${w.totalEarnings.toFixed(2)}
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                            <Box sx={{ width: '100%', bgcolor: 'grey.200', borderRadius: 1, height: 6 }}>
                                <Box sx={{ width: `${pct}%`, bgcolor: 'primary.main', borderRadius: 1, height: 6, transition: 'width 0.3s' }} />
                            </Box>
                        </Box>
                    );
                })}
                <Divider sx={{ my: 1 }} />
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="body2" fontWeight={600}>Итого</Typography>
                    <Box textAlign="right">
                        <Typography variant="body2" fontWeight={700}>
                            {Math.floor(totalMinutes / 60)}ч {totalMinutes % 60}м
                        </Typography>
                        {totalEarnings > 0 && (
                            <Typography variant="caption" color="success.main" fontWeight={600}>
                                ${totalEarnings.toFixed(2)}
                            </Typography>
                        )}
                    </Box>
                </Box>
            </Paper>

            {/* Individual sessions */}
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                Сессии ({sessions.length})
            </Typography>
            {sessions.map((s) => {
                const start = s.startTime?.toDate ? s.startTime.toDate() : null;
                const end = s.endTime?.toDate ? s.endTime.toDate() : null;
                const duration = s.durationMinutes || (start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : 0);
                return (
                    <Paper
                        key={s.id}
                        variant="outlined"
                        sx={{ p: 1.5, mb: 1, borderRadius: 2 }}
                    >
                        <Box display="flex" justifyContent="space-between" alignItems="center">
                            <Box display="flex" alignItems="center" gap={1}>
                                <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem', bgcolor: 'primary.light' }}>
                                    {(s.workerName || s.userName || 'Р').charAt(0).toUpperCase()}
                                </Avatar>
                                <Box>
                                    <Typography variant="body2" fontWeight={500}>
                                        {s.workerName || s.userName || 'Работник'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {start ? formatDate(start, 'dd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                                        {end ? ` → ${formatDate(end, 'HH:mm', { locale: ru })}` : ' → в процессе'}
                                    </Typography>
                                </Box>
                            </Box>
                            <Box textAlign="right">
                                <Typography variant="body2" fontWeight={600}>
                                    {duration ? `${Math.floor(duration / 60)}ч ${duration % 60}м` : '—'}
                                </Typography>
                                {s.earnings ? (
                                    <Typography variant="caption" color="success.main">
                                        ${s.earnings.toFixed(2)}
                                    </Typography>
                                ) : null}
                            </Box>
                        </Box>
                    </Paper>
                );
            })}
        </Box>
    );
};

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const UnifiedCockpitPage: React.FC = () => {
    const { taskId } = useParams<{ taskId: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const { currentUser } = useAuth();

    // Context-aware back navigation
    const backPath = (location.state as any)?.from || '/crm/gtd';

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
    const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

    // Refs for autosave
    const savingRef = useRef(false);
    const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const hasChangesRef = useRef(false);

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

    // New fields
    const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState<number | ''>('');
    const [startDate, setStartDate] = useState<string>('');
    const [dueDate, setDueDate] = useState<string>('');
    const [dueDateManual, setDueDateManual] = useState(false);
    const [coAssignees, setCoAssignees] = useState<Array<{ id: string; name: string; role: 'executor' | 'reviewer' | 'observer' }>>([]);

    // Materials state
    const [materials, setMaterials] = useState<TaskMaterial[]>([]);

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

                // Skip form re-init when WE just saved (to avoid overwriting user edits)
                if (savingRef.current) return;

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
                setEstimatedDurationMinutes(data.estimatedDurationMinutes || '');

                // Convert Timestamp to date string for inputs
                if (data.startDate) {
                    const sd = data.startDate as any;
                    const dateObj = sd?.toDate ? sd.toDate() : new Date(sd);
                    setStartDate(formatDate(dateObj, 'yyyy-MM-dd'));
                } else {
                    setStartDate('');
                }
                if (data.dueDate) {
                    const dd = data.dueDate as any;
                    const dateObj = dd?.toDate ? dd.toDate() : new Date(dd);
                    setDueDate(formatDate(dateObj, 'yyyy-MM-dd'));
                } else {
                    setDueDate('');
                }
                setDueDateManual(false);
                setCoAssignees(data.coAssignees || []);
                setMaterials(data.materials || []);

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

        // Load users (all users, not filtered by status)
        getDocs(collection(db, 'users'))
            .then(snap => {
                setUsers(snap.docs
                    .map(d => ({
                        id: d.id,
                        displayName: d.data().displayName,
                        avatarUrl: d.data().avatarUrl
                    }))
                    .filter(u => u.displayName)
                    .sort((a, b) => a.displayName.localeCompare(b.displayName))
                );
            });

        return () => unsubscribe();
    }, [taskId]);

    // Auto-calculate end date from startDate + estimatedDurationMinutes
    useEffect(() => {
        if (!dueDateManual && startDate && estimatedDurationMinutes) {
            const start = new Date(startDate + 'T00:00:00');
            const durationMs = Number(estimatedDurationMinutes) * 60 * 1000;
            const end = new Date(start.getTime() + durationMs);
            setDueDate(formatDate(end, 'yyyy-MM-dd'));
            setHasChanges(true);
        }
    }, [startDate, estimatedDurationMinutes, dueDateManual]);

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

    const handleSave = useCallback(async () => {
        if (!taskId || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);

        try {
            // Build history events for co-assignee changes
            const prevCoIds = (task?.coAssignees || []).map(c => c.id);
            const newCoIds = coAssignees.map(c => c.id);
            const historyUpdates: any[] = [...(task?.taskHistory || [])];

            // Detect added co-assignees
            coAssignees.forEach(ca => {
                if (!prevCoIds.includes(ca.id)) {
                    historyUpdates.push({
                        type: 'co_assignee_added',
                        description: `Добавлен соисполнитель: ${ca.name} (${ca.role === 'executor' ? 'Исполнитель' : ca.role === 'reviewer' ? 'Ревьюер' : 'Наблюдатель'})`,
                        userId: currentUser?.uid,
                        userName: currentUser?.displayName || '',
                        timestamp: Timestamp.now(),
                    });
                }
            });
            // Detect removed co-assignees
            (task?.coAssignees || []).forEach((ca: any) => {
                if (!newCoIds.includes(ca.id)) {
                    historyUpdates.push({
                        type: 'co_assignee_removed',
                        description: `Удалён соисполнитель: ${ca.name}`,
                        userId: currentUser?.uid,
                        userName: currentUser?.displayName || '',
                        timestamp: Timestamp.now(),
                    });
                }
            });

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
                estimatedDurationMinutes: estimatedDurationMinutes || null,
                startDate: startDate ? Timestamp.fromDate(new Date(startDate + 'T00:00:00')) : null,
                dueDate: dueDate ? Timestamp.fromDate(new Date(dueDate + 'T00:00:00')) : null,
                coAssignees: coAssignees.length > 0 ? coAssignees : [],
                coAssigneeIds: coAssignees.map(c => c.id),
                taskHistory: historyUpdates,
                materials: materials.length > 0 ? materials : [],
                materialsCostPlanned: calculateMaterialsCost(materials).planned || null,
                materialsCostActual: calculateMaterialsCost(materials).actual || null,
                updatedAt: Timestamp.now()
            });
            setHasChanges(false);
            hasChangesRef.current = false;
            setLastSavedAt(new Date());
        } catch (error) {
            console.error('Save failed:', error);
        } finally {
            setSaving(false);
            // Allow onSnapshot re-init after a short delay
            setTimeout(() => { savingRef.current = false; }, 1000);
        }
    }, [taskId, title, description, status, checklist, clientId, clientName, assigneeId, assigneeName, estimatedCost, needsEstimate, priority, estimatedDurationMinutes, startDate, dueDate, coAssignees, materials, task, currentUser]);

    // ── Debounced autosave ──
    useEffect(() => {
        hasChangesRef.current = hasChanges;
        if (!hasChanges) return;

        // Clear previous timer
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

        // Schedule save after 1.5s of inactivity
        autoSaveTimerRef.current = setTimeout(() => {
            handleSave();
        }, 1500);

        return () => {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        };
    }, [hasChanges, handleSave]);

    // Save on unmount (navigating away)
    useEffect(() => {
        return () => {
            if (hasChangesRef.current) {
                // Fire-and-forget save
                handleSave();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
                <Button onClick={() => navigate(backPath)} sx={{ mt: 2 }}>
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
                        <IconButton onClick={() => navigate(backPath)}>
                            <BackIcon />
                        </IconButton>
                        <Breadcrumbs>
                            <Link
                                component="button"
                                variant="body2"
                                onClick={() => navigate(backPath)}
                                underline="hover"
                            >
                                {backPath === '/crm/tasks-masonry' ? 'Touch Board' : 'Cockpit'}
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

                        {/* Autosave indicator */}
                        {saving && (
                            <Box display="flex" alignItems="center" gap={0.5} sx={{ color: '#8E8E93' }}>
                                <CircularProgress size={14} sx={{ color: '#8E8E93' }} />
                                <Typography variant="caption">Saving…</Typography>
                            </Box>
                        )}
                        {!saving && lastSavedAt && !hasChanges && (
                            <Typography variant="caption" sx={{ color: '#34C759', fontWeight: 500 }}>
                                ✓ Saved
                            </Typography>
                        )}

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
                                <Tab icon={<TimeIcon />} label="Журнал работ" />
                                <Tab icon={<PersonIcon />} label="История" />
                                <Tab icon={<InventoryIcon />} label="Материалы" />
                            </Tabs>

                            {activeTab === 0 && (
                                <Box sx={{ py: 2 }}>
                                    {isTimerRunningForThisTask && (
                                        <Alert severity="success" sx={{ mb: 2 }}>
                                            🟢 Сейчас идёт работа...
                                        </Alert>
                                    )}
                                    {task.totalTimeSpentMinutes && task.totalTimeSpentMinutes > 0 ? (
                                        <Typography variant="body2" sx={{ mb: 2 }}>
                                            Общее время: <strong>{Math.floor(task.totalTimeSpentMinutes / 60)}ч {task.totalTimeSpentMinutes % 60}м</strong>
                                            {task.totalEarnings ? ` · $${task.totalEarnings.toFixed(2)}` : ''}
                                        </Typography>
                                    ) : (
                                        !isTimerRunningForThisTask && (
                                            <Typography color="text.secondary" variant="body2">
                                                Нет записей о работе
                                            </Typography>
                                        )
                                    )}
                                    <WorkSessionsList taskId={taskId || ''} />
                                </Box>
                            )}

                            {activeTab === 1 && (
                                <Box sx={{ py: 2 }}>
                                    <Stack spacing={1.5}>
                                        {task.createdAt && (
                                            <Box display="flex" alignItems="flex-start" gap={1.5}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 0.8, flexShrink: 0 }} />
                                                <Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        Задача создана
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {formatDate(
                                                            (task.createdAt as any)?.toDate ? (task.createdAt as any).toDate() : new Date(task.createdAt as any),
                                                            'dd MMM yyyy, HH:mm',
                                                            { locale: ru }
                                                        )}
                                                        {task.ownerName ? ` · ${task.ownerName}` : ''}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        )}

                                        {task.assigneeName && (
                                            <Box display="flex" alignItems="flex-start" gap={1.5}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'info.main', mt: 0.8, flexShrink: 0 }} />
                                                <Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        Назначен исполнитель: {task.assigneeName}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        )}

                                        {task.startDate && (
                                            <Box display="flex" alignItems="flex-start" gap={1.5}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main', mt: 0.8, flexShrink: 0 }} />
                                                <Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        План старта
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {formatDate(
                                                            (task.startDate as any)?.toDate ? (task.startDate as any).toDate() : new Date(task.startDate as any),
                                                            'dd MMM yyyy',
                                                            { locale: ru }
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        )}

                                        {task.dueDate && (
                                            <Box display="flex" alignItems="flex-start" gap={1.5}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', mt: 0.8, flexShrink: 0 }} />
                                                <Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        Дедлайн
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {formatDate(
                                                            (task.dueDate as any)?.toDate ? (task.dueDate as any).toDate() : new Date(task.dueDate as any),
                                                            'dd MMM yyyy',
                                                            { locale: ru }
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        )}

                                        {task.completedAt && (
                                            <Box display="flex" alignItems="flex-start" gap={1.5}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', mt: 0.8, flexShrink: 0 }} />
                                                <Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        ✅ Задача завершена
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {formatDate(
                                                            (task.completedAt as any)?.toDate ? (task.completedAt as any).toDate() : new Date(task.completedAt as any),
                                                            'dd MMM yyyy, HH:mm',
                                                            { locale: ru }
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        )}

                                        {task.updatedAt && (
                                            <Box display="flex" alignItems="flex-start" gap={1.5}>
                                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'grey.400', mt: 0.8, flexShrink: 0 }} />
                                                <Box>
                                                    <Typography variant="body2" fontWeight={500}>
                                                        Последнее обновление
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {formatDate(
                                                            (task.updatedAt as any)?.toDate ? (task.updatedAt as any).toDate() : new Date(task.updatedAt as any),
                                                            'dd MMM yyyy, HH:mm',
                                                            { locale: ru }
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        )}

                                        {/* Task History Events */}
                                        {task.taskHistory && task.taskHistory.length > 0 && (
                                            <>
                                                <Divider sx={{ my: 1 }} />
                                                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                                                    Журнал изменений
                                                </Typography>
                                                {[...task.taskHistory].reverse().map((event, idx) => {
                                                    const eventColors: Record<string, string> = {
                                                        co_assignee_added: '#4caf50',
                                                        co_assignee_removed: '#f44336',
                                                        assigned: '#2196f3',
                                                        status_changed: '#ff9800',
                                                        completed: '#4caf50',
                                                        created: '#2196f3',
                                                        updated: '#9e9e9e',
                                                    };
                                                    const ts = event.timestamp?.toDate ? event.timestamp.toDate() : (event.timestamp ? new Date(event.timestamp) : null);
                                                    return (
                                                        <Box key={idx} display="flex" alignItems="flex-start" gap={1.5}>
                                                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: eventColors[event.type] || '#9e9e9e', mt: 0.8, flexShrink: 0 }} />
                                                            <Box>
                                                                <Typography variant="body2" fontWeight={500}>
                                                                    {event.description}
                                                                </Typography>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {ts ? formatDate(ts, 'dd MMM yyyy, HH:mm', { locale: ru }) : ''}
                                                                    {event.userName ? ` · ${event.userName}` : ''}
                                                                </Typography>
                                                            </Box>
                                                        </Box>
                                                    );
                                                })}
                                            </>
                                        )}
                                    </Stack>
                                </Box>
                            )}

                            {activeTab === 2 && (
                                <TaskMaterialsTab
                                    taskId={taskId || ''}
                                    materials={materials}
                                    clientId={clientId || undefined}
                                    clientName={clientName || undefined}
                                    userId={currentUser?.uid || ''}
                                    userName={currentUser?.displayName || ''}
                                    onMaterialsChange={(updated) => {
                                        setMaterials(updated);
                                        setHasChanges(true);
                                    }}
                                />
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
                                👤 Исполнитель
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
                                    <TextField {...params} label="Исполнитель" size="small" />
                                )}
                                renderOption={(props, option) => (
                                    <li {...props}>
                                        <Avatar sx={{ width: 24, height: 24, mr: 1 }} src={option.avatarUrl}>
                                            {option.displayName?.charAt(0)}
                                        </Avatar>
                                        {option.displayName}
                                    </li>
                                )}
                                sx={{ mb: 2 }}
                            />

                            {/* Co-assignees */}
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Соисполнители
                            </Typography>

                            {coAssignees.length > 0 && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1 }}>
                                    {coAssignees.map(ca => (
                                        <Box key={ca.id} display="flex" alignItems="center" gap={0.5}>
                                            <Chip
                                                label={ca.name}
                                                size="small"
                                                avatar={<Avatar sx={{ width: 20, height: 20 }}>{ca.name?.charAt(0)}</Avatar>}
                                                onDelete={() => {
                                                    setCoAssignees(prev => prev.filter(c => c.id !== ca.id));
                                                    setHasChanges(true);
                                                }}
                                                sx={{ flexShrink: 0 }}
                                            />
                                            <Box
                                                component="select"
                                                value={ca.role || 'executor'}
                                                onChange={(e: any) => {
                                                    setCoAssignees(prev => prev.map(c =>
                                                        c.id === ca.id ? { ...c, role: e.target.value } : c
                                                    ));
                                                    setHasChanges(true);
                                                }}
                                                sx={{
                                                    border: '1px solid',
                                                    borderColor: 'divider',
                                                    borderRadius: 1,
                                                    px: 0.5,
                                                    py: 0.25,
                                                    fontSize: '0.7rem',
                                                    bgcolor: 'transparent',
                                                    cursor: 'pointer',
                                                    outline: 'none',
                                                    color: 'text.secondary',
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
                                options={users.filter(u => u.id !== assigneeId && !coAssignees.some(ca => ca.id === u.id))}
                                getOptionLabel={(opt) => opt.displayName}
                                onChange={(_, newVal) => {
                                    if (newVal) {
                                        setCoAssignees(prev => [...prev, { id: newVal.id, name: newVal.displayName, role: 'executor' as const }]);
                                        setHasChanges(true);
                                    }
                                }}
                                renderInput={(params) => (
                                    <TextField {...params} label="Добавить соисполнителя" size="small" />
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
                                blurOnSelect
                                clearOnBlur
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Block B2: Metadata — Creator, Time */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                📋 Информация
                            </Typography>

                            <Stack spacing={1} sx={{ mb: 3 }}>
                                {/* Creator */}
                                {task.ownerName && (
                                    <Box display="flex" justifyContent="space-between" alignItems="center">
                                        <Typography variant="body2" color="text.secondary">Создал</Typography>
                                        <Typography variant="body2" fontWeight={500}>{task.ownerName}</Typography>
                                    </Box>
                                )}

                                {/* Created At */}
                                {task.createdAt && (
                                    <Box display="flex" justifyContent="space-between" alignItems="center">
                                        <Typography variant="body2" color="text.secondary">Дата создания</Typography>
                                        <Typography variant="body2" fontWeight={500}>
                                            {formatDate(
                                                (task.createdAt as any)?.toDate ? (task.createdAt as any).toDate() : new Date(task.createdAt as any),
                                                'dd MMM yyyy, HH:mm',
                                                { locale: ru }
                                            )}
                                        </Typography>
                                    </Box>
                                )}

                                {/* Updated At */}
                                {task.updatedAt && (
                                    <Box display="flex" justifyContent="space-between" alignItems="center">
                                        <Typography variant="body2" color="text.secondary">Обновлено</Typography>
                                        <Typography variant="body2">
                                            {formatDate(
                                                (task.updatedAt as any)?.toDate ? (task.updatedAt as any).toDate() : new Date(task.updatedAt as any),
                                                'dd MMM yyyy, HH:mm',
                                                { locale: ru }
                                            )}
                                        </Typography>
                                    </Box>
                                )}
                            </Stack>

                            <Divider sx={{ my: 2 }} />

                            {/* Block B3: Planning — Duration, Start, End */}
                            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                                📅 Планирование
                            </Typography>

                            {/* Estimated Duration */}
                            <TextField
                                fullWidth
                                size="small"
                                label="Планируемое время (мин)"
                                type="number"
                                value={estimatedDurationMinutes}
                                onChange={(e) => { setEstimatedDurationMinutes(e.target.value ? Number(e.target.value) : ''); setHasChanges(true); }}
                                InputProps={{
                                    startAdornment: <InputAdornment position="start"><ScheduleIcon fontSize="small" /></InputAdornment>,
                                    endAdornment: estimatedDurationMinutes ? (
                                        <InputAdornment position="end">
                                            <Typography variant="caption" color="text.secondary">
                                                {Math.floor(Number(estimatedDurationMinutes) / 60)}ч {Number(estimatedDurationMinutes) % 60}м
                                            </Typography>
                                        </InputAdornment>
                                    ) : null
                                }}
                                sx={{ mb: 2 }}
                            />

                            {/* Plan Start Date */}
                            <TextField
                                fullWidth
                                size="small"
                                label="План старта"
                                type="date"
                                value={startDate}
                                onChange={(e) => { setStartDate(e.target.value); setHasChanges(true); }}
                                InputLabelProps={{ shrink: true }}
                                InputProps={{
                                    startAdornment: <InputAdornment position="start"><CalendarIcon fontSize="small" /></InputAdornment>
                                }}
                                sx={{ mb: 2 }}
                            />

                            {/* Due Date / Plan End */}
                            <TextField
                                fullWidth
                                size="small"
                                label={!dueDateManual && startDate && estimatedDurationMinutes ? 'План окончания (авто)' : 'План окончания'}
                                type="date"
                                value={dueDate}
                                onChange={(e) => { setDueDate(e.target.value); setDueDateManual(true); setHasChanges(true); }}
                                InputLabelProps={{ shrink: true }}
                                InputProps={{
                                    startAdornment: <InputAdornment position="start"><CalendarIcon fontSize="small" /></InputAdornment>,
                                    endAdornment: dueDateManual && startDate && estimatedDurationMinutes ? (
                                        <InputAdornment position="end">
                                            <Tooltip title="Сбросить на авто-расчёт">
                                                <IconButton size="small" onClick={() => { setDueDateManual(false); setHasChanges(true); }}>
                                                    <ScheduleIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </InputAdornment>
                                    ) : null
                                }}
                                sx={{
                                    mb: 3,
                                    '& .MuiOutlinedInput-root': !dueDateManual && startDate && estimatedDurationMinutes ? {
                                        bgcolor: 'action.hover'
                                    } : {}
                                }}
                                helperText={!dueDateManual && startDate && estimatedDurationMinutes ? 'Авто-расчёт от старта + длительность' : undefined}
                            />

                            {/* Show in Calendar Button */}
                            {(startDate || dueDate) && (
                                <Button
                                    fullWidth
                                    size="small"
                                    startIcon={<CalendarIcon />}
                                    onClick={() => {
                                        const targetDate = dueDate || startDate;
                                        navigate(`/crm/calendar?date=${targetDate}`);
                                    }}
                                    sx={{
                                        mb: 1,
                                        textTransform: 'none',
                                        justifyContent: 'flex-start',
                                        color: 'primary.main',
                                        fontWeight: 500,
                                    }}
                                >
                                    Показать в календаре
                                </Button>
                            )}

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
