import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, addDoc, deleteDoc, Timestamp, or } from 'firebase/firestore';
import { DropResult } from '@hello-pangea/dnd';
import { db } from '../firebase/firebase';
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
    const [columns, setColumns] = useState(createInitialData);
    const [loading, setLoading] = useState(true);
    // Keep a ref to previous columns for DnD rollback
    const prevColumnsRef = useRef<Record<GTDStatus, GTDTask[]> | null>(null);

    // Subscribe to tasks
    useEffect(() => {
        if (!currentUser) return;
        setLoading(true);

        // Query based on showAllTasks flag
        const q = showAllTasks
            ? query(
                collection(db, 'gtd_tasks'),
                orderBy('createdAt', 'desc')
            )
            : query(
                collection(db, 'gtd_tasks'),
                or(
                    where('ownerId', '==', currentUser.uid),
                    where('assigneeId', '==', currentUser.uid),
                    where('coAssigneeIds', 'array-contains', currentUser.uid)
                )
            );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const newColumns = createInitialData();

            snapshot.docs.forEach(doc => {
                const task = { id: doc.id, ...doc.data() } as GTDTask;
                // Safety check if status is valid
                if (newColumns[task.status]) {
                    newColumns[task.status].push(task);
                }
            });

            // Sort
            Object.keys(newColumns).forEach(key => {
                newColumns[key as GTDStatus].sort((a, b) =>
                    (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
                );
            });

            setColumns(newColumns);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [currentUser, showAllTasks]);

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

        // Firestore Update
        if (currentUser && updatedTaskRef) {
            try {
                const taskRef = doc(db, 'gtd_tasks', draggableId);
                const updates: any = { status: destColId, updatedAt: Timestamp.now() };

                // Safe TaskHistory update
                const newHistoryEvent = {
                    type: 'status_changed',
                    description: `Статус изменен на "${destColId.replace('_', ' ')}"`,
                    userId: currentUser.uid,
                    userName: currentUser.displayName || 'Пользователь',
                    timestamp: Timestamp.now()
                };

                // Add to the cloned object's history, then save the full array.
                // This prevents `arrayUnion` from failing on documents missing the taskHistory field.
                const currentHistory = (updatedTaskRef as any).taskHistory || [];
                const updatedHistory = [...currentHistory, newHistoryEvent];
                updates.taskHistory = updatedHistory;

                // Auto-set completedAt when moving to Done
                if (destColId === 'done' && sourceColId !== 'done') {
                    updates.completedAt = Timestamp.now();
                }
                // Auto-set needsEstimate when moving to Estimate
                if (destColId === 'estimate') {
                    updates.needsEstimate = true;
                }

                await updateDoc(taskRef, updates);
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
