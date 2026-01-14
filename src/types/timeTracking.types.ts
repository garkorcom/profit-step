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
    relatedTaskId?: string; // Links to GTD Task

    // === LIFECYCLE MANAGEMENT ===
    finalizationStatus?: 'pending' | 'finalized' | 'processed';
    finalizedAt?: Timestamp;        // When session became immutable (48h after start)

    // === AUTO-CLOSE ===
    autoClosed?: boolean;           // True if closed by 48h auto-close rule

    // === MANUAL EDIT TRACKING ===
    isManuallyEdited?: boolean;     // True if admin corrected this session
    editedAt?: Timestamp;           // When the edit was made
    editedBy?: string;              // Admin UID who edited
    editNote?: string;              // Reason for the edit

    // === ORIGINAL VALUES (audit trail for edits) ===
    originalStartTime?: Timestamp;
    originalEndTime?: Timestamp;
    originalHourlyRate?: number;
    originalClientId?: string;
    originalClientName?: string;

    // === PAYROLL INTEGRATION (future) ===
    payrollPeriod?: string;         // "2026-01" - month for payroll
    payrollEntryId?: string;        // Link to payroll entry after processing
    processedAt?: Timestamp;        // When transferred to payroll
}
