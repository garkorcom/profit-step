import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, doc, updateDoc, addDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { DropResult } from '@hello-pangea/dnd';
import { db, functions } from '../firebase/firebase';
import { GTDTask, GTDStatus, GTDPriority } from '../types/gtd.types';
import { Client } from '../types/crm.types';
import { UserProfile } from '../types/user.types';

/** Factory function to avoid shared-reference bugs */
const createInitialData = (): Record<GTDStatus, GTDTask[]> => ({
    inbox: [],
    next_action: [],
    waiting: [],
    projects: [],
    estimate: [],
    someday: [],
    done: []
});

export const useGTDTasks = (currentUser: any, showAllTasks: boolean = false) => {
    const [rawTasks, setRawTasks] = useState<GTDTask[]>([]);
    const [columns, setColumns] = useState(createInitialData);
    const [loading, setLoading] = useState(true);
    // Keep a ref to previous columns for DnD rollback
    const prevColumnsRef = useRef<Record<GTDStatus, GTDTask[]> | null>(null);

    // 1. Subscribe to ALL tasks (Runs once, ignores showAllTasks changes)
    useEffect(() => {
        if (!currentUser) return;
        setLoading(true);

        const q = query(
            collection(db, 'gtd_tasks'),
            // Ограничение: желательно добавить where('status', '!=', 'done') если нужно,
            // но пока грузим всё для консистентности.
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GTDTask));
            setRawTasks(fetchedTasks);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser]); // <-- Removed showAllTasks from dependencies!

    // 2. Local memory filtering (Runs instantly on toggle without network requests)
    useEffect(() => {
        const newColumns = createInitialData();

        rawTasks.forEach(task => {
            const isMine = task.ownerId === currentUser?.uid || 
                           task.assigneeId === currentUser?.uid || 
                           task.coAssigneeIds?.includes(currentUser?.uid);

            if (showAllTasks || isMine) {
                // Safety check if status is valid
                if (newColumns[task.status]) {
                    newColumns[task.status].push(task);
                }
            }
        });

        // Sort chronologically
        Object.keys(newColumns).forEach(key => {
            newColumns[key as GTDStatus].sort((a, b) =>
                (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
            );
        });

        setColumns(newColumns);
    }, [rawTasks, showAllTasks, currentUser]);

    const moveTask = useCallback(async (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return null;
        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return null;
        }

        const sourceColId = source.droppableId as GTDStatus;
        const destColId = destination.droppableId as GTDStatus;

        let updatedTaskRef: GTDTask | null = null;

        // Save previous state for rollback
        setColumns(prev => {
            prevColumnsRef.current = prev;

            // Optimistic update
            const sourceList = [...prev[sourceColId]];
            const destList = sourceColId === destColId ? sourceList : [...prev[destColId]];

            const [movedTask] = sourceList.splice(source.index, 1);

            // Fix 1 & 3: Deep clone to prevent state mutation and keep a reference
            const updatedTask = { ...movedTask, status: destColId };
            updatedTaskRef = updatedTask;

            destList.splice(destination.index, 0, updatedTask);

            return {
                ...prev,
                [sourceColId]: sourceList,
                [destColId]: destList,
            };
        });

        // Server-Side Firestore Update (Atomic)
        if (currentUser && updatedTaskRef) {
            try {
                const moveGtdTaskFn = httpsCallable(functions, 'moveGtdTask');
                await moveGtdTaskFn({
                    taskId: draggableId,
                    destColId,
                    sourceColId
                });
                return { movedTask: updatedTaskRef as GTDTask, destColId };
            } catch (error) {
                console.error("Error moving task:", error);
                // Rollback to previous state
                if (prevColumnsRef.current) {
                    setColumns(prevColumnsRef.current);
                    prevColumnsRef.current = null;
                }
                throw error; // Let the caller handle UI feedback
            }
        }
        return null;
    }, [currentUser]);

    const addTask = useCallback(async (
        title: string,
        columnId: GTDStatus,
        clients: Client[],
        users: UserProfile[],
        clientId?: string,
        assigneeId?: string,

        extra?: {
            dueDate?: string;
            startDate?: string;
            startTime?: string;
            estimatedDurationMinutes?: number;
            priority?: GTDPriority;
            description?: string;
        }
    ) => {
        if (!currentUser) return;
        try {
            const selectedClient = clients.find(c => c.id === clientId);
            const selectedAssignee = users.find(u => u.id === assigneeId);

            const newTask: Partial<GTDTask> = {
                title,
                status: columnId,
                priority: (extra?.priority || 'none') as GTDPriority,
                createdAt: Timestamp.now(),
                ownerId: currentUser.uid,
                ownerName: currentUser.displayName || 'Unknown',
                context: '',
                description: extra?.description || '',
                ...(clientId && { clientId, clientName: selectedClient?.name || '' }),
                ...(assigneeId && { assigneeId, assigneeName: selectedAssignee?.displayName || '' }),
                // Date fields
                ...(extra?.dueDate && {
                    dueDate: Timestamp.fromDate(new Date(extra.dueDate + 'T00:00:00'))
                }),
                ...(extra?.startDate && {
                    startDate: (() => {
                        const d = new Date(extra.startDate + 'T00:00:00');
                        if (extra.startTime) {
                            const [hh, mm] = extra.startTime.split(':').map(Number);
                            d.setHours(hh, mm);
                        }
                        return Timestamp.fromDate(d);
                    })()
                }),
                ...(extra?.estimatedDurationMinutes && {
                    estimatedDurationMinutes: extra.estimatedDurationMinutes
                }),
                // Auto-set completedAt if created directly in Done
                ...(columnId === 'done' && { completedAt: Timestamp.now() }),
                // Auto-set needsEstimate if created in Estimate
                ...(columnId === 'estimate' && { needsEstimate: true }),

            };
            await addDoc(collection(db, 'gtd_tasks'), newTask);
        } catch (error) {
            console.error("Error adding task:", error);
            throw error; // Let caller handle UI feedback
        }
    }, [currentUser]);

    const updateTask = useCallback(async (taskId: string, updates: Partial<GTDTask>) => {
        if (!currentUser) return;
        try {
            const taskRef = doc(db, 'gtd_tasks', taskId);
            await updateDoc(taskRef, { ...updates, updatedAt: Timestamp.now() });
        } catch (error) {
            console.error("Error updating task:", error);
            throw error;
        }
    }, [currentUser]);

    const deleteTask = useCallback(async (taskId: string) => {
        if (!currentUser) return;
        try {
            const taskRef = doc(db, 'gtd_tasks', taskId);
            await deleteDoc(taskRef);
        } catch (error) {
            console.error("Error deleting task:", error);
            throw error; // Let caller handle UI feedback
        }
    }, [currentUser]);

    return {
        columns,
        loading,
        moveTask,
        addTask,
        updateTask,
        deleteTask
    };
};
