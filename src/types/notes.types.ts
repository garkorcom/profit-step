/**
 * @fileoverview Types for Notes/Inbox module
 * 
 * Notes are quick captures from Telegram and Web that flow into the GTD system.
 * "Fire & Forget" pattern - user sends, system processes asynchronously.
 * 
 * @module types/notes.types
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Note stage in the pipeline
 * 
 * INTAKE:
 * - inbox: Just received, not processed
 * - processing: AI is transcribing/analyzing
 * - ready: Processed, ready for triage
 * 
 * WORKFLOW (Cockpit View):
 * - planning: Being enriched (project, assignee, estimate)
 * - execution: Work in progress
 * - review: Submitted for controller verification
 * - done: Completed and verified
 * 
 * ARCHIVE:
 * - archived: Soft deleted/merged
 */
export type NoteStage =
    | 'inbox'
    | 'processing'
    | 'ready'
    | 'planning'
    | 'execution'
    | 'review'
    | 'done'
    | 'archived';

/**
 * Source channel for the note
 */
export type NoteChannel = 'telegram' | 'web';

/**
 * AI processing status
 */
export type AIStatus = 'none' | 'pending' | 'completed' | 'failed';

/**
 * Attachment type
 */
export type AttachmentType = 'image' | 'audio' | 'file' | 'video';

/**
 * Checklist item within a note (batch task support)
 */
export interface ChecklistItem {
    /** Unique ID for this item (UUID) */
    id: string;
    /** Task text */
    text: string;
    /** Completion status */
    isDone: boolean;
    /** Reference to photo if item was created from image */
    originalSource?: string;
}

/**
 * Note attachment (photo, voice, document)
 */
export interface NoteAttachment {
    /** Type of attachment */
    type: AttachmentType;
    /** Firebase Storage URL (not Telegram URL!) */
    url: string;
    /** Original filename */
    name?: string;
    /** MIME type */
    mimeType?: string;
    /** File size in bytes */
    size?: number;
}

/**
 * Source tracking for the note
 */
export interface NoteSource {
    /** Channel where note originated */
    channel: NoteChannel;
    /** External ID (Telegram message_id, etc.) */
    externalId?: string;
    /** Sender display name */
    senderName?: string;
    /** Original chat ID (for Telegram) */
    chatId?: number;
    /** Media group ID for album detection */
    mediaGroupId?: string;
    /** Forward info */
    forwardFrom?: {
        name: string;
        id?: number;
    };
}

/**
 * Main Note interface (v2 with checklist support)
 * 
 * Stored in Firestore: `notes/{noteId}`
 */
export interface Note {
    /** Document ID */
    id: string;

    /** Pipeline stage */
    stage: NoteStage;

    /** Source tracking */
    source: NoteSource;

    /** Owner (platform user ID from Firebase Auth) */
    ownerId: string;
    /** Owner display name */
    ownerName?: string;
    /** Telegram ID (for bot responses) */
    telegramId?: number;

    /** Title (first 50 chars or AI-generated) */
    title: string;
    /** Full description/text (original input for history) */
    description?: string;

    // ═══════════════════════════════════════════════════════════
    // BATCH TASK SUPPORT (v2)
    // ═══════════════════════════════════════════════════════════

    /** Embedded checklist items (max 20 recommended) */
    checklist?: ChecklistItem[];

    // ═══════════════════════════════════════════════════════════
    // CONTEXT INHERITANCE
    // ═══════════════════════════════════════════════════════════

    /** Project ID (inherited by all checklist items) */
    projectId?: string;
    /** Project name for display */
    projectName?: string;
    /** Location/site ID */
    locationId?: string;
    /** Shared deadline for the entire note/list */
    deadline?: Timestamp;

    // ═══════════════════════════════════════════════════════════
    // MERGE/SPLIT HISTORY
    // ═══════════════════════════════════════════════════════════

    /** IDs of notes that were merged into this one */
    mergedFromIds?: string[];
    /** Parent note ID (if this was split from another note) */
    parentId?: string;

    // ═══════════════════════════════════════════════════════════
    // ATTACHMENTS & MEDIA
    // ═══════════════════════════════════════════════════════════

    /** Attachments (photos, audio, files) */
    attachments?: NoteAttachment[];

    /** AI processing status */
    aiStatus: AIStatus;
    /** AI error message if failed */
    aiError?: string;
    /** Original audio URL (for re-processing) */
    originalAudioUrl?: string;

    /** Geolocation if provided */
    location?: {
        latitude: number;
        longitude: number;
    };

    /** Created timestamp */
    createdAt: Timestamp;
    /** Last updated */
    updatedAt?: Timestamp;

    /** Flag: has been converted to GTD task */
    convertedToTask?: boolean;
    /** ID of created task (for traceability) */
    taskId?: string;

