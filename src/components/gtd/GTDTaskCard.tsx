import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, Typography, Box, Chip, IconButton, Tooltip, Avatar, AvatarGroup } from '@mui/material';
import { Draggable } from '@hello-pangea/dnd';
import EditIcon from '@mui/icons-material/Edit';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FlagIcon from '@mui/icons-material/Flag';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { GTDTask, PRIORITY_COLORS, GTDPriority } from '../../types/gtd.types';
import { WorkSessionData } from '../../hooks/useActiveSession';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';

interface GTDTaskCardProps {
    task: GTDTask;
    index: number;
    clientName?: string;
    onClick: (task: GTDTask) => void;
    onStartSession?: (task: GTDTask) => void;
    activeSession?: WorkSessionData | null;
    onStopSession?: (task: GTDTask) => void;
}

const PRIORITY_LABELS: Record<GTDPriority, string> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    none: ''
};

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

    const handleTitleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        navigate(`/crm/gtd/${task.id}`);
    };

    const handlePlayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onStartSession) onStartSession(task);
    };

    const handleStopClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onStopSession) onStopSession(task);
    };

    return (
        <Draggable draggableId={task.id} index={index}>
            {(provided, snapshot) => (
                <Card
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    sx={{
                        // Apple-style card design
                        mb: 1.5,
                        backgroundColor: isActive
                            ? APPLE_COLORS.backgroundActive
                            : (snapshot.isDragging ? '#f0f9ff' : isDone ? '#fafafa' : APPLE_COLORS.background),
                        borderRadius: '16px',
                        boxShadow: snapshot.isDragging
                            ? '0 20px 40px rgba(0,0,0,0.15)'
                            : (isActive
                                ? '0 4px 20px rgba(52, 199, 89, 0.2)'
                                : '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)'),
                        border: isActive
                            ? `2px solid ${APPLE_COLORS.success}`
                            : `1px solid ${APPLE_COLORS.border}`,
                        cursor: 'grab',
                        opacity: isDone ? 0.6 : 1,
                        transition: 'all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
                        transform: snapshot.isDragging ? 'scale(1.02) rotate(2deg)' : 'none',
                        overflow: 'visible',
                        '&:hover': {
                            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                            transform: 'translateY(-2px)',
                            backgroundColor: isDone ? '#f5f5f7' : APPLE_COLORS.backgroundHover
                        },
                        '&:active': {
                            transform: 'scale(0.98)',
                        }
                    }}
                    onClick={() => onClick(task)}
                >
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        {/* Header: Drag Handle + Title */}
                        <Box display="flex" alignItems="flex-start" gap={1}>
                            {/* Drag Handle - Apple style */}
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 28,
                                    height: 28,
                                    borderRadius: '8px',
                                    backgroundColor: 'transparent',
                                    transition: 'all 0.2s',
                                    '&:hover': {
                                        backgroundColor: APPLE_COLORS.gray
                                    }
                                }}
                            >
                                <DragIndicatorIcon sx={{ fontSize: 18, color: APPLE_COLORS.textSecondary }} />
                            </Box>

                            {/* Title */}
                            <Typography
                                component="span"
                                onClick={handleTitleClick}
                                sx={{
                                    flex: 1,
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    lineHeight: 1.4,
                                    letterSpacing: '-0.01em',
                                    color: isDone ? APPLE_COLORS.textSecondary : APPLE_COLORS.textPrimary,
                                    textDecoration: isDone ? 'line-through' : 'none',
                                    cursor: 'pointer',
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
                                    '&:hover': {
                                        color: APPLE_COLORS.accent
                                    }
                                }}
                            >
                                {task.title}
                            </Typography>

                            {/* Priority indicator - subtle dot */}
                            {hasPriority && (
                                <Box
                                    sx={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        backgroundColor: priorityColor,
                                        flexShrink: 0,
                                        mt: 0.8
                                    }}
                                />
                            )}
                        </Box>

                        {/* Tags Row - Apple style chips */}
                        <Box display="flex" gap={0.75} flexWrap="wrap" mt={1.5} alignItems="center">
                            {clientName && (
                                <Chip
                                    label={clientName}
                                    size="small"
                                    sx={{
                                        height: 26,
                                        fontSize: '12px',
                                        fontWeight: 500,
                                        borderRadius: '8px',
                                        bgcolor: '#fff3cd',
                                        color: '#856404',
                                        border: 'none',
                                        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                    }}
                                />
                            )}

                            {task.assigneeName && (
                                <Chip
                                    icon={task.acceptedAt
                                        ? <CheckCircleIcon sx={{ fontSize: 14, color: `${APPLE_COLORS.success} !important` }} />
                                        : <PersonIcon sx={{ fontSize: 14 }} />
                                    }
                                    label={task.assigneeName}
                                    size="small"
                                    sx={{
                                        height: 26,
                                        fontSize: '12px',
                                        fontWeight: 500,
                                        borderRadius: '8px',
                                        bgcolor: task.acceptedAt ? '#dcfce7' : APPLE_COLORS.gray,
                                        color: task.acceptedAt ? '#166534' : APPLE_COLORS.textPrimary,
                                        border: 'none',
                                        '& .MuiChip-icon': { ml: 0.5 }
                                    }}
                                />
                            )}

                            {/* Co-assignee avatars */}
                            {task.coAssignees && task.coAssignees.length > 0 && (
                                <Tooltip title={task.coAssignees.map(ca => `${ca.name} (${ca.role === 'executor' ? 'Исп.' : ca.role === 'reviewer' ? 'Рев.' : 'Набл.'})`).join(', ')}>
                                    <AvatarGroup
                                        max={3}
                                        sx={{
                                            '& .MuiAvatar-root': {
                                                width: 22,
                                                height: 22,
                                                fontSize: '0.65rem',
                                                fontWeight: 600,
                                                border: '2px solid #fff',
                                                bgcolor: '#6366f1',
                                                color: '#fff'
                                            }
                                        }}
                                    >
                                        {task.coAssignees.map(ca => (
                                            <Avatar key={ca.id}>{ca.name?.charAt(0).toUpperCase()}</Avatar>
                                        ))}
                                    </AvatarGroup>
                                </Tooltip>
                            )}

                            {task.context && (
                                <Chip
                                    label={task.context}
                                    size="small"
                                    sx={{
                                        height: 26,
                                        fontSize: '12px',
                                        fontWeight: 500,
                                        borderRadius: '8px',
                                        bgcolor: '#e0e7ff',
                                        color: '#4338ca',
                                        border: 'none',
                                    }}
                                />
                            )}

                            {task.dueDate && (
                                <Box display="flex" alignItems="center" color={APPLE_COLORS.textSecondary} ml="auto">
                                    <AccessTimeIcon sx={{ fontSize: 14, mr: 0.5 }} />
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontSize: '12px',
                                            fontWeight: 500,
                                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'
                                        }}
                                    >
                                        {(() => {
                                            const raw = task.dueDate as any;
                                            const d = raw?.seconds
                                                ? new Date(raw.seconds * 1000)
                                                : raw?.toDate
                                                    ? raw.toDate()
                                                    : new Date(raw);
                                            return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                        })()}
                                    </Typography>
                                </Box>
                            )}
                        </Box>

                        {/* Action Buttons Row - Apple 44pt touch targets */}
                        {!isDone && (
                            <Box
                                display="flex"
                                justifyContent="space-between"
                                alignItems="center"
                                mt={2}
                                pt={1.5}
                                sx={{
                                    borderTop: `1px solid ${APPLE_COLORS.border}`
                                }}
                            >
                                {/* Play/Stop Button */}
                                {isActive && onStopSession ? (
                                    <Tooltip title="Stop Timer" arrow>
                                        <IconButton
                                            onClick={handleStopClick}
                                            sx={{
                                                width: 44,
                                                height: 44,
                                                borderRadius: '12px',
                                                backgroundColor: 'rgba(255, 59, 48, 0.12)',
                                                color: APPLE_COLORS.danger,
                                                transition: 'all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
                                                '&:hover': {
                                                    backgroundColor: APPLE_COLORS.danger,
                                                    color: 'white',
                                                    transform: 'scale(1.05)'
                                                },
                                                '&:active': {
                                                    transform: 'scale(0.95)'
                                                }
                                            }}
                                        >
                                            <StopIcon sx={{ fontSize: 24 }} />
                                        </IconButton>
                                    </Tooltip>
                                ) : (
                                    onStartSession && (
                                        <Tooltip title="Start Timer" arrow>
                                            <IconButton
                                                onClick={handlePlayClick}
                                                sx={{
                                                    width: 44,
                                                    height: 44,
                                                    borderRadius: '12px',
                                                    backgroundColor: 'rgba(52, 199, 89, 0.12)',
                                                    color: APPLE_COLORS.success,
                                                    transition: 'all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
                                                    '&:hover': {
                                                        backgroundColor: APPLE_COLORS.success,
                                                        color: 'white',
                                                        transform: 'scale(1.05)'
                                                    },
                                                    '&:active': {
                                                        transform: 'scale(0.95)'
                                                    }
                                                }}
                                            >
                                                <PlayArrowIcon sx={{ fontSize: 24 }} />
                                            </IconButton>
                                        </Tooltip>
                                    )
                                )}

                                {/* Spacer when no play button */}
                                {!onStartSession && !isActive && <Box />}

                                {/* Edit Button */}
                                <Tooltip title="Edit Task" arrow>
                                    <IconButton
                                        sx={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: '12px',
                                            backgroundColor: APPLE_COLORS.gray,
                                            color: APPLE_COLORS.textSecondary,
                                            transition: 'all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
                                            '&:hover': {
                                                backgroundColor: '#e5e5e7',
                                                color: APPLE_COLORS.textPrimary,
                                                transform: 'scale(1.05)'
                                            },
                                            '&:active': {
                                                transform: 'scale(0.95)'
                                            }
                                        }}
                                    >
                                        <EditIcon sx={{ fontSize: 20 }} />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        )}
                    </CardContent>
                </Card>
            )}
        </Draggable>
    );
};

export default GTDTaskCard;
