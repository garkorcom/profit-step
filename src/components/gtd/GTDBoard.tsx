import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Snackbar, Alert, Fab, Tab, Tabs, Badge, Dialog, DialogTitle, DialogContent, TextField, DialogActions, Button, useMediaQuery, useTheme } from '@mui/material';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, addDoc, deleteDoc, Timestamp, getDocs, or } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { GTDTask, GTD_COLUMNS, GTDStatus, GTDPriority } from '../../types/gtd.types';
import { Client } from '../../types/crm.types';
import { UserProfile } from '../../types/user.types';
import { FormControl, Select, MenuItem, InputLabel, Typography, Tooltip, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PersonIcon from '@mui/icons-material/Person';
import FilterListIcon from '@mui/icons-material/FilterList';
import GTDColumn from './GTDColumn';
import GTDEditDialog from './GTDEditDialog';
import { useActiveSession } from '../../hooks/useActiveSession';

// Mock initial data structure
const initialData: Record<GTDStatus, GTDTask[]> = {
    inbox: [],
    next_action: [],
    waiting: [],
    projects: [],
    someday: [],
    done: [] // technically not a column in board usually, but needed for type safety
};

const GTDBoard: React.FC = () => {
    const { currentUser, userProfile } = useAuth();
    const effectiveUserId = useMemo(() => {
        if (userProfile?.telegramId && !isNaN(Number(userProfile.telegramId))) {
            return Number(userProfile.telegramId);
        }
        return currentUser?.uid;
    }, [currentUser, userProfile]);

    const { activeSession } = useActiveSession(effectiveUserId);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [columns, setColumns] = useState(initialData);
    const [editingTask, setEditingTask] = useState<GTDTask | null>(null);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState<string>('all');
    const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('all');

    const handleStopSession = async () => {
        if (!activeSession) return;

        try {
            const sessionRef = doc(db, 'work_sessions', activeSession.id);
            const endTime = Timestamp.now();
            // @ts-ignore
            const startTime = activeSession.startTime;
            let diffArr = 0;
            if (startTime) {
                diffArr = endTime.toMillis() - startTime.toMillis();
            }
            const durationMinutes = Math.round(diffArr / 1000 / 60);

            // @ts-ignore
            const rate = activeSession.hourlyRate || 0;
            const hours = durationMinutes / 60;
            const earnings = parseFloat((hours * rate).toFixed(2));

            await updateDoc(sessionRef, {
                status: 'completed',
                endTime: endTime,
                durationMinutes: durationMinutes,
                sessionEarnings: earnings
            });

            setSessionStartMessage(`⏹️ Session stopped`);
            setSessionSnackbarOpen(true);
        } catch (error) {
            console.error("Error stopping session:", error);
            alert("Failed to stop session");
        }
    };
    const [showShortcutHint, setShowShortcutHint] = useState(false);

    // Mobile-specific state
    const [selectedTab, setSelectedTab] = useState(0);
    const [showFilters, setShowFilters] = useState(false);
    const [quickAddOpen, setQuickAddOpen] = useState(false);
    const [quickAddTitle, setQuickAddTitle] = useState('');
    const [quickAddClientId, setQuickAddClientId] = useState<string>('');
    const [quickAddAssigneeId, setQuickAddAssigneeId] = useState<string>('');

    // Create clients lookup map for quick access
    const clientsMap = useMemo(() => {
        const map: Record<string, Client> = {};
        clients.forEach(c => { map[c.id] = c; });
        return map;
    }, [clients]);

    // Fetch users and clients
    useEffect(() => {
        const fetchData = async () => {
            try {
                // Fetch users for assignee dropdown
                const usersSnap = await getDocs(collection(db, 'users'));
                const fetchedUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile));
                setUsers(fetchedUsers.filter(u => u.displayName).sort((a, b) =>
                    (a.displayName || '').localeCompare(b.displayName || '')
                ));

                // Fetch clients
                const clientQ = query(collection(db, 'clients'), orderBy('name'));
                const clientSnap = await getDocs(clientQ);
                setClients(clientSnap.docs.map(d => ({ id: d.id, ...d.data() } as Client)));
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };
        fetchData();
    }, []);

    // 1. Subscribe to tasks from GLOBAL collection
    useEffect(() => {
        if (!currentUser) return;

        // Query tasks where user is owner OR assignee
        const q = query(
            collection(db, 'gtd_tasks'),
            or(
                where('ownerId', '==', currentUser.uid),
                where('assigneeId', '==', currentUser.uid)
            )
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newColumns = { ...initialData };
            // Reset arrays to empty before populating
            Object.keys(newColumns).forEach(key => newColumns[key as GTDStatus] = []);

            snapshot.docs.forEach(doc => {
                const task = { id: doc.id, ...doc.data() } as GTDTask;
                if (newColumns[task.status]) {
                    newColumns[task.status].push(task);
                }
            });

            // Sort each column by createdAt desc
            Object.keys(newColumns).forEach(key => {
                newColumns[key as GTDStatus].sort((a, b) =>
                    (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
                );
            });

            setColumns(newColumns);
        });

        return () => unsubscribe();
    }, [currentUser]);

    // 2. Drag & Drop Handler
    const onDragEnd = async (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return;
        }

        const sourceColId = source.droppableId as GTDStatus;
        const destColId = destination.droppableId as GTDStatus;

        // Optimistic Update
        const sourceList = [...columns[sourceColId]];
        const destList = sourceColId === destColId ? sourceList : [...columns[destColId]];

        const [movedTask] = sourceList.splice(source.index, 1);
        movedTask.status = destColId; // Update status immediately
        destList.splice(destination.index, 0, movedTask);

        const newState = {
            ...columns,
            [sourceColId]: sourceList,
            [destColId]: destList
        };
        setColumns(newState);

        // Firestore Update - now using global collection
        if (currentUser) {
            try {
                const taskRef = doc(db, 'gtd_tasks', draggableId);
                await updateDoc(taskRef, { status: destColId, updatedAt: Timestamp.now() });

                // Feature: Prompt for context if moving to Next Action and no context set
                if (destColId === 'next_action' && !movedTask.context) {
                    setEditingTask(movedTask); // Open edit dialog specifically to add context
                }
            } catch (error) {
                console.error("Error moving task:", error);
            }
        }
    };

    // 3. Task Actions - now with client and assignee support
    const handleAddTask = async (title: string, columnId: GTDStatus, clientId?: string, assigneeId?: string) => {
        if (!currentUser) return;
        try {
            const selectedClient = clients.find(c => c.id === clientId);
            const selectedAssignee = users.find(u => u.id === assigneeId);

            const newTask: Partial<GTDTask> = {
                title,
                status: columnId,
                priority: 'none' as GTDPriority,
                createdAt: Timestamp.now(),
                ownerId: currentUser.uid,
                ownerName: currentUser.displayName || 'Unknown',
                context: '',
                description: '',
                ...(clientId && { clientId, clientName: selectedClient?.name || '' }),
                ...(assigneeId && { assigneeId, assigneeName: selectedAssignee?.displayName || '' })
            };
            await addDoc(collection(db, 'gtd_tasks'), newTask);
        } catch (error) {
            console.error("Error adding task:", error);
        }
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

    const handleUpdateTask = async (taskId: string, updates: Partial<GTDTask>) => {
        if (!currentUser) return;
        const taskRef = doc(db, 'gtd_tasks', taskId);
        await updateDoc(taskRef, { ...updates, updatedAt: Timestamp.now() });
    };

    const handleDeleteTask = async (taskId: string) => {
        if (!currentUser) return;
        const taskRef = doc(db, 'gtd_tasks', taskId);
        await deleteDoc(taskRef);
    };

    // 4. Start Session from Task
    const [sessionSnackbarOpen, setSessionSnackbarOpen] = useState(false);
    const [sessionStartMessage, setSessionStartMessage] = useState('');

    const handleStartSession = async (task: GTDTask) => {
        if (!currentUser) return;
        try {
            // 1. Check/Close existing active session
            const sessionsRef = collection(db, 'work_sessions');
            const q = query(
                sessionsRef,
                where('employeeId', '==', effectiveUserId),
                where('status', '==', 'active')
            );
            const snapshot = await getDocs(q);

            let closedSessionMsg = '';

            if (!snapshot.empty) {
                const activeSessionDoc = snapshot.docs[0];
                const activeData = activeSessionDoc.data();

                // Calculate stats for closing
                const endTime = Timestamp.now();
                const startTime = activeData.startTime;

                let diffArr = 0;
                if (startTime) {
                    diffArr = endTime.toMillis() - startTime.toMillis();
                }
                const durationMinutes = Math.round(diffArr / 1000 / 60); // Consistent with Bot calculation

                const rate = activeData.hourlyRate || 0;
                const hours = durationMinutes / 60;
                const earnings = parseFloat((hours * rate).toFixed(2));

                await updateDoc(activeSessionDoc.ref, {
                    status: 'completed',
                    endTime: endTime,
                    durationMinutes: durationMinutes,
                    sessionEarnings: earnings,
                    // Append note about auto-switch if description allows? 
                    // Or just leave description as is. User wanted "Auto-switched" if empty.
                    // For now, let's trust the existing description or just close it.
                    // If description is empty? usually not allowed in UI but might be in Bot.
                });
                closedSessionMsg = 'Previous session closed. ';
            }

            // 2. Create new active session
            await addDoc(collection(db, 'work_sessions'), {
                employeeId: effectiveUserId,
                employeeName: currentUser.displayName || 'Unknown',
                startTime: Timestamp.now(),
                status: 'active',
                description: task.title,
                clientId: task.clientId || '',
                clientName: task.clientName || '',
                type: 'regular',
                relatedTaskId: task.id // Link back to task
            });

            setSessionStartMessage(`${closedSessionMsg}⏱️ Session started: ${task.title}`);
            setSessionSnackbarOpen(true);
        } catch (error) {
            console.error("Error starting session:", error);
            alert("Failed to start session");
        }
    };

    // Filter columns by client AND assignee
    const filteredColumns = { ...columns };
    Object.keys(filteredColumns).forEach(key => {
        let tasks = filteredColumns[key as GTDStatus];
        if (selectedClientId !== 'all') {
            tasks = tasks.filter(t => t.clientId === selectedClientId);
        }
        if (selectedAssigneeId !== 'all') {
            tasks = tasks.filter(t => t.assigneeId === selectedAssigneeId);
        }
        filteredColumns[key as GTDStatus] = tasks;
    });

    // Quick add from FAB
    const handleQuickAdd = () => {
        if (!quickAddTitle.trim()) return;
        const targetColumn = GTD_COLUMNS[selectedTab]?.id || 'inbox';
        handleAddTask(quickAddTitle, targetColumn, quickAddClientId || undefined, quickAddAssigneeId || undefined);
        setQuickAddTitle('');
        setQuickAddClientId('');
        setQuickAddAssigneeId('');
        setQuickAddOpen(false);
    };

    // Mobile: active column based on tab
    const activeColumn = GTD_COLUMNS[selectedTab];

    return (
        <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column', p: { xs: 1, md: 2 }, gap: 1, position: 'relative' }}>
            {/* Filter Bar - Desktop: visible, Mobile: toggle button */}
            {isMobile ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="subtitle1" fontWeight="bold">
                        {activeColumn?.title} ({filteredColumns[activeColumn?.id]?.length || 0})
                    </Typography>
                    <IconButton onClick={() => setShowFilters(!showFilters)}>
                        <Badge
                            color="primary"
                            variant="dot"
                            invisible={selectedClientId === 'all' && selectedAssigneeId === 'all'}
                        >
                            <FilterListIcon />
                        </Badge>
                    </IconButton>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
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

                    {/* Clear Filters Button */}
                    {(selectedClientId !== 'all' || selectedAssigneeId !== 'all') && (
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => { setSelectedClientId('all'); setSelectedAssigneeId('all'); }}
                            sx={{ height: 40 }}
                        >
                            Clear Filters
                        </Button>
                    )}

                    {/* Desktop FAB for adding tasks */}
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setQuickAddOpen(true)}
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
                </Box>
            )}

            {/* Mobile: Tabs for columns */}
            {isMobile && (
                <Tabs
                    value={selectedTab}
                    onChange={(_, newValue) => setSelectedTab(newValue)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{
                        minHeight: 40,
                        '& .MuiTab-root': { minHeight: 40, py: 0.5, px: 1.5, fontSize: '0.75rem', fontWeight: 600 }
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
            )}

            {/* Content: Desktop=all columns, Mobile=single column */}
            <Box sx={{ flex: 1, display: 'flex', overflowX: 'auto', overflowY: 'hidden', gap: 2 }}>
                <DragDropContext onDragEnd={onDragEnd}>
                    {isMobile ? (
                        // Mobile: Show only active column
                        <GTDColumn
                            key={activeColumn?.id}
                            columnId={activeColumn?.id}
                            title={activeColumn?.title}
                            tasks={filteredColumns[activeColumn?.id] || []}
                            clientsMap={clientsMap}
                            onTaskClick={setEditingTask}
                            onAddTask={handleAddTask}
                            onStartSession={handleStartSession}
                            activeSession={activeSession}
                            onStopSession={handleStopSession}
                        />
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
                                onAddTask={handleAddTask}
                                onStartSession={handleStartSession}
                                activeSession={activeSession}
                                onStopSession={handleStopSession}
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
                    onClick={() => setQuickAddOpen(true)}
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

            {/* Quick Add Dialog */}
            <Dialog
                open={quickAddOpen}
                onClose={() => setQuickAddOpen(false)}
                fullWidth
                maxWidth="sm"
                PaperProps={{ sx: { borderRadius: 3 } }}
            >
                <DialogTitle sx={{ pb: 1 }}>
                    Add to {activeColumn?.title || 'Inbox'}
                </DialogTitle>
                <DialogContent sx={{ pt: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        autoFocus
                        fullWidth
                        placeholder="Task title..."
                        value={quickAddTitle}
                        onChange={(e) => setQuickAddTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && quickAddTitle.trim() && handleQuickAdd()}
                        sx={{ mt: 1 }}
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <FormControl fullWidth size="small">
                            <InputLabel>Client (optional)</InputLabel>
                            <Select
                                value={quickAddClientId}
                                label="Client (optional)"
                                onChange={(e) => setQuickAddClientId(e.target.value)}
                            >
                                <MenuItem value=""><em>No Client</em></MenuItem>
                                {clients.map(c => (
                                    <MenuItem key={c.id} value={c.id}>
                                        {c.name} {c.type === 'company' ? '🏢' : '👤'}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small">
                            <InputLabel>Assignee (optional)</InputLabel>
                            <Select
                                value={quickAddAssigneeId}
                                label="Assignee (optional)"
                                onChange={(e) => setQuickAddAssigneeId(e.target.value)}
                            >
                                <MenuItem value=""><em>No Assignee</em></MenuItem>
                                {users.map(u => (
                                    <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setQuickAddOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleQuickAdd} disabled={!quickAddTitle.trim()}>
                        Add
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Edit Dialog */}
            {editingTask && (
                <GTDEditDialog
                    open={!!editingTask}
                    onClose={() => setEditingTask(null)}
                    task={editingTask}
                    onSave={handleUpdateTask}
                    onDelete={handleDeleteTask}
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
        </Box>
    );
};

export default GTDBoard;
