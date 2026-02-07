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
import { useSearchParams } from 'react-router-dom';
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
    useTheme,
    useMediaQuery,
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

type ViewMode = 'month' | 'week' | 'day' | 'list';

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
const DroppableDayCell: React.FC<{
    day: Date;
    children: React.ReactNode;
    onClick: () => void;
    isCurrentMonth: boolean;
    isToday: boolean;
    viewMode: ViewMode;
    taskCount?: number;
    onShowMore?: (event: React.MouseEvent<HTMLElement>) => void;
}> =
    ({ day, children, onClick, isCurrentMonth, isToday, viewMode, taskCount = 0, onShowMore }) => {
        const { isOver, setNodeRef } = useDroppable({ id: day.toISOString() });

        // Fixed heights based on view mode
        const cellHeight = viewMode === 'week' ? 200 : 110;
        const maxVisibleTasks = viewMode === 'week' ? 5 : 3;

        return (
            <Box
                ref={setNodeRef}
                onClick={onClick}
                sx={{
                    borderRight: '1px solid #E0E0E0',
                    borderBottom: '1px solid #E0E0E0',
                    bgcolor: isOver ? '#E3F2FD' : (isCurrentMonth ? '#FFFFFF' : '#FAFAFA'),
                    height: cellHeight,
                    minHeight: cellHeight,
                    maxHeight: cellHeight,
                    p: 1,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    overflow: 'hidden',
                    position: 'relative',
                    '&:hover': { bgcolor: '#F7F7F5' },
                }}
            >
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                    <Box sx={{
                        width: 22, height: 22, borderRadius: '50%',
                        bgcolor: isToday ? '#EB5757' : 'transparent',
                        color: isToday ? 'white' : (isCurrentMonth ? '#37352F' : '#D1D5DB'),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontWeight: isToday ? '600' : '400'
                    }}>
                        {format(day, 'd')}
                    </Box>
                </Box>
                <Box display="flex" flexDirection="column" gap={0.25} sx={{ overflow: 'hidden' }}>
                    {children}
                </Box>
            </Box>
        );
    };

