import { Timestamp } from 'firebase/firestore';

export interface WorkSession {
    id: string;
    employeeId: number | string;
    employeeName: string;
    clientId: string;
    clientName: string;
    startTime: Timestamp;
    endTime?: Timestamp;
    durationMinutes?: number;
    description?: string; // User provided description
    startPhotoId?: string;
    endPhotoId?: string;
    startPhotoUrl?: string;
    endPhotoUrl?: string;
    status: 'active' | 'completed' | 'paused' | 'auto_closed';
    reminderSent?: boolean;
    breaks?: {
        start: Timestamp;
        end: Timestamp;
        durationMinutes: number;
    }[];
    totalBreakMinutes?: number;
    startLocation?: {
        latitude: number;
        longitude: number;
    };
    hourlyRate?: number;
    sessionEarnings?: number;
    type?: 'regular' | 'correction' | 'manual_adjustment';
    relatedSessionId?: string;
    correctionNote?: string;
    isVoided?: boolean;
    voidReason?: string;
}
