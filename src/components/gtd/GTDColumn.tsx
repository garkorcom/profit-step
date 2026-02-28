import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, Paper, TextField, Button, IconButton } from '@mui/material';
import { Droppable } from '@hello-pangea/dnd';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import { GTDTask, GTDStatus } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import GTDTaskCard from './GTDTaskCard';
import { WorkSessionData } from '../../hooks/useActiveSession';

interface GTDColumnProps {
    columnId: GTDStatus;
    title: string;
    tasks: GTDTask[];
    clientsMap: Record<string, Client>;
    onTaskClick: (task: GTDTask) => void;
    onAddTask?: (title: string, columnId: GTDStatus) => void;
    onStartSession?: (task: GTDTask) => void;
    activeSession?: WorkSessionData | null;
    onStopSession?: (task: GTDTask) => void;
}

// Apple-style column colors - subtle and elegant
const COLUMN_STYLES: Record<GTDStatus, {
    bg: string;
    headerBg: string;
    headerText: string;
    accent: string;
    icon?: React.ReactNode
}> = {
    inbox: {
        bg: 'rgba(245, 245, 247, 0.8)',
        headerBg: 'rgba(255, 255, 255, 0.72)',
        headerText: '#1d1d1f',
        accent: '#86868b'
    },
    next_action: {
        bg: 'rgba(255, 249, 240, 0.9)',
        headerBg: 'rgba(255, 159, 10, 0.12)',
        headerText: '#c93400',
        accent: '#ff9500'
    },
    projects: {
        bg: 'rgba(240, 247, 255, 0.9)',
        headerBg: 'rgba(0, 122, 255, 0.08)',
        headerText: '#0066cc',
        accent: '#007aff'
    },
    waiting: {
        bg: 'rgba(252, 244, 250, 0.9)',
        headerBg: 'rgba(175, 82, 222, 0.08)',
        headerText: '#8944ab',
        accent: '#af52de'
    },
    estimate: {
        bg: 'rgba(255, 251, 245, 0.9)',
        headerBg: 'rgba(255, 159, 10, 0.08)',
        headerText: '#b25000',
        accent: '#ff9500'
    },
    someday: {
        bg: 'rgba(245, 245, 250, 0.9)',
        headerBg: 'rgba(88, 86, 214, 0.08)',
        headerText: '#5856d6',
        accent: '#5856d6'
    },
    done: {
        bg: 'rgba(240, 253, 244, 0.9)',
        headerBg: 'rgba(52, 199, 89, 0.12)',
        headerText: '#1a7f37',
        accent: '#34c759',
        icon: <CheckCircleIcon sx={{ fontSize: 18, color: '#34c759', mr: 0.75 }} />
    }
};

// WIP limits per column — null means no limit
const WIP_LIMITS: Partial<Record<GTDStatus, number>> = {
    next_action: 7,
    estimate: 5,
    projects: 10,
};

