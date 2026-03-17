import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Typography, Box, IconButton, Tooltip } from '@mui/material';
import { Draggable } from '@hello-pangea/dnd';
import EditIcon from '@mui/icons-material/Edit';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import SubjectIcon from '@mui/icons-material/Subject';
import { GTDTask, PRIORITY_COLORS } from '../../types/gtd.types';
import { WorkSessionData } from '../../hooks/useActiveSession';

interface GTDTaskCardProps {
    task: GTDTask;
    index: number;
    clientName?: string;
    onClick: (task: GTDTask) => void;
    onStartSession?: (task: GTDTask) => void;
    activeSession?: WorkSessionData | null;
    onStopSession?: (task: GTDTask) => void;
}

// Apple-style colors
const APPLE_COLORS = {
    background: '#ffffff',
    backgroundHover: '#f5f5f7',
    backgroundActive: '#e8f5e9',
    border: 'rgba(0, 0, 0, 0.04)',
    textPrimary: '#1d1d1f',
    textSecondary: '#86868b',
    accent: '#007aff',
    success: '#34c759',
    warning: '#ff9500',
    danger: '#ff3b30',
    gray: '#f5f5f7',
};

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

const GTDTaskCard: React.FC<GTDTaskCardProps> = ({
    task,
    index,
    clientName,
    onClick,
    onStartSession,
    activeSession,
    onStopSession
}) => {
    const navigate = useNavigate();
    const isDone = task.status === 'done';
    const priorityColor = PRIORITY_COLORS[task.priority || 'none'];
    const hasPriority = task.priority && task.priority !== 'none';
    const isActive = activeSession && activeSession.relatedTaskId === task.id;

    // Compute due date display
    const dueDateDisplay = useMemo(() => {
        if (!task.dueDate) return null;
        const raw = task.dueDate as any;
        const d = raw?.seconds
            ? new Date(raw.seconds * 1000)
            : raw?.toDate
                ? raw.toDate()
                : new Date(raw);
        if (isNaN(d.getTime())) return null;
        const isOverdue = d < new Date() && !isDone;
        return {
            text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            isOverdue,
        };
    }, [task.dueDate, isDone]);

    // ==================== HANDLERS ====================
    const handleTitleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        navigate(`/crm/gtd/${task.id}`);
    };

    // ==================== SWIPE-TO-ACTIONS ====================
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSwiped, setIsSwiped] = useState(false);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isHorizontalSwipe = useRef<boolean | null>(null);

    // Reset swipe state when task data changes (e.g. via onSnapshot)
    useEffect(() => {
        setSwipeOffset(0);
        setIsSwiped(false);
    }, [task.id, task.status]);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        isHorizontalSwipe.current = null;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        const dx = e.touches[0].clientX - touchStartX.current;
        const dy = e.touches[0].clientY - touchStartY.current;

        if (isHorizontalSwipe.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy) * 1.5; // Require 1.5x horizontal bias
        }

        if (!isHorizontalSwipe.current) return;

        const offset = isSwiped ? Math.min(0, dx - 100) : Math.min(0, dx);
        setSwipeOffset(Math.max(-120, offset));
    };

    const handleTouchEnd = () => {
        if (isHorizontalSwipe.current === false) return;
        if (swipeOffset < -75) {
            setSwipeOffset(-100);
            setIsSwiped(true);
        } else {
            setSwipeOffset(0);
            setIsSwiped(false);
        }
    };

    const closeSwipe = () => {
        setSwipeOffset(0);
        setIsSwiped(false);
    };

    return (
        <Draggable draggableId={task.id} index={index}>
            {(provided, snapshot) => (
                <Box
                    sx={{ position: 'relative', overflow: 'hidden', borderRadius: '10px', mb: 0.5 }}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* Swipe action buttons behind the card */}
                    {(isSwiped || swipeOffset < 0) && (
                        <Box
                            sx={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: 100,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                gap: 0.5,
                                pr: 1,
                                borderRadius: '10px',
                                background: 'linear-gradient(90deg, transparent, rgba(0,122,255,0.06))',
                            }}
                        >
                            {/* Quick play/stop */}
                            {isActive && onStopSession ? (
                                <IconButton
                                    onClick={(e) => { e.stopPropagation(); onStopSession(task); closeSwipe(); }}
                                    sx={{
                                        width: 40, height: 40, borderRadius: '10px',
                                        bgcolor: APPLE_COLORS.danger, color: 'white',
                                        '&:hover': { bgcolor: '#e63329' },
                                    }}
                                >
                                    <StopIcon sx={{ fontSize: 20 }} />
                                </IconButton>
                            ) : onStartSession ? (
                                <IconButton
                                    onClick={(e) => { e.stopPropagation(); onStartSession(task); closeSwipe(); }}
                                    sx={{
                                        width: 40, height: 40, borderRadius: '10px',
                                        bgcolor: APPLE_COLORS.success, color: 'white',
                                        '&:hover': { bgcolor: '#2da44e' },
                                    }}
                                >
                                    <PlayArrowIcon sx={{ fontSize: 20 }} />
                                </IconButton>
                            ) : null}
                            {/* Quick edit */}
                            <IconButton
                                onClick={(e) => { e.stopPropagation(); navigate(`/crm/gtd/${task.id}`); closeSwipe(); }}
                                sx={{
                                    width: 40, height: 40, borderRadius: '10px',
                                    bgcolor: APPLE_COLORS.accent, color: 'white',
                                    '&:hover': { bgcolor: '#0066cc' },
                                }}
                            >
                                <EditIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                        </Box>
                    )}

                    <Card
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        sx={{
                            backgroundColor: isActive
                                ? 'rgba(232, 245, 233, 0.6)'
                                : (snapshot.isDragging ? '#f0f9ff' : isDone ? '#fafafa' : APPLE_COLORS.background),
                            borderRadius: '10px',
                            boxShadow: snapshot.isDragging
                                ? '0 20px 40px rgba(0,0,0,0.15)'
                                : '0 1px 3px rgba(0,0,0,0.04)',
                            border: `1px solid ${APPLE_COLORS.border}`,
                            // Priority left border
                            borderLeft: hasPriority
                                ? `3px solid ${priorityColor}`
                                : (isActive ? `3px solid ${APPLE_COLORS.success}` : `1px solid ${APPLE_COLORS.border}`),
                            cursor: 'grab',
                            opacity: isDone ? 0.55 : 1,
                            transition: snapshot.isDragging
                                ? 'box-shadow 0.2s, transform 0.2s'
                                : 'all 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)',
                            transform: snapshot.isDragging
                                ? 'scale(1.02) rotate(1.5deg)'
                                : `translateX(${swipeOffset}px)`,
                            // GPU compositing for smooth DnD on touch
                            willChange: snapshot.isDragging ? 'transform' : 'auto',
                            overflow: 'visible',
                            position: 'relative',
                            zIndex: snapshot.isDragging ? 999 : 1,
                            // Active session pulsing border
                            ...(isActive && !snapshot.isDragging ? {
                                animation: 'activePulse 2s ease-in-out infinite',
                                '@keyframes activePulse': {
                                    '0%, 100%': { borderLeftColor: APPLE_COLORS.success },
                                    '50%': { borderLeftColor: '#a8e6cf' },
                                },
                            } : {}),
                            // Drop bounce
                            ...(snapshot.isDropAnimating ? {
                                animation: 'cardDropBounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                '@keyframes cardDropBounce': {
                                    '0%': { transform: 'scale(1.02)' },
                                    '50%': { transform: 'scale(0.97)' },
                                    '100%': { transform: 'scale(1)' },
                                },
                            } : {}),
                            '&:hover': !isSwiped ? {
                                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                                backgroundColor: isDone ? '#f5f5f7' : APPLE_COLORS.backgroundHover,
                            } : {},
                            // Fix Android DnD: no scale on touch press
                            '@media (pointer: coarse)': {
                                '&:active': {},
                            },
                            '@media (pointer: fine)': {
                                '&:active': !isSwiped ? {
                                    transform: 'scale(0.98)',
                                } : {},
                            },
                        }}
                        onClick={() => { if (isSwiped) { closeSwipe(); } else { onClick(task); } }}
                    >
                        {/* Compact card content — 2 lines max */}
                        <Box sx={{ px: 1.25, py: 0.75 }}>
                            {/* Line 1: Title */}
                            <Typography
                                component="div"
                                onClick={handleTitleClick}
                                sx={{
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    lineHeight: 1.35,
                                    letterSpacing: '-0.01em',
                                    color: isDone ? APPLE_COLORS.textSecondary : APPLE_COLORS.textPrimary,
                                    textDecoration: isDone ? 'line-through' : 'none',
                                    cursor: 'pointer',
                                    fontFamily: SF_FONT,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    '&:hover': { color: APPLE_COLORS.accent },
                                }}
                            >
                                {task.title}
                            </Typography>

                            {/* Line 2: Metadata row — compact inline */}
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.75,
                                    mt: 0.5,
                                    flexWrap: 'wrap',
                                    rowGap: 0.25,
                                }}
                            >
                                {/* Client/Project */}
                                {clientName && (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 0.3,
                                            flexShrink: 1,
                                            minWidth: 0,
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: '50%',
                                                bgcolor: '#f59e0b',
                                                flexShrink: 0,
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                fontSize: '11px',
                                                fontWeight: 500,
                                                color: '#856404',
                                                fontFamily: SF_FONT,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}
                                        >
                                            {clientName}
                                        </Typography>
                                    </Box>
                                )}

                                {/* Assignee — avatar initial */}
                                {task.assigneeName && (
                                    <Tooltip title={task.assigneeName} arrow>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.3,
                                                flexShrink: 0,
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: '50%',
                                                    bgcolor: task.acceptedAt ? '#dcfce7' : '#f0f0f2',
                                                    color: task.acceptedAt ? '#166534' : APPLE_COLORS.textSecondary,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '10px',
                                                    fontWeight: 700,
                                                    fontFamily: SF_FONT,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {task.assigneeName.charAt(0).toUpperCase()}
                                            </Box>
                                        </Box>
                                    </Tooltip>
                                )}

                                {/* Co-assignees count */}
                                {task.coAssignees && task.coAssignees.length > 0 && (
                                    <Tooltip title={task.coAssignees.map(ca => ca.name).join(', ')} arrow>
                                        <Box
                                            sx={{
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                color: '#6366f1',
                                                bgcolor: '#eef2ff',
                                                px: 0.5,
                                                py: 0.1,
                                                borderRadius: '4px',
                                                flexShrink: 0,
                                                fontFamily: SF_FONT,
                                            }}
                                        >
                                            +{task.coAssignees.length}
                                        </Box>
                                    </Tooltip>
                                )}

                                {/* Context tag */}
                                {task.context && (
                                    <Typography
                                        sx={{
                                            fontSize: '10px',
                                            fontWeight: 500,
                                            color: '#4338ca',
                                            bgcolor: '#e0e7ff',
                                            px: 0.5,
                                            py: 0.1,
                                            borderRadius: '4px',
                                            flexShrink: 0,
                                            fontFamily: SF_FONT,
                                        }}
                                    >
                                        {task.context}
                                    </Typography>
                                )}

                                {/* Spacer */}
                                <Box sx={{ flex: 1 }} />

                                {/* Time estimate */}
                                {task.estimatedDurationMinutes && task.estimatedDurationMinutes > 0 && (
                                    <Typography
                                        sx={{
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            color: '#0e7490',
                                            bgcolor: '#ecfeff',
                                            px: 0.5,
                                            py: 0.1,
                                            borderRadius: '4px',
                                            flexShrink: 0,
                                            fontFamily: SF_FONT,
                                        }}
                                    >
                                        ⏱ {task.estimatedDurationMinutes >= 60
                                            ? `${Math.floor(task.estimatedDurationMinutes / 60)}h${task.estimatedDurationMinutes % 60 ? task.estimatedDurationMinutes % 60 + 'm' : ''}`
                                            : `${task.estimatedDurationMinutes}m`}
                                    </Typography>
                                )}

                                {/* Attachments Indicator */}
                                {task.attachments && task.attachments.length > 0 && (
                                    <Tooltip title={`${task.attachments.length} вложений`} arrow>
                                        <Box sx={{ display: 'flex', alignItems: 'center', color: APPLE_COLORS.textSecondary }}>
                                            <InsertLinkIcon sx={{ fontSize: 13 }} />
                                        </Box>
                                    </Tooltip>
                                )}

                                {/* Memo Indicator */}
                                {task.memo && (
                                    <Tooltip title="Есть заметка" arrow>
                                        <Box sx={{ display: 'flex', alignItems: 'center', color: APPLE_COLORS.textSecondary }}>
                                            <SubjectIcon sx={{ fontSize: 13 }} />
                                        </Box>
                                    </Tooltip>
                                )}

                                {/* Due date */}
                                {dueDateDisplay && (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 0.25,
                                            flexShrink: 0,
                                        }}
                                    >
                                        <AccessTimeIcon
                                            sx={{
                                                fontSize: 12,
                                                color: dueDateDisplay.isOverdue ? APPLE_COLORS.danger : APPLE_COLORS.textSecondary,
                                            }}
                                        />
                                        <Typography
                                            sx={{
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                color: dueDateDisplay.isOverdue ? APPLE_COLORS.danger : APPLE_COLORS.textSecondary,
                                                fontFamily: SF_FONT,
                                            }}
                                        >
                                            {dueDateDisplay.text}
                                        </Typography>
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    </Card>
                </Box>
            )}
        </Draggable>
    );
};

export default React.memo(GTDTaskCard);
