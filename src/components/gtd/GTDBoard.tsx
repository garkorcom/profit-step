/**
 * @fileoverview GTDBoard — главный компонент Kanban-доски для GTD задач
 * 
 * АРХИТЕКТУРА:
 * - Использует глобальную коллекцию Firestore: `gtd_tasks`
 * - Подписка на real-time обновления через onSnapshot
 * - Drag-and-drop через @hello-pangea/dnd
 * - Интеграция с Time Tracking (запуск сессий из задач)
 * 
 * ДОСТУП К ЗАДАЧАМ:
 * Пользователь видит задачи где он:
 * 1. Владелец (ownerId === currentUser.uid), ИЛИ
 * 2. Назначенный исполнитель (assigneeId === currentUser.uid)
 * 
 * ФИЛЬТРЫ:
 * - По клиенту (clientId)
 * - По исполнителю (assigneeId)
 * 
 * @module components/gtd/GTDBoard
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Snackbar, Alert, Fab, Tab, Tabs, Badge, Button, useMediaQuery, Chip, Popover } from '@mui/material';
import { startOfDay, addDays, endOfWeek, isBefore, isWithinInterval } from 'date-fns';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { GTDTask, GTD_COLUMNS, GTDStatus } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { FormControl, Select, MenuItem, InputLabel, Typography, IconButton, ToggleButtonGroup, ToggleButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PersonIcon from '@mui/icons-material/Person';
import FilterListIcon from '@mui/icons-material/FilterList';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import GTDColumn from './GTDColumn';
import GTDEditDialog from './GTDEditDialog';
import GTDQuickAddDialog, { AIEstimateData } from './GTDQuickAddDialog';
import ColumnIndicator from './ColumnIndicator';
import { useGTDTasks } from '../../hooks/useGTDTasks';
import { useSessionManager } from '../../hooks/useSessionManager';
import { useSwipeGesture, triggerHaptic } from '../../hooks/useSwipeGesture';

/**
 * GTDBoard — основной компонент Kanban-доски
 * 
 * Функционал:
 * - Отображение задач по колонкам (статусам)
 * - Drag-and-drop между колонками
 * - Создание задач с выбором клиента и исполнителя
 * - Фильтрация по клиенту и исполнителю
 * - Запуск рабочих сессий (Time Tracking) из задач
 * - Адаптивный дизайн (tabs на мобильных)
 */
