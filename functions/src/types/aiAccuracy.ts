/**
 * @fileoverview Types for AI Accuracy Tracking
 * 
 * Logs comparison between AI estimates and actual work session durations
 * to enable continuous learning and estimate refinement.
 */

import { Timestamp } from 'firebase-admin/firestore';

/**
 * Log entry comparing AI prediction vs actual work
 * Stored in Firestore: ai_accuracy_logs/{id}
 */
export interface AIAccuracyLog {
    /** Auto-generated ID */
    id?: string;

    /** Reference to the GTD task */
    taskId: string;

    /** Task title for human readability */
    taskTitle: string;

    /** Normalized description (for pattern analysis) */
    normalizedDescription: string;

    /** Reference to the work session that was completed */
    sessionId: string;

    // ═══════════════════════════════════════
    // COMPARISON DATA
    // ═══════════════════════════════════════

    /** AI predicted duration in minutes */
    predictedMinutes: number;

    /** Actual work session duration in minutes */
    actualMinutes: number;

    /**
     * Accuracy ratio: predicted / actual
     * - < 1: AI underestimated (actual took longer)
     * - = 1: Perfect prediction
     * - > 1: AI overestimated (actual was faster)
     */
    accuracyRatio: number;

    /**
     * Absolute error in minutes
     * |predicted - actual|
     */
    errorMinutes: number;

    // ═══════════════════════════════════════
    // CONTEXT DATA (for pattern analysis)
    // ═══════════════════════════════════════

    /** Employee role at time of estimate */
    employeeRole?: string;

    /** Employee ID who completed the work */
    employeeId: string;

    /** Client ID if task had one */
    clientId?: string;

    /** When the log was created */
    createdAt: Timestamp;
}

/**
 * Aggregated accuracy stats for a pattern/role
 */
export interface AIAccuracyStats {
    /** The pattern or role being analyzed */
    pattern: string;

    /** Number of samples */
    sampleCount: number;

    /** Average accuracy ratio */
    avgAccuracyRatio: number;

    /** Suggested correction multiplier */
    correctionFactor: number;

    /** Last updated */
    updatedAt: Timestamp;
}

export const ACCURACY_CONFIG = {
    /** Collection name */
    COLLECTION: 'ai_accuracy_logs',

    /** Minimum session duration to log (avoid noise from quick fixes) */
    MIN_SESSION_MINUTES: 5,

    /** Maximum reasonable ratio (filter outliers) */
    MAX_RATIO: 10,
} as const;
