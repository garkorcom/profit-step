/**
 * @fileoverview GTD Task Calendar - Enhanced Version
 * 
 * Features:
 * - Month & Week views
 * - Quick Add on day click
 * - Overdue indicator
 * - Client filter
 * - Day detail popup
 * - Status colors
 * - Click to edit
 * - iCal export
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
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    List,
    ListItemButton,
    ListItemText,
    ListItemIcon,
    TextField,
    DialogActions,
} from '@mui/material';
import { collection, query, where, onSnapshot, or, addDoc, Timestamp, getDocs, orderBy } from 'firebase/firestore';
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
    addWeeks,
    subWeeks,
    parseISO,
    isValid,
    isBefore,
    startOfDay,
} from 'date-fns';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import AddIcon from '@mui/icons-material/Add';
import WarningIcon from '@mui/icons-material/Warning';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarViewMonthIcon from '@mui/icons-material/CalendarViewMonth';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import DownloadIcon from '@mui/icons-material/Download';
import { GTDTask, GTDStatus, GTD_COLUMNS } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import GTDEditDialog from '../../components/gtd/GTDEditDialog';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';

// Status colors for calendar display - Enhanced with gradients
const STATUS_COLORS: Record<GTDStatus, { bg: string; border: string; text: string; gradient?: string }> = {
    inbox: { bg: '#f8fafc', border: '#94a3b8', text: '#334155', gradient: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' },
    next_action: { bg: '#fef9c3', border: '#eab308', text: '#854d0e', gradient: 'linear-gradient(135deg, #fef9c3 0%, #fde047 100%)' },
    projects: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', gradient: 'linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)' },
    waiting: { bg: '#fce7f3', border: '#ec4899', text: '#9d174d', gradient: 'linear-gradient(135deg, #fce7f3 0%, #f9a8d4 100%)' },
    estimate: { bg: '#ffedd5', border: '#f97316', text: '#c2410c', gradient: 'linear-gradient(135deg, #ffedd5 0%, #fdba74 100%)' },
    someday: { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', gradient: 'linear-gradient(135deg, #e0e7ff 0%, #a5b4fc 100%)' },
    done: { bg: '#dcfce7', border: '#22c55e', text: '#15803d', gradient: 'linear-gradient(135deg, #dcfce7 0%, #86efac 100%)' },
};

type ViewMode = 'month' | 'week';

const CalendarPage: React.FC = () => {
    const { currentUser } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [tasks, setTasks] = useState<GTDTask[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<GTDTask | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [showAllTasks, setShowAllTasks] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [selectedClientId, setSelectedClientId] = useState<string>('all');

    // Quick Add state
    const [quickAddOpen, setQuickAddOpen] = useState(false);
    const [quickAddDate, setQuickAddDate] = useState<Date | null>(null);
    const [quickAddTitle, setQuickAddTitle] = useState('');

    // Day Detail Popup
    const [dayDetailOpen, setDayDetailOpen] = useState(false);
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);

    // Fetch clients
    useEffect(() => {
        const fetchClients = async () => {
            const q = query(collection(db, 'clients'), orderBy('name'));
            const snap = await getDocs(q);
            setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
        };
        fetchClients();
    }, []);

    // Fetch GTD tasks
    useEffect(() => {
        if (!currentUser) return;

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
            let tasksData = snapshot.docs
                .map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                } as GTDTask))
                .filter(t => t.dueDate || t.startDate);

            // Client filter
            if (selectedClientId !== 'all') {
                tasksData = tasksData.filter(t => t.clientId === selectedClientId);
            }

            setTasks(tasksData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser, showAllTasks, selectedClientId]);

    // Generate calendar days based on view mode
    const calendarDays = useMemo(() => {
        if (viewMode === 'week') {
            const weekStart = startOfWeek(currentDate);
            const weekEnd = endOfWeek(currentDate);
            return eachDayOfInterval({ start: weekStart, end: weekEnd });
        }

        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);
        return eachDayOfInterval({ start: startDate, end: endDate });
    }, [currentDate, viewMode]);

    // Navigation handlers
    const handlePrev = () => {
        if (viewMode === 'week') {
            setCurrentDate(subWeeks(currentDate, 1));
        } else {
            setCurrentDate(subMonths(currentDate, 1));
        }
    };

    const handleNext = () => {
        if (viewMode === 'week') {
            setCurrentDate(addWeeks(currentDate, 1));
        } else {
            setCurrentDate(addMonths(currentDate, 1));
        }
    };

    const handleToday = () => setCurrentDate(new Date());

    const handleTaskClick = (task: GTDTask, e: React.MouseEvent) => {
        e.stopPropagation();
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

    // Quick Add handlers
    const handleDayClick = (day: Date) => {
        setQuickAddDate(day);
        setQuickAddTitle('');
        setQuickAddOpen(true);
    };

    const handleQuickAddSave = async () => {
        if (!quickAddTitle.trim() || !quickAddDate || !currentUser) return;

        try {
            await addDoc(collection(db, 'gtd_tasks'), {
                title: quickAddTitle.trim(),
                status: 'inbox',
                dueDate: format(quickAddDate, 'yyyy-MM-dd'),
                ownerId: currentUser.uid,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
            });
            setQuickAddOpen(false);
            setQuickAddTitle('');
        } catch (error) {
            console.error('Failed to add task:', error);
        }
    };

    // Day detail popup
    const handleDayDetail = (day: Date, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedDay(day);
        setDayDetailOpen(true);
    };

    // Get task date
    const getTaskDate = (task: GTDTask): Date | null => {
        const dateField = task.dueDate || task.startDate;
        if (!dateField) return null;

        if (typeof dateField === 'string') {
            return parseISO(dateField);
        } else if ((dateField as any).toDate) {
            return (dateField as any).toDate();
        }
        return new Date(dateField as any);
    };

    // Check if task is overdue
    const isOverdue = (task: GTDTask): boolean => {
        if (task.status === 'done') return false;
        const taskDate = getTaskDate(task);
        if (!taskDate || !isValid(taskDate)) return false;
        return isBefore(startOfDay(taskDate), startOfDay(new Date()));
    };

    // Get tasks for a specific day
    const getTasksForDay = (day: Date): GTDTask[] => {
        return tasks.filter(task => {
            const taskDate = getTaskDate(task);
            return taskDate && isValid(taskDate) && isSameDay(taskDate, day);
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

    // Count overdue
    const overdueCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);

    // Export to iCal
    const handleExportICal = () => {
        let ical = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Profit Step//GTD Calendar//EN\n';

        tasks.forEach(task => {
            const taskDate = getTaskDate(task);
            if (!taskDate || !isValid(taskDate)) return;

            const dtstart = format(taskDate, "yyyyMMdd");
            ical += `BEGIN:VEVENT\n`;
            ical += `DTSTART;VALUE=DATE:${dtstart}\n`;
            ical += `SUMMARY:${task.title.replace(/,/g, '\\,')}\n`;
            ical += `DESCRIPTION:Status: ${task.status}\n`;
            ical += `UID:${task.id}@profit-step\n`;
            ical += `END:VEVENT\n`;
        });

        ical += 'END:VCALENDAR';

        const blob = new Blob([ical], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gtd-tasks.ics';
        a.click();
        URL.revokeObjectURL(url);
    };

    // Clients map for display
    const clientsMap = useMemo(() => {
        const map: Record<string, Client> = {};
        clients.forEach(c => { map[c.id] = c; });
        return map;
    }, [clients]);

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{
            minHeight: 'calc(100vh - 64px)',
            background: 'linear-gradient(180deg, #f0f4ff 0%, #fafbff 50%, #ffffff 100%)',
            py: 2,
        }}>
            <Container maxWidth="xl" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Header with gradient */}
                <Paper
                    elevation={0}
                    sx={{
                        p: 2,
                        mb: 2,
                        borderRadius: 3,
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        boxShadow: '0 4px 20px rgba(102, 126, 234, 0.25)',
                    }}
                >
                    <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1.5}>
                        <Box display="flex" alignItems="center" gap={2}>
                            <Typography variant="h5" fontWeight="bold" sx={{ color: 'white', display: 'flex', alignItems: 'center', gap: 1 }}>
                                📅 Task Calendar
                            </Typography>
                            <Chip
                                label={`${tasks.length} Tasks`}
                                sx={{
                                    bgcolor: 'rgba(255,255,255,0.2)',
                                    color: 'white',
                                    fontWeight: 600,
                                    backdropFilter: 'blur(10px)',
                                }}
                                size="small"
                            />
                            {overdueCount > 0 && (
                                <Chip
                                    icon={<WarningIcon sx={{ color: 'white !important' }} />}
                                    label={`${overdueCount} Overdue`}
                                    sx={{
                                        bgcolor: 'rgba(239, 68, 68, 0.9)',
                                        color: 'white',
                                        fontWeight: 600,
                                    }}
                                    size="small"
                                />
                            )}
                        </Box>

                        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                            {/* Client Filter */}
                            <FormControl size="small" sx={{ minWidth: 150 }}>
                                <InputLabel>Client</InputLabel>
                                <Select
                                    value={selectedClientId}
                                    label="Client"
                                    onChange={(e) => setSelectedClientId(e.target.value)}
                                >
                                    <MenuItem value="all"><em>All Clients</em></MenuItem>
                                    {clients.map(c => (
                                        <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            {/* View Toggle */}
                            <ToggleButtonGroup
                                value={viewMode}
                                exclusive
                                onChange={(_, val) => val && setViewMode(val)}
                                size="small"
                            >
                                <ToggleButton value="month"><CalendarViewMonthIcon /></ToggleButton>
                                <ToggleButton value="week"><ViewWeekIcon /></ToggleButton>
                            </ToggleButtonGroup>

                            {/* My/All Toggle */}
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
                                <IconButton onClick={handlePrev} size="small">
                                    <ChevronLeftIcon />
                                </IconButton>
                                <Typography variant="subtitle2" sx={{ px: 1.5, minWidth: 130, textAlign: 'center', fontWeight: 600 }}>
                                    {viewMode === 'week'
                                        ? `${format(calendarDays[0], 'MMM d')} - ${format(calendarDays[6], 'MMM d, yyyy')}`
                                        : format(currentDate, 'MMMM yyyy')
                                    }
                                </Typography>
                                <IconButton onClick={handleNext} size="small">
                                    <ChevronRightIcon />
                                </IconButton>
                            </Box>

                            <Tooltip title="Export to iCal">
                                <IconButton onClick={handleExportICal} size="small">
                                    <DownloadIcon />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>

                    {/* Status Legend */}
                    <Box display="flex" gap={0.5} mb={1.5} flexWrap="wrap">
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
                                    fontSize: '0.7rem',
                                    height: 24,
                                }}
                            />
                        ))}
                    </Box>

                    {/* Calendar Grid */}
                    <Paper elevation={0} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', border: '1px solid #e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                        {/* Weekday Headers */}
                        <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" bgcolor="#f9fafb" borderBottom="1px solid #e5e7eb">
                            {['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].map(day => (
                                <Box key={day} p={1} textAlign="center">
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
                                const hasOverdue = dayTasks.some(isOverdue);

                                return (
                                    <Box
                                        key={day.toISOString()}
                                        onClick={() => handleDayClick(day)}
                                        sx={{
                                            borderRight: (index + 1) % 7 === 0 ? 'none' : '1px solid #e5e7eb',
                                            borderBottom: '1px solid #e5e7eb',
                                            bgcolor: isCurrentMonth ? 'white' : '#f9fafb',
                                            minHeight: viewMode === 'week' ? 200 : 90,
                                            p: 0.5,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            cursor: 'pointer',
                                            transition: 'background 0.15s',
                                            '&:hover': { bgcolor: '#f0f9ff' },
                                            ...(hasOverdue && { borderLeft: '3px solid #ef4444' }),
                                        }}
                                    >
                                        {/* Day Header */}
                                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.25}>
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    fontWeight: isToday ? 'bold' : 'normal',
                                                    color: isToday ? 'white' : (isCurrentMonth ? 'text.primary' : 'text.disabled'),
                                                    bgcolor: isToday ? 'primary.main' : 'transparent',
                                                    width: 20,
                                                    height: 20,
                                                    borderRadius: '50%',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '0.65rem',
                                                }}
                                            >
                                                {format(day, 'd')}
                                            </Typography>
                                            {dayTasks.length > 0 && (
                                                <Chip
                                                    label={dayTasks.length}
                                                    size="small"
                                                    onClick={(e) => handleDayDetail(day, e)}
                                                    sx={{ height: 16, fontSize: '0.6rem', cursor: 'pointer' }}
                                                />
                                            )}
                                        </Box>

                                        {/* Tasks */}
                                        <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                                            {dayTasks.slice(0, viewMode === 'week' ? 10 : 3).map(task => {
                                                const colors = STATUS_COLORS[task.status];
                                                const taskOverdue = isOverdue(task);

                                                return (
                                                    <Tooltip key={task.id} title={`${task.title}${task.clientId ? ` • ${clientsMap[task.clientId]?.name || ''}` : ''}`} arrow>
                                                        <Box
                                                            onClick={(e) => handleTaskClick(task, e)}
                                                            sx={{
                                                                px: 0.5,
                                                                py: 0.25,
                                                                borderRadius: 0.5,
                                                                bgcolor: taskOverdue ? '#fef2f2' : colors.bg,
                                                                borderLeft: `3px solid ${taskOverdue ? '#ef4444' : colors.border}`,
                                                                cursor: 'pointer',
                                                                '&:hover': { opacity: 0.8 },
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 0.25,
                                                            }}
                                                        >
                                                            {taskOverdue && <WarningIcon sx={{ fontSize: 10, color: '#ef4444' }} />}
                                                            <Typography
                                                                variant="caption"
                                                                noWrap
                                                                sx={{
                                                                    fontSize: '0.6rem',
                                                                    color: taskOverdue ? '#991b1b' : colors.text,
                                                                    fontWeight: 500,
                                                                    flex: 1,
                                                                }}
                                                            >
                                                                {task.title}
                                                            </Typography>
                                                        </Box>
                                                    </Tooltip>
                                                );
                                            })}
                                            {dayTasks.length > (viewMode === 'week' ? 10 : 3) && (
                                                <Typography
                                                    variant="caption"
                                                    color="primary"
                                                    sx={{ fontSize: '0.55rem', pl: 0.5, cursor: 'pointer' }}
                                                    onClick={(e) => handleDayDetail(day, e)}
                                                >
                                                    +{dayTasks.length - (viewMode === 'week' ? 10 : 3)} more
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Box>
                    </Paper>

                    {/* Quick Add Dialog */}
                    <Dialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} maxWidth="xs" fullWidth>
                        <DialogTitle>
                            <AddIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
                            Quick Add Task
                            {quickAddDate && (
                                <Chip label={format(quickAddDate, 'MMM d, yyyy')} size="small" sx={{ ml: 1 }} />
                            )}
                        </DialogTitle>
                        <DialogContent>
                            <TextField
                                autoFocus
                                fullWidth
                                label="Task Title"
                                value={quickAddTitle}
                                onChange={(e) => setQuickAddTitle(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleQuickAddSave()}
                                sx={{ mt: 1 }}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setQuickAddOpen(false)}>Cancel</Button>
                            <Button onClick={handleQuickAddSave} variant="contained" disabled={!quickAddTitle.trim()}>
                                Add Task
                            </Button>
                        </DialogActions>
                    </Dialog>

                    {/* Day Detail Dialog */}
                    <Dialog open={dayDetailOpen} onClose={() => setDayDetailOpen(false)} maxWidth="sm" fullWidth>
                        <DialogTitle>
                            📅 {selectedDay && format(selectedDay, 'EEEE, MMMM d, yyyy')}
                        </DialogTitle>
                        <DialogContent>
                            {selectedDay && (
                                <List>
                                    {getTasksForDay(selectedDay).map(task => {
                                        const colors = STATUS_COLORS[task.status];
                                        const taskOverdue = isOverdue(task);

                                        return (
                                            <ListItemButton
                                                key={task.id}
                                                onClick={() => {
                                                    setDayDetailOpen(false);
                                                    setSelectedTask(task);
                                                    setIsDialogOpen(true);
                                                }}
                                                sx={{
                                                    bgcolor: taskOverdue ? '#fef2f2' : colors.bg,
                                                    borderLeft: `4px solid ${taskOverdue ? '#ef4444' : colors.border}`,
                                                    mb: 1,
                                                    borderRadius: 1,
                                                }}
                                            >
                                                <ListItemIcon>
                                                    {taskOverdue ? <WarningIcon color="error" /> : <AccessTimeIcon />}
                                                </ListItemIcon>
                                                <ListItemText
                                                    primary={task.title}
                                                    secondary={
                                                        <>
                                                            {task.clientId && clientsMap[task.clientId]?.name && `👤 ${clientsMap[task.clientId].name} • `}
                                                            <Chip label={task.status} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
                                                        </>
                                                    }
                                                />
                                            </ListItemButton>
                                        );
                                    })}
                                    {selectedDay && getTasksForDay(selectedDay).length === 0 && (
                                        <Typography color="text.secondary" textAlign="center" py={2}>
                                            No tasks for this day
                                        </Typography>
                                    )}
                                </List>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setDayDetailOpen(false)}>Close</Button>
                            <Button
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => {
                                    setDayDetailOpen(false);
                                    if (selectedDay) handleDayClick(selectedDay);
                                }}
                            >
                                Add Task
                            </Button>
                        </DialogActions>
                    </Dialog>

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
                </Paper>
            </Container>
        </Box>
    );
};

export default CalendarPage;

