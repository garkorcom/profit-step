/**
 * @fileoverview Premium Mobile-First GTD Task Creation Dialog
 * 
 * Features:
 * - Quick date chips (Сегодня, Завтра, Пн-Пт)
 * - Quick time presets (Утро, День, Вечер)
 * - Duration selector (1-7 дней)
 * - Crew size stepper with +/- buttons
 * - Auto-cost calculation from hours
 * - Progress bar for form completion
 * - Save & Add More with persistent fields
 * - Undo banner for quick reversal
 * - Client suggestions from recent
 * - Full-screen on mobile, dialog on desktop
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    Dialog,
    Box,
    Typography,
    TextField,
    Button,
    IconButton,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
    useTheme,
    useMediaQuery,
    InputAdornment,
    LinearProgress,
    Snackbar,
    Alert,
    Autocomplete,
    Paper,
    Slide,
} from '@mui/material';
import {
    Close as CloseIcon,
    Person as PersonIcon,
    People as PeopleIcon,
    Add as AddIcon,
    Remove as RemoveIcon,
    CalendarToday as CalendarIcon,
    AccessTime as TimeIcon,
    Mic as MicIcon,
    Clear as ClearIcon,
} from '@mui/icons-material';
import { format, addDays, startOfWeek, isToday, isTomorrow } from 'date-fns';
import { ru } from 'date-fns/locale';

import { GTDStatus, GTDPriority } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';

interface GTDQuickAddDialogProps {
    open: boolean;
    onClose: () => void;
    onAdd: (title: string, columnId: GTDStatus, clientId?: string, assigneeId?: string, priority?: GTDPriority) => void;
    targetColumn: GTDStatus;
    clients: Client[];
    users: UserProfile[];
}

// Helper: Generate quick date options
const getQuickDates = () => {
    const today = new Date();
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const dates = [];

    for (let i = 0; i < 7; i++) {
        const date = addDays(today, i);
        const dayName = days[date.getDay()];
        dates.push({
            id: i === 0 ? 'today' : i === 1 ? 'tomorrow' : dayName.toLowerCase(),
            label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : dayName,
            sub: format(date, 'd MMM', { locale: ru }),
            date: format(date, 'yyyy-MM-dd'),
            dateObj: date,
        });
    }
    return dates;
};

// Quick time presets
const QUICK_TIMES = [
    { id: 'morning', emoji: '🌅', time: '08:00', name: 'Утро' },
    { id: 'day', emoji: '☀️', time: '12:00', name: 'День' },
    { id: 'evening', emoji: '🌆', time: '17:00', name: 'Вечер' },
];

// Duration options
const DURATION_OPTIONS = [
    { days: 1, label: '1 день' },
    { days: 2, label: '2 дня' },
    { days: 3, label: '3 дня' },
    { days: 5, label: '5 дней' },
    { days: 7, label: '1 нед' },
];

// Hourly rate for auto-calculation
const HOURLY_RATE = 95;

const GTDQuickAddDialog: React.FC<GTDQuickAddDialogProps> = ({
    open,
    onClose,
    onAdd,
    targetColumn,
    clients,
    users,
}) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const scrollRef = useRef<HTMLDivElement>(null);

    // ═══════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════

    // Assignee
    const [assigneeType, setAssigneeType] = useState<'self' | 'employee'>('self');
    const [assigneeId, setAssigneeId] = useState('');

    // Client
    const [clientInput, setClientInput] = useState('');
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);

    // Task details
    const [description, setDescription] = useState('');
    const [crewSize, setCrewSize] = useState(2);
    const [hours, setHours] = useState('');
    const [cost, setCost] = useState('');

    // Planning
    const [selectedQuickDate, setSelectedQuickDate] = useState('today');
    const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [startTime, setStartTime] = useState('');
    const [durationMode, setDurationMode] = useState<'days' | 'date'>('days');
    const [durationDays, setDurationDays] = useState(1);
    const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [planningMode, setPlanningMode] = useState<'quick' | 'custom'>('quick');

    // UI State
    const [saving, setSaving] = useState(false);
    const [tasksCreated, setTasksCreated] = useState(0);
    const [showUndo, setShowUndo] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [showSuggestion, setShowSuggestion] = useState(false);

    // Priority (minimal, still available)
    const [priority, setPriority] = useState<GTDPriority>('none');

    // Quick dates memoized
    const quickDates = useMemo(() => getQuickDates(), []);

    // ═══════════════════════════════════════
    // COMPUTED
    // ═══════════════════════════════════════

    // Auto-calculated cost
    const estimatedCost = hours ? parseInt(hours) * crewSize * HOURLY_RATE : 0;

    // Suggested duration from hours
    const suggestedDuration = hours ? Math.ceil(parseInt(hours) / 8) : null;

    // Progress (for progress bar)
    const progress = useMemo(() => {
        const fields = [selectedClient, description, hours || cost, startDate];
        return fields.filter(Boolean).length;
    }, [selectedClient, description, hours, cost, startDate]);
    const progressPercent = (progress / 4) * 100;

    // ═══════════════════════════════════════
    // HANDLERS
    // ═══════════════════════════════════════

    const handleQuickDateSelect = (qd: typeof quickDates[0]) => {
        setSelectedQuickDate(qd.id);
        setStartDate(qd.date);
        setPlanningMode('quick');

        // Auto-update end date based on duration
        const newEnd = addDays(qd.dateObj, durationDays - 1);
        setEndDate(format(newEnd, 'yyyy-MM-dd'));
    };

    const handleDurationChange = (days: number) => {
        setDurationDays(days);
        const start = new Date(startDate);
        const end = addDays(start, days - 1);
        setEndDate(format(end, 'yyyy-MM-dd'));
    };

    const handleTimeSelect = (time: string) => {
        setStartTime(startTime === time ? '' : time);
    };

    const applySuggestion = () => {
        setCrewSize(3);
        setHours('8');
        setCost(String(8 * 3 * HOURLY_RATE));
        setShowSuggestion(false);
    };

    const handleSave = async (addMore: boolean) => {
        if (!description.trim()) return;

        setSaving(true);
        try {
            await onAdd(
                description.trim(),
                targetColumn,
                selectedClient?.id,
                assigneeType === 'employee' ? assigneeId : undefined,
                priority !== 'none' ? priority : undefined
            );

            if (addMore) {
                // Save & Add More
                setTasksCreated(prev => prev + 1);
                setShowUndo(true);
                setShowToast(true);

                // Haptic feedback
                if ('vibrate' in navigator) {
                    navigator.vibrate(50);
                }

                setTimeout(() => setShowToast(false), 2500);
                setTimeout(() => setShowUndo(false), 6000);

                // Reset non-persistent fields
                setDescription('');
                setHours('');
                setCost('');
                setAssigneeType('self');
                setAssigneeId('');
                setStartTime('');
                setPriority('none');

                // Scroll to top
                scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                handleClose();
            }
        } catch (error) {
            console.error('Failed to add task:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleClose = () => {
        // Reset all state
        setDescription('');
        setSelectedClient(null);
        setClientInput('');
        setCrewSize(2);
        setHours('');
        setCost('');
        setAssigneeType('self');
        setAssigneeId('');
        setSelectedQuickDate('today');
        setStartDate(format(new Date(), 'yyyy-MM-dd'));
        setStartTime('');
        setDurationDays(1);
        setPriority('none');
        setTasksCreated(0);
        setShowUndo(false);
        setShowSuggestion(false);
        onClose();
    };

    // Reset on open
    useEffect(() => {
        if (open) {
            setSelectedQuickDate('today');
            setStartDate(format(new Date(), 'yyyy-MM-dd'));
        }
    }, [open]);

    // Show suggestion when client is selected
    useEffect(() => {
        if (selectedClient && !hours && !cost) {
            setShowSuggestion(true);
        }
    }, [selectedClient, hours, cost]);

    const getColumnName = (col: GTDStatus): string => {
        const names: Record<GTDStatus, string> = {
            inbox: 'Inbox',
            next_action: 'Next Actions',
            waiting: 'Waiting For',
            projects: 'Projects',
            someday: 'Someday',
            done: 'Done',
        };
        return names[col] || col;
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullScreen={isMobile}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    m: isMobile ? 0 : 2,
                    borderRadius: isMobile ? 0 : 3,
                    maxHeight: isMobile ? '100%' : '90vh',
                    overflow: 'hidden',
                }
            }}
        >
            {/* ═══════════════════════════════════════
                HEADER
            ═══════════════════════════════════════ */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
            }}>
                <IconButton onClick={handleClose} edge="start">
                    <CloseIcon />
                </IconButton>

                <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                        Новая задача
                    </Typography>
                    {tasksCreated > 0 && (
                        <Typography variant="caption" color="success.main">
                            +{tasksCreated} создано
                        </Typography>
                    )}
                </Box>

                <Box sx={{ width: 40 }} /> {/* Spacer */}
            </Box>

            {/* Progress Bar */}
            <LinearProgress
                variant="determinate"
                value={progressPercent}
                sx={{ height: 3 }}
            />

            {/* ═══════════════════════════════════════
                SCROLLABLE CONTENT
            ═══════════════════════════════════════ */}
            <Box
                ref={scrollRef}
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    p: 2,
                    pb: 16, // Space for sticky footer
                }}
            >
                {/* Assignee */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Исполнитель
                    </Typography>
                    <ToggleButtonGroup
                        value={assigneeType}
                        exclusive
                        onChange={(_, val) => val && setAssigneeType(val)}
                        fullWidth
                        sx={{
                            bgcolor: 'grey.100',
                            borderRadius: 2,
                            p: 0.5,
                            '& .MuiToggleButton-root': {
                                border: 0,
                                borderRadius: 1.5,
                                py: 1.5,
                                '&.Mui-selected': {
                                    bgcolor: 'background.paper',
                                    boxShadow: 1,
                                }
                            }
                        }}
                    >
                        <ToggleButton value="self">👤 Я</ToggleButton>
                        <ToggleButton value="employee">👥 Сотрудник</ToggleButton>
                    </ToggleButtonGroup>

                    {assigneeType === 'employee' && (
                        <Autocomplete
                            options={users}
                            getOptionLabel={(u) => u.displayName || ''}
                            value={users.find(u => u.id === assigneeId) || null}
                            onChange={(_, val) => setAssigneeId(val?.id || '')}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    placeholder="Имя сотрудника..."
                                    size="small"
                                    sx={{ mt: 1.5 }}
                                />
                            )}
                        />
                    )}
                </Box>

                {/* Client */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Клиент <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                    </Typography>
                    <Autocomplete
                        options={clients}
                        getOptionLabel={(c) => c.name}
                        value={selectedClient}
                        onChange={(_, val) => setSelectedClient(val)}
                        inputValue={clientInput}
                        onInputChange={(_, val) => setClientInput(val)}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                placeholder="Выберите или введите..."
                                sx={{
                                    '& .MuiOutlinedInput-root': {
                                        bgcolor: selectedClient ? 'primary.50' : 'background.paper',
                                        borderColor: selectedClient ? 'primary.main' : undefined,
                                    }
                                }}
                                InputProps={{
                                    ...params.InputProps,
                                    endAdornment: (
                                        <>
                                            {selectedClient && (
                                                <IconButton size="small" onClick={() => { setSelectedClient(null); setShowSuggestion(false); }}>
                                                    <ClearIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                            <IconButton size="small" sx={{ color: 'grey.400' }}>
                                                <MicIcon fontSize="small" />
                                            </IconButton>
                                        </>
                                    ),
                                }}
                            />
                        )}
                        renderOption={(props, option) => (
                            <li {...props}>
                                {option.type === 'company' ? '🏢' : '👤'} {option.name}
                            </li>
                        )}
                    />

                    {/* Suggestion Banner */}
                    {showSuggestion && (
                        <Button
                            onClick={applySuggestion}
                            fullWidth
                            sx={{
                                mt: 1.5,
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                bgcolor: 'warning.50',
                                border: 1,
                                borderColor: 'warning.200',
                                borderRadius: 2,
                                py: 1,
                                '&:hover': { bgcolor: 'warning.100' },
                            }}
                        >
                            <Box>
                                <Typography variant="caption" fontWeight={600} color="warning.dark">
                                    💡 Применить типичные значения
                                </Typography>
                                <Typography variant="caption" color="warning.main" display="block">
                                    3 человека · 8 часов · ${8 * 3 * HOURLY_RATE}
                                </Typography>
                            </Box>
                        </Button>
                    )}
                </Box>

                {/* Description */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Описание <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                    </Typography>
                    <TextField
                        fullWidth
                        multiline
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Что нужно сделать?"
                    />
                </Box>

                {/* Resources Grid */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Ресурсы и финансы
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                        {/* Crew Size Stepper */}
                        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', borderRadius: 2 }}>
                            <IconButton
                                onClick={() => setCrewSize(Math.max(1, crewSize - 1))}
                                disabled={crewSize <= 1}
                            >
                                <RemoveIcon />
                            </IconButton>
                            <Box sx={{ flex: 1, textAlign: 'center' }}>
                                <Typography variant="h6" fontWeight={700}>{crewSize}</Typography>
                                <Typography variant="caption" color="text.secondary">человек</Typography>
                            </Box>
                            <IconButton onClick={() => setCrewSize(Math.min(20, crewSize + 1))}>
                                <AddIcon />
                            </IconButton>
                        </Paper>

                        {/* Hours */}
                        <TextField
                            type="number"
                            inputMode="numeric"
                            value={hours}
                            onChange={(e) => setHours(e.target.value)}
                            placeholder="Часы"
                            InputProps={{
                                endAdornment: <InputAdornment position="end">ч</InputAdornment>
                            }}
                        />

                        {/* Cost - Full Width */}
                        <Box sx={{ gridColumn: 'span 2' }}>
                            <TextField
                                fullWidth
                                type="number"
                                inputMode="decimal"
                                value={cost}
                                onChange={(e) => setCost(e.target.value)}
                                placeholder="Стоимость"
                                InputProps={{
                                    startAdornment: <InputAdornment position="start">$</InputAdornment>
                                }}
                            />
                            {!cost && hours && (
                                <Button
                                    size="small"
                                    onClick={() => setCost(String(estimatedCost))}
                                    sx={{ mt: 0.5, color: 'warning.main', textTransform: 'none' }}
                                >
                                    💡 Авто: ${estimatedCost.toLocaleString()} ({crewSize} чел × {hours}ч × ${HOURLY_RATE})
                                </Button>
                            )}
                        </Box>
                    </Box>
                </Box>

                {/* ═══════════════════════════════════════
                    PLANNING SECTION
                ═══════════════════════════════════════ */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Когда
                    </Typography>

                    {/* Quick Date Chips */}
                    <Box sx={{
                        display: 'flex',
                        gap: 1,
                        overflowX: 'auto',
                        pb: 1.5,
                        mx: -2,
                        px: 2,
                        '&::-webkit-scrollbar': { display: 'none' },
                    }}>
                        {quickDates.map((qd) => (
                            <Chip
                                key={qd.id}
                                onClick={() => handleQuickDateSelect(qd)}
                                label={
                                    <Box sx={{ textAlign: 'center' }}>
                                        <Typography variant="caption" fontWeight={600} display="block">
                                            {qd.label}
                                        </Typography>
                                        <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                            {qd.sub}
                                        </Typography>
                                    </Box>
                                }
                                sx={{
                                    minWidth: 56,
                                    height: 'auto',
                                    py: 1,
                                    borderRadius: 2,
                                    bgcolor: selectedQuickDate === qd.id ? 'primary.main' : 'grey.100',
                                    color: selectedQuickDate === qd.id ? 'white' : 'text.primary',
                                    '& .MuiChip-label': { px: 1.5 },
                                    boxShadow: selectedQuickDate === qd.id ? 3 : 0,
                                }}
                            />
                        ))}
                        <Chip
                            onClick={() => setPlanningMode('custom')}
                            label={
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="body2">📅</Typography>
                                    <Typography variant="caption">Другая</Typography>
                                </Box>
                            }
                            variant="outlined"
                            sx={{
                                minWidth: 56,
                                height: 'auto',
                                py: 1,
                                borderRadius: 2,
                                borderStyle: 'dashed',
                            }}
                        />
                    </Box>

                    {/* Custom Date Picker */}
                    {planningMode === 'custom' && (
                        <TextField
                            type="date"
                            fullWidth
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            sx={{ mb: 1.5 }}
                        />
                    )}

                    {/* Quick Time */}
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                        Время начала (опционально)
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                        {QUICK_TIMES.map((qt) => (
                            <Button
                                key={qt.id}
                                variant={startTime === qt.time ? 'contained' : 'outlined'}
                                onClick={() => handleTimeSelect(qt.time)}
                                sx={{
                                    flex: 1,
                                    flexDirection: 'column',
                                    py: 1.5,
                                    borderRadius: 2,
                                }}
                            >
                                <Typography variant="body1">{qt.emoji}</Typography>
                                <Typography variant="caption">{qt.time}</Typography>
                            </Button>
                        ))}
                        <Button
                            variant="outlined"
                            sx={{
                                flex: 1,
                                flexDirection: 'column',
                                py: 1.5,
                                borderRadius: 2,
                                borderStyle: 'dashed',
                            }}
                        >
                            <Typography variant="body1">⏱</Typography>
                            <Typography variant="caption">Точное</Typography>
                        </Button>
                    </Box>

                    {/* Duration */}
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                            <Typography variant="caption" fontWeight={500}>Длительность</Typography>
                            <ToggleButtonGroup
                                value={durationMode}
                                exclusive
                                onChange={(_, val) => val && setDurationMode(val)}
                                size="small"
                            >
                                <ToggleButton value="days" sx={{ px: 1.5 }}>Дни</ToggleButton>
                                <ToggleButton value="date" sx={{ px: 1.5 }}>Дата</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>

                        {durationMode === 'days' ? (
                            <>
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    {DURATION_OPTIONS.map((opt) => (
                                        <Button
                                            key={opt.days}
                                            variant={durationDays === opt.days ? 'contained' : 'outlined'}
                                            size="small"
                                            onClick={() => handleDurationChange(opt.days)}
                                            sx={{ flex: 1, borderRadius: 1.5 }}
                                        >
                                            {opt.label}
                                        </Button>
                                    ))}
                                </Box>
                                {hours && suggestedDuration && suggestedDuration !== durationDays && (
                                    <Button
                                        size="small"
                                        onClick={() => handleDurationChange(suggestedDuration)}
                                        sx={{ mt: 1, color: 'warning.main', textTransform: 'none' }}
                                    >
                                        💡 {hours}ч работы ≈ {suggestedDuration} {suggestedDuration === 1 ? 'день' : suggestedDuration < 5 ? 'дня' : 'дней'} (по 8ч/день)
                                    </Button>
                                )}
                            </>
                        ) : (
                            <TextField
                                type="date"
                                fullWidth
                                size="small"
                                value={endDate}
                                inputProps={{ min: startDate }}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        )}

                        {/* Summary */}
                        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between' }}>
                            <Typography variant="caption" color="text.secondary">Итого:</Typography>
                            <Typography variant="body2" fontWeight={600}>
                                {quickDates.find(q => q.id === selectedQuickDate)?.sub || startDate} → {
                                    durationMode === 'days'
                                        ? `+${durationDays} ${durationDays === 1 ? 'день' : durationDays < 5 ? 'дня' : 'дней'}`
                                        : format(new Date(endDate), 'd MMM', { locale: ru })
                                }
                                {startTime && ` в ${startTime}`}
                            </Typography>
                        </Box>
                    </Paper>
                </Box>
            </Box>

            {/* ═══════════════════════════════════════
                UNDO BANNER
            ═══════════════════════════════════════ */}
            <Slide direction="up" in={showUndo} mountOnEnter unmountOnExit>
                <Paper
                    elevation={8}
                    sx={{
                        position: 'absolute',
                        left: 16,
                        right: 16,
                        bottom: 100,
                        bgcolor: 'grey.800',
                        borderRadius: 3,
                        px: 2,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        zIndex: 30,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{
                            width: 32,
                            height: 32,
                            bgcolor: 'success.main',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            ✓
                        </Box>
                        <Typography color="white" fontWeight={500}>
                            Задача #{tasksCreated}
                        </Typography>
                    </Box>
                    <Button sx={{ color: 'warning.main', fontWeight: 700 }}>
                        ОТМЕНА
                    </Button>
                </Paper>
            </Slide>

            {/* ═══════════════════════════════════════
                TOAST
            ═══════════════════════════════════════ */}
            <Snackbar
                open={showToast}
                autoHideDuration={2500}
                onClose={() => setShowToast(false)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                sx={{ top: 80 }}
            >
                <Alert severity="success" variant="filled" sx={{ width: '100%' }}>
                    ✨ Форма готова к следующей задаче
                </Alert>
            </Snackbar>

            {/* ═══════════════════════════════════════
                STICKY FOOTER
            ═══════════════════════════════════════ */}
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    bgcolor: 'background.paper',
                    borderTop: 1,
                    borderColor: 'divider',
                    p: 2,
                    pb: isMobile ? 4 : 2,
                    display: 'flex',
                    gap: 1.5,
                    zIndex: 20,
                }}
            >
                <Button
                    variant="outlined"
                    onClick={() => handleSave(false)}
                    disabled={!description.trim() || saving}
                    sx={{
                        flex: 1,
                        py: 1.5,
                        borderRadius: 3,
                    }}
                >
                    Сохранить
                </Button>
                <Button
                    variant="contained"
                    onClick={() => handleSave(true)}
                    disabled={!description.trim() || saving}
                    sx={{
                        flex: 1,
                        py: 1.5,
                        borderRadius: 3,
                        boxShadow: 3,
                    }}
                >
                    {saving ? (
                        <CircularProgress size={20} color="inherit" />
                    ) : (
                        <>
                            <Typography variant="h6" component="span" sx={{ mr: 0.5 }}>+</Typography>
                            Ещё задачу
                        </>
                    )}
                </Button>
            </Box>
        </Dialog>
    );
};

export default GTDQuickAddDialog;
