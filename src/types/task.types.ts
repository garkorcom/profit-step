import { Timestamp } from 'firebase/firestore';

export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TimeLog {
    userId: string;
    startTime: Timestamp;
    endTime?: Timestamp;
    duration?: number; // in seconds
}

export interface Task {
    id: string;
    companyId: string;
    title: string;
    description: string;
    status: TaskStatus;
    assigneeId?: string; // UID of assigned user
    reporterId: string; // UID of creator
    priority: TaskPriority;
    dueDate?: Timestamp;
    timeLogs: TimeLog[];
    totalTime: number; // in seconds
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface CreateTaskData {
    title: string;
    description?: string;
    status?: TaskStatus;
    assigneeId?: string;
    priority?: TaskPriority;
    dueDate?: Date;
}

export interface UpdateTaskData {
    title?: string;
    description?: string;
    status?: TaskStatus;
    assigneeId?: string | null;
    priority?: TaskPriority;
    dueDate?: Date | null;
}
