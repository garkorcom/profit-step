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

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Snackbar, Alert, Fab, Tab, Tabs, Badge, Dialog, DialogTitle, DialogContent, TextField, DialogActions, Button, useMediaQuery, useTheme, Chip, Slide } from '@mui/material';
import { startOfDay, endOfDay, addDays, startOfWeek, endOfWeek, isBefore, isAfter, isWithinInterval } from 'date-fns';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { GTDTask, GTD_COLUMNS, GTDStatus } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { FormControl, Select, MenuItem, InputLabel, Typography, IconButton, ToggleButtonGroup, ToggleButton } from '@mui/material';
import EventIcon from '@mui/icons-material/Event';
import AddIcon from '@mui/icons-material/Add';
import PersonIcon from '@mui/icons-material/Person';
import FilterListIcon from '@mui/icons-material/FilterList';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
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

    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md')); // Адаптивность

    // ==================== СОСТОЯНИЕ ====================
    const [editingTask, setEditingTask] = useState<GTDTask | null>(null); // Редактируемая задача
    const [users, setUsers] = useState<UserProfile[]>([]);         // Пользователи для dropdown
    const [clients, setClients] = useState<Client[]>([]);          // Клиенты для dropdown
    const [selectedClientId, setSelectedClientId] = useState<string>('all');    // Фильтр по клиенту
    const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('all'); // Фильтр по assignee
    const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all'); // Фильтр по due date

    const [showShortcutHint, setShowShortcutHint] = useState(false);
    const [taskSaveSnackbar, setTaskSaveSnackbar] = useState(false); // Toast for task save confirmation

    // ==================== МОБИЛЬНОЕ СОСТОЯНИЕ ====================
    const [selectedTab, setSelectedTab] = useState(0);    // Активная вкладка (мобильный)
    const [showFilters, setShowFilters] = useState(false); // Показать фильтры (мобильный)
    const [isHeaderCompact, setIsHeaderCompact] = useState(false); // Compact header state

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

    // ==================== SCROLL LISTENER FOR COMPACT HEADER ====================
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleScroll = () => {
            setIsHeaderCompact(container.scrollTop > 50);
        };

        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

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
            // Show shortcut hint on ?
            if (e.key === '?') {
                setShowShortcutHint(true);
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

    // Active column (for mobile tabs and Quick Add target)
    const activeColumn = GTD_COLUMNS[selectedTab];

    return (
        <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', p: { xs: 1, md: 2 }, gap: 1, position: 'relative' }}>
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
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Toggle: My Tasks / All Tasks */}
                    <ToggleButtonGroup
                        value={showAllTasks}
                        exclusive
                        onChange={(_, val) => val !== null && setShowAllTasks(val)}
                        size="small"
                    >
                        <ToggleButton value={false}>Мои</ToggleButton>
                        <ToggleButton value={true}>Все</ToggleButton>
                    </ToggleButtonGroup>

                    <FormControl size="small" sx={{ minWidth: 200, bgcolor: 'background.paper' }}>
                        <InputLabel>Filter by Client</InputLabel>
                        <Select
                            value={selectedClientId}
                            label="Filter by Client"
                            onChange={(e) => setSelectedClientId(e.target.value)}
                            startAdornment={selectedClientId !== 'all' ? <PersonIcon sx={{ mr: 1, color: 'primary.main' }} /> : null}
                        >
                            <MenuItem value="all"><em>All Clients</em></MenuItem>
                            {clients.map(c => (
                                <MenuItem key={c.id} value={c.id}>
                                    {c.name} {c.type === 'company' ? '🏢' : '👤'}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 200, bgcolor: 'background.paper' }}>
                        <InputLabel>Filter by Assignee</InputLabel>
                        <Select
                            value={selectedAssigneeId}
                            label="Filter by Assignee"
                            onChange={(e) => setSelectedAssigneeId(e.target.value)}
                        >
                            <MenuItem value="all"><em>All Assignees</em></MenuItem>
                            {users.map(u => (
                                <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl size="small" sx={{ minWidth: 160, bgcolor: 'background.paper' }}>
                        <InputLabel>Due Date</InputLabel>
                        <Select
                            value={selectedDateFilter}
                            label="Due Date"
                            onChange={(e) => setSelectedDateFilter(e.target.value)}
                            startAdornment={selectedDateFilter !== 'all' ? <EventIcon sx={{ mr: 1, color: 'primary.main' }} /> : null}
                        >
                            <MenuItem value="all"><em>All Dates</em></MenuItem>
                            <MenuItem value="today">📅 Today</MenuItem>
                            <MenuItem value="tomorrow">📆 Tomorrow</MenuItem>
                            <MenuItem value="this_week">🗓️ This Week</MenuItem>
                            <MenuItem value="overdue">⚠️ Overdue</MenuItem>
                            <MenuItem value="no_date">❓ No Due Date</MenuItem>
                        </Select>
                    </FormControl>

                    {/* Clear Filters Button */}
                    {(selectedClientId !== 'all' || selectedAssigneeId !== 'all' || selectedDateFilter !== 'all') && (
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => { setSelectedClientId('all'); setSelectedAssigneeId('all'); setSelectedDateFilter('all'); }}
                            sx={{ height: 40 }}
                        >
                            Clear Filters
                        </Button>
                    )}

                    {/* Desktop FAB for adding tasks */}
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => navigate(`/crm/gtd/new?column=${activeColumn?.id || 'inbox'}`)}
                        sx={{ ml: 'auto', height: 40 }}
                    >
                        Add Task
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

            {/* Content: Desktop=all columns, Mobile=single column */}
            <Box
                sx={{
                    flex: 1,
                    display: 'flex',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    gap: 2,
                    px: 1,
                    // Apple-style scroll behavior
                    WebkitOverflowScrolling: 'touch',
                    scrollBehavior: 'smooth',
                    // CSS Scroll Snap for iPad
                    '@media (max-width: 1194px)': {
                        scrollSnapType: 'x mandatory',
                        '& > *': {
                            scrollSnapAlign: 'start',
                            flexShrink: 0,
                        }
                    },
                    // Hide scrollbar but keep functionality
                    '&::-webkit-scrollbar': {
                        height: 8,
                    },
                    '&::-webkit-scrollbar-track': {
                        background: '#f5f5f7',
                        borderRadius: 4,
                    },
                    '&::-webkit-scrollbar-thumb': {
                        background: '#c7c7cc',
                        borderRadius: 4,
                        '&:hover': {
                            background: '#a1a1a6'
                        }
                    }
                }}
            >
                <DragDropContext onDragEnd={onDragEnd}>
                    {isMobile ? (
                        // Mobile: Show only active column with swipe support
                        <Box
                            ref={swipeContainerRef}
                            sx={{
                                flex: 1,
                                display: 'flex',
                                touchAction: 'pan-y', // Allow vertical scroll, detect horizontal swipe
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
                    ) : (
                        // Desktop: Show all columns
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

            {/* FAB - Quick Add (mobile only, desktop has button in header) */}
            {isMobile && (
                <Fab
                    color="primary"
                    aria-label="add task"
                    onClick={() => navigate(`/crm/gtd/new?column=${activeColumn?.id || 'inbox'}`)}
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: 1000
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