// --- HOURS FOR DAY VIEW ---
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CalendarPage: React.FC = () => {
    const { currentUser } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [searchParams] = useSearchParams();

    const [currentDate, setCurrentDate] = useState(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            const parsed = parseISO(dateParam);
            if (isValid(parsed)) return parsed;
        }
        return new Date();
    });
    const [tasks, setTasks] = useState<GTDTask[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTask, setSelectedTask] = useState<GTDTask | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    // View Mode State
    // We'll initialize based on device type in useEffect or use a derived default if not set
    const [viewMode, setViewMode] = useState<ViewMode>('month');

    // Effect to set default view for mobile
    useEffect(() => {
        if (isMobile) {
            setViewMode('list');
        } else {
            setViewMode('month');
        }
    }, [isMobile]);

    const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

    // Filters
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [activeFilters, setActiveFilters] = useState<FilterConfig[]>([]);

    // Day Popover (for showing all tasks on a day)
    const [dayPopoverOpen, setDayPopoverOpen] = useState(false);
    const [selectedDayTasks, setSelectedDayTasks] = useState<GTDTask[]>([]);
    const [selectedDayDate, setSelectedDayDate] = useState<Date | null>(null);

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
            or(
                where('ownerId', '==', currentUser.uid),
                where('assigneeId', '==', currentUser.uid),
                where('coAssigneeIds', 'array-contains', currentUser.uid)
            )
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GTDTask));
            // Show all tasks - use createdAt as fallback date if no dueDate/startDate
            setTasks(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [currentUser]);

    // Helpers - priority: dueDate > startDate > createdAt
    const getTaskDate = (task: GTDTask): Date | null => {
        const d = task.dueDate || task.startDate || task.createdAt;
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
        // For list view, we behave like 'month' or 'week'? 
        // Let's iterate the current month for List View to show a schedule
        if (viewMode === 'list') {
            const start = startOfMonth(currentDate);
            const end = endOfMonth(currentDate);
            return eachDayOfInterval({ start, end });
        }
        const start = viewMode === 'week' ? startOfWeek(currentDate, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
        const end = viewMode === 'week' ? endOfWeek(currentDate, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
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
        else setCurrentDate(subMonths(currentDate, 1)); // Month & List move by month
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
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
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

    // --- LIST VIEW RENDER (MOBILE) ---
    const renderListView = () => {
        // Filter out empty days to show a cleaner list, "Agenda" style
        // Or show all days? Agenda usually skips empty days. 
        // Let's show all days that match the search/month, but maybe highlight today.
        // Actually, for "List View" usually we just show days with tasks or consecutive days.
        // Let's stick to showing the whole month but compact.

        return (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, py: 1 }}>
                {calendarDays.map(day => {
                    const dayTasks = getTasksForDay(day);
                    if (dayTasks.length === 0) return null; // Skip empty days for cleaner mobile view? Or keep?
                    // Let's keep empty days IF it's "today". Otherwise skip? 
                    // Common pattern: Show header for day, then list items.

                    const isToday = isSameDay(day, new Date());

                    return (
                        <Box key={day.toISOString()} mb={2}>
                            <Box display="flex" alignItems="center" gap={1} mb={1} sx={{ opacity: isToday ? 1 : 0.7 }}>
                                <Typography variant="body1" fontWeight={isToday ? 700 : 600} color={isToday ? 'primary.main' : 'text.primary'}>
                                    {format(day, 'd MMM')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {format(day, 'EEEE')}
                                </Typography>
                                {isToday && <Chip label="Today" size="small" color="primary" sx={{ height: 20, fontSize: '0.65rem' }} />}
                            </Box>

                            <Box display="flex" flexDirection="column" gap={1}>
                                {dayTasks.map(task => {
                                    const style = PASTEL_COLORS[task.status] || PASTEL_COLORS.inbox;
                                    const taskTime = getTaskDate(task);
                                    const timeStr = taskTime && typeof task.dueDate !== 'string' ? format(taskTime, 'HH:mm') : 'All Day';

                                    return (
                                        <Box
                                            key={task.id}
                                            onClick={() => { setSelectedTask(task); setIsDialogOpen(true); }}
                                            sx={{
                                                bgcolor: 'white',
                                                border: '1px solid #E0E0E0',
                                                borderRadius: 2,
                                                p: 1.5,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1.5,
                                                boxShadow: '0px 2px 4px rgba(0,0,0,0.02)'
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    minWidth: 4,
                                                    height: 32,
                                                    borderRadius: 1,
                                                    bgcolor: style.bg
                                                }}
                                            />
                                            <Box flexGrow={1}>
                                                <Typography variant="body2" fontWeight={500}>{task.title}</Typography>
                                                <Box display="flex" alignItems="center" gap={1}>
                                                    <Typography variant="caption" color="text.secondary">{timeStr}</Typography>
                                                    {task.clientName && (
                                                        <Chip label={task.clientName} size="small" sx={{ height: 16, fontSize: '0.65rem' }} />
                                                    )}
                                                </Box>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                    );
                })}

                {/* Empty State for Month */}
                {filteredTasks.filter(t => isSameMonth(getTaskDate(t) || new Date(), currentDate)).length === 0 && (
                    <Box display="flex" justifyContent="center" py={4}>
                        <Typography variant="body2" color="text.secondary">No tasks for this month</Typography>
                    </Box>
                )}

                {/* Floating Action Button for Mobile */}
                {/* We already have quick add on cell click, but on mobile maybe a FAB? 
                     For now, user can click "Add" in header or we add a FAB. 
                     Header "Add" is good enough or we can rely on Header.
                 */}
            </Box>
        );
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <DndContext collisionDetection={closestCenter} onDragStart={(e) => setDraggedTaskId(e.active.id as string)} onDragEnd={handleDragEnd}>
                <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    minHeight: 0,
                    bgcolor: '#ffffff',
                    color: '#37352F',
                    overflow: 'hidden'
                }}>
                    {/* --- HEADER --- */}
                    <Box sx={{
                        px: 2,
                        py: 1.5,
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        alignItems: isMobile ? 'stretch' : 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #E0E0E0',
                        gap: isMobile ? 2 : 0
                    }}>
                        {/* Top Row (Mobile): Title + Navigation */}
                        <Box display="flex" alignItems="center" justifyContent="space-between" width={isMobile ? '100%' : 'auto'}>
                            <Box display="flex" alignItems="center" gap={1}>
                                <Typography variant="h6" fontWeight="600" sx={{ letterSpacing: '-0.02em', fontFamily: 'Inter, system-ui, sans-serif' }}>
                                    {isMobile ? format(currentDate, 'MMMM') : 'Calendar'}
                                </Typography>
                                {!isMobile && (
                                    <Typography variant="body1" fontWeight="500" sx={{ minWidth: 160, ml: 2 }}>
                                        {viewMode === 'day' ? format(currentDate, 'EEEE, MMM d') : format(currentDate, 'MMMM yyyy')}
                                    </Typography>
                                )}
                            </Box>

                            <Box display="flex" alignItems="center" bgcolor="#F7F7F5" borderRadius={1} px={0.5}>
                                <IconButton size="small" onClick={handlePrev}><ChevronLeftIcon fontSize="small" /></IconButton>
                                <Button onClick={handleToday} sx={{ color: '#37352F', textTransform: 'none', fontWeight: 500, minWidth: 'auto', px: 1.5 }}>
                                    {isMobile ? 'T' : 'Today'}
                                </Button>
                                <IconButton size="small" onClick={handleNext}><ChevronRightIcon fontSize="small" /></IconButton>
                            </Box>
                        </Box>

                        {/* Bottom Row (Mobile) or Right Side (Desktop): Controls */}
                        <Box display="flex" alignItems="center" gap={1} justifyContent={isMobile ? 'space-between' : 'flex-end'} width={isMobile ? '100%' : 'auto'}>
                            {/* View Switcher */}
                            <Box sx={{ border: '1px solid #E0E0E0', borderRadius: 1, display: 'flex', overflow: 'hidden' }}>
                                {(isMobile ? ['list', 'day', 'month'] : ['month', 'week', 'day']).map((mode, i) => (
                                    <React.Fragment key={mode}>
                                        {i > 0 && <Box sx={{ width: '1px', bgcolor: '#E0E0E0' }} />}
                                        <Button
                                            size="small"
                                            onClick={() => setViewMode(mode as ViewMode | 'list')}
                                            sx={{
                                                bgcolor: viewMode === mode ? '#F7F7F5' : 'transparent',
                                                color: '#37352F',
                                                textTransform: 'capitalize',
                                                borderRadius: 0,
                                                py: 0.5,
                                                px: isMobile ? 2 : 1.5,
                                                fontSize: isMobile ? '0.75rem' : '0.875rem'
                                            }}
                                        >
                                            {mode}
                                        </Button>
                                    </React.Fragment>
                                ))}
                            </Box>

                            <Box display="flex" gap={0.5}>
                                <Button
                                    size={isMobile ? "small" : "medium"}
                                    startIcon={<FilterListIcon fontSize="small" sx={{ color: activeFilters.length ? '#2196f3' : 'inherit' }} />}
                                    onClick={(e) => setFilterAnchorEl(e.currentTarget)}
                                    sx={{
                                        color: activeFilters.length ? '#2196f3' : '#37352F',
                                        textTransform: 'none',
                                        fontWeight: 400,
                                        '&:hover': { bgcolor: '#F7F7F5' },
                                        minWidth: isMobile ? 'auto' : 64
                                    }}
                                >
                                    {!isMobile && 'Filter'}
                                    {activeFilters.length > 0 && ` (${activeFilters.length})`}
                                </Button>

                                {!isMobile && (
                                    <IconButton size="small" onClick={handleExportICal}><DownloadIcon fontSize="small" sx={{ color: '#9CA3AF' }} /></IconButton>
                                )}

                                <IconButton size="small" onClick={() => handleQuickAdd(new Date(), 9)} sx={{ bgcolor: '#37352F', color: 'white', '&:hover': { bgcolor: '#121212' } }}>
                                    <AddIcon fontSize="small" />
                                </IconButton>
                            </Box>
                        </Box>
                    </Box>

                    {/* --- CONTENT --- */}
                    {viewMode === 'list' ? renderListView() : viewMode === 'day' ? renderDayView() : (
                        <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                            {/* Weekday Headers (Sticky) */}
                            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                                <Box
                                    key={d}
                                    py={1}
                                    px={2}
                                    borderRight="1px solid #E0E0E0"
                                    borderBottom="1px solid #E0E0E0"
                                    bgcolor="white"
                                    sx={{
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 10,
                                        '&:last-child': { borderRight: 'none' } // Actually inside a grid, last col might differ, but border logic repeats
                                    }}
                                >
                                    <Typography variant="caption" fontWeight="600" color="#9CA3AF" sx={{ textTransform: 'uppercase', fontSize: isMobile ? '0.65rem' : '0.75rem' }}>
                                        {isMobile ? d.charAt(0) : d}
                                    </Typography>
                                </Box>
                            ))}

                            {/* Grid Days */}
                            {calendarDays.map((day) => {
                                const dayTasks = getTasksForDay(day);
                                const maxVisible = isMobile ? 2 : 3;
                                const hasMore = dayTasks.length > maxVisible;

                                return (
                                    <DroppableDayCell
                                        key={day.toISOString()}
                                        day={day}
                                        onClick={() => handleQuickAdd(day)}
                                        isCurrentMonth={isSameMonth(day, currentDate)}
                                        isToday={isSameDay(day, new Date())}
                                        viewMode={viewMode as ViewMode}
                                        taskCount={dayTasks.length}
                                    >
                                        {dayTasks.slice(0, maxVisible).map(task => (
                                            <DraggableTask
                                                key={task.id}
                                                task={task}
                                                isOverdue={isOverdue(task)}
                                                onClick={() => { setSelectedTask(task); setIsDialogOpen(true); }}
                                            />
                                        ))}
                                        {hasMore && (
                                            <Typography
                                                variant="caption"
                                                color="primary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    // Show all tasks for this day in a dialog
                                                    setSelectedDayTasks(dayTasks);
                                                    setSelectedDayDate(day);
                                                    setDayPopoverOpen(true);
                                                }}
                                                sx={{
                                                    cursor: 'pointer',
                                                    fontWeight: 500,
                                                    '&:hover': { textDecoration: 'underline' }
                                                }}
                                            >
                                                +{dayTasks.length - maxVisible} ещё
                                            </Typography>
                                        )}
                                    </DroppableDayCell>
                                );
                            })}
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
                                        onChange={(v) => setQuickAddStartTime(v ? (v as any).toDate?.() ?? v : null)}
                                        slotProps={{ textField: { size: 'small', fullWidth: true } }}
                                    />
                                    <TimePicker
                                        label="End"
                                        value={quickAddEndTime}
                                        onChange={(v) => setQuickAddEndTime(v ? (v as any).toDate?.() ?? v : null)}
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

                    {/* Day Popover - All Tasks for a Day */}
                    <Dialog
                        open={dayPopoverOpen}
                        onClose={() => setDayPopoverOpen(false)}
                        maxWidth="xs"
                        fullWidth
                    >
                        <DialogTitle sx={{ pb: 1 }}>
                            {selectedDayDate && format(selectedDayDate, 'EEEE, d MMMM')}
                        </DialogTitle>
                        <DialogContent sx={{ pt: 0 }}>
                            <List dense>
                                {selectedDayTasks.map(task => {
                                    const style = PASTEL_COLORS[task.status] || PASTEL_COLORS.inbox;
                                    return (
                                        <ListItemButton
                                            key={task.id}
                                            onClick={() => {
                                                setDayPopoverOpen(false);
                                                setSelectedTask(task);
                                                setIsDialogOpen(true);
                                            }}
                                            sx={{ borderRadius: 1, mb: 0.5 }}
                                        >
                                            <ListItemIcon sx={{ minWidth: 28 }}>
                                                <Box sx={{
                                                    width: 8,
                                                    height: 24,
                                                    borderRadius: 1,
                                                    bgcolor: style.bg,
                                                }} />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={task.title}
                                                secondary={task.clientName}
                                                primaryTypographyProps={{ fontWeight: 500, fontSize: '0.9rem' }}
                                                secondaryTypographyProps={{ fontSize: '0.75rem' }}
                                            />
                                            {task.priority === 'high' && (
                                                <WarningIcon fontSize="small" sx={{ color: '#ef4444' }} />
                                            )}
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        </DialogContent>
                    </Dialog>
                </Box>
            </DndContext>
        </LocalizationProvider>
    );
};

export default CalendarPage;
