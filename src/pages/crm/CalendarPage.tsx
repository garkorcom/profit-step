/**
 * @fileoverview GTD Task Calendar
 * 
 * Modern calendar view for GTD tasks with:
 * - Tasks displayed by dueDate or startDate
 * - Color-coded by status
 * - Click to edit functionality
 * - Month navigation
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    Box,
    Container,
    Typography,
    Paper,
    IconButton,
    Button,
    Tooltip,
    Chip,
    CircularProgress,
    ToggleButtonGroup,
    ToggleButton,
} from '@mui/material';
import { collection, query, where, onSnapshot, or } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    format,
    isSameMonth,
    isSameDay,
    addMonths,
    subMonths,
    parseISO,
    isValid,
} from 'date-fns';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { GTDTask, GTDStatus, GTD_COLUMNS } from '../../types/gtd.types';
import GTDEditDialog from '../../components/gtd/GTDEditDialog';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';

// Status colors for calendar display
const STATUS_COLORS: Record<GTDStatus, { bg: string; border: string; text: string }> = {
    inbox: { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' },
    next_action: { bg: '#fef3c7', border: '#fcd34d', text: '#92400e' },
    projects: { bg: '#dbeafe', border: '#93c5fd', text: '#1e40af' },
    waiting: { bg: '#fce7f3', border: '#f9a8d4', text: '#9d174d' },
    estimate: { bg: '#fff7ed', border: '#fdba74', text: '#c2410c' },
    someday: { bg: '#e0e7ff', border: '#a5b4fc', text: '#3730a3' },
    done: { bg: '#d1fae5', border: '#6ee7b7', text: '#065f46' },
};

const CalendarPage: React.FC = () => {
    const { currentUser } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [tasks, setTasks] = useState<GTDTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<GTDTask | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [showAllTasks, setShowAllTasks] = useState(false);

    // Fetch GTD tasks with dueDate or startDate
    useEffect(() => {
        if (!currentUser) return;

        // Query: tasks where user is owner OR assignee, with dueDate or startDate
        const baseQuery = showAllTasks
            ? query(collection(db, 'gtd_tasks'))
            : query(
                collection(db, 'gtd_tasks'),
                or(
                    where('ownerId', '==', currentUser.uid),
                    where('assigneeId', '==', currentUser.uid)
                )
            );

        const unsubscribe = onSnapshot(baseQuery, (snapshot) => {
            const tasksData = snapshot.docs
                .map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                } as GTDTask))
                .filter(t => t.dueDate || t.startDate); // Only tasks with dates

            setTasks(tasksData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching calendar tasks:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser, showAllTasks]);

    // Generate calendar days
    const calendarDays = useMemo(() => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        return eachDayOfInterval({ start: startDate, end: endDate });
    }, [currentDate]);

    const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const handleToday = () => setCurrentDate(new Date());

    const handleTaskClick = (task: GTDTask) => {
        setSelectedTask(task);
        setIsDialogOpen(true);
    };

    const handleUpdateTask = async (taskId: string, data: Partial<GTDTask>) => {
        try {
            await updateDoc(doc(db, 'gtd_tasks', taskId), data);
            setIsDialogOpen(false);
        } catch (error) {
            console.error('Failed to update task:', error);
        }
    };

    const handleDeleteTask = async (taskId: string) => {
        try {
            await deleteDoc(doc(db, 'gtd_tasks', taskId));
            setIsDialogOpen(false);
        } catch (error) {
            console.error('Failed to delete task:', error);
        }
    };

    // Get tasks for a specific day
    const getTasksForDay = (day: Date): GTDTask[] => {
        return tasks.filter(task => {
            // Check dueDate first, then startDate
            const dateField = task.dueDate || task.startDate;
            if (!dateField) return false;

            // Handle Firestore Timestamp or string
            let taskDate: Date;
            if (typeof dateField === 'string') {
                taskDate = parseISO(dateField);
            } else if ((dateField as any).toDate) {
                taskDate = (dateField as any).toDate();
            } else {
                taskDate = new Date(dateField as any);
            }

            return isValid(taskDate) && isSameDay(taskDate, day);
        });
    };

    // Count tasks by status
    const taskCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        tasks.forEach(t => {
            counts[t.status] = (counts[t.status] || 0) + 1;
        });
        return counts;
    }, [tasks]);

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ py: 3, height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Typography variant="h5" fontWeight="bold">
                        📅 Task Calendar
                    </Typography>
                    <Chip
                        label={`${tasks.length} Tasks`}
                        color="primary"
                        size="small"
                    />
                </Box>

                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                    {/* View Toggle */}
                    <ToggleButtonGroup
                        value={showAllTasks}
                        exclusive
                        onChange={(_, val) => val !== null && setShowAllTasks(val)}
                        size="small"
                    >
                        <ToggleButton value={false}>Мои</ToggleButton>
                        <ToggleButton value={true}>Все</ToggleButton>
                    </ToggleButtonGroup>

                    <Button variant="outlined" startIcon={<TodayIcon />} onClick={handleToday} size="small">
                        Today
                    </Button>

                    <Box display="flex" alignItems="center" bgcolor="white" borderRadius={1} border="1px solid #e5e7eb">
                        <IconButton onClick={handlePrevMonth} size="small">
                            <ChevronLeftIcon />
                        </IconButton>
                        <Typography variant="subtitle1" sx={{ px: 2, minWidth: 140, textAlign: 'center', fontWeight: 600 }}>
                            {format(currentDate, 'MMMM yyyy')}
                        </Typography>
                        <IconButton onClick={handleNextMonth} size="small">
                            <ChevronRightIcon />
                        </IconButton>
                    </Box>
                </Box>
            </Box>

            {/* Status Legend */}
            <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                {GTD_COLUMNS.filter(c => taskCounts[c.id]).map(col => (
                    <Chip
                        key={col.id}
                        label={`${col.title} (${taskCounts[col.id] || 0})`}
                        size="small"
                        sx={{
                            bgcolor: STATUS_COLORS[col.id].bg,
                            borderColor: STATUS_COLORS[col.id].border,
                            color: STATUS_COLORS[col.id].text,
                            border: '1px solid',
                        }}
                    />
                ))}
            </Box>

            {/* Calendar Grid */}
            <Paper
                elevation={0}
                sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #e5e7eb',
                    borderRadius: 2,
                    overflow: 'hidden'
                }}
            >
                {/* Weekday Headers */}
                <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" bgcolor="#f9fafb" borderBottom="1px solid #e5e7eb">
                    {['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].map(day => (
                        <Box key={day} p={1.5} textAlign="center">
                            <Typography variant="caption" fontWeight="bold" color="text.secondary">
                                {day}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                {/* Days */}
                <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" flexGrow={1} sx={{ overflowY: 'auto' }}>
                    {calendarDays.map((day, index) => {
                        const dayTasks = getTasksForDay(day);
                        const isCurrentMonth = isSameMonth(day, currentDate);
                        const isToday = isSameDay(day, new Date());

                        return (
                            <Box
                                key={day.toISOString()}
                                sx={{
                                    borderRight: (index + 1) % 7 === 0 ? 'none' : '1px solid #e5e7eb',
                                    borderBottom: '1px solid #e5e7eb',
                                    bgcolor: isCurrentMonth ? 'white' : '#f9fafb',
                                    minHeight: 100,
                                    p: 0.5,
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                {/* Day Number */}
                                <Box display="flex" justifyContent="flex-start" mb={0.5}>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            fontWeight: isToday ? 'bold' : 'normal',
                                            color: isToday ? 'white' : (isCurrentMonth ? 'text.primary' : 'text.disabled'),
                                            bgcolor: isToday ? 'primary.main' : 'transparent',
                                            width: 22,
                                            height: 22,
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '0.7rem',
                                        }}
                                    >
                                        {format(day, 'd')}
                                    </Typography>
                                </Box>

                                {/* Tasks */}
                                <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                                    {dayTasks.slice(0, 3).map(task => {
                                        const colors = STATUS_COLORS[task.status];
                                        return (
                                            <Tooltip key={task.id} title={task.title} arrow>
                                                <Box
                                                    onClick={() => handleTaskClick(task)}
                                                    sx={{
                                                        px: 0.5,
                                                        py: 0.25,
                                                        borderRadius: 0.5,
                                                        bgcolor: colors.bg,
                                                        borderLeft: `3px solid ${colors.border}`,
                                                        cursor: 'pointer',
                                                        '&:hover': {
                                                            opacity: 0.8,
                                                            transform: 'scale(1.02)',
                                                        },
                                                        transition: 'all 0.15s',
                                                    }}
                                                >
                                                    <Typography
                                                        variant="caption"
                                                        noWrap
                                                        sx={{
                                                            fontSize: '0.65rem',
                                                            color: colors.text,
                                                            fontWeight: 500,
                                                            display: 'block',
                                                        }}
                                                    >
                                                        {task.title}
                                                    </Typography>
                                                </Box>
                                            </Tooltip>
                                        );
                                    })}
                                    {dayTasks.length > 3 && (
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', pl: 0.5 }}>
                                            +{dayTasks.length - 3} more
                                        </Typography>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            </Paper>

            {/* Edit Dialog */}
            {selectedTask && (
                <GTDEditDialog
                    open={isDialogOpen}
                    onClose={() => setIsDialogOpen(false)}
                    task={selectedTask}
                    onSave={handleUpdateTask}
                    onDelete={handleDeleteTask}
                />
            )}
        </Container>
    );
};

export default CalendarPage;
