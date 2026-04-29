import React, { useMemo, useState, useEffect } from 'react';
import { Box, Typography, Paper, CircularProgress, Alert, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Gantt, Task as GanttTask, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
import { useAuth } from '../../../auth/AuthContext';
import { tasktotimeApi } from '../../../api/tasktotimeApi';
import type { TaskDto, TaskLifecycle } from '../../../api/tasktotimeApi';

const getTaskProgress = (lifecycle: TaskLifecycle): number => {
    switch (lifecycle) {
        case 'completed':
        case 'accepted':
            return 100;
        case 'doing':
        case 'review':
            return 50;
        default:
            return 0;
    }
};

const getTaskColor = (lifecycle: TaskLifecycle): string => {
    switch (lifecycle) {
        case 'completed':
        case 'accepted':
            return '#4caf50'; // green
        case 'doing':
        case 'review':
            return '#ff9800'; // orange
        case 'todo':
        case 'draft':
            return '#2196f3'; // blue
        case 'canceled':
            return '#9e9e9e'; // grey
        default:
            return '#2196f3';
    }
};

const GanttPage: React.FC = () => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();
    const companyId = userProfile?.companyId;

    const [tasks, setTasks] = useState<TaskDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

    const fetchTasks = async () => {
        if (!companyId) return;
        setLoading(true);
        try {
            let allTasks: TaskDto[] = [];
            let cursor: string | null = null;
            do {
                const res = await tasktotimeApi.listTasks({
                    companyId,
                    limit: 1000,
                    cursor: cursor ?? undefined,
                });
                allTasks = allTasks.concat(res.items);
                cursor = res.nextCursor;
            } while (cursor);
            setTasks(allTasks);
        } catch (err) {
            console.error('Failed to fetch tasks for Gantt', err);
            setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, [companyId]);

    const ganttTasks: GanttTask[] | null = useMemo(() => {
        if (!tasks.length) return null;

        const gTasks: GanttTask[] = [];

        tasks.forEach(t => {
            const startTimestamp = t.actualStartAt || t.plannedStartAt || t.createdAt;
            const start = new Date(startTimestamp);
            
            let end: Date;
            if (t.completedAt) {
                end = new Date(t.completedAt);
            } else if (t.dueAt) {
                end = new Date(t.dueAt);
            } else {
                end = new Date(start);
                end.setDate(end.getDate() + 1);
            }

            // Fallback for end before start (rare but possible in bad data)
            if (end.getTime() <= start.getTime()) {
                end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
            }

            gTasks.push({
                id: t.id,
                name: t.title,
                start,
                end,
                progress: getTaskProgress(t.lifecycle),
                type: t.subtaskIds?.length > 0 ? 'project' : 'task',
                project: t.parentTaskId || undefined,
                dependencies: t.dependencies?.map(d => d.taskId),
                isDisabled: false,
                styles: {
                    progressColor: getTaskColor(t.lifecycle),
                    progressSelectedColor: '#1976d2',
                }
            });
        });

        return gTasks.sort((a, b) => a.start.getTime() - b.start.getTime());
    }, [tasks]);

    const handleDateChange = async (task: GanttTask) => {
        if (!companyId) return;
        try {
            await tasktotimeApi.updateTask({
                companyId,
                taskId: task.id,
                updates: {
                    plannedStartAt: task.start.getTime(),
                    dueAt: task.end.getTime()
                }
            });
            toast.success('Task dates updated');
            // Optimistic update
            setTasks(prev => prev.map(t => 
                t.id === task.id ? { ...t, plannedStartAt: task.start.getTime(), dueAt: task.end.getTime() } : t
            ));
        } catch (err) {
            console.error('Failed to update task dates', err);
            toast.error('Failed to update task dates');
            fetchTasks(); // Revert
        }
    };

    const handleProgressChange = async (task: GanttTask) => {
        // We do not directly support progress percentage updates in TaskDto right now (only lifecycle),
        // so we can ignore this or show a toast. For now, doing nothing.
        toast('Progress mapped to lifecycle status', { icon: 'ℹ️' });
    };

    const handleDoubleClick = (task: GanttTask) => {
        navigate(`/crm/tasktotime/tasks/${task.id}`);
    };

    return (
        <Box sx={{ p: { xs: 2, sm: 3 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                    <Typography variant="h4" component="h1" gutterBottom fontWeight={700}>
                        Gantt Chart
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Timeline and dependencies of your tasks
                    </Typography>
                </Box>
                
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Zoom</InputLabel>
                    <Select
                        value={viewMode}
                        label="Zoom"
                        onChange={(e) => setViewMode(e.target.value as ViewMode)}
                    >
                        <MenuItem value={ViewMode.Day}>Day</MenuItem>
                        <MenuItem value={ViewMode.Week}>Week</MenuItem>
                        <MenuItem value={ViewMode.Month}>Month</MenuItem>
                    </Select>
                </FormControl>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error.message}
                </Alert>
            )}

            <Paper 
                sx={{ 
                    flex: 1, 
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    minHeight: 500
                }}
            >
                {loading && !tasks.length ? (
                    <Box display="flex" justifyContent="center" alignItems="center" flex={1}>
                        <CircularProgress />
                    </Box>
                ) : !ganttTasks || ganttTasks.length === 0 ? (
                    <Box display="flex" justifyContent="center" alignItems="center" flex={1}>
                        <Typography color="text.secondary">No tasks found</Typography>
                    </Box>
                ) : (
                    <Box sx={{ flex: 1, overflowX: 'auto', p: 2 }}>
                        <Gantt
                            tasks={ganttTasks}
                            viewMode={viewMode}
                            onDateChange={handleDateChange}
                            onProgressChange={handleProgressChange}
                            onDoubleClick={handleDoubleClick}
                            listCellWidth="155px"
                            columnWidth={viewMode === ViewMode.Day ? 60 : undefined}
                        />
                    </Box>
                )}
            </Paper>
        </Box>
    );
};

export default GanttPage;
