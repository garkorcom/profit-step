/**
 * @fileoverview GTD Calendar - Google/Notion Style Redesign
 * 
 * Features:
 * - Minimalist aesthetics (White/Gray, Sharp borders)
 * - Notion-style pastel colors for tasks
 * - Google Calendar grid layout
 * - Advanced Notion-style Filtering (GTDFilterBuilder)
 * - functional: Quick Add, Week/Month view, iCal export
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
} from '@mui/material';
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
    parseISO,
    isValid,
    isBefore,
    startOfDay,
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

// --- VISUAL SYSTEM (Notion-like) ---

// Pastel Palette for Tasks
const PASTEL_COLORS: Record<GTDStatus, { bg: string; text: string }> = {
    inbox: { bg: '#F1F1EF', text: '#37352F' }, // Gray
    next_action: { bg: '#FBEDD6', text: '#4A3712' }, // Yellow/Orange
    projects: { bg: '#E3EFFD', text: '#183347' }, // Blue
    waiting: { bg: '#F9E6EC', text: '#4C2337' }, // Pink
    estimate: { bg: '#FDECC8', text: '#402C1B' }, // Brown/Orange
    someday: { bg: '#EFE9F5', text: '#302841' }, // Purple
    done: { bg: '#DBEDDB', text: '#1C3829' }, // Green
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
    const [viewMode, setViewMode] = useState<ViewMode>('month');

    // Filters State (Notion Style)
    const [filterAnchorEl, setFilterAnchorEl] = useState<null | HTMLElement>(null);
    const [activeFilters, setActiveFilters] = useState<FilterConfig[]>([]);

    // Quick Add state
    const [quickAddOpen, setQuickAddOpen] = useState(false);
    const [quickAddDate, setQuickAddDate] = useState<Date | null>(null);
    const [quickAddTitle, setQuickAddTitle] = useState('');

    // Day Detail Popup
    const [dayDetailOpen, setDayDetailOpen] = useState(false);
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);

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
                where('assigneeId', '==', currentUser.uid)
            )
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() } as GTDTask))
                .filter(t => t.dueDate || t.startDate);
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
                if (!value) return true; // checking type or emptiness? Let's assume non-empty string for now

                let taskValue: any;
                switch (property) {
                    case 'status':
                        taskValue = task.status;
                        break;
                    case 'client':
                        taskValue = task.clientId;
                        break;
                    case 'priority':
                        taskValue = task.priority || 'none';
                        break;
                    case 'assignee':
                        taskValue = task.assigneeId; // simplified
                        break;
                    default:
                        return true;
                }

                switch (operator) {
                    case 'is':
                        return taskValue === value;
                    case 'is_not':
                        return taskValue !== value;
                    // contains not implemented for enums/ids
                    default:
                        return true;
                }
            });
        });
    }, [tasks, activeFilters]);

    // Calendar Math
    const calendarDays = useMemo(() => {
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
    const handlePrev = () => setCurrentDate(viewMode === 'week' ? subWeeks(currentDate, 1) : subMonths(currentDate, 1));
    const handleNext = () => setCurrentDate(viewMode === 'week' ? addWeeks(currentDate, 1) : addMonths(currentDate, 1));
    const handleToday = () => setCurrentDate(new Date());

    const handleQuickAdd = (day: Date) => {
        setQuickAddDate(day);
        setQuickAddTitle('');
        setQuickAddOpen(true);
    };

    const handleSaveQuickAdd = async () => {
        if (!quickAddTitle.trim() || !quickAddDate || !currentUser) return;
        await addDoc(collection(db, 'gtd_tasks'), {
            title: quickAddTitle.trim(),
            status: 'inbox',
            dueDate: format(quickAddDate, 'yyyy-MM-dd'),
            ownerId: currentUser.uid,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
        setQuickAddOpen(false);
    };

    const handleExportICal = () => {
        let ical = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Profit Step//GTD Calendar//EN\n';
        filteredTasks.forEach(task => { // Export filtered tasks
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

    return (
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

                    <Typography variant="body1" fontWeight="500" sx={{ minWidth: 140 }}>
                        {format(currentDate, 'MMMM yyyy')}
                    </Typography>
                </Box>

                <Box display="flex" alignItems="center" gap={1}>
                    {/* View Switcher */}
                    <Box sx={{ border: '1px solid #E0E0E0', borderRadius: 1, display: 'flex', overflow: 'hidden' }}>
                        <Button size="small" onClick={() => setViewMode('month')} sx={{ bgcolor: viewMode === 'month' ? '#F7F7F5' : 'transparent', color: '#37352F', textTransform: 'none', borderRadius: 0, py: 0.5 }}>Month</Button>
                        <Box sx={{ width: '1px', bgcolor: '#E0E0E0' }} />
                        <Button size="small" onClick={() => setViewMode('week')} sx={{ bgcolor: viewMode === 'week' ? '#F7F7F5' : 'transparent', color: '#37352F', textTransform: 'none', borderRadius: 0, py: 0.5 }}>Week</Button>
                    </Box>

                    {/* Filter Button */}
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

            {/* --- GRID --- */}
            <Box display="flex" flexGrow={1} flexDirection="column" sx={{ overflow: 'hidden' }}>
                <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" borderBottom="1px solid #E0E0E0">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <Box key={day} py={1} px={2} borderRight="1px solid #E0E0E0" sx={{ '&:last-child': { borderRight: 'none' } }}>
                            <Typography variant="caption" fontWeight="600" color="#9CA3AF" sx={{ textTransform: 'uppercase' }}>{day}</Typography>
                        </Box>
                    ))}
                </Box>

                <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" flexGrow={1} sx={{ overflowY: 'auto' }}>
                    {calendarDays.map((day, i) => {
                        const isToday = isSameDay(day, new Date());
                        const isCurrentMonth = isSameMonth(day, currentDate);
                        const dayTasks = getTasksForDay(day);

                        return (
                            <Box
                                key={day.toISOString()}
                                onClick={() => handleQuickAdd(day)}
                                sx={{
                                    borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid #E0E0E0',
                                    borderBottom: '1px solid #E0E0E0',
                                    bgcolor: isCurrentMonth ? '#FFFFFF' : '#FAFAFA',
                                    minHeight: viewMode === 'week' ? 300 : 120,
                                    p: 1,
                                    cursor: 'pointer',
                                    transition: 'background 0.1s',
                                    '&:hover': { bgcolor: '#F7F7F5' }
                                }}
                            >
                                <Box display="flex" justifyContent="space-between" mb={1}>
                                    <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: isToday ? '#EB5757' : 'transparent', color: isToday ? 'white' : (isCurrentMonth ? '#37352F' : '#D1D5DB'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: isToday ? '600' : '400' }}>
                                        {format(day, 'd')}
                                    </Box>
                                    {dayTasks.length > 4 && (
                                        <Typography variant="caption" color="text.secondary" onClick={(e) => { e.stopPropagation(); setSelectedDay(day); setDayDetailOpen(true); }} sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                                            {dayTasks.length} items
                                        </Typography>
                                    )}
                                </Box>

                                <Box display="flex" flexDirection="column" gap={0.5}>
                                    {dayTasks.slice(0, 4).map(task => {
                                        const overdue = isOverdue(task);
                                        const style = PASTEL_COLORS[task.status] || PASTEL_COLORS.inbox;
                                        return (
                                            <Box
                                                key={task.id}
                                                onClick={(e) => { e.stopPropagation(); setSelectedTask(task); setIsDialogOpen(true); }}
                                                sx={{
                                                    bgcolor: overdue ? '#FFF1F0' : style.bg,
                                                    color: overdue ? '#D83A3A' : style.text,
                                                    borderRadius: '4px',
                                                    px: 0.75, py: 0.25,
                                                    fontSize: '0.75rem', fontWeight: 500,
                                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    display: 'flex', alignItems: 'center', gap: 0.5,
                                                    transition: 'all 0.1s',
                                                    '&:hover': { filter: 'brightness(0.97)', transform: 'translateY(-1px)' }
                                                }}
                                            >
                                                {overdue && <WarningIcon sx={{ fontSize: 12, color: 'inherit' }} />}
                                                {task.title}
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            </Box>

            {/* Filter Menu Popover */}
            <Popover
                open={Boolean(filterAnchorEl)}
                anchorEl={filterAnchorEl}
                onClose={() => setFilterAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{ sx: { borderRadius: 2, boxShadow: '0px 4px 24px rgba(0,0,0,0.1)' } }}
            >
                <GTDFilterBuilder filters={activeFilters} onChange={setActiveFilters} clients={clients} />
            </Popover>

            {/* Quick Add Dialog */}
            <Dialog open={quickAddOpen} onClose={() => setQuickAddOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ fontSize: '1rem' }}>New Event</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth placeholder="Untitled" variant="standard" value={quickAddTitle} onChange={(e) => setQuickAddTitle(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSaveQuickAdd()} sx={{ mt: 1 }} InputProps={{ style: { fontSize: '1.25rem' } }} />
                    <Box mt={2} display="flex" gap={1}>
                        <Chip label={quickAddDate ? format(quickAddDate, 'MMM d') : ''} size="small" />
                        <Chip label="Inbox" size="small" />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setQuickAddOpen(false)} sx={{ color: '#9CA3AF' }}>Cancel</Button>
                    <Button onClick={handleSaveQuickAdd} variant="contained" disabled={!quickAddTitle.trim()} sx={{ bgcolor: '#37352F', '&:hover': { bgcolor: '#121212' } }}>Save</Button>
                </DialogActions>
            </Dialog>

            {/* Day Detail Dialog */}
            <Dialog open={dayDetailOpen} onClose={() => setDayDetailOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{selectedDay && format(selectedDay, 'EEEE, MMM d')}</DialogTitle>
                <DialogContent>
                    <List>
                        {selectedDay && getTasksForDay(selectedDay).map(task => (
                            <ListItemButton key={task.id} onClick={() => { setDayDetailOpen(false); setSelectedTask(task); setIsDialogOpen(true); }}>
                                <ListItemIcon><AccessTimeIcon fontSize="small" /></ListItemIcon>
                                <ListItemText primary={task.title} secondary={task.status} />
                            </ListItemButton>
                        ))}
                    </List>
                </DialogContent>
            </Dialog>

            {/* Task Edit Dialog */}
            {selectedTask && (
                <GTDEditDialog open={isDialogOpen} onClose={() => setIsDialogOpen(false)} task={selectedTask} onSave={async (id, data) => { await updateDoc(doc(db, 'gtd_tasks', id), data); setIsDialogOpen(false); }} onDelete={async (id) => { await deleteDoc(doc(db, 'gtd_tasks', id)); setIsDialogOpen(false); }} />
            )}
        </Box>
    );
};

export default CalendarPage;
