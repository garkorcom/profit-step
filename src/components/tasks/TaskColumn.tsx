import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Box, Typography, Paper } from '@mui/material';
import { Task, TaskStatus } from '../../types/task.types';
import TaskCard from './TaskCard';

interface TaskColumnProps {
    id: TaskStatus;
    title: string;
    tasks: Task[];
    onTaskClick: (task: Task) => void;
}

const TaskColumn: React.FC<TaskColumnProps> = ({ id, title, tasks, onTaskClick }) => {
    const { setNodeRef, isOver } = useDroppable({
        id: id,
    });

    const style = {
        backgroundColor: isOver ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
        flex: 1,
        minWidth: '280px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column' as const,
    };

    return (
        <Paper
            elevation={0}
            sx={{
                p: 2,
                bgcolor: 'background.default',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid',
                borderColor: 'divider'
            }}
        >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                    {title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ bgcolor: 'action.hover', px: 1, borderRadius: 1 }}>
                    {tasks.length}
                </Typography>
            </Box>

            <div ref={setNodeRef} style={style}>
                <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 100 }}>
                    {tasks.map((task) => (
                        <TaskCard key={task.id} task={task} onClick={onTaskClick} />
                    ))}
                </Box>
            </div>
        </Paper>
    );
};

export default TaskColumn;
