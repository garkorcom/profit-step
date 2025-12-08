import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Box, Grid } from '@mui/material';
import { Task, TaskStatus } from '../../types/task.types';
import TaskColumn from './TaskColumn';
import TaskCard from './TaskCard';

interface KanbanBoardProps {
    tasks: Task[];
    onTaskMove: (taskId: string, newStatus: TaskStatus) => void;
    onTaskClick: (task: Task) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, onTaskMove, onTaskClick }) => {
    const [activeTask, setActiveTask] = useState<Task | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const task = tasks.find(t => t.id === active.id);
        if (task) setActiveTask(task);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // If dropped over a column container (which has ID as status)
            const newStatus = over.id as TaskStatus;
            onTaskMove(active.id as string, newStatus);
        }

        setActiveTask(null);
    };

    const columns: { id: TaskStatus; title: string }[] = [
        { id: 'todo', title: 'To Do' },
        { id: 'in-progress', title: 'In Progress' },
        { id: 'done', title: 'Done' },
    ];

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <Box sx={{ height: 'calc(100vh - 200px)', overflowX: 'auto', pb: 2 }}>
                <Grid container spacing={2} sx={{ height: '100%', minWidth: '900px' }}>
                    {columns.map((col) => (
                        <Grid size={{ xs: 4 }} key={col.id} sx={{ height: '100%' }}>
                            <TaskColumn
                                id={col.id}
                                title={col.title}
                                tasks={tasks.filter(t => t.status === col.id)}
                                onTaskClick={onTaskClick}
                            />
                        </Grid>
                    ))}
                </Grid>
            </Box>

            <DragOverlay>
                {activeTask ? (
                    <TaskCard task={activeTask} onClick={() => { }} />
                ) : null}
            </DragOverlay>
        </DndContext>
    );
};

export default KanbanBoard;
