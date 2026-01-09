import { Timestamp } from 'firebase/firestore';

export type GTDStatus = 'inbox' | 'next_action' | 'waiting' | 'projects' | 'someday' | 'done';

export type GTDPriority = 'high' | 'medium' | 'low' | 'none';

export const PRIORITY_COLORS: Record<GTDPriority, string> = {
    high: '#ef4444',    // Red
    medium: '#f59e0b',  // Orange
    low: '#3b82f6',     // Blue
    none: 'transparent'
};

export interface Project {
    id: string;
    name: string;
    clientName?: string;
    status?: string;
}

export interface GTDTask {
    id: string;
    userId: string;
    title: string;
    status: GTDStatus;
    priority: GTDPriority;
    context: string; // e.g., '@home', '@work', '@computer'
    projectId?: string; // Link to business project
    clientId?: string; // Link to client from /clients collection
    description?: string;
    dueDate?: Timestamp;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    order?: number; // For manual sorting if needed later
}

export const GTD_COLUMNS: { id: GTDStatus; title: string }[] = [
    { id: 'inbox', title: 'Inbox' },
    { id: 'next_action', title: 'Next Actions' },
    { id: 'projects', title: 'Projects' },
    { id: 'waiting', title: 'Waiting For' },
    { id: 'someday', title: 'Someday / Maybe' },
    { id: 'done', title: 'Done ✓' }
];
