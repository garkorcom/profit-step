import React, { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Paper,
    Button,
    CircularProgress,
    Alert,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { GTDTask, PRIORITY_COLORS } from '../../types/gtd.types';
import GTDEditDialog from '../gtd/GTDEditDialog';
interface ClientTasksTabProps {
    clientId: string;
    clientName: string;
}

const statusLabels: Record<string, string> = {
    'inbox': 'Входящие',
    'next_action': 'В работе',
    'projects': 'Проекты',
    'waiting': 'Ожидание',
    'estimate': 'Просчёт',
    'someday': 'Когда-нибудь',
    'done': 'Выполнено'
};

const ClientTasksTab: React.FC<ClientTasksTabProps> = ({ clientId, clientName }) => {
    const navigate = useNavigate();
    const [tasks, setTasks] = useState<GTDTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Edit dialog state
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<GTDTask | null>(null);

    const loadTasks = async () => {
        if (!clientId) return;
        setLoading(true);
        setError(null);
        try {
            const q = query(
                collection(db, 'gtd_tasks'),
                where('clientId', '==', clientId),
                orderBy('createdAt', 'desc')
            );
            const snapshot = await getDocs(q);
            const loadedTasks = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as GTDTask));
            setTasks(loadedTasks);
        } catch (err: any) {
            console.error('Error loading tasks:', err);
            setError('Не удалось загрузить задачи: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadTasks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    const handleCreateTask = () => {
        navigate(`/crm/gtd/new?clientId=${clientId}`);
    };

    const handleEditClick = (task: GTDTask) => {
        setSelectedTask(task);
        setEditDialogOpen(true);
    };

    const handleSaveTask = async (taskId: string, data: Partial<GTDTask>) => {
        try {
            const taskRef = doc(db, 'gtd_tasks', taskId);
            await updateDoc(taskRef, data);

            // Re-fetch or update local state
            setTasks(prev => prev.map(t =>
                t.id === taskId ? { ...t, ...data } : t
            ));

            // Don't close here, the dialog will close itself
        } catch (err) {
            console.error('Error updating task:', err);
            throw err;
        }
    };

    const handleDeleteTask = async (taskId: string) => {
        if (!window.confirm('Вы уверены, что хотите удалить эту задачу?')) return;
        try {
            await deleteDoc(doc(db, 'gtd_tasks', taskId));
            setTasks(prev => prev.filter(t => t.id !== taskId));
        } catch (err) {
            console.error('Error deleting task:', err);
            alert('Ошибка при удалении задачи');
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" p={4}>
                <CircularProgress />
            </Box>
        );
    }

    const activeTasks = tasks.filter(t => t.status !== 'done');

    return (
        <Box>
            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
            )}

            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6">
                    Задачи ({activeTasks.length} активных)
                </Typography>
                <Button
                    startIcon={<AddIcon />}
                    variant="contained"
                    size="small"
                    onClick={handleCreateTask}
                    sx={{ borderRadius: 2, textTransform: 'none' }}
                >
                    Новая задача
                </Button>
            </Box>

            {tasks.length === 0 ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                    Нет задач для этого клиента. Создайте первую задачу!
                </Alert>
            ) : (
                <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ bgcolor: 'background.default' }}>
                                <TableCell>Название</TableCell>
                                <TableCell>Статус</TableCell>
                                <TableCell>Приоритет</TableCell>
                                <TableCell>Дедлайн</TableCell>
                                <TableCell>Исполнитель</TableCell>
                                <TableCell align="right">Действия</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {tasks.map((task) => (
                                <TableRow
                                    key={task.id}
                                    sx={{
                                        opacity: task.status === 'done' ? 0.6 : 1,
                                        '&:hover': { bgcolor: 'action.hover' },
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => handleEditClick(task)}
                                >
                                    <TableCell>
                                        <Typography variant="body2" fontWeight={task.status !== 'done' ? 500 : 400} sx={{ textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
                                            {task.title}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={statusLabels[task.status] || task.status}
                                            size="small"
                                            color={task.status === 'done' ? 'success' : task.status === 'estimate' ? 'secondary' : 'default'}
                                            variant={task.status === 'done' ? 'outlined' : 'filled'}
                                            sx={{ fontSize: '0.7rem', height: 20 }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {task.priority !== 'none' && (
                                            <Chip
                                                label={task.priority}
                                                size="small"
                                                sx={{
                                                    bgcolor: PRIORITY_COLORS[task.priority],
                                                    color: '#fff',
                                                    fontSize: '0.7rem',
                                                    height: 20
                                                }}
                                            />
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color={(() => {
                                            if (!task.dueDate || task.status === 'done') return 'text.secondary';
                                            try {
                                                const d = typeof task.dueDate === 'string' ? new Date(task.dueDate)
                                                    : task.dueDate?.toDate ? task.dueDate.toDate()
                                                        : task.dueDate instanceof Date ? task.dueDate : null;
                                                return d && d < new Date() ? 'error.main' : 'text.secondary';
                                            } catch { return 'text.secondary'; }
                                        })()}>
                                            {(() => {
                                                if (!task.dueDate) return '-';
                                                try {
                                                    const d = typeof task.dueDate === 'string' ? new Date(task.dueDate)
                                                        : task.dueDate?.toDate ? task.dueDate.toDate()
                                                            : task.dueDate instanceof Date ? task.dueDate : null;
                                                    return d ? d.toLocaleDateString() : '-';
                                                } catch { return '-'; }
                                            })()}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="text.secondary">
                                            {task.assigneeName || 'Не назначен'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <IconButton
                                            size="small"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEditClick(task);
                                            }}
                                        >
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                        <IconButton
                                            size="small"
                                            color="error"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteTask(task.id);
                                            }}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {editDialogOpen && selectedTask && (
                <GTDEditDialog
                    open={editDialogOpen}
                    onClose={() => {
                        setEditDialogOpen(false);
                        setSelectedTask(null);
                        // Refresh to ensure we have the very latest data (or rely on the local update above)
                        loadTasks();
                    }}
                    task={selectedTask}
                    onSave={handleSaveTask}
                    onDelete={handleDeleteTask}
                />
            )}
        </Box>
    );
};

export default ClientTasksTab;