// Format minutes to compact hours string
const formatHours = (minutes: number): string => {
    if (minutes === 0) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}.${Math.round(m / 6)}h`; // e.g. 1.5h for 90min
};

const GTDColumn: React.FC<GTDColumnProps> = ({
    columnId,
    title,
    tasks,
    clientsMap,
    onTaskClick,
    onAddTask,
    onStartSession,
    activeSession,
    onStopSession
}) => {
    const [newTitle, setNewTitle] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [isAddingLoading, setIsAddingLoading] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const scrollRef = useRef<HTMLDivElement>(null);
    const isDone = columnId === 'done';
    const styles = COLUMN_STYLES[columnId];

    const toggleGroupCollapse = useCallback((groupKey: string) => {
        setCollapsedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
    }, []);

    // Group tasks by client/project, maintaining DnD-compatible sequential indices
    const groupedTasks = useMemo(() => {
        if (tasks.length === 0) return [];

        const groups: Record<string, { clientName: string; tasks: { task: GTDTask; originalIndex: number }[] }> = {};

        tasks.forEach((task, index) => {
            const clientName = task.clientId && clientsMap[task.clientId]
                ? clientsMap[task.clientId].name
                : '';
            const key = clientName || '__no_project__';

            if (!groups[key]) {
                groups[key] = { clientName: clientName || '', tasks: [] };
            }
            groups[key].tasks.push({ task, originalIndex: index });
        });

        // Sort: most tasks first, 'No project' last
        const entries = Object.entries(groups);
        entries.sort(([keyA, a], [keyB, b]) => {
            if (keyA === '__no_project__') return 1;
            if (keyB === '__no_project__') return -1;
            return b.tasks.length - a.tasks.length;
        });

        return entries.map(([key, group]) => ({
            key,
            clientName: group.clientName,
            tasks: group.tasks,
        }));
    }, [tasks, clientsMap]);

    // Check if there are multiple groups (needed to decide whether to show grouping)
    const hasMultipleGroups = groupedTasks.length > 1;

    // Auto-collapse groups when column is overflowing (>7 tasks)
    const AUTO_COLLAPSE_THRESHOLD = 7;
    const [hasAutoCollapsed, setHasAutoCollapsed] = useState(false);

    useEffect(() => {
        if (tasks.length > AUTO_COLLAPSE_THRESHOLD && hasMultipleGroups && !hasAutoCollapsed) {
            const autoCollapsed: Record<string, boolean> = {};
            groupedTasks.forEach((group, idx) => {
                if (idx > 0) autoCollapsed[group.key] = true; // collapse all except first
            });
            setCollapsedGroups(autoCollapsed);
            setHasAutoCollapsed(true);
        }
        // Reset auto-collapse flag when tasks drop below threshold
        if (tasks.length <= AUTO_COLLAPSE_THRESHOLD && hasAutoCollapsed) {
            setHasAutoCollapsed(false);
            setCollapsedGroups({});
        }
    }, [tasks.length, hasMultipleGroups, groupedTasks, hasAutoCollapsed]);

    // WIP limit check
    const wipLimit = WIP_LIMITS[columnId];
    const isOverWip = wipLimit ? tasks.length > wipLimit : false;

    // Total estimated time for the column
    const totalMinutes = useMemo(() => {
        return tasks.reduce((sum, t) => sum + (t.estimatedDurationMinutes || 0), 0);
    }, [tasks]);

    // Auto-expand when tasks appear in a collapsed column (without flicker)
    useEffect(() => {
        if (tasks.length > 0 && isCollapsed) {
            // Delay to avoid flicker from rapid task count changes
            const t = setTimeout(() => setIsCollapsed(false), 300);
            return () => clearTimeout(t);
        }
    }, [tasks.length, isCollapsed]);

    // Scroll gradient detection
    const checkScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const hasMoreBelow = el.scrollHeight - el.scrollTop - el.clientHeight > 8;
        setCanScrollDown(hasMoreBelow);
    }, []);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        // Initial check
        checkScroll();
        el.addEventListener('scroll', checkScroll, { passive: true });
        // Re-check when tasks change
        const observer = new ResizeObserver(checkScroll);
        observer.observe(el);
        return () => {
            el.removeEventListener('scroll', checkScroll);
            observer.disconnect();
        };
    }, [checkScroll, tasks.length]);

    const handleAdd = async () => {
        if (!newTitle.trim() || !onAddTask || isAddingLoading) return;
        setIsAddingLoading(true);
        try {
            await onAddTask(newTitle, columnId);
            setNewTitle('');
            setIsAdding(false);
        } catch {
            // Keep the form open on error
        } finally {
            setIsAddingLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAdd();
        if (e.key === 'Escape') {
            setNewTitle('');
            setIsAdding(false);
        }
    };

    // ==================== COLLAPSED STATE ====================
    if (isCollapsed && tasks.length === 0) {
        return (
            <Paper
                data-column-id={columnId}
                elevation={0}
                onClick={() => setIsCollapsed(false)}
                sx={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: styles.bg,
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    boxShadow: '0 4px 30px rgba(0, 0, 0, 0.05)',
                    cursor: 'pointer',
                    minWidth: 48,
                    maxWidth: 48,
                    overflow: 'hidden',
                    transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                    '&:hover': {
                        boxShadow: '0 8px 40px rgba(0, 0, 0, 0.08)',
                        bgcolor: styles.headerBg,
                    }
                }}
            >
                <ChevronRightIcon sx={{ fontSize: 18, color: styles.headerText, mb: 1 }} />
                <Typography
                    sx={{
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: styles.headerText,
                        letterSpacing: '0.02em',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                    }}
                >
                    {title}
                </Typography>
                <Typography
                    component="span"
                    sx={{
                        bgcolor: styles.accent,
                        color: 'white',
                        px: 0.75,
                        py: 0.25,
                        borderRadius: '8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        mt: 1,
                        minWidth: 20,
                        textAlign: 'center'
                    }}
                >
                    0
                </Typography>
            </Paper>
        );
    }

    return (
        <Paper
            data-column-id={columnId}
            elevation={0}
            sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                // Apple-style glassmorphism
                bgcolor: styles.bg,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                boxShadow: '0 4px 30px rgba(0, 0, 0, 0.05)',
                transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                overflow: 'hidden',
                minHeight: 0,
                '&:hover': {
                    boxShadow: '0 8px 40px rgba(0, 0, 0, 0.08)',
                }
            }}
        >
            {/* Compact Header */}
            <Box
                px={2}
                py={1}
                sx={{
                    bgcolor: styles.headerBg,
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                }}
            >
                {styles.icon}
                <Typography
                    variant="subtitle2"
                    sx={{
                        flex: 1,
                        fontWeight: 600,
                        fontSize: '13px',
                        letterSpacing: '-0.01em',
                        color: styles.headerText,
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
                    }}
                >
                    {title}
                </Typography>

                {/* Collapse button for empty columns */}
                {tasks.length === 0 && (
                    <IconButton
                        size="small"
                        onClick={() => setIsCollapsed(true)}
                        sx={{
                            width: 24,
                            height: 24,
                            mr: 0.5,
                            color: styles.headerText,
                            opacity: 0.5,
                            '&:hover': { opacity: 1, bgcolor: 'rgba(0,0,0,0.05)' }
                        }}
                    >
                        <ChevronRightIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                )}

                <Typography
                    component="span"
                    sx={{
                        bgcolor: isOverWip ? '#ff3b30' : styles.accent,
                        color: 'white',
                        px: 1,
                        py: 0.25,
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                        minWidth: 24,
                        textAlign: 'center',
                        transition: 'background-color 0.3s',
                        ...(isOverWip ? {
                            animation: 'wipPulse 2s ease-in-out infinite',
                            '@keyframes wipPulse': {
                                '0%, 100%': { bgcolor: '#ff3b30' },
                                '50%': { bgcolor: '#ff6961' },
                            },
                        } : {}),
                    }}
                >
                    {tasks.length}{wipLimit ? `/${wipLimit}` : ''}
                </Typography>

                {/* Total estimated time */}
                {totalMinutes > 0 && (
                    <Typography
                        sx={{
                            fontSize: '10px',
                            fontWeight: 600,
                            color: '#0e7490',
                            ml: 0.5,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                        }}
                    >
                        ⏱ {formatHours(totalMinutes)}
                    </Typography>
                )}
            </Box>

            {/* Tasks List (Droppable) with scroll gradient */}
            <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Droppable droppableId={columnId}>
                    {(provided, snapshot) => (
                        <Box
                            ref={(el: HTMLDivElement | null) => {
                                provided.innerRef(el);
                                (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                            }}
                            {...provided.droppableProps}
                            sx={{
                                p: 1,
                                flexGrow: 1,
                                overflowY: 'auto',
                                overflowX: 'hidden',
                                minHeight: 0,
                                transition: 'background-color 0.3s ease',
                                bgcolor: snapshot.isDraggingOver ? 'rgba(0, 122, 255, 0.06)' : 'transparent',
                                // Apple-style scrollbar
                                '&::-webkit-scrollbar': {
                                    width: 6,
                                },
                                '&::-webkit-scrollbar-track': {
                                    background: 'transparent',
                                },
                                '&::-webkit-scrollbar-thumb': {
                                    background: 'rgba(0, 0, 0, 0.15)',
                                    borderRadius: 3,
                                    '&:hover': {
                                        background: 'rgba(0, 0, 0, 0.25)'
                                    }
                                }
                            }}
                        >
                            {hasMultipleGroups ? (
                                // Grouped rendering with project headers
                                groupedTasks.map((group) => {
                                    const isGroupCollapsed = !!collapsedGroups[group.key];
                                    const showTimer = columnId !== 'done' && columnId !== 'someday';
                                    const groupMinutes = group.tasks.reduce(
                                        (sum, { task: t }) => sum + (t.estimatedDurationMinutes || 0), 0
                                    );
                                    const groupLabel = group.clientName || 'No project';

                                    return (
                                        <Box key={group.key}>
                                            {/* Group header */}
                                            <Box
                                                onClick={() => toggleGroupCollapse(group.key)}
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 0.5,
                                                    px: 0.75,
                                                    py: 0.4,
                                                    mt: 0.5,
                                                    mb: 0.25,
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    userSelect: 'none',
                                                    transition: 'background 0.15s',
                                                    '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' },
                                                    '&:first-of-type': { mt: 0 },
                                                }}
                                            >
                                                <ExpandMoreIcon
                                                    sx={{
                                                        fontSize: 16,
                                                        color: styles.headerText,
                                                        transition: 'transform 0.2s',
                                                        transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                                                    }}
                                                />
                                                {group.clientName ? (
                                                    <FolderIcon sx={{ fontSize: 14, color: '#f59e0b', opacity: 0.8 }} />
                                                ) : null}
                                                <Typography
                                                    sx={{
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        color: group.clientName ? '#856404' : '#86868b',
                                                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {groupLabel}
                                                </Typography>
                                                <Typography
                                                    sx={{
                                                        fontSize: '10px',
                                                        fontWeight: 600,
                                                        color: styles.headerText,
                                                        bgcolor: `${styles.accent}15`,
                                                        px: 0.6,
                                                        py: 0.1,
                                                        borderRadius: '4px',
                                                        minWidth: 16,
                                                        textAlign: 'center',
                                                    }}
                                                >
                                                    {group.tasks.length}
                                                </Typography>
                                                {groupMinutes > 0 && (
                                                    <Typography
                                                        sx={{
                                                            fontSize: '10px',
                                                            fontWeight: 600,
                                                            color: '#0e7490',
                                                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                                        }}
                                                    >
                                                        · {formatHours(groupMinutes)}
                                                    </Typography>
                                                )}
                                            </Box>
                                            {/* Group tasks */}
                                            {!isGroupCollapsed && group.tasks.map(({ task, originalIndex }) => (
                                                <GTDTaskCard
                                                    key={task.id}
                                                    task={task}
                                                    index={originalIndex}
                                                    clientName={group.clientName || undefined}
                                                    onClick={onTaskClick}
                                                    onStartSession={showTimer ? onStartSession : undefined}
                                                    activeSession={showTimer ? activeSession : undefined}
                                                    onStopSession={showTimer ? onStopSession : undefined}
                                                />
                                            ))}

                                            {/* Collapsed summary */}
                                            {isGroupCollapsed && (
                                                <Box
                                                    sx={{
                                                        px: 1,
                                                        py: 0.3,
                                                        mb: 0.25,
                                                        fontSize: '10px',
                                                        color: '#86868b',
                                                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                                    }}
                                                >
                                                    {group.tasks.length} tasks hidden
                                                </Box>
                                            )}
                                        </Box>
                                    );
                                })
                            ) : (
                                // Single group or no groups — flat rendering
                                tasks.map((task, index) => {
                                    const showTimer = columnId !== 'done' && columnId !== 'someday';
                                    return (
                                        <GTDTaskCard
                                            key={task.id}
                                            task={task}
                                            index={index}
                                            clientName={task.clientId ? clientsMap[task.clientId]?.name : undefined}
                                            onClick={onTaskClick}
                                            onStartSession={showTimer ? onStartSession : undefined}
                                            activeSession={showTimer ? activeSession : undefined}
                                            onStopSession={showTimer ? onStopSession : undefined}
                                        />
                                    );
                                })
                            )}
                            {provided.placeholder}

                            {/* Styled drop placeholder */}
                            {snapshot.isDraggingOver && tasks.length === 0 && (
                                <Box
                                    sx={{
                                        height: 60,
                                        border: '2px dashed rgba(0, 122, 255, 0.3)',
                                        borderRadius: '10px',
                                        bgcolor: 'rgba(0, 122, 255, 0.04)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    <Typography
                                        sx={{
                                            fontSize: '12px',
                                            color: 'rgba(0, 122, 255, 0.5)',
                                            fontWeight: 500,
                                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                        }}
                                    >
                                        Drop here
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    )}
                </Droppable>

                {/* Scroll gradient indicator */}
                {canScrollDown && (
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 32,
                            background: `linear-gradient(transparent, ${styles.bg})`,
                            pointerEvents: 'none',
                            borderRadius: '0 0 12px 12px',
                            transition: 'opacity 0.3s ease',
                        }}
                    />
                )}
            </Box>

            {/* Apple-style Quick Add */}
            <Box px={1.5} pb={1.5} sx={{ flexShrink: 0 }}>
                {isAdding ? (
                    <Box>
                        <TextField
                            autoFocus
                            fullWidth
                            size="small"
                            placeholder="Task title..."
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onKeyDown={handleKeyDown}
                            sx={{
                                mb: 1,
                                '& .MuiOutlinedInput-root': {
                                    borderRadius: '12px',
                                    bgcolor: 'white',
                                    fontSize: '15px',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                    '& fieldset': {
                                        border: '1px solid rgba(0, 0, 0, 0.08)',
                                    },
                                    '&:hover fieldset': {
                                        border: '1px solid rgba(0, 0, 0, 0.15)',
                                    },
                                    '&.Mui-focused fieldset': {
                                        border: '2px solid #007aff',
                                    }
                                }
                            }}
                        />
                        <Box display="flex" gap={1}>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={handleAdd}
                                disabled={isAddingLoading || !newTitle.trim()}
                                sx={{
                                    textTransform: 'none',
                                    borderRadius: '10px',
                                    bgcolor: '#007aff',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    px: 2.5,
                                    py: 0.75,
                                    boxShadow: 'none',
                                    '&:hover': {
                                        bgcolor: '#0066cc',
                                        boxShadow: 'none'
                                    }
                                }}
                            >
                                Add
                            </Button>
                            <IconButton
                                size="small"
                                onClick={() => { setNewTitle(''); setIsAdding(false); }}
                                sx={{
                                    width: 32,
                                    height: 32,
                                    bgcolor: 'rgba(0, 0, 0, 0.05)',
                                    '&:hover': {
                                        bgcolor: 'rgba(0, 0, 0, 0.1)'
                                    }
                                }}
                            >
                                <CloseIcon sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Box>
                    </Box>
                ) : (
                    <Button
                        fullWidth
                        startIcon={<AddIcon sx={{ fontSize: 20 }} />}
                        aria-label="add-task"
                        sx={{
                            justifyContent: 'flex-start',
                            color: '#86868b',
                            textTransform: 'none',
                            borderRadius: '12px',
                            py: 1.25,
                            px: 1.5,
                            fontSize: '14px',
                            fontWeight: 500,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                            transition: 'all 0.2s ease',
                            '&:hover': {
                                bgcolor: 'rgba(0, 0, 0, 0.04)',
                                color: '#1d1d1f'
                            }
                        }}
                        onClick={() => setIsAdding(true)}
                    >
                        {isDone ? 'Add completed' : 'Add a card'}
                    </Button>
                )}
            </Box>
        </Paper>
    );
};

export default React.memo(GTDColumn);
