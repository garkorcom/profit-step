import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    IconButton,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    TextField,
    Chip,
    FormControlLabel,
    Switch,
    useTheme,
    useMediaQuery,
    CircularProgress,
    Popover,
} from '@mui/material';
import { LocalizationProvider, TimePicker } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
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

import { useAuth } from '../../../auth/AuthContext';
import { useTaskList } from '../../../hooks/useTasktotime';
import { TaskDto, TaskLifecycle } from '../../../api/tasktotimeApi';

// --- PASTEL COLORS ---
const PASTEL_COLORS: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#F1F1EF', text: '#37352F' },
    ready: { bg: '#FBEDD6', text: '#4A3712' },
    started: { bg: '#E3EFFD', text: '#183347' },
    blocked: { bg: '#F9E6EC', text: '#4C2337' },
    completed: { bg: '#DBEDDB', text: '#1C3829' },
    accepted: { bg: '#D1E8E2', text: '#1A4D2E' },
    cancelled: { bg: '#F2F2F2', text: '#808080' },
};

type ViewMode = 'month' | 'week' | 'day' | 'list';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const CalendarPage: React.FC = () => {
    const { currentUser, currentCompany } = useAuth();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [currentDate, setCurrentDate] = useState(() => {
        const dateParam = searchParams.get('date');
        if (dateParam) {
            const parsed = parseISO(dateParam);
            if (isValid(parsed)) return parsed;
        }
        return new Date();
    });

    const [viewMode, setViewMode] = useState<ViewMode>('month');

    useEffect(() => {
        if (isMobile) {
            setViewMode('list');
        } else {
            setViewMode('month');
        }
    }, [isMobile]);

    // We'll fetch all tasks for the calendar view (in a real app you might want to paginate or filter by date range)
    const { tasks, loading } = useTaskList(
        currentCompany ? { companyId: currentCompany.id, limit: 1000 } : null
    );

    const getTaskDate = (task: TaskDto): Date | null => {
        const timestamp = task.dueAt || task.plannedStartAt || task.createdAt;
        if (!timestamp) return null;
        return new Date(timestamp);
    };

    const isOverdue = (task: TaskDto): boolean => {
        if (task.lifecycle === 'completed' || task.lifecycle === 'accepted' || task.lifecycle === 'cancelled') return false;
        const d = getTaskDate(task);
        if (!d || !isValid(d)) return false;
        return isBefore(startOfDay(d), startOfDay(new Date()));
    };

    const filteredTasks = useMemo(() => {
        // Here you would apply any additional filters (e.g. by assignee, bucket, etc.)
        return tasks;
    }, [tasks]);

    const calendarDays = useMemo(() => {
        if (viewMode === 'day') return [currentDate];
        if (viewMode === 'list') {
            const start = startOfMonth(currentDate);
            const end = endOfMonth(currentDate);
            return eachDayOfInterval({ start, end });
        }
        const start = viewMode === 'week' ? startOfWeek(currentDate, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
        const end = viewMode === 'week' ? endOfWeek(currentDate, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
        return eachDayOfInterval({ start, end });
    }, [currentDate, viewMode]);

    const getTasksForDay = (day: Date): TaskDto[] => {
        return filteredTasks.filter(t => {
            const d = getTaskDate(t);
            return d && isValid(d) && isSameDay(d, day);
        });
    };

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

    const handleTaskClick = (task: TaskDto) => {
        // Navigate to detail page
        navigate(`/crm/tasktotime/tasks/${task.id}`);
    };

    // --- DAY VIEW RENDER ---
    const renderDayView = () => {
        const dayTasks = getTasksForDay(currentDate);
        // For simplicity, treat tasks without a specific hour as "all day" (e.g. dueAt is set to start of day)
        // In a real implementation you'd check if it's an exact time vs a date-only field
        const allDayTasks = dayTasks.filter(t => {
            const d = getTaskDate(t);
            return d && getHours(d) === 0 && getMinutes(d) === 0;
        });
        const timedTasks = dayTasks.filter(t => {
            const d = getTaskDate(t);
            return d && (getHours(d) !== 0 || getMinutes(d) !== 0);
        });

        return (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {allDayTasks.length > 0 && (
                    <Box p={2} borderBottom="1px solid #E0E0E0" bgcolor="#FAFAFA">
                        <Typography variant="caption" color="text.secondary" fontWeight="600">ALL DAY</Typography>
                        <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
                            {allDayTasks.map(task => {
                                const style = PASTEL_COLORS[task.lifecycle] || PASTEL_COLORS.draft;
                                return (
                                    <Box
                                        key={task.id}
                                        onClick={() => handleTaskClick(task)}
                                        sx={{
                                            bgcolor: isOverdue(task) ? '#FFF1F0' : style.bg,
                                            color: isOverdue(task) ? '#D83A3A' : style.text,
                                            borderRadius: '4px',
                                            px: 0.75, py: 0.25,
                                            fontSize: '0.75rem', fontWeight: 500,
                                            cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 0.5,
                                            '&:hover': { filter: 'brightness(0.97)', transform: 'translateY(-1px)' }
                                        }}
                                    >
                                        {isOverdue(task) && <WarningIcon sx={{ fontSize: 12, color: 'inherit' }} />}
                                        {task.title}
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                )}

                <Box display="flex" flexDirection="column">
                    {HOURS.map(hour => (
                        <Box
                            key={hour}
                            display="flex"
                            borderBottom="1px solid #F0F0F0"
                            minHeight={60}
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
                                }).map(task => {
                                    const style = PASTEL_COLORS[task.lifecycle] || PASTEL_COLORS.draft;
                                    return (
                                        <Box
                                            key={task.id}
                                            onClick={() => handleTaskClick(task)}
                                            sx={{
                                                bgcolor: isOverdue(task) ? '#FFF1F0' : style.bg,
                                                color: isOverdue(task) ? '#D83A3A' : style.text,
                                                borderRadius: '4px',
                                                px: 0.75, py: 0.25,
                                                fontSize: '0.75rem', fontWeight: 500,
                                                cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', gap: 0.5,
                                                '&:hover': { filter: 'brightness(0.97)', transform: 'translateY(-1px)' }
                                            }}
                                        >
                                            {isOverdue(task) && <WarningIcon sx={{ fontSize: 12, color: 'inherit' }} />}
                                            {task.title}
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Box>
        );
    };

    // --- LIST VIEW RENDER (MOBILE) ---
    const renderListView = () => {
        return (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 2, py: 1 }}>
                {calendarDays.map(day => {
                    const dayTasks = getTasksForDay(day);
                    if (dayTasks.length === 0) return null;

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
                                    const style = PASTEL_COLORS[task.lifecycle] || PASTEL_COLORS.draft;
                                    const taskTime = getTaskDate(task);
                                    const timeStr = taskTime ? format(taskTime, 'HH:mm') : '';

                                    return (
                                        <Box
                                            key={task.id}
                                            onClick={() => handleTaskClick(task)}
                                            sx={{
                                                bgcolor: 'white',
                                                border: '1px solid #E0E0E0',
                                                borderRadius: 2,
                                                p: 1.5,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 1.5,
                                                boxShadow: '0px 2px 4px rgba(0,0,0,0.02)',
                                                cursor: 'pointer'
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
                                                    {task.projectName && (
                                                        <Chip label={task.projectName} size="small" sx={{ height: 16, fontSize: '0.65rem' }} />
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

                {filteredTasks.filter(t => isSameMonth(getTaskDate(t) || new Date(), currentDate)).length === 0 && (
                    <Box display="flex" justifyContent="center" py={4}>
                        <Typography variant="body2" color="text.secondary">No tasks for this month</Typography>
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
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

                    <Box display="flex" alignItems="center" gap={1} justifyContent={isMobile ? 'space-between' : 'flex-end'} width={isMobile ? '100%' : 'auto'}>
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
                    </Box>
                </Box>

                {/* --- CONTENT --- */}
                {loading ? (
                    <Box display="flex" justifyContent="center" py={4}>
                        <CircularProgress />
                    </Box>
                ) : viewMode === 'list' ? renderListView() : viewMode === 'day' ? renderDayView() : (
                    <Box display="grid" gridTemplateColumns="repeat(7, 1fr)" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                                    '&:last-child': { borderRight: 'none' }
                                }}
                            >
                                <Typography variant="caption" fontWeight="600" color="#9CA3AF" sx={{ textTransform: 'uppercase', fontSize: isMobile ? '0.65rem' : '0.75rem' }}>
                                    {isMobile ? d.charAt(0) : d}
                                </Typography>
                            </Box>
                        ))}

                        {calendarDays.map((day) => {
                            const dayTasks = getTasksForDay(day);
                            const maxVisible = isMobile ? 2 : 4;
                            const hasMore = dayTasks.length > maxVisible;
                            const isCurrentMonth = isSameMonth(day, currentDate);
                            const isToday = isSameDay(day, new Date());
                            const cellHeight = viewMode === 'week' ? 200 : 120;

                            return (
                                <Box
                                    key={day.toISOString()}
                                    sx={{
                                        borderRight: '1px solid #E0E0E0',
                                        borderBottom: '1px solid #E0E0E0',
                                        bgcolor: isCurrentMonth ? '#FFFFFF' : '#FAFAFA',
                                        height: cellHeight,
                                        minHeight: cellHeight,
                                        maxHeight: cellHeight,
                                        p: 1,
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
                                        {dayTasks.slice(0, maxVisible).map(task => {
                                            const style = PASTEL_COLORS[task.lifecycle] || PASTEL_COLORS.draft;
                                            return (
                                                <Box
                                                    key={task.id}
                                                    onClick={() => handleTaskClick(task)}
                                                    sx={{
                                                        bgcolor: isOverdue(task) ? '#FFF1F0' : style.bg,
                                                        color: isOverdue(task) ? '#D83A3A' : style.text,
                                                        borderRadius: '4px',
                                                        px: 0.75, py: 0.25,
                                                        fontSize: '0.75rem', fontWeight: 500,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                        display: 'flex', alignItems: 'center', gap: 0.5,
                                                        cursor: 'pointer',
                                                        '&:hover': { filter: 'brightness(0.97)', transform: 'translateY(-1px)' }
                                                    }}
                                                >
                                                    {isOverdue(task) && <WarningIcon sx={{ fontSize: 12, color: 'inherit' }} />}
                                                    {task.title}
                                                </Box>
                                            );
                                        })}
                                        {hasMore && (
                                            <Typography
                                                variant="caption"
                                                color="primary"
                                                sx={{
                                                    cursor: 'pointer',
                                                    fontWeight: 500,
                                                    '&:hover': { textDecoration: 'underline' }
                                                }}
                                            >
                                                +{dayTasks.length - maxVisible} more
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>
        </LocalizationProvider>
    );
};

export default CalendarPage;
