import React, { useEffect, useState, useMemo } from 'react';
import { Box, Typography, CircularProgress, Select, MenuItem, FormControl, InputLabel, Paper } from '@mui/material';
import { Gantt, Task as GanttTask, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase'; // Assuming standard firebase config location
import { GTDTask } from '../../types/gtd.types';

interface ProjectGanttChartProps {
    projectId: string;
}

export const ProjectGanttChart: React.FC<ProjectGanttChartProps> = ({ projectId }) => {
    const [tasks, setTasks] = useState<GTDTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

    useEffect(() => {
        if (!projectId) return;
        
        const q = query(
            collection(db, 'gtd_tasks'),
            where('projectId', '==', projectId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const loadedTasks: GTDTask[] = [];
            snapshot.forEach((docSnap) => {
                loadedTasks.push({ id: docSnap.id, ...docSnap.data() } as GTDTask);
            });
            setTasks(loadedTasks);
            setLoading(false);
        }, (err) => {
            console.error("Gantt: Failed to fetch tasks", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [projectId]);

    const ganttTasks: GanttTask[] | null = useMemo(() => {
        if (!tasks.length) return null;

        const gTasks: GanttTask[] = tasks.map(t => {
            // Provide sensible defaults if dates are missing
            const start = t.startDate?.toDate() || t.createdAt?.toDate() || new Date();
            let end = t.dueDate?.toDate();
            if (!end) {
                end = new Date(start);
                end.setDate(end.getDate() + 1); // default 1 day duration
            }

            return {
                id: t.id,
                name: t.title,
                start,
                end,
                progress: t.progressPercentage || 0,
                type: t.isMilestone ? 'milestone' : (t.parentTaskId ? 'task' : 'project'),
                project: t.parentTaskId || undefined,
                dependencies: t.dependsOn || undefined,
                styles: {
                    progressColor: t.ganttColor || '#ffbb54',
                    progressSelectedColor: '#ff9e0d',
                }
            };
        });

        // Ensure parent and children are correctly linked and children are after parents in the array 
        // Although gantt-task-react usually handles flat structures, it's safer.
        return gTasks.sort((a, b) => a.start.getTime() - b.start.getTime());

    }, [tasks]);

    const handleTaskChange = async (task: GanttTask) => {
        try {
            const taskRef = doc(db, 'gtd_tasks', task.id);
            await updateDoc(taskRef, {
                startDate: Timestamp.fromDate(task.start),
                dueDate: Timestamp.fromDate(task.end)
            });
            // State will update via onSnapshot
        } catch (err) {
            console.error("Failed to update task dates", err);
        }
    };

    const handleProgressChange = async (task: GanttTask) => {
        try {
            const taskRef = doc(db, 'gtd_tasks', task.id);
            await updateDoc(taskRef, {
                progressPercentage: task.progress
            });
        } catch (err) {
            console.error("Failed to update task progress", err);
        }
    };

    if (loading) {
        return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
    }

    if (!ganttTasks || ganttTasks.length === 0) {
        return (
            <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
                <Typography color="text.secondary">Нет задач для отображения на графике.</Typography>
                <Typography variant="caption" display="block" mt={1}>Создайте задачи в проекте и укажите даты.</Typography>
            </Paper>
        );
    }

    return (
        <Box>
            <Box mb={2} display="flex" justifyContent="flex-end">
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Масштаб (Zoom)</InputLabel>
                    <Select
                        value={viewMode}
                        label="Масштаб (Zoom)"
                        onChange={(e) => setViewMode(e.target.value as ViewMode)}
                    >
                        <MenuItem value={ViewMode.Day}>Дни</MenuItem>
                        <MenuItem value={ViewMode.Week}>Недели</MenuItem>
                        <MenuItem value={ViewMode.Month}>Месяцы</MenuItem>
                    </Select>
                </FormControl>
            </Box>

            <Box sx={{ overflowX: 'auto', bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                <Gantt
                    tasks={ganttTasks}
                    viewMode={viewMode}
                    onDateChange={handleTaskChange}
                    onProgressChange={handleProgressChange}
                    listCellWidth={"155px"}
                    columnWidth={viewMode === ViewMode.Day ? 60 : undefined}
                />
            </Box>
        </Box>
    );
};
