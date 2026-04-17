import { Timestamp } from 'firebase/firestore';

/**
 * Reasons a worker's start- or end-of-shift selfie may be absent.
 * Stored as a plain string in Firestore; this enum keeps call sites honest.
 */
export type PhotoSkipReason =
    | 'worker_refused_no_camera'     // Worker tapped the "skip" button at shift start
    | 'worker_skipped_on_finish'     // Worker tapped "skip" at shift end
    | 'timeout_auto_skip';           // Reserved for future auto-timeout scheduler

export interface WorkSession {
    id: string;
    employeeId: number | string;
    employeeName: string;
    clientId: string;
    clientName: string;
    /** Optional: project within client for granular attribution */
    projectId?: string;
    projectName?: string;
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
    lastBreakStart?: Timestamp; // added to support pausing logic
    breakNotificationSent?: boolean;
    startLocation?: {
        latitude: number;
        longitude: number;
    };
    hourlyRate?: number;
    sessionEarnings?: number;
    type?: 'regular' | 'correction' | 'manual_adjustment' | 'payment';
    relatedSessionId?: string;
    correctionNote?: string;
    isVoided?: boolean;
    voidReason?: string;
    needsAdjustment?: boolean; // True if session was finished late/incorrectly
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

    // === ADMIN SESSION CONTROL ===
    stoppedByAdmin?: boolean;       // True if session was stopped by admin
    adminStopReason?: string;       // Reason for admin stop
    adminStopperId?: string;        // UID of admin who stopped

    startedByAdmin?: boolean;       // True if session was started by admin
    adminStartReason?: string;      // Reason for admin start
    adminStarterId?: string;        // UID of admin who started

    // === ADMIN REVIEW ===
    requiresAdminReview?: boolean;  // True if auto-closed session needs admin confirmation

    // === TASK LINKING ===
    relatedTaskTitle?: string;      // Snapshot of task title for display

    // === AI VOICE TRANSCRIPTION ===
    plannedTaskSummary?: string;     // AI: "Шпаклевка стен" (short)
    plannedTaskDescription?: string; // AI: Full task description
    resultSummary?: string;          // AI: "Стены готовы" (short)
    resultDescription?: string;      // AI: Full result description
    issuesReported?: string;         // AI: Problems detected (blocker)
    locationDetected?: string;       // AI: Location mentioned in voice
    voiceStartUrl?: string;          // URL to start voice file
    voiceEndUrl?: string;            // URL to end voice file
    aiTranscribedAt?: Timestamp;     // When AI processed the voice

    // === GEOFENCING ===
    locationMismatch?: boolean;
    locationDistanceMeters?: number;

    // === AI FACE VERIFICATION ===
    faceMatch?: boolean;
    faceConfidence?: number;
    faceMismatchReason?: string;

    // === SELFIE / SHIFT-PHOTO SKIP AUDIT ===
    // Set when the worker explicitly skipped the start-of-shift selfie.
    // Admin UI surfaces these as a warning chip (TimeTrackingTable.tsx).
    startPhotoSkipped?: boolean;
    startPhotoSkipReason?: PhotoSkipReason;
    startPhotoSkippedAt?: Timestamp;

    // Same, for the end-of-shift photo.
    endPhotoSkipped?: boolean;
    endPhotoSkipReason?: PhotoSkipReason;
    endPhotoSkippedAt?: Timestamp;
}
