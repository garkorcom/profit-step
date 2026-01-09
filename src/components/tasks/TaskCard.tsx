import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, Typography, Box, Chip, Avatar, IconButton, Tooltip } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { Task } from '../../types/task.types';

interface TaskCardProps {
    task: Task;
    onClick: (task: Task) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onClick }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: task.id,
        data: { task }
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        cursor: 'grab',
        marginBottom: '8px'
    };

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high': return 'error';
            case 'medium': return 'warning';
            case 'low': return 'success';
            default: return 'default';
        }
    };

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
    };

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
            <Card
                onClick={() => onClick(task)}
                sx={{
                    '&:hover': { boxShadow: 3 },
                    cursor: 'pointer',
                    position: 'relative'
                }}
            >
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                        <Tooltip title={task.title}>
                            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, lineHeight: 1.2, maxWidth: 200 }}>
                                {task.title}
                            </Typography>
                        </Tooltip>
                    </Box>

                    <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box display="flex" gap={0.5}>
                            <Chip
                                label={task.priority}
                                size="small"
                                color={getPriorityColor(task.priority) as any}
                                sx={{ height: 20, fontSize: '0.65rem' }}
                            />
                            {task.totalTime > 0 && (
                                <Chip
                                    icon={<AccessTimeIcon sx={{ fontSize: '0.8rem !important' }} />}
                                    label={formatTime(task.totalTime)}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                />
                            )}
                        </Box>

                        {task.assigneeId && (
                            <Avatar
                                sx={{ width: 24, height: 24, fontSize: '0.75rem' }}
                                alt="Assignee"
                                src={`https://api.dicebear.com/7.x/initials/svg?seed=${task.assigneeId}`}
                            />
                        )}
                    </Box>
                </CardContent>
            </Card>
        </div>
    );
};

export default TaskCard;