    // ═══════════════════════════════════════════════════════════
    // 👥 SMART DISPATCHER - ROLES
    // ═══════════════════════════════════════════════════════════

    /** 
     * Assigned user IDs (detected by AI from voice mentions)
     * Example: "Леша, сделай плитку" → assigneeIds: ["user_555"]
     */
    assigneeIds?: string[];
    /** Assignee display names for UI */
    assigneeNames?: string[];

    /**
     * Controller ID - who verifies the work
     * Auto-set to ownerId when assignee ≠ owner
     */
    controllerId?: string;
    /** Controller display name */
    controllerName?: string;

    // ═══════════════════════════════════════════════════════════
    // 🤖 AI PREDICTION METADATA
    // ═══════════════════════════════════════════════════════════

    /**
     * AI metadata for UI highlighting
     * Shows which fields were auto-filled by Smart Dispatcher
     */
    aiMetadata?: {
        /** Project was predicted by AI (show yellow border) */
        isProjectPredicted: boolean;
        /** Assignee was predicted by AI */
        isAssigneePredicted: boolean;
        /** AI confidence level */
        confidence: 'high' | 'low';
        /** Raw AI reasoning (debug) */
        reasoning?: string;
    };

    // ═══════════════════════════════════════════════════════════
    // 🚦 QUALITY LOOP GATES
    // ═══════════════════════════════════════════════════════════

    /**
     * Quality control gates for delegated tasks
     * Traffic light: Blue (in work) → Orange (submitted) → Green (verified)
     */
    gates?: {
        /** Assignee clicked "Done" - submitted for review */
        internalDone: boolean;
        internalDoneAt?: Timestamp;
        internalDoneBy?: string;

        /** Controller clicked "Accept" - task verified */
        verified: boolean;
        verifiedAt?: Timestamp;
        verifiedBy?: string;

        /** Controller clicked "Return" with comment */
        returnedAt?: Timestamp;
        returnComment?: string;
    };

    /** Reason for archiving */
    archivedReason?: 'converted_to_task' | 'merged' | 'manual' | 'verified';

    /** ID of GTD Task created from this note (if converted) */
    convertedToTaskId?: string;

    // ═══════════════════════════════════════════════════════════
    // 📅 COCKPIT VIEW - SCHEDULING
    // ═══════════════════════════════════════════════════════════

    /**
     * Work schedule for the task
     */
    schedule?: {
        /** Work start date */
        start?: Timestamp;
        /** Work end date (deadline) */
        end?: Timestamp;
        /** When to remind controller for check-in */
        controlAt?: Timestamp;
    };

    // ═══════════════════════════════════════════════════════════
    // 👤 COCKPIT VIEW - CLIENT OVERRIDE
    // ═══════════════════════════════════════════════════════════

    /**
     * Client override (if different from project's client)
     * For one-off jobs where client ≠ project owner
     */
    clientId?: string;
    clientName?: string;

    // ═══════════════════════════════════════════════════════════
    // 💰 COCKPIT VIEW - FINANCE
    // ═══════════════════════════════════════════════════════════

    /**
     * Financial data for the task
     */
    financials?: {
        /** Price charged to client */
        price?: number;
        /** Actual cost (calculated from time + materials) */
        actualCost?: number;
        /** AI suggested price */
        aiSuggestedPrice?: number;
        /** Currency */
        currency?: 'USD' | 'UAH';
    };

    /** Flag: requires cost estimator review */
    isNeedsEstimate?: boolean;

    // ═══════════════════════════════════════════════════════════
    // ⏱️ COCKPIT VIEW - ACTIVE TIMER
    // ═══════════════════════════════════════════════════════════

    /**
     * Currently running timer (for quick UI display)
     * Synced via onSessionChange trigger
     */
    activeTimer?: {
        sessionId: string;
        startedAt: Timestamp;
        employeeId: string;
        employeeName: string;
    };

    // ═══════════════════════════════════════════════════════════
    // 🏷️ COCKPIT VIEW - ORGANIZATION
    // ═══════════════════════════════════════════════════════════

    /** Task priority */
    priority?: 'low' | 'medium' | 'high' | 'urgent';

    /** Tags for filtering */
    tags?: string[];

    /** Location/site within project */
    siteLocation?: string;
}

/**
 * Pending album for grouping photos
 * TTL: 5 seconds
 */
export interface PendingAlbum {
    /** Media group ID from Telegram */
    mediaGroupId: string;
    /** User ID */
    userId: number;
    /** Chat ID */
    chatId: number;
    /** Collected photo file IDs */
    photoFileIds: string[];
    /** Caption (from first photo with caption) */
    caption?: string;
    /** First photo timestamp */
    createdAt: Timestamp;
    /** Expiry timestamp */
    expiresAt: Timestamp;
}
