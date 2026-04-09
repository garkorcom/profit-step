/**
 * @fileoverview TasksMasonryPage — Sectioned grid of task squares
 * 
 * Route: /crm/tasks-masonry
 * Features:
 * - Responsive CSS Grid: 1→2→3→4 columns
 * - Sections: "Overdue & Today", "Tomorrow", etc.
 * - FAB for quick add with priority/context/client/status/dueDate
 * - Click-to-navigate to task cockpit (with context-aware back)
 * - Undo snackbar for mark-as-done with fade animation
 * - Search/filter
 * - Drag-and-drop between sections (desktop)
 * - Expandable Done section (5 → all)
 * - No Context CTA
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
    Box, Typography, Fab, Dialog, TextField, Button, CircularProgress,
    Snackbar, Alert, Chip, Autocomplete,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import UndoIcon from '@mui/icons-material/Undo';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import LabelOffIcon from '@mui/icons-material/LabelOff';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import TaskSquare from '../../components/tasks-masonry/TaskSquare';
import TasksMasonryHeader from '../../components/tasks-masonry/TasksMasonryHeader';
import { useTasksMasonry, TaskGroup } from '../../hooks/useTasksMasonry';
import { GTDTask, GTDPriority, GTDStatus, PRIORITY_COLORS } from '../../types/gtd.types';

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

// ── Collapsible Section ──
interface SectionProps {
    group: TaskGroup;
    children: React.ReactNode;
    // Optional: expandable "Show more" for Done section
    showMoreButton?: React.ReactNode;
    // Optional: CTA message for empty-ish sections
    ctaMessage?: string;
}

const Section: React.FC<SectionProps> = ({ group, children, showMoreButton, ctaMessage }) => {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <Box sx={{ mb: 3 }}>
            {/* Section header */}
            <Box
                onClick={() => setCollapsed(!collapsed)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: { xs: 0.5, md: 0 },
                    py: 1,
                    cursor: 'pointer',
                    userSelect: 'none',
                    '&:hover': { opacity: 0.8 },
                }}
            >
                <Typography sx={{ fontSize: '20px' }}>{group.emoji}</Typography>
                <Typography sx={{
                    fontWeight: 700,
                    fontSize: '16px',
                    fontFamily: SF_FONT,
                    color: '#1D1D1F',
                }}>
                    {group.label}
                </Typography>
                <Box sx={{
                    bgcolor: `${group.color}18`,
                    color: group.color,
                    fontWeight: 700,
                    fontSize: '12px',
                    fontFamily: SF_FONT,
                    px: 1.25,
                    py: 0.25,
                    borderRadius: '8px',
                    minWidth: 24,
                    textAlign: 'center',
                }}>
                    {group.tasks.length}
                </Box>
                {collapsed ? (
                    <ExpandMoreIcon sx={{ fontSize: 20, color: '#8E8E93', ml: 'auto' }} />
                ) : (
                    <ExpandLessIcon sx={{ fontSize: 20, color: '#8E8E93', ml: 'auto' }} />
                )}
            </Box>

            {/* CTA message */}
            {!collapsed && ctaMessage && (
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1.5,
                    py: 1,
                    mb: 1.5,
                    borderRadius: '12px',
                    bgcolor: '#FFF9C4',
                    border: '1px solid #FFF176',
                }}>
                    <LabelOffIcon sx={{ fontSize: 16, color: '#F9A825' }} />
                    <Typography sx={{
                        fontSize: '12px',
                        color: '#F57F17',
                        fontFamily: SF_FONT,
                        fontWeight: 500,
                    }}>
                        {ctaMessage}
                    </Typography>
                </Box>
            )}

            {/* Grid of cards */}
            {!collapsed && children}

            {/* Show more/less button */}
            {!collapsed && showMoreButton}
        </Box>
    );
};

// ── Enhanced Quick Add Dialog ──
interface QuickAddPayload {
    title: string;
    priority: GTDPriority;
    context: string;
    clientId: string;
    clientName: string;
    status: GTDStatus;
    dueDate: string; // yyyy-MM-dd or ''
}

interface QuickAddProps {
    open: boolean;
    onClose: () => void;
    onAdd: (payload: QuickAddPayload) => void;
}

const CONTEXT_OPTIONS = ['@home', '@work', '@office', '@computer', '@phone', '@errands'];

