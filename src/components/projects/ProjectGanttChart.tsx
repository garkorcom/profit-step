import React, { useEffect, useState, useMemo } from 'react';
import { Box, Typography, CircularProgress, Select, MenuItem, FormControl, InputLabel, Paper } from '@mui/material';
import { Gantt, Task as GanttTask, ViewMode } from 'gantt-task-react';
import "gantt-task-react/dist/index.css";
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp, addDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase'; // Assuming standard firebase config location
import { GTDTask } from '../../types/gtd.types';

interface ProjectGanttChartProps {
    projectId: string;
    companyId: string;
}

export const ProjectGanttChart: React.FC<ProjectGanttChartProps> = ({ projectId, companyId }) => {
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

        const gTasks: GanttTask[] = [];

        tasks.forEach(t => {
            // 1. Определение фактических дат
            const actualStart = t.actualStartDate?.toDate() || t.startDate?.toDate() || t.createdAt?.toDate() || new Date();
            let actualEnd = t.actualEndDate?.toDate() || t.dueDate?.toDate();
            if (!actualEnd) {
                actualEnd = new Date(actualStart);
                actualEnd.setDate(actualEnd.getDate() + 1); // default 1 day duration
            }

            // 2. Рендер изначального плана (Теневая задача)
            if (t.plannedStartDate && t.plannedEndDate) {
                gTasks.push({
                    id: t.id + '_plan',
                    name: `[План] ${t.title}`,
                    start: t.plannedStartDate.toDate(),
                    end: t.plannedEndDate.toDate(),
                    progress: 100,
                    type: t.isMilestone ? 'milestone' : 'task',
                    project: t.parentTaskId || undefined,
                    isDisabled: true, // Блокируем drag-n-drop
                    styles: {
                        progressColor: '#e0e0e0',
                        progressSelectedColor: '#d5d5d5',
                        backgroundColor: '#f5f5f5',
                        backgroundSelectedColor: '#f0f0f0',
                    }
                });
            }

            // 3. Рендер фактической задачи
            gTasks.push({
                id: t.id,
                name: t.title,
                start: actualStart,
                end: actualEnd,
                progress: t.progressPercentage || 0,
                type: t.isMilestone ? 'milestone' : (t.parentTaskId ? 'task' : 'project'),
                project: t.parentTaskId || undefined,
                dependencies: t.dependsOn || undefined,
                isDisabled: false,
                styles: {
                    progressColor: t.ganttColor || '#ffbb54',
                    progressSelectedColor: '#ff9e0d',
                }
            });
        });

        return gTasks.sort((a, b) => a.start.getTime() - b.start.getTime());
    }, [tasks]);

    const handleTaskChange = async (task: GanttTask) => {
        if (task.id.endsWith('_plan')) return; // Игнорируем фоновые бары

        try {
            const taskRef = doc(db, 'gtd_tasks', task.id);
            await updateDoc(taskRef, {
                actualStartDate: Timestamp.fromDate(task.start),
                actualEndDate: Timestamp.fromDate(task.end),
                startDate: Timestamp.fromDate(task.start), // Legacy sync
                dueDate: Timestamp.fromDate(task.end)      // Legacy sync
            });

            // Автоматическая запись в Time-Lapse
            await addDoc(collection(db, 'activity_logs'), {
                companyId,
                projectId,
                taskId: task.id,
                type: 'task_status_changed',
                content: `Сроки задачи "${task.name}" изменены на Диаграмме Ганта.`,
                performedBy: 'Пользователь',
                performedAt: Timestamp.now(),
                isInternalOnly: false
            });
        } catch (err) {
            console.error("Failed to update task dates", err);
        }
    };

    const handleProgressChange = async (task: GanttTask) => {
        if (task.id.endsWith('_plan')) return;

        try {
            const taskRef = doc(db, 'gtd_tasks', task.id);
            await updateDoc(taskRef, {
                progressPercentage: task.progress
            });

            // Автоматическая запись в Time-Lapse
            await addDoc(collection(db, 'activity_logs'), {
                companyId,
                projectId,
                taskId: task.id,
                type: 'task_status_changed',
                content: `Прогресс по задаче "${task.name}" изменен на ${Math.round(task.progress)}%.`,
                performedBy: 'Пользователь',
                performedAt: Timestamp.now(),
                isInternalOnly: false
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
