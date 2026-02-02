import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, Typography, Box, Chip, IconButton, Link, Tooltip } from '@mui/material';
import { Draggable } from '@hello-pangea/dnd';
import EditIcon from '@mui/icons-material/Edit';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FlagIcon from '@mui/icons-material/Flag';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DescriptionIcon from '@mui/icons-material/Description';
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

const GTDTaskCard: React.FC<GTDTaskCardProps> = ({ task, index, clientName, onClick, onStartSession, activeSession, onStopSession }) => {
    const navigate = useNavigate();
    const isDone = task.status === 'done';
    const priorityColor = PRIORITY_COLORS[task.priority || 'none'];
    const hasPriority = task.priority && task.priority !== 'none';

    // Check if this task is active
    const isActive = activeSession && activeSession.relatedTaskId === task.id;

    const handleTitleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        navigate(`/crm/gtd/${task.id}`);
    };

    const handlePlayClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onStartSession) {
            onStartSession(task);
        }
    };

    const handleStopClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onStopSession) {
            onStopSession(task);
        }
    }

    const handleNoteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (task.sourceNoteId) {
            navigate(`/crm/inbox/${task.sourceNoteId}`);
        }
    };

    return (
        <Draggable draggableId={task.id} index={index}>
            {(provided, snapshot) => (
                <Card
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    sx={{
                        mb: 1.5,
                        backgroundColor: isActive ? '#f0fdf4' : (snapshot.isDragging ? '#f0f9ff' : isDone ? '#f9fafb' : 'white'),
                        boxShadow: snapshot.isDragging ? 4 : (isActive ? 3 : 1),
                        cursor: 'grab',
                        borderLeft: isActive ? '4px solid #22c55e' : (hasPriority ? `4px solid ${priorityColor}` : 'none'),
                        opacity: isDone ? 0.7 : 1,
                        transition: 'all 0.2s ease-in-out',
                        transform: snapshot.isDragging ? 'rotate(3deg)' : 'none',
                        '&:hover': {
                            boxShadow: 3,
                            transform: 'translateY(-2px)',
                            backgroundColor: isActive ? '#dcfce7' : (isDone ? '#f3f4f6' : '#fafafa')
                        }
                    }}
                    onClick={() => onClick(task)}
                >
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                            {/* Drag Handle - shows on hover */}
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    mr: 0.5,
                                    ml: -0.5,
                                    opacity: 0.4,
                                    transition: 'opacity 0.2s',
                                    '&:hover': { opacity: 0.8 }
                                }}
                            >
                                <DragIndicatorIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                            </Box>
                            <Typography
                                component={Link}
                                href={`/crm/gtd/${task.id}`}
                                variant="body2"
                                fontWeight="medium"
                                onClick={handleTitleClick}
                                sx={{
                                    textDecoration: isDone ? 'line-through' : 'none',
                                    color: isDone ? 'text.secondary' : 'text.primary',
                                    flex: 1,
                                    pr: 1,
                                    cursor: 'pointer',
                                    '&:hover': { color: 'primary.main', textDecoration: 'underline' }
                                }}
                            >
                                {task.title}
                            </Typography>
                            <Box display="flex" gap={0.5} sx={{ mt: -0.5, mr: -0.5 }}>
                                {!isDone && (
                                    <>
                                        {isActive && onStopSession ? (
                                            <IconButton
                                                size="small"
                                                onClick={handleStopClick}
                                                sx={{
                                                    transition: 'all 0.2s',
                                                    color: 'error.main',
                                                    '&:hover': {
                                                        bgcolor: 'error.light',
                                                        transform: 'scale(1.1)'
                                                    }
                                                }}
                                                title="Stop Timer"
                                            >
                                                <StopIcon sx={{ fontSize: 18 }} />
                                            </IconButton>
                                        ) : (
                                            onStartSession && (
                                                <IconButton
                                                    size="small"
                                                    className="play-button"
                                                    onClick={handlePlayClick}
                                                    sx={{
                                                        opacity: 0.7, // Visible by default for mobile
                                                        transition: 'all 0.2s',
                                                        color: 'success.main',
                                                        '&:hover': {
                                                            opacity: 1,
                                                            bgcolor: 'success.light',
                                                            transform: 'scale(1.1)'
                                                        }
                                                    }}
                                                    title="Start Timer"
                                                >
                                                    <PlayArrowIcon sx={{ fontSize: 18 }} />
                                                </IconButton>
                                            )
                                        )}
                                    </>
                                )}
                                <IconButton
                                    size="small"
                                    sx={{
                                        opacity: 0.5,
                                        '&:hover': { opacity: 1 }
                                    }}
                                >
                                    <EditIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                                {task.sourceNoteId && (
                                    <Tooltip title="Open in Cockpit">
                                        <IconButton
                                            size="small"
                                            onClick={handleNoteClick}
                                            sx={{
                                                opacity: 0.6,
                                                color: 'info.main',
                                                '&:hover': {
                                                    opacity: 1,
                                                    bgcolor: 'info.light',
                                                    transform: 'scale(1.1)'
                                                }
                                            }}
                                        >
                                            <DescriptionIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </Tooltip>
                                )}
                            </Box>
                        </Box>

                        <Box display="flex" gap={0.5} flexWrap="wrap" mt={1} alignItems="center">
                            {/* Priority Badge */}
                            {hasPriority && (
                                <Chip
                                    icon={<FlagIcon sx={{ fontSize: 14, color: `${priorityColor} !important` }} />}
                                    label={PRIORITY_LABELS[task.priority!] || 'Priority'}
                                    size="small"
                                    sx={{
                                        height: 20,
                                        fontSize: '0.65rem',
                                        bgcolor: `${priorityColor}15`,
                                        color: priorityColor,
                                        border: `1px solid ${priorityColor}40`,
                                        '& .MuiChip-icon': { ml: 0.5 }
                                    }}
                                />
                            )}

                            {/* Client Badge */}
                            {clientName && (
                                <Chip
                                    label={clientName}
                                    size="small"
                                    sx={{
                                        height: 20,
                                        fontSize: '0.65rem',
                                        bgcolor: '#fef3c7',
                                        color: '#92400e',
                                        border: '1px solid #fcd34d',
                                    }}
                                />
                            )}

                            {/* Assignee Badge with Accepted indicator */}
                            {task.assigneeName && (
                                <Chip
                                    icon={task.acceptedAt ?
                                        <CheckCircleIcon sx={{ fontSize: 14, color: '#22c55e !important' }} /> :
                                        <PersonIcon sx={{ fontSize: 14 }} />}
                                    label={task.assigneeName}
                                    size="small"
                                    sx={{
                                        height: 20,
                                        fontSize: '0.65rem',
                                        bgcolor: task.acceptedAt ? '#dcfce7' : '#dbeafe',
                                        color: task.acceptedAt ? '#166534' : '#1e40af',
                                        border: task.acceptedAt ? '1px solid #86efac' : '1px solid #93c5fd',
                                        '& .MuiChip-icon': { ml: 0.5, color: task.acceptedAt ? '#22c55e' : '#1e40af' }
                                    }}
                                />
                            )}

                            {/* Context Badge */}
                            {task.context && (
                                <Chip
                                    label={task.context}
                                    size="small"
                                    sx={{
                                        height: 20,
                                        fontSize: '0.65rem',
                                        bgcolor: '#e0e7ff',
                                        color: '#4338ca'
                                    }}
                                />
                            )}

                            {/* Due Date */}
                            {task.dueDate && (
                                <Box display="flex" alignItems="center" color="text.secondary" ml="auto">
                                    <AccessTimeIcon sx={{ fontSize: 14, mr: 0.3 }} />
                                    <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>
                                        {new Date(task.dueDate.seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </CardContent>
                </Card>
            )}
        </Draggable>
    );
};

export default GTDTaskCard;
