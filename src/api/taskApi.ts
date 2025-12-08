import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp,
    arrayUnion
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Task, CreateTaskData, UpdateTaskData, TimeLog } from '../types/task.types';

const TASKS_COLLECTION = 'tasks';

// Helper to get company tasks collection reference
const getCompanyTasksRef = (companyId: string) => {
    return collection(db, 'companies', companyId, TASKS_COLLECTION);
};

export const subscribeToTasks = (companyId: string, callback: (tasks: Task[]) => void) => {
    const q = query(
        getCompanyTasksRef(companyId),
        orderBy('createdAt', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
        const tasks = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Task[];
        callback(tasks);
    });
};

export const createTask = async (companyId: string, userId: string, data: CreateTaskData) => {
    const taskData = {
        ...data,
        companyId,
        reporterId: userId,
        status: data.status || 'todo',
        priority: data.priority || 'medium',
        timeLogs: [],
        totalTime: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dueDate: data.dueDate ? Timestamp.fromDate(data.dueDate) : null
    };

    return addDoc(getCompanyTasksRef(companyId), taskData);
};

export const updateTask = async (companyId: string, taskId: string, data: UpdateTaskData) => {
    const taskRef = doc(db, 'companies', companyId, TASKS_COLLECTION, taskId);

    const updates: any = {
        ...data,
        updatedAt: serverTimestamp()
    };

    if (data.dueDate) {
        updates.dueDate = Timestamp.fromDate(data.dueDate);
    }

    return updateDoc(taskRef, updates);
};

export const deleteTask = async (companyId: string, taskId: string) => {
    const taskRef = doc(db, 'companies', companyId, TASKS_COLLECTION, taskId);
    return deleteDoc(taskRef);
};

export const logTaskTime = async (companyId: string, taskId: string, timeLog: TimeLog, additionalDuration: number) => {
    const taskRef = doc(db, 'companies', companyId, TASKS_COLLECTION, taskId);

    // We need to use a transaction or just simple update if we trust the client calculation for totalTime
    // For simplicity, we'll increment totalTime
    // Note: arrayUnion only works for unique elements. Since timestamps differ, it should be fine.

    // However, we can't increment totalTime atomically with arrayUnion easily without a transaction or increment()
    // Let's use updateDoc with increment
    const { increment } = await import('firebase/firestore');

    return updateDoc(taskRef, {
        timeLogs: arrayUnion(timeLog),
        totalTime: increment(additionalDuration),
        updatedAt: serverTimestamp()
    });
};