const PRIORITY_OPTIONS: { value: GTDPriority; label: string; color: string }[] = [
    { value: 'none', label: 'Нет', color: '#C7C7CC' },
    { value: 'low', label: 'Низкий', color: PRIORITY_COLORS.low },
    { value: 'medium', label: 'Средний', color: PRIORITY_COLORS.medium },
    { value: 'high', label: 'Высокий', color: PRIORITY_COLORS.high },
];

interface SimpleClient { id: string; name: string; }

const STATUS_QUICK_OPTIONS: { value: GTDStatus; label: string; color: string }[] = [
    { value: 'inbox', label: 'Inbox', color: '#8E8E93' },
    { value: 'next_action', label: 'Next Action', color: '#007AFF' },
];

const QuickAddDialog: React.FC<QuickAddProps> = ({ open, onClose, onAdd }) => {
    const [title, setTitle] = useState('');
    const [priority, setPriority] = useState<GTDPriority>('none');
    const [context, setContext] = useState('');
    const [selectedClient, setSelectedClient] = useState<SimpleClient | null>(null);
    const [clients, setClients] = useState<SimpleClient[]>([]);
    const [status, setStatus] = useState<GTDStatus>('inbox');
    const [dueDate, setDueDate] = useState('');

    // Fetch clients on open
    useEffect(() => {
        if (!open) return;
        const fetchClients = async () => {
            try {
                const snap = await getDocs(query(collection(db, 'clients'), orderBy('name')));
                setClients(snap.docs.map(d => ({ id: d.id, name: (d.data() as { name?: string }).name || '' })));
            } catch (e) {
                console.error('Error fetching clients', e);
            }
        };
        fetchClients();
    }, [open]);

    const handleSubmit = () => {
        if (title.trim()) {
            onAdd({
                title: title.trim(),
                priority,
                context,
                clientId: selectedClient?.id || '',
                clientName: selectedClient?.name || '',
                status,
                dueDate,
            });
            setTitle('');
            setPriority('none');
            setContext('');
            setSelectedClient(null);
            setStatus('inbox');
            setDueDate('');
            onClose();
        }
    };

    const handleClose = () => {
        setTitle('');
        setPriority('none');
        setContext('');
        setSelectedClient(null);
        setStatus('inbox');
        setDueDate('');
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth
            maxWidth="sm"
            PaperProps={{
                sx: {
                    borderRadius: '20px',
                    p: 3,
                    fontFamily: SF_FONT,
                },
            }}
        >
            <Typography sx={{ fontWeight: 700, fontSize: '18px', mb: 2, fontFamily: SF_FONT }}>
                ✏️ Новая задача
            </Typography>

            {/* Title */}
            <TextField
                autoFocus
                fullWidth
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="Что нужно сделать?"
                variant="outlined"
                sx={{
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        fontFamily: SF_FONT,
                        fontSize: '16px',
                    },
                }}
            />

            {/* Priority */}
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#8E8E93', mb: 0.75, fontFamily: SF_FONT }}>
                Приоритет
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
                {PRIORITY_OPTIONS.map(opt => (
                    <Chip
                        key={opt.value}
                        label={opt.label}
                        size="small"
                        onClick={() => setPriority(opt.value)}
                        sx={{
                            fontFamily: SF_FONT,
                            fontWeight: 600,
                            fontSize: '13px',
                            height: 32,
                            px: 0.5,
                            bgcolor: priority === opt.value ? `${opt.color}20` : '#F5F5F7',
                            color: priority === opt.value ? opt.color : '#8E8E93',
                            border: priority === opt.value ? `2px solid ${opt.color}` : '2px solid transparent',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: `${opt.color}15` },
                        }}
                    />
                ))}
            </Box>

            {/* Context */}
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#8E8E93', mb: 0.75, fontFamily: SF_FONT }}>
                Контекст
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
                {CONTEXT_OPTIONS.map(ctx => (
                    <Chip
                        key={ctx}
                        label={ctx}
                        size="small"
                        onClick={() => setContext(context === ctx ? '' : ctx)}
                        sx={{
                            fontFamily: SF_FONT,
                            fontWeight: 600,
                            fontSize: '12px',
                            height: 30,
                            bgcolor: context === ctx ? '#007AFF18' : '#F5F5F7',
                            color: context === ctx ? '#007AFF' : '#8E8E93',
                            border: context === ctx ? '2px solid #007AFF' : '2px solid transparent',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: '#007AFF10' },
                        }}
                    />
                ))}
            </Box>

            {/* Status toggle */}
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#8E8E93', mb: 0.75, fontFamily: SF_FONT }}>
                Статус
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, mb: 2 }}>
                {STATUS_QUICK_OPTIONS.map(opt => (
                    <Chip
                        key={opt.value}
                        label={opt.label}
                        size="small"
                        onClick={() => setStatus(opt.value)}
                        sx={{
                            fontFamily: SF_FONT,
                            fontWeight: 600,
                            fontSize: '13px',
                            height: 32,
                            px: 0.5,
                            bgcolor: status === opt.value ? `${opt.color}20` : '#F5F5F7',
                            color: status === opt.value ? opt.color : '#8E8E93',
                            border: status === opt.value ? `2px solid ${opt.color}` : '2px solid transparent',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: `${opt.color}15` },
                        }}
                    />
                ))}
            </Box>

            {/* Due date */}
            <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#8E8E93', mb: 0.75, fontFamily: SF_FONT }}>
                Дедлайн
            </Typography>
            <TextField
                type="date"
                fullWidth
                size="small"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                sx={{
                    mb: 2,
                    '& .MuiOutlinedInput-root': {
                        borderRadius: '12px',
                        fontFamily: SF_FONT,
                        fontSize: '14px',
                    },
                }}
                InputLabelProps={{ shrink: true }}
            />

            {/* Client */}
            <Autocomplete
                value={selectedClient}
                options={clients}
                getOptionLabel={(opt) => opt.name || ''}
                onChange={(_, val) => setSelectedClient(val)}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        placeholder="Проект / Клиент"
                        size="small"
                        sx={{
                            mb: 2,
                            '& .MuiOutlinedInput-root': {
                                borderRadius: '12px',
                                fontFamily: SF_FONT,
                            },
                        }}
                    />
                )}
                size="small"
                blurOnSelect
                clearOnBlur
            />

            {/* Actions */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button onClick={handleClose} sx={{ fontFamily: SF_FONT, textTransform: 'none', color: '#8E8E93', minHeight: 44 }}>
                    Отмена
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={!title.trim()}
                    sx={{
                        fontFamily: SF_FONT,
                        textTransform: 'none',
                        fontWeight: 600,
                        borderRadius: '12px',
                        bgcolor: '#007AFF',
                        minHeight: 44,
                        px: 3,
                        '&:hover': { bgcolor: '#0066DD' },
                    }}
                >
                    Добавить
                </Button>
            </Box>
        </Dialog>
    );
};

