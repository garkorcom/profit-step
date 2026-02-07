import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, addDoc, deleteDoc, Timestamp, or } from 'firebase/firestore';
import { DropResult } from '@hello-pangea/dnd';
import { db } from '../firebase/firebase';
import { GTDTask, GTDStatus, GTDPriority } from '../types/gtd.types';
import { Client } from '../types/crm.types'; // Assuming this import path
import { UserProfile } from '../types/user.types'; // Assuming this import path

const initialData: Record<GTDStatus, GTDTask[]> = {
    inbox: [],
    next_action: [],
    waiting: [],
    projects: [],
    estimate: [],
    someday: [],
    done: []
};

export const useGTDTasks = (currentUser: any, showAllTasks: boolean = false) => {
    const [columns, setColumns] = useState(initialData);

    // Subscribe to tasks
    useEffect(() => {
        if (!currentUser) return;

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
            const newColumns = { ...initialData };
            // Deep copy existing arrays to avoid reference issues if needed, 
            // but actually we want to reset and repopulate clearly.
            // Re-initializing structure ensures we don't keep stale tasks.
            for (const key in newColumns) {
                newColumns[key as GTDStatus] = [];
            }

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
        });

        return () => unsubscribe();
    }, [currentUser, showAllTasks]);

    const moveTask = async (result: DropResult) => {
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

        // Optimistic Update
        const sourceList = [...columns[sourceColId]];
        const destList = sourceColId === destColId ? sourceList : [...columns[destColId]];

        const [movedTask] = sourceList.splice(source.index, 1);
        movedTask.status = destColId;
        destList.splice(destination.index, 0, movedTask);

        const newState = {
            ...columns,
            [sourceColId]: sourceList,
            [destColId]: destList
        };
        setColumns(newState);

        // Firestore Update
        if (currentUser) {
            try {
                const taskRef = doc(db, 'gtd_tasks', draggableId);
                await updateDoc(taskRef, { status: destColId, updatedAt: Timestamp.now() });
                return { movedTask, destColId };
            } catch (error) {
                console.error("Error moving task:", error);
                // Revert? For now we just log.
            }
        }
        return null;
    };

    const addTask = async (
        title: string,
        columnId: GTDStatus,
        clients: Client[],
        users: UserProfile[],
        clientId?: string,
        assigneeId?: string,
        aiData?: {
            estimatedHours?: number;
            estimatedCost?: number;
            crewSize?: number;
            aiMaterials?: string[];
            selectedMaterials?: string[];
            aiTools?: string[];
            selectedTools?: string[];
            aiReasoning?: string;
        }
    ) => {
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
                ...(assigneeId && { assigneeId, assigneeName: selectedAssignee?.displayName || '' }),
                // AI Estimation fields (only include if defined to avoid Firestore errors)
                ...(aiData && {
                    ...(aiData.estimatedHours && { estimatedDurationMinutes: Math.round(aiData.estimatedHours * 60) }),
                    ...(aiData.estimatedCost !== undefined && { estimatedCost: aiData.estimatedCost }),
                    ...(aiData.crewSize !== undefined && { crewSize: aiData.crewSize }),
                    ...(aiData.aiMaterials && aiData.aiMaterials.length > 0 && { aiMaterials: aiData.aiMaterials }),
                    ...(aiData.selectedMaterials && aiData.selectedMaterials.length > 0 && { selectedMaterials: aiData.selectedMaterials }),
                    ...(aiData.aiTools && aiData.aiTools.length > 0 && { aiTools: aiData.aiTools }),
                    ...(aiData.selectedTools && aiData.selectedTools.length > 0 && { selectedTools: aiData.selectedTools }),
                    ...(aiData.aiReasoning && { aiReasoning: aiData.aiReasoning }),
                    aiEstimateUsed: true,
                }),
            };
            await addDoc(collection(db, 'gtd_tasks'), newTask);
        } catch (error) {
            console.error("Error adding task:", error);
        }
    };

    const updateTask = async (taskId: string, updates: Partial<GTDTask>) => {
        if (!currentUser) return;
        const taskRef = doc(db, 'gtd_tasks', taskId);
        await updateDoc(taskRef, { ...updates, updatedAt: Timestamp.now() });
    };

    const deleteTask = async (taskId: string) => {
        if (!currentUser) return;
        const taskRef = doc(db, 'gtd_tasks', taskId);
        await deleteDoc(taskRef);
    };

    return {
        columns,
        moveTask,
        addTask,
        updateTask,
        deleteTask
    };
};
