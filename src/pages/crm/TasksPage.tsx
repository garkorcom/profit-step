import React, { useState, useEffect } from 'react';
import { Box, Button, Typography, CircularProgress } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useAuth } from '../../auth/AuthContext';
import { subscribeToTasks, createTask, updateTask, deleteTask, logTaskTime } from '../../api/taskApi';
import { Task, TaskStatus, CreateTaskData, UpdateTaskData } from '../../types/task.types';
import KanbanBoard from '../../components/tasks/KanbanBoard';
import TaskModal from '../../components/tasks/TaskModal';
import { collection, getDocs, Timestamp, query, where } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import toast from 'react-hot-toast';

const TasksPage: React.FC = () => {
    const { currentUser, userProfile } = useAuth();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);

    const companyId = userProfile?.companyId;

    useEffect(() => {
        if (!companyId) return;

        // Subscribe to tasks
        const unsubscribe = subscribeToTasks(companyId, (updatedTasks) => {
            setTasks(updatedTasks);
            setLoading(false);
        });

        // Fetch users for assignment (one-time fetch)
        const fetchUsers = async () => {
            try {
                const usersRef = collection(db, 'users');
                const q = query(usersRef, where('companyId', '==', companyId));
                const snapshot = await getDocs(q);
                const companyUsers = snapshot.docs
                    .map(doc => ({ uid: doc.id, ...doc.data() } as any));
                setUsers(companyUsers);
            } catch (error) {
                console.error("Error fetching users:", error);
            }
        };

        fetchUsers();

        return () => unsubscribe();
    }, [companyId]);

    const handleTaskMove = async (taskId: string, newStatus: TaskStatus) => {
        if (!companyId) return;
        try {
            await updateTask(companyId, taskId, { status: newStatus });
        } catch (error) {
            console.error("Error moving task:", error);
            toast.error("Failed to update task status");
        }
    };

    const handleCreateTask = () => {
        setSelectedTask(undefined);
        setIsModalOpen(true);
    };

    const handleEditTask = (task: Task) => {
        setSelectedTask(task);
        setIsModalOpen(true);
    };

    const handleSaveTask = async (data: CreateTaskData | UpdateTaskData) => {
        if (!companyId || !currentUser) return;

        try {
            if (selectedTask) {
                await updateTask(companyId, selectedTask.id, data);
                toast.success("Task updated");
            } else {
                await createTask(companyId, currentUser.uid, data as CreateTaskData);
                toast.success("Task created");
            }
        } catch (error) {
            console.error("Error saving task:", error);
            toast.error("Failed to save task");
        }
    };

    const handleDeleteTask = async () => {
        if (!companyId || !selectedTask) return;
        if (window.confirm("Are you sure you want to delete this task?")) {
            try {
                await deleteTask(companyId, selectedTask.id);
                toast.success("Task deleted");
                setIsModalOpen(false);
            } catch (error) {
                console.error("Error deleting task:", error);
                toast.error("Failed to delete task");
            }
        }
    };

    const handleLogTime = async (duration: number) => {
        if (!companyId || !selectedTask || !currentUser) return;
        try {
            const timeLog = {
                userId: currentUser.uid,
                startTime: Timestamp.now(), // Approximate, ideally passed from modal
                duration: duration
            };
            await logTaskTime(companyId, selectedTask.id, timeLog, duration);
            toast.success("Time logged");
        } catch (error) {
            console.error("Error logging time:", error);
            toast.error("Failed to log time");
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100vh">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h4" fontWeight="bold">
                    Tasks
                </Typography>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={handleCreateTask}
                >
                    Add Task
                </Button>
            </Box>

            <KanbanBoard
                tasks={tasks}
                onTaskMove={handleTaskMove}
                onTaskClick={handleEditTask}
            />

            <TaskModal
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                task={selectedTask}
                users={users}
                onSave={handleSaveTask}
                onDelete={selectedTask ? handleDeleteTask : undefined}
                onLogTime={selectedTask ? handleLogTime : undefined}
            />
        </Box>
    );
};

export default TasksPage;
