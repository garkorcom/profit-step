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
 * Note stage in the inbox pipeline
 * - inbox: Just received, not processed
 * - processing: AI is transcribing/analyzing
 * - ready: Processed, ready for triage
 * - archived: Merged into another note (soft delete)
 */
export type NoteStage = 'inbox' | 'processing' | 'ready' | 'archived';

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