// ═══════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════

const TasksMasonryPage: React.FC<{ hideHeader?: boolean }> = ({ hideHeader }) => {
    const navigate = useNavigate();
    const {
        groups,
        stats,
        loading,
        groupMode,
        setGroupMode,
        markDone,
        markUndone,
        removeTask,
        quickAdd,
        selectMode,
        setSelectMode,
        selectedIds,
        toggleSelect,
        clearSelection,
        bulkMarkDone,
        bulkDelete,
        searchQuery,
        setSearchQuery,
        moveTask,
        expandedDone,
        toggleExpandDone,
        totalDoneCount,
    } = useTasksMasonry();

    const [quickAddOpen, setQuickAddOpen] = useState(false);

    // ── Undo snackbar state ──
    const [undoSnackbar, setUndoSnackbar] = useState<{ open: boolean; taskId: string; taskTitle: string }>({
        open: false, taskId: '', taskTitle: '',
    });

    // ── Fade-out animation for mark-done ──
    const [fadingTaskId, setFadingTaskId] = useState<string | null>(null);

    const handleLongPress = useCallback((taskId: string) => {
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(30);
        setSelectMode(true);
        toggleSelect(taskId);
    }, [setSelectMode, toggleSelect]);

    // Click-to-edit → navigate to cockpit with back-to-board state
    const handleTaskClick = useCallback((task: GTDTask) => {
        navigate(`/crm/gtd/${task.id}`, { state: { from: '/crm/tasks-masonry' } });
    }, [navigate]);

    // Mark done with fade animation + undo
    const handleMarkDone = useCallback(async (taskId: string) => {
        const task = groups.flatMap(g => g.tasks).find(t => t.id === taskId);
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
        // Fade out animation
        setFadingTaskId(taskId);
        setTimeout(async () => {
            await markDone(taskId);
            setFadingTaskId(null);
            setUndoSnackbar({ open: true, taskId, taskTitle: task?.title || 'Задача' });
        }, 350);
    }, [markDone, groups]);

    const handleUndo = useCallback(async () => {
        if (undoSnackbar.taskId) {
            await markUndone(undoSnackbar.taskId);
        }
        setUndoSnackbar({ open: false, taskId: '', taskTitle: '' });
    }, [undoSnackbar.taskId, markUndone]);

    // Drag-and-drop handler
    const handleDragEnd = useCallback((result: DropResult) => {
        if (!result.destination) return;
        const sourceGroupId = result.source.droppableId;
        const destGroupId = result.destination.droppableId;
        if (sourceGroupId === destGroupId) return;
        const taskId = result.draggableId;
        // Haptic feedback on successful drop
        if (navigator.vibrate) navigator.vibrate(15);
        moveTask(taskId, destGroupId);
    }, [moveTask]);

    if (loading) {
        return (
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '80vh',
            }}>
                <CircularProgress sx={{ color: '#007AFF' }} />
            </Box>
        );
    }

    return (
        <Box sx={{
            minHeight: '100vh',
            bgcolor: '#F2F2F7',
            fontFamily: SF_FONT,
        }}>
            {/* ── Header ── */}
            {!hideHeader && (
                <TasksMasonryHeader
                    groupMode={groupMode}
                    onGroupModeChange={setGroupMode}
                    stats={stats}
                    selectMode={selectMode}
                    selectedCount={selectedIds.size}
                    onBulkDone={bulkMarkDone}
                    onBulkDelete={bulkDelete}
                    onClearSelection={clearSelection}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                />
            )}

            {/* ── Content: Sectioned Grid with DnD ── */}
            <DragDropContext onDragEnd={handleDragEnd}>
                <Box sx={{ px: { xs: 2, sm: 2.5, md: 3 }, py: 2, pb: 14 }}>
                    {groups.length === 0 ? (
                        <Box sx={{
                            textAlign: 'center',
                            py: 10,
                        }}>
                            <Typography sx={{ fontSize: '48px', mb: 1 }}>
                                {searchQuery ? '🔍' : '🎉'}
                            </Typography>
                            <Typography sx={{
                                fontWeight: 600,
                                fontSize: '18px',
                                fontFamily: SF_FONT,
                                color: '#1D1D1F',
                                mb: 0.5,
                            }}>
                                {searchQuery ? 'Ничего не найдено' : 'Всё чисто!'}
                            </Typography>
                            <Typography sx={{
                                fontSize: '14px',
                                color: '#8E8E93',
                                fontFamily: SF_FONT,
                            }}>
                                {searchQuery
                                    ? `Нет задач по запросу «${searchQuery}»`
                                    : 'Нет задач. Нажми + чтобы добавить.'}
                            </Typography>
                        </Box>
                    ) : (
                        groups.map((group) => (
                            <Section
                                key={group.id}
                                group={group}
                                ctaMessage={
                                    group.id === 'No Context'
                                        ? 'Добавь контекст задачам (@office, @home, @calls) для лучшей организации'
                                        : undefined
                                }
                                showMoreButton={
                                    group.id === 'done' && totalDoneCount > 5 ? (
                                        <Box
                                            onClick={(e) => { e.stopPropagation(); toggleExpandDone(); }}
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: 0.5,
                                                py: 1.5,
                                                mt: 1.5,
                                                borderRadius: '12px',
                                                bgcolor: '#F5F5F7',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                '&:hover': { bgcolor: '#E8E8ED' },
                                                '&:active': { transform: 'scale(0.98)' },
                                            }}
                                        >
                                            {expandedDone ? (
                                                <KeyboardArrowUpIcon sx={{ fontSize: 18, color: '#8E8E93' }} />
                                            ) : (
                                                <KeyboardArrowDownIcon sx={{ fontSize: 18, color: '#8E8E93' }} />
                                            )}
                                            <Typography sx={{
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                fontFamily: SF_FONT,
                                                color: '#8E8E93',
                                            }}>
                                                {expandedDone
                                                    ? 'Свернуть'
                                                    : `Показать ещё ${totalDoneCount - 5} выполненных`}
                                            </Typography>
                                        </Box>
                                    ) : undefined
                                }
                            >
                                <Droppable droppableId={group.id}>
                                    {(provided, snapshot) => (
                                        <Box
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                            sx={{
                                                display: 'grid',
                                                gridTemplateColumns: {
                                                    xs: '1fr',
                                                    sm: '1fr 1fr',
                                                    md: '1fr 1fr 1fr',
                                                    lg: 'repeat(4, 1fr)',
                                                },
                                                gap: { xs: 1.5, sm: 2, md: 2.5 },
                                                minHeight: snapshot.isDraggingOver ? 80 : 'auto',
                                                bgcolor: snapshot.isDraggingOver ? 'rgba(0,122,255,0.04)' : 'transparent',
                                                borderRadius: '16px',
                                                transition: 'background-color 0.2s',
                                                p: snapshot.isDraggingOver ? 1 : 0,
                                            }}
                                        >
                                            {group.tasks.map((task, index) => (
                                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                                    {(dragProvided, dragSnapshot) => (
                                                        <Box
                                                            ref={dragProvided.innerRef}
                                                            {...dragProvided.draggableProps}
                                                            {...dragProvided.dragHandleProps}
                                                            sx={{
                                                                opacity: fadingTaskId === task.id ? 0 : dragSnapshot.isDragging ? 0.85 : 1,
                                                                transform: fadingTaskId === task.id
                                                                    ? 'scale(0.9) translateY(-10px)'
                                                                    : dragSnapshot.isDragging ? 'rotate(2deg)' : 'none',
                                                                transition: fadingTaskId === task.id
                                                                    ? 'opacity 0.35s ease-out, transform 0.35s ease-out'
                                                                    : dragSnapshot.isDragging ? 'none' : 'all 0.2s',
                                                            }}
                                                        >
                                                            <TaskSquare
                                                                task={task}
                                                                onMarkDone={handleMarkDone}
                                                                onMarkUndone={markUndone}
                                                                onDelete={removeTask}
                                                                onClick={handleTaskClick}
                                                                selectMode={selectMode}
                                                                isSelected={selectedIds.has(task.id)}
                                                                onToggleSelect={toggleSelect}
                                                                onLongPress={handleLongPress}
                                                                compact={group.id === 'done'}
                                                            />
                                                        </Box>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {provided.placeholder}
                                        </Box>
                                    )}
                                </Droppable>
                            </Section>
                        ))
                    )}
                </Box>
            </DragDropContext>

            {/* ── FAB: Quick Add ── */}
            <Fab
                onClick={() => setQuickAddOpen(true)}
                sx={{
                    position: 'fixed',
                    bottom: { xs: 24, md: 32 },
                    right: { xs: 24, md: 32 },
                    width: 60,
                    height: 60,
                    bgcolor: '#007AFF',
                    color: '#fff',
                    boxShadow: '0 6px 20px rgba(0,122,255,0.35)',
                    '&:hover': { bgcolor: '#0066DD' },
                    '&:active': { transform: 'scale(0.95)' },
                    zIndex: 100,
                }}
            >
                <AddIcon sx={{ fontSize: 30 }} />
            </Fab>

            {/* ── Quick Add Dialog ── */}
            <QuickAddDialog
                open={quickAddOpen}
                onClose={() => setQuickAddOpen(false)}
                onAdd={quickAdd}
            />

            {/* ── Undo Snackbar ── */}
            <Snackbar
                open={undoSnackbar.open}
                autoHideDuration={4000}
                onClose={() => setUndoSnackbar(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
                sx={{ mb: { xs: 10, md: 2 } }}
            >
                <Alert
                    severity="success"
                    variant="filled"
                    action={
                        <Button
                            color="inherit"
                            size="small"
                            startIcon={<UndoIcon />}
                            onClick={handleUndo}
                            sx={{ fontFamily: SF_FONT, textTransform: 'none', fontWeight: 600 }}
                        >
                            Отменить
                        </Button>
                    }
                    sx={{
                        fontFamily: SF_FONT,
                        borderRadius: '14px',
                        fontSize: '14px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                        '& .MuiAlert-message': { display: 'flex', alignItems: 'center' },
                    }}
                >
                    ✅ «{undoSnackbar.taskTitle}» выполнена
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default TasksMasonryPage;
