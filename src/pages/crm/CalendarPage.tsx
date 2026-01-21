/**
 * @fileoverview GTD Calendar - Advanced Features
 * 
 * Features:
 * - Day/Week/Month views
 * - Day View with timeline (Google Calendar style)
 * - Drag & Drop tasks between days (@dnd-kit)
 * - Quick Add with time picker
 * - Advanced filters
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
    Box,
    Typography,
    IconButton,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    List,
    ListItemButton,
    ListItemText,
    ListItemIcon,
    TextField,
    DialogActions,
    Popover,
    CircularProgress,
    Chip,
    FormControlLabel,
    Switch,
} from '@mui/material';
import { LocalizationProvider, TimePicker } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DndContext, DragEndEvent, DragOverlay, useDraggable, useDroppable, closestCenter } from '@dnd-kit/core';
import { collection, query, where, onSnapshot, or, addDoc, Timestamp, getDocs, orderBy, updateDoc, deleteDoc, doc } from 'firebase/firestore';
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
    addDays,
    subDays,
    parseISO,
    isValid,
    isBefore,
    startOfDay,
    setHours,
    setMinutes,
    getHours,
    getMinutes,
} from 'date-fns';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import WarningIcon from '@mui/icons-material/Warning';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FilterListIcon from '@mui/icons-material/FilterList';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { GTDTask, GTDStatus } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import GTDEditDialog from '../../components/gtd/GTDEditDialog';
import GTDFilterBuilder, { FilterConfig } from '../../components/gtd/GTDFilterBuilder';

// --- PASTEL COLORS ---
const PASTEL_COLORS: Record<GTDStatus, { bg: string; text: string }> = {
    inbox: { bg: '#F1F1EF', text: '#37352F' },
    next_action: { bg: '#FBEDD6', text: '#4A3712' },
    projects: { bg: '#E3EFFD', text: '#183347' },
    waiting: { bg: '#F9E6EC', text: '#4C2337' },
    estimate: { bg: '#FDECC8', text: '#402C1B' },
    someday: { bg: '#EFE9F5', text: '#302841' },
    done: { bg: '#DBEDDB', text: '#1C3829' },
};

type ViewMode = 'month' | 'week' | 'day';

// --- DRAGGABLE TASK ---
const DraggableTask: React.FC<{ task: GTDTask; isOverdue: boolean; onClick: () => void }> = ({ task, isOverdue, onClick }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
    const style = PASTEL_COLORS[task.status] || PASTEL_COLORS.inbox;

    return (
        <Box
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            sx={{
                bgcolor: isOverdue ? '#FFF1F0' : style.bg,
                color: isOverdue ? '#D83A3A' : style.text,
                borderRadius: '4px',
                px: 0.75, py: 0.25,
                fontSize: '0.75rem', fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                display: 'flex', alignItems: 'center', gap: 0.5,
                cursor: 'grab',
                opacity: isDragging ? 0.5 : 1,
                transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
                transition: isDragging ? 'none' : 'all 0.1s',
                '&:hover': { filter: 'brightness(0.97)', transform: 'translateY(-1px)' }
            }}
        >
            {isOverdue && <WarningIcon sx={{ fontSize: 12, color: 'inherit' }} />}
            {task.title}
        </Box>
    );
};

// --- DROPPABLE DAY CELL ---
const DroppableDayCell: React.FC<{ day: Date; children: React.ReactNode; onClick: () => void; isCurrentMonth: boolean; isToday: boolean; viewMode: ViewMode }> =
    ({ day, children, onClick, isCurrentMonth, isToday, viewMode }) => {
        const { isOver, setNodeRef } = useDroppable({ id: day.toISOString() });

        return (
            <Box
                ref={setNodeRef}
                onClick={onClick}
                sx={{
                    borderRight: '1px solid #E0E0E0',
                    borderBottom: '1px solid #E0E0E0',
                    bgcolor: isOver ? '#E3F2FD' : (isCurrentMonth ? '#FFFFFF' : '#FAFAFA'),
                    minHeight: viewMode === 'week' ? 300 : 120,
                    p: 1,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    '&:hover': { bgcolor: '#F7F7F5' }
                }}
            >
                <Box display="flex" justifyContent="space-between" mb={1}>
                    <Box sx={{
                        width: 24, height: 24, borderRadius: '50%',
                        bgcolor: isToday ? '#EB5757' : 'transparent',
                        color: isToday ? 'white' : (isCurrentMonth ? '#37352F' : '#D1D5DB'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: isToday ? '600' : '400'
                    }}>
                        {format(day, 'd')}
                    </Box>
                </Box>
                <Box display="flex" flexDirection="column" gap={0.5}>
                    {children}
                </Box>
            </Box>
        );
    };

// --- HOURS FOR DAY VIEW ---
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CalendarPage: React.FC = () => {
    const { currentUser } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [tasks, setTasks] = useState<GTDTask[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<GTDTask | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

    // Filters
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [activeFilters, setActiveFilters] = useState<FilterConfig[]>([]);

    // Quick Add
    const [quickAddOpen, setQuickAddOpen] = useState(false);
    const [quickAddDate, setQuickAddDate] = useState<Date | null>(null);
    const [quickAddTitle, setQuickAddTitle] = useState('');
    const [quickAddAllDay, setQuickAddAllDay] = useState(true);
    const [quickAddStartTime, setQuickAddStartTime] = useState<Date | null>(null);
    const [quickAddEndTime, setQuickAddEndTime] = useState<Date | null>(null);

    // Fetch data
    useEffect(() => {
        const fetchClients = async () => {
            const q = query(collection(db, 'clients'), orderBy('name'));
            const snap = await getDocs(q);
            setClients(snap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
        };
        fetchClients();
    }, []);

    useEffect(() => {
        if (!currentUser) return;
        const q = query(
            collection(db, 'gtd_tasks'),
            or(where('ownerId', '==', currentUser.uid), where('assigneeId', '==', currentUser.uid))
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GTDTask)).filter(t => t.dueDate || t.startDate);
            setTasks(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [currentUser]);

    // Helpers
    const getTaskDate = (task: GTDTask): Date | null => {
        const d = task.dueDate || task.startDate;
        if (!d) return null;
        if (typeof d === 'string') return parseISO(d);
        if ((d as any).toDate) return (d as any).toDate();
        return new Date(d as any);
    };

    const isOverdue = (task: GTDTask): boolean => {
        if (task.status === 'done') return false;
        const d = getTaskDate(task);
        if (!d || !isValid(d)) return false;
        return isBefore(startOfDay(d), startOfDay(new Date()));
    };

    // Filter Logic
    const filteredTasks = useMemo(() => {
        return tasks.filter(task => {
            if (activeFilters.length === 0) return true;
            return activeFilters.every(filter => {
                const { property, operator, value } = filter;
                if (!value) return true;
                let taskValue: any;
                switch (property) {
                    case 'status': taskValue = task.status; break;
                    case 'client': taskValue = task.clientId; break;
                    case 'priority': taskValue = task.priority || 'none'; break;
                    case 'assignee': taskValue = task.assigneeId; break;
                    default: return true;
                }
                switch (operator) {
                    case 'is': return taskValue === value;
                    case 'is_not': return taskValue !== value;
                    default: return true;
                }
            });
        });
    }, [tasks, activeFilters]);

    // Calendar Math
    const calendarDays = useMemo(() => {
        if (viewMode === 'day') return [currentDate];
        const start = viewMode === 'week' ? startOfWeek(currentDate) : startOfWeek(startOfMonth(currentDate));
        const end = viewMode === 'week' ? endOfWeek(currentDate) : endOfWeek(endOfMonth(currentDate));
        return eachDayOfInterval({ start, end });
    }, [currentDate, viewMode]);

    const getTasksForDay = (day: Date): GTDTask[] => {
        return filteredTasks.filter(t => {
            const d = getTaskDate(t);
            return d && isValid(d) && isSameDay(d, day);
        });
    };

    // Handlers
    const handlePrev = () => {
        if (viewMode === 'day') setCurrentDate(subDays(currentDate, 1));
        else if (viewMode === 'week') setCurrentDate(subWeeks(currentDate, 1));
        else setCurrentDate(subMonths(currentDate, 1));
    };
    const handleNext = () => {
        if (viewMode === 'day') setCurrentDate(addDays(currentDate, 1));
        else if (viewMode === 'week') setCurrentDate(addWeeks(currentDate, 1));
        else setCurrentDate(addMonths(currentDate, 1));
    };
    const handleToday = () => setCurrentDate(new Date());

    const handleQuickAdd = (day: Date, hour?: number) => {
        setQuickAddDate(day);
        setQuickAddTitle('');
        setQuickAddAllDay(hour === undefined);
        if (hour !== undefined) {
            setQuickAddStartTime(setHours(setMinutes(day, 0), hour));
            setQuickAddEndTime(setHours(setMinutes(day, 0), hour + 1));
        } else {
            setQuickAddStartTime(null);
            setQuickAddEndTime(null);
        }
        setQuickAddOpen(true);
    };

    const handleSaveQuickAdd = async () => {
        if (!quickAddTitle.trim() || !quickAddDate || !currentUser) return;

        let dueDateValue: string | Timestamp;
        if (quickAddAllDay || !quickAddStartTime) {
            dueDateValue = format(quickAddDate, 'yyyy-MM-dd');
        } else {
            // Combine date and time
            const combined = setHours(setMinutes(quickAddDate, getMinutes(quickAddStartTime)), getHours(quickAddStartTime));
            dueDateValue = Timestamp.fromDate(combined);
        }

        await addDoc(collection(db, 'gtd_tasks'), {
            title: quickAddTitle.trim(),
            status: 'inbox',
            dueDate: dueDateValue,
            ownerId: currentUser.uid,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        setQuickAddOpen(false);
    };

    // Drag & Drop Handler
    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setDraggedTaskId(null);

        if (!over || active.id === over.id) return;

        const taskId = active.id as string;
        const newDateStr = over.id as string;
        const newDate = parseISO(newDateStr);

        if (!isValid(newDate)) return;

        await updateDoc(doc(db, 'gtd_tasks', taskId), {
            dueDate: format(newDate, 'yyyy-MM-dd'),
            updatedAt: Timestamp.now()
        });
    };

    const handleExportICal = () => {
        let ical = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Profit Step//GTD Calendar//EN\n';
        filteredTasks.forEach(task => {
            const taskDate = getTaskDate(task);
            if (!taskDate || !isValid(taskDate)) return;
            const dtstart = format(taskDate, "yyyyMMdd");
            ical += `BEGIN:VEVENT\nDTSTART;VALUE=DATE:${dtstart}\nSUMMARY:${task.title.replace(/,/g, '\\,')}\nDESCRIPTION:Status: ${task.status}\nUID:${task.id}@profit-step\nEND:VEVENT\n`;
        });
        ical += 'END:VCALENDAR';
        const blob = new Blob([ical], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'gtd-tasks.ics'; a.click(); URL.revokeObjectURL(url);
    };

    if (loading) return <Box display="flex" justifyContent="center" height="100vh" alignItems="center"><CircularProgress /></Box>;

    // --- DAY VIEW RENDER ---
    const renderDayView = () => {
        const dayTasks = getTasksForDay(currentDate);
        const allDayTasks = dayTasks.filter(t => {
            const d = getTaskDate(t);
            return !d || typeof (t.dueDate) === 'string'; // All-day if stored as string
        });
        const timedTasks = dayTasks.filter(t => {
            const d = getTaskDate(t);
            return d && typeof (t.dueDate) !== 'string';
        });

        return (
            <Box flexGrow={1} overflow="auto">
                {/* All-day section */}
                {allDayTasks.length > 0 && (
                    <Box p={2} borderBottom="1px solid #E0E0E0" bgcolor="#FAFAFA">
                        <Typography variant="caption" color="text.secondary" fontWeight="600">ALL DAY</Typography>
                        <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                            {allDayTasks.map(task => (
                                <DraggableTask key={task.id} task={task} isOverdue={isOverdue(task)} onClick={() => { setSelectedTask(task); setIsDialogOpen(true); }} />
                            ))}
                        </Box>
                    </Box>
                )}

                {/* Timeline */}
                <Box display="flex" flexDirection="column">
                    {HOURS.map(hour => (
                        <Box
                            key={hour}
                            display="flex"
                            borderBottom="1px solid #F0F0F0"
                            minHeight={60}
                            onClick={() => handleQuickAdd(currentDate, hour)}
                            sx={{ cursor: 'pointer', '&:hover': { bgcolor: '#FAFAFA' } }}
                        >
                            <Box width={60} p={1} borderRight="1px solid #E0E0E0" textAlign="right">
                                <Typography variant="caption" color="text.secondary">
                                    {format(setHours(new Date(), hour), 'ha')}
                                </Typography>
                            </Box>
                            <Box flexGrow={1} p={0.5} display="flex" gap={0.5} flexWrap="wrap">
                                {timedTasks.filter(t => {
                                    const d = getTaskDate(t);
                                    return d && getHours(d) === hour;
                                }).map(task => (
                                    <DraggableTask key={task.id} task={task} isOverdue={isOverdue(task)} onClick={() => { setSelectedTask(task); setIsDialogOpen(true); }} />
                                ))}
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Box>
        );
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <DndContext collisionDetection={closestCenter} onDragStart={(e) => setDraggedTaskId(e.active.id as string)} onDragEnd={handleDragEnd}>
                <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#ffffff', color: '#37352F' }}>
                    {/* --- HEADER --- */}
                    <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #E0E0E0' }}>
                        <Box display="flex" alignItems="center" gap={2}>
                            <Typography variant="h6" fontWeight="600" sx={{ letterSpacing: '-0.02em', fontFamily: 'Inter, system-ui, sans-serif' }}>
                                Calendar
                            </Typography>

                            <Box display="flex" alignItems="center" bgcolor="#F7F7F5" borderRadius={1} px={0.5}>
                                <IconButton size="small" onClick={handlePrev}><ChevronLeftIcon fontSize="small" /></IconButton>
                                <Button onClick={handleToday} sx={{ color: '#37352F', textTransform: 'none', fontWeight: 500, minWidth: 'auto', px: 1.5 }}>Today</Button>
                                <IconButton size="small" onClick={handleNext}><ChevronRightIcon fontSize="small" /></IconButton>
                            </Box>

                            <Typography variant="body1" fontWeight="500" sx={{ minWidth: 180 }}>
                                {viewMode === 'day' ? format(currentDate, 'EEEE, MMM d, yyyy') : format(currentDate, 'MMMM yyyy')}
                            </Typography>
                        </Box>

                        <Box display="flex" alignItems="center" gap={1}>
                            {/* View Switcher: Month / Week / Day */}
                            <Box sx={{ border: '1px solid #E0E0E0', borderRadius: 1, display: 'flex', overflow: 'hidden' }}>
                                {(['month', 'week', 'day'] as ViewMode[]).map((mode, i) => (
                                    <React.Fragment key={mode}>
                                        {i > 0 && <Box sx={{ width: '1px', bgcolor: '#E0E0E0' }} />}
                                        <Button
                                            size="small"
                                            onClick={() => setViewMode(mode)}
                                            sx={{
                                                bgcolor: viewMode === mode ? '#F7F7F5' : 'transparent',
                                                color: '#37352F',
                                                textTransform: 'capitalize',
                                                borderRadius: 0,
                                                py: 0.5
                                            }}
                                        >
                                            {mode}
                                        </Button>
                                    </React.Fragment>
                                ))}
                            </Box>

                            <Button
                                startIcon={<FilterListIcon fontSize="small" sx={{ color: activeFilters.length ? '#2196f3' : 'inherit' }} />}
                                endIcon={<KeyboardArrowDownIcon fontSize="small" />}
                                onClick={(e) => setFilterAnchorEl(e.currentTarget)}
                                sx={{ color: activeFilters.length ? '#2196f3' : '#37352F', textTransform: 'none', fontWeight: 400, '&:hover': { bgcolor: '#F7F7F5' } }}
                            >
                                Filter {activeFilters.length > 0 && `(${activeFilters.length})`}
                            </Button>

                            <IconButton size="small" onClick={handleExportICal}><DownloadIcon fontSize="small" sx={{ color: '#9CA3AF' }} /></IconButton>
                        </Box>
                    </Box>

                    {/* --- CONTENT --- */}
                    {viewMode === 'day' ? renderDayView() : (
                        <Box display="flex" flexGrow={1} flexDirection="column" sx={{ overflow: 'hidden' }}>
                            {/* Weekday Headers */}
                            <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" borderBottom="1px solid #E0E0E0">
                                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                    <Box key={d} py={1} px={2} borderRight="1px solid #E0E0E0" sx={{ '&:last-child': { borderRight: 'none' } }}>
                                        <Typography variant="caption" fontWeight="600" color="#9CA3AF" sx={{ textTransform: 'uppercase' }}>{d}</Typography>
                                    </Box>
                                ))}
                            </Box>

                            {/* Grid */}
                            <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" flexGrow={1} sx={{ overflowY: 'auto' }}>
                                {calendarDays.map((day) => {
                                    const dayTasks = getTasksForDay(day);
                                    return (
                                        <DroppableDayCell
                                            key={day.toISOString()}
                                            day={day}
                                            onClick={() => handleQuickAdd(day)}
                                            isCurrentMonth={isSameMonth(day, currentDate)}
                                            isToday={isSameDay(day, new Date())}
                                            viewMode={viewMode}
                                        >
                                            {dayTasks.slice(0, 4).map(task => (
                                                <DraggableTask
                                                    key={task.id}
                                                    task={task}
                                                    isOverdue={isOverdue(task)}
                                                    onClick={() => { setSelectedTask(task); setIsDialogOpen(true); }}
                                                />
                                            ))}
                                            {dayTasks.length > 4 && (
                                                <Typography variant="caption" color="text.secondary" sx={{ cursor: 'pointer' }}>
                                                    +{dayTasks.length - 4} more
                                                </Typography>
                                            )}
                                        </DroppableDayCell>
                                    );
                                })}
                            </Box>
                        </Box>
                    )}

                    {/* Drag Overlay */}
                    <DragOverlay>
                        {draggedTaskId && (() => {
                            const task = tasks.find(t => t.id === draggedTaskId);
                            if (!task) return null;
                            const style = PASTEL_COLORS[task.status] || PASTEL_COLORS.inbox;
                            return (
                                <Box sx={{ bgcolor: style.bg, color: style.text, px: 1, py: 0.25, borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, boxShadow: 2 }}>
                                    {task.title}
                                </Box>
                            );
                        })()}
                    </DragOverlay>

                    {/* --- DIALOGS --- */}

                    {/* Filter Popover */}
                    <Popover open={Boolean(filterAnchorEl)} anchorEl={filterAnchorEl} onClose={() => setFilterAnchorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} PaperProps={{ sx: { borderRadius: 2, boxShadow: '0px 4px 24px rgba(0,0,0,0.1)' } }}>
                        <GTDFilterBuilder filters={activeFilters} onChange={setActiveFilters} clients={clients} />
                    </Popover>

                    {/* Quick Add Dialog with Time Picker */}
                    <Dialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} maxWidth="xs" fullWidth>
                        <DialogTitle sx={{ fontSize: '1rem' }}>New Task</DialogTitle>
                        <DialogContent>
                            <TextField
                                autoFocus
                                fullWidth
                                placeholder="Task title"
                                variant="standard"
                                value={quickAddTitle}
                                onChange={(e) => setQuickAddTitle(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSaveQuickAdd()}
                                sx={{ mt: 1 }}
                                InputProps={{ style: { fontSize: '1.25rem' } }}
                            />

                            <Box mt={2} display="flex" gap={1} alignItems="center">
                                <Chip label={quickAddDate ? format(quickAddDate, 'MMM d') : ''} size="small" icon={<AccessTimeIcon />} />
                                <FormControlLabel
                                    control={<Switch checked={quickAddAllDay} onChange={(e) => setQuickAddAllDay(e.target.checked)} size="small" />}
                                    label="All day"
                                />
                            </Box>

                            {!quickAddAllDay && (
                                <Box mt={2} display="flex" gap={2}>
                                    <TimePicker
                                        label="Start"
                                        value={quickAddStartTime}
                                        onChange={(v) => setQuickAddStartTime(v)}
                                        slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                    />
                                    <TimePicker
                                        label="End"
                                        value={quickAddEndTime}
                                        onChange={(v) => setQuickAddEndTime(v)}
                                        slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                    />
                                </Box>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setQuickAddOpen(false)} sx={{ color: '#9CA3AF' }}>Cancel</Button>
                            <Button onClick={handleSaveQuickAdd} variant="contained" disabled={!quickAddTitle.trim()} sx={{ bgcolor: '#37352F', '&:hover': { bgcolor: '#121212' } }}>Save</Button>
                        </DialogActions>
                    </Dialog>

                    {/* Task Edit Dialog */}
                    {selectedTask && (
                        <GTDEditDialog
                            open={isDialogOpen}
                            onClose={() => setIsDialogOpen(false)}
                            task={selectedTask}
                            onSave={async (id, data) => { await updateDoc(doc(db, 'gtd_tasks', id), data); setIsDialogOpen(false); }}
                            onDelete={async (id) => { await deleteDoc(doc(db, 'gtd_tasks', id)); setIsDialogOpen(false); }}
                        />
                    )}
                </Box>
            </DndContext>
        </LocalizationProvider>
    );
};

export default CalendarPage;