const GTDBoard: React.FC = () => {
    const { currentUser, userProfile } = useAuth();
    const navigate = useNavigate();

    // ==================== СОСТОЯНИЕ ОТОБРАЖЕНИЯ ЗАДАЧ ====================
    const [showAllTasks, setShowAllTasks] = useState(false); // false = мои задачи, true = все

    const {
        columns,
        moveTask,
        addTask,
        updateTask,
        deleteTask
    } = useGTDTasks(currentUser, showAllTasks);

    const {
        activeSession,
        startSession,
        stopSession,
        sessionSnackbarOpen,
        sessionStartMessage,
        setSessionSnackbarOpen
    } = useSessionManager(currentUser?.uid, currentUser?.displayName || undefined, userProfile?.telegramId);

    const isMobile = useMediaQuery('(max-width:599px)'); // Phone — 1 column + tabs + swipe
    const isFoldable = useMediaQuery('(min-width:600px) and (max-width:959px)'); // Pixel Fold / small tablet — horizontal scroll
    const isCompact = useMediaQuery('(max-width:959px)'); // Tablet/foldable — show FAB

    // ==================== СОСТОЯНИЕ ====================
    const [editingTask, setEditingTask] = useState<GTDTask | null>(null); // Редактируемая задача
    const [users, setUsers] = useState<UserProfile[]>([]);         // Пользователи для dropdown
    const [clients, setClients] = useState<Client[]>([]);          // Клиенты для dropdown
    const [selectedClientId, setSelectedClientId] = useState<string>('all');    // Фильтр по клиенту
    const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('all'); // Фильтр по assignee
    const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all'); // Фильтр по due date

    const [taskSaveSnackbar, setTaskSaveSnackbar] = useState(false); // Toast for task save confirmation

    // ==================== МОБИЛЬНОЕ СОСТОЯНИЕ ====================
    const [selectedTab, setSelectedTab] = useState(0);    // Активная вкладка (мобильный)
    const [showFilters, setShowFilters] = useState(false); // Показать фильтры (мобильный)
    const [shortcutAnchor, setShortcutAnchor] = useState<HTMLElement | null>(null); // Keyboard help popover

    // ==================== SWIPE NAVIGATION ====================
    const handleSwipeLeft = useCallback(() => {
        if (selectedTab < GTD_COLUMNS.length - 1) {
            setSelectedTab(prev => prev + 1);
            triggerHaptic('light');
        }
    }, [selectedTab]);

    const handleSwipeRight = useCallback(() => {
        if (selectedTab > 0) {
            setSelectedTab(prev => prev - 1);
            triggerHaptic('light');
        }
    }, [selectedTab]);

    const swipeContainerRef = useSwipeGesture<HTMLDivElement>({
        onSwipeLeft: handleSwipeLeft,
        onSwipeRight: handleSwipeRight,
        threshold: 75,
    });

    // ==================== QUICK ADD DIALOG ====================
    const [quickAddOpen, setQuickAddOpen] = useState(false);

    /**
     * Lookup-таблица клиентов по ID
     * Используется для быстрого доступа к данным клиента при создании сессий
     */
    const clientsMap = useMemo(() => {
        const map: Record<string, Client> = {};
        clients.forEach(c => { map[c.id] = c; });
        return map;
    }, [clients]);

    /**
     * Загрузка пользователей и клиентов для dropdown'ов
     */
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Загрузка пользователей для dropdown "Assignee"
                const usersSnap = await getDocs(collection(db, 'users'));
                const fetchedUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
                // Фильтруем пользователей без displayName и сортируем
                setUsers(fetchedUsers.filter(u => u.displayName).sort((a, b) =>
                    (a.displayName || '').localeCompare(b.displayName || '')
                ));

                // Загрузка клиентов для dropdown "Client"
                const clientQ = query(collection(db, 'clients'), orderBy('name'));
                const clientSnap = await getDocs(clientQ);
                setClients(clientSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };
        fetchData();
    }, []);

    // 2. Drag & Drop Handler
    const onDragEnd = async (result: DropResult) => {
        const moveResult = await moveTask(result);
        if (moveResult) {
            const { movedTask, destColId } = moveResult;
            // Feature: Prompt for context if moving to Next Action and no context set
            if (destColId === 'next_action' && !movedTask.context) {
                setEditingTask(movedTask);
            }
        }
    };

    // 3. Task Actions
    const handleAddTaskWrapper = async (
        title: string,
        columnId: GTDStatus,
        clientId?: string,
        assigneeId?: string,
        aiData?: AIEstimateData
    ) => {
        await addTask(title, columnId, clients, users, clientId, assigneeId, aiData);
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl/Cmd + N = Focus inbox add
            if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
                e.preventDefault();
                // Find and click the Inbox add button
                const inboxAddBtn = document.querySelector('[data-column-id="inbox"] button[aria-label="add-task"]') as HTMLButtonElement;
                if (inboxAddBtn) inboxAddBtn.click();
            }

        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Filter columns by client, assignee, AND due date
    const filteredColumns = useMemo(() => {
        const result = { ...columns };
        const today = startOfDay(new Date());
        const tomorrow = startOfDay(addDays(new Date(), 1));
        const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });

        Object.keys(result).forEach(key => {
            let tasks = result[key as GTDStatus];

            // Client filter
            if (selectedClientId !== 'all') {
                tasks = tasks.filter(t => t.clientId === selectedClientId);
            }

            // Assignee filter
            if (selectedAssigneeId !== 'all') {
                tasks = tasks.filter(t => t.assigneeId === selectedAssigneeId);
            }

            // Due Date filter
            if (selectedDateFilter !== 'all') {
                tasks = tasks.filter(t => {
                    if (!t.dueDate) {
                        return selectedDateFilter === 'no_date';
                    }
                    const dueDateRaw = t.dueDate as any;
                    const dueDate = dueDateRaw?.toDate
                        ? startOfDay(dueDateRaw.toDate())
                        : startOfDay(new Date(dueDateRaw));

                    switch (selectedDateFilter) {
                        case 'today':
                            return dueDate.getTime() === today.getTime();
                        case 'tomorrow':
                            return dueDate.getTime() === tomorrow.getTime();
                        case 'this_week':
                            return isWithinInterval(dueDate, { start: today, end: weekEnd });
                        case 'overdue':
                            return isBefore(dueDate, today);
                        case 'no_date':
                            return false; // Already handled above
                        default:
                            return true;
                    }
                });
            }

            result[key as GTDStatus] = tasks;
        });
        return result;
    }, [columns, selectedClientId, selectedAssigneeId, selectedDateFilter]);

    // Total task count across all filtered columns
    const totalTaskCount = useMemo(() => {
        return Object.values(filteredColumns).reduce((sum, tasks) => sum + tasks.length, 0);
    }, [filteredColumns]);

    // Active column (for mobile tabs and Quick Add target)
    const activeColumn = GTD_COLUMNS[selectedTab];

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: { xs: 0.5, md: 1.5 }, gap: 0.5, position: 'relative' }}>
            {/* Filter Bar - Desktop: visible, Mobile: toggle button */}
            {isMobile ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    {/* Mobile toggle: Мои / Все */}
                    <ToggleButtonGroup
                        value={showAllTasks}
                        exclusive
                        onChange={(_, val) => val !== null && setShowAllTasks(val)}
                        size="small"
                        sx={{ '& .MuiToggleButton-root': { px: 1.5, py: 0.5, fontSize: '0.75rem' } }}
                    >
                        <ToggleButton value={false}>Мои</ToggleButton>
                        <ToggleButton value={true}>Все</ToggleButton>
                    </ToggleButtonGroup>

                    <Typography variant="subtitle1" fontWeight="bold" sx={{ flex: 1, textAlign: 'center' }}>
                        {activeColumn?.title} ({filteredColumns[activeColumn?.id]?.length || 0})
                    </Typography>

                    <IconButton onClick={() => setShowFilters(!showFilters)}>
                        <Badge
                            color="primary"
                            variant="dot"
                            invisible={selectedClientId === 'all' && selectedAssigneeId === 'all' && selectedDateFilter === 'all' && !showAllTasks}
                        >
                            <FilterListIcon />
                        </Badge>
                    </IconButton>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Toggle: My Tasks / All Tasks */}
                    <ToggleButtonGroup
                        value={showAllTasks}
                        exclusive
                        onChange={(_, val) => val !== null && setShowAllTasks(val)}
                        size="small"
                        sx={{
                            '& .MuiToggleButton-root': {
                                px: 1.5,
                                py: 0.5,
                                fontSize: '13px',
                                fontWeight: 600,
                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                textTransform: 'none',
                                borderRadius: '8px !important',
                                border: '1px solid rgba(0,0,0,0.08)',
                                '&.Mui-selected': {
                                    bgcolor: '#007aff',
                                    color: 'white',
                                    '&:hover': { bgcolor: '#0066cc' },
                                },
                            }
                        }}
                    >
                        <ToggleButton value={false}>МОИ</ToggleButton>
                        <ToggleButton value={true}>ВСЕ</ToggleButton>
                    </ToggleButtonGroup>

                    {/* Filter Chips */}
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', overflowX: 'auto', flex: 1, '&::-webkit-scrollbar': { display: 'none' } }}>
                        {/* Client filter chips */}
                        {clients.slice(0, 6).map(c => (
                            <Chip
                                key={c.id}
                                label={c.name}
                                size="small"
                                variant={selectedClientId === c.id ? 'filled' : 'outlined'}
                                onClick={() => setSelectedClientId(selectedClientId === c.id ? 'all' : c.id)}
                                sx={{
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                                    height: 30,
                                    ...(selectedClientId === c.id ? {
                                        bgcolor: '#007aff',
                                        color: 'white',
                                        border: 'none',
                                        '&:hover': { bgcolor: '#0066cc' },
                                    } : {
                                        borderColor: 'rgba(0,0,0,0.12)',
                                        '&:hover': { bgcolor: 'rgba(0,122,255,0.06)' },
                                    }),
                                }}
                            />
                        ))}

                        {/* Separator */}
                        {clients.length > 0 && (
                            <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(0,0,0,0.1)', flexShrink: 0 }} />
                        )}

                        {/* Assignee filter chips */}
                        {users.slice(0, 4).map(u => (
                            <Chip
                                key={u.id}
                                label={u.displayName}
                                size="small"
                                icon={<PersonIcon sx={{ fontSize: '14px !important' }} />}
                                variant={selectedAssigneeId === u.id ? 'filled' : 'outlined'}
                                onClick={() => setSelectedAssigneeId(selectedAssigneeId === u.id ? 'all' : u.id)}
                                sx={{
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    height: 30,
                                    ...(selectedAssigneeId === u.id ? {
                                        bgcolor: '#34c759',
                                        color: 'white',
                                        border: 'none',
                                        '& .MuiChip-icon': { color: 'white' },
                                        '&:hover': { bgcolor: '#2da44e' },
                                    } : {
                                        borderColor: 'rgba(0,0,0,0.12)',
                                        '&:hover': { bgcolor: 'rgba(52,199,89,0.06)' },
                                    }),
                                }}
                            />
                        ))}

                        {/* Separator */}
                        <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(0,0,0,0.1)', flexShrink: 0 }} />

                        {/* Due date chips */}
                        {[
                            { id: 'today', label: 'Today', icon: '📅' },
                            { id: 'overdue', label: 'Overdue', icon: '⚠️' },
                            { id: 'this_week', label: 'This Week', icon: '🗓️' },
                            { id: 'no_date', label: 'No Date', icon: '❓' },
                        ].map(f => (
                            <Chip
                                key={f.id}
                                label={`${f.icon} ${f.label}`}
                                size="small"
                                variant={selectedDateFilter === f.id ? 'filled' : 'outlined'}
                                onClick={() => setSelectedDateFilter(selectedDateFilter === f.id ? 'all' : f.id)}
                                sx={{
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 500,
                                    height: 30,
                                    ...(selectedDateFilter === f.id ? {
                                        bgcolor: '#ff9500',
                                        color: 'white',
                                        border: 'none',
                                        '&:hover': { bgcolor: '#e08600' },
                                    } : {
                                        borderColor: 'rgba(0,0,0,0.12)',
                                        '&:hover': { bgcolor: 'rgba(255,149,0,0.06)' },
                                    }),
                                }}
                            />
                        ))}

                        {/* Clear all */}
                        {(selectedClientId !== 'all' || selectedAssigneeId !== 'all' || selectedDateFilter !== 'all') && (
                            <Chip
                                label="✕ Clear"
                                size="small"
                                onClick={() => { setSelectedClientId('all'); setSelectedAssigneeId('all'); setSelectedDateFilter('all'); }}
                                sx={{
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    height: 30,
                                    bgcolor: 'rgba(255,59,48,0.1)',
                                    color: '#ff3b30',
                                    '&:hover': { bgcolor: 'rgba(255,59,48,0.2)' },
                                }}
                            />
                        )}
                    </Box>

                    {/* Total task count badge */}
                    <Typography
                        sx={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#86868b',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {totalTaskCount} tasks
                    </Typography>

                    {/* Keyboard shortcuts help */}
                    <IconButton
                        size="small"
                        onClick={(e) => setShortcutAnchor(e.currentTarget)}
                        sx={{
                            width: 32,
                            height: 32,
                            color: '#86868b',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.05)', color: '#1d1d1f' },
                        }}
                    >
                        <KeyboardIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <Popover
                        open={Boolean(shortcutAnchor)}
                        anchorEl={shortcutAnchor}
                        onClose={() => setShortcutAnchor(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                        PaperProps={{
                            sx: {
                                borderRadius: '12px',
                                p: 2,
                                bgcolor: 'rgba(255,255,255,0.95)',
                                backdropFilter: 'blur(20px)',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                                minWidth: 220,
                            }
                        }}
                    >
                        <Typography sx={{ fontSize: '13px', fontWeight: 700, mb: 1.5, color: '#1d1d1f' }}>
                            Keyboard Shortcuts
                        </Typography>
                        {[
                            { keys: '⌘ N', desc: 'Add to Inbox' },
                            { keys: 'Click chip', desc: 'Toggle filter' },
                            { keys: 'Drag card', desc: 'Move between columns' },
                        ].map(s => (
                            <Box key={s.keys} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                                <Typography sx={{ fontSize: '12px', color: '#86868b' }}>{s.desc}</Typography>
                                <Box
                                    sx={{
                                        bgcolor: '#f5f5f7',
                                        px: 1,
                                        py: 0.25,
                                        borderRadius: '6px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        fontFamily: 'monospace',
                                        color: '#1d1d1f',
                                    }}
                                >
                                    {s.keys}
                                </Box>
                            </Box>
                        ))}
                    </Popover>

                    {/* Desktop button for adding tasks */}
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => navigate(`/crm/gtd/new?column=${activeColumn?.id || 'inbox'}`)}
                        sx={{
                            height: 36,
                            borderRadius: '10px',
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: '13px',
                            bgcolor: '#007aff',
                            boxShadow: 'none',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                            '&:hover': { bgcolor: '#0066cc', boxShadow: 'none' },
                        }}
                    >
                        + Add Task
                    </Button>
                </Box>
            )}

            {/* Mobile Filters Dialog */}
            {isMobile && showFilters && (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', py: 1, bgcolor: '#f5f5f5', borderRadius: 1, px: 1 }}>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 120, bgcolor: 'white' }}>
                        <InputLabel>Client</InputLabel>
                        <Select value={selectedClientId} label="Client" onChange={(e) => setSelectedClientId(e.target.value)}>
                            <MenuItem value="all"><em>All</em></MenuItem>
                            {clients.map(c => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 120, bgcolor: 'white' }}>
                        <InputLabel>Assignee</InputLabel>
                        <Select value={selectedAssigneeId} label="Assignee" onChange={(e) => setSelectedAssigneeId(e.target.value)}>
                            <MenuItem value="all"><em>All</em></MenuItem>
                            {users.map(u => <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 100, bgcolor: 'white' }}>
                        <InputLabel>Due</InputLabel>
                        <Select value={selectedDateFilter} label="Due" onChange={(e) => setSelectedDateFilter(e.target.value)}>
                            <MenuItem value="all"><em>All</em></MenuItem>
                            <MenuItem value="today">Today</MenuItem>
                            <MenuItem value="tomorrow">Tomorrow</MenuItem>
                            <MenuItem value="this_week">Week</MenuItem>
                            <MenuItem value="overdue">Overdue</MenuItem>
                            <MenuItem value="no_date">No Date</MenuItem>
                        </Select>
                    </FormControl>
                </Box>
            )}

            {/* Mobile: Tabs for columns */}
            {isMobile && (
                <Box>
                    <Tabs
                        value={selectedTab}
                        onChange={(_, newValue) => {
                            setSelectedTab(newValue);
                            triggerHaptic('light');
                        }}
                        variant="scrollable"
                        scrollButtons="auto"
                        sx={{
                            minHeight: 44,
                            '& .MuiTab-root': {
                                minHeight: 44,
                                py: 1,
                                px: 2,
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
                            }
                        }}
                    >
                        {GTD_COLUMNS.map((col, idx) => (
                            <Tab
                                key={col.id}
                                label={
                                    <Badge badgeContent={filteredColumns[col.id]?.length || 0} color="primary" max={99}>
                                        <Box sx={{ pr: 1.5 }}>{col.title}</Box>
                                    </Badge>
                                }
                            />
                        ))}
                    </Tabs>

                    {/* Column Indicator Dots */}
                    <ColumnIndicator
                        total={GTD_COLUMNS.length}
                        current={selectedTab}
                        onChange={(index) => {
                            setSelectedTab(index);
                            triggerHaptic('light');
                        }}
                    />

                    {/* Swipe hint */}
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 1,
                        py: 0.5,
                        color: '#86868b',
                        fontSize: '0.7rem',
                    }}>
                        <ChevronLeftIcon sx={{ fontSize: 14 }} />
                        <Typography variant="caption" sx={{ color: 'inherit' }}>
                            Свайп для переключения
                        </Typography>
                        <ChevronRightIcon sx={{ fontSize: 14 }} />
                    </Box>
                </Box>
            )}

            {/* Content: Desktop=grid, Foldable=scroll-snap, Mobile=single column */}
            <Box
                sx={{
                    flex: 1,
                    minHeight: 0,
                    ...(isMobile ? {
                        display: 'flex',
                    } : isFoldable ? {
                        display: 'flex',
                        overflowX: 'auto',
                        overflowY: 'hidden',
                        gap: 1.5,
                        px: 1,
                        scrollSnapType: 'x mandatory',
                        WebkitOverflowScrolling: 'touch',
                        // Hide scrollbar but keep scrollable
                        '&::-webkit-scrollbar': { display: 'none' },
                        msOverflowStyle: 'none',
                        scrollbarWidth: 'none',
                    } : {
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                        gap: 1.5,
                        px: 0.5,
                    }),
                    overflow: isMobile ? 'visible' : undefined,
                    touchAction: isMobile ? 'pan-y' : 'none',
                }}
            >
                <DragDropContext onDragEnd={onDragEnd}>
                    {isMobile ? (
                        // Mobile (<600px): Show only active column with swipe support
                        <Box
                            ref={swipeContainerRef}
                            sx={{
                                flex: 1,
                                display: 'flex',
                                touchAction: 'pan-y',
                            }}
                        >
                            <GTDColumn
                                key={activeColumn?.id}
                                columnId={activeColumn?.id}
                                title={activeColumn?.title}
                                tasks={filteredColumns[activeColumn?.id] || []}
                                clientsMap={clientsMap}
                                onTaskClick={setEditingTask}
                                onAddTask={handleAddTaskWrapper}
                                onStartSession={startSession}
                                activeSession={activeSession}
                                onStopSession={stopSession}
                            />
                        </Box>
                    ) : isFoldable ? (
                        // Foldable (600-959px): Horizontal scroll-snap columns
                        GTD_COLUMNS.map(column => (
                            <Box
                                key={column.id}
                                sx={{
                                    minWidth: 280,
                                    maxWidth: 320,
                                    flexShrink: 0,
                                    height: '100%',
                                    scrollSnapAlign: 'start',
                                }}
                            >
                                <GTDColumn
                                    columnId={column.id}
                                    title={column.title}
                                    tasks={filteredColumns[column.id]}
                                    clientsMap={clientsMap}
                                    onTaskClick={setEditingTask}
                                    onAddTask={handleAddTaskWrapper}
                                    onStartSession={startSession}
                                    activeSession={activeSession}
                                    onStopSession={stopSession}
                                />
                            </Box>
                        ))
                    ) : (
                        // Desktop (960px+): Show all columns in grid
                        GTD_COLUMNS.map(column => (
                            <GTDColumn
                                key={column.id}
                                columnId={column.id}
                                title={column.title}
                                tasks={filteredColumns[column.id]}
                                clientsMap={clientsMap}
                                onTaskClick={setEditingTask}
                                onAddTask={handleAddTaskWrapper}
                                onStartSession={startSession}
                                activeSession={activeSession}
                                onStopSession={stopSession}
                            />
                        ))
                    )}
                </DragDropContext>
            </Box>

            {/* FAB - Quick Add (mobile + tablet/foldable) */}
            {isCompact && (
                <Fab
                    color="primary"
                    aria-label="add task"
                    onClick={() => navigate(`/crm/gtd/new?column=${activeColumn?.id || 'inbox'}`)}
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: 1000,
                        width: 48,
                        height: 48,
                    }}
                >
                    <AddIcon />
                </Fab>
            )}

            {/* Quick Add Dialog - New Mobile-First Design */}
            <GTDQuickAddDialog
                open={quickAddOpen}
                onClose={() => setQuickAddOpen(false)}
                onAdd={(title, columnId, clientId, assigneeId, priority, aiData) => {
                    handleAddTaskWrapper(title, columnId, clientId, assigneeId, aiData);
                }}
                targetColumn={activeColumn?.id || 'inbox'}
                clients={clients}
                users={users}
                currentUser={currentUser}
            />

            {/* Edit Dialog */}
            {editingTask && (
                <GTDEditDialog
                    open={!!editingTask}
                    onClose={() => setEditingTask(null)}
                    task={editingTask}
                    onSave={async (taskId, data) => {
                        await updateTask(taskId, data);
                        setTaskSaveSnackbar(true);
                    }}
                    onDelete={deleteTask}
                />
            )}

            <Snackbar
                open={sessionSnackbarOpen}
                autoHideDuration={4000}
                onClose={() => setSessionSnackbarOpen(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSessionSnackbarOpen(false)} severity="success" variant="filled">
                    {sessionStartMessage}
                </Alert>
            </Snackbar>

            {/* Toast for task save */}
            <Snackbar
                open={taskSaveSnackbar}
                autoHideDuration={3000}
                onClose={() => setTaskSaveSnackbar(false)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setTaskSaveSnackbar(false)} severity="success" variant="filled">
                    ✓ Задача сохранена
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default GTDBoard;
