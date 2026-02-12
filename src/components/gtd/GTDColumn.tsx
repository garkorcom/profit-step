import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Typography, Paper, TextField, Button, IconButton } from '@mui/material';
import { Droppable } from '@hello-pangea/dnd';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
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
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [canScrollDown, setCanScrollDown] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isDone = columnId === 'done';
    const styles = COLUMN_STYLES[columnId];

    // Auto-expand when tasks appear in a collapsed column
    useEffect(() => {
        if (tasks.length > 0 && isCollapsed) {
            setIsCollapsed(false);
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

    const handleAdd = () => {
        if (!newTitle.trim() || !onAddTask) return;
        onAddTask(newTitle, columnId);
        setNewTitle('');
        setIsAdding(false);
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
                        bgcolor: styles.accent,
                        color: 'white',
                        px: 1,
                        py: 0.25,
                        borderRadius: '10px',
                        fontSize: '12px',
                        fontWeight: 600,
                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                        minWidth: 24,
                        textAlign: 'center'
                    }}
                >
                    {tasks.length}
                </Typography>
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
                            {tasks.map((task, index) => {
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
                            })}
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

export default GTDColumn;
