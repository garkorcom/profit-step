/**
 * @fileoverview API wrapper for AI Task Generation (Claude-powered)
 * 
 * Cloud Functions: generateAiTask, confirmAiTask
 * Region: us-east1 (closest to South Florida)
 */

import { httpsCallable, getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import app from '../firebase/firebase';

// Functions instance for us-east1 region (AI task functions are deployed there)
const functionsEast = getFunctions(app, 'us-east1');

// Connect to emulator if configured
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
    connectFunctionsEmulator(functionsEast, '127.0.0.1', 5001);
}

// ═══════════════════════════════════════
// TYPES — mirrors Zod schemas from Cloud Function
// ═══════════════════════════════════════

export interface AiChecklistItem {
    title: string;
    isDone: false;
}

export interface AiTaskDraft {
    title: string;
    description?: string;
    assigneeIds: string[];
    projectId: string;
    dueDate: string;           // ISO 8601 with timezone
    priority: 'low' | 'medium' | 'high' | 'urgent';
    estimatedMinutes?: number;
    zone?: string;
    checklist?: AiChecklistItem[];
}

export interface AiConfidence {
    assignee: number;  // 0..1
    project: number;
    dueDate: number;
    scope: number;
}

export interface AiPossibleDuplicate {
    found: boolean;
    existingTaskTitle?: string;
    suggestion?: 'merge' | 'link' | 'ignore';
}

export interface AiAnalysis {
    scopeStatus: 'in_estimate_pending' | 'in_estimate_completed' | 'in_change_order' | 'not_in_estimate' | 'uncertain';
    matchedEstimateItem?: string;
    scopeExplanation: string;
    assigneeReasoning: string;
    confidence: AiConfidence;
    possibleDuplicate?: AiPossibleDuplicate;
}

// Success response
export interface AiTaskSuccessResponse {
    success: true;
    draft: AiTaskDraft;
    analysis: AiAnalysis;
    auditLogId: string;
    latencyMs: number;
}

// Fallback response (Zod validation failed)
export interface AiTaskFallbackResponse {
    success: false;
    error: string;
    zodErrors: unknown[];
    fallbackToManual: true;
}

export type AiTaskResponse = AiTaskSuccessResponse | AiTaskFallbackResponse;

// ═══════════════════════════════════════
// REQUEST TYPES
// ═══════════════════════════════════════

export interface GenerateAiTaskRequest {
    userInput: string;
    projectId: string;
    clientDatetime: string;    // e.g. "Monday, Feb 16, 2026, 7:30 PM (EST)"
    inputMethod?: 'text' | 'voice' | 'photo';
}

export interface ConfirmAiTaskRequest {
    taskData: AiTaskDraft & Record<string, unknown>;
    auditLogId: string;
    userEdits?: string[];
    scopeDecision?: string;
}

export interface ConfirmAiTaskResponse {
    success: boolean;
    taskId: string;
}

// ═══════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════

/**
 * Generate AI task draft via Claude.
 * Returns a draft (NOT saved) + scope analysis for user review.
 */
export async function generateAiTask(request: GenerateAiTaskRequest): Promise<AiTaskResponse> {
    const callable = httpsCallable<GenerateAiTaskRequest, AiTaskResponse>(
        functionsEast, 'generateAiTask'
    );
    const result = await callable(request);
    return result.data;
}

/**
 * Confirm and save an AI-generated task draft.
 * Called after user reviews and optionally edits the draft.
 */
export async function confirmAiTask(request: ConfirmAiTaskRequest): Promise<ConfirmAiTaskResponse> {
    const callable = httpsCallable<ConfirmAiTaskRequest, ConfirmAiTaskResponse>(
        functionsEast, 'confirmAiTask'
    );
    const result = await callable(request);
    return result.data;
}

// ═══════════════════════════════════════
// AI TASK DECOMPOSITION (Phase 5.1)
// ═══════════════════════════════════════
//
// Two-phase: decomposeAiTask() returns proposed subtasks (no writes), the
// operator reviews/edits in the dialog, then confirmAiDecomposition()
// atomically creates the subtasks via the canonical createTaskHandler.

// Includes 'critical' because Claude often mirrors the parent task's
// post-domain priority back (parents store 'critical' in tasktotime_tasks).
// Backend mapPriority() folds 'urgent' / 'critical' to the same domain
// value, so they are visually distinct here but functionally equivalent.
export type AiSubtaskPriority =
    | 'low'
    | 'medium'
    | 'high'
    | 'urgent'
    | 'critical';

/** Proposed subtask returned from decomposeAiTask preview. */
export interface ProposedSubtask {
    title: string;
    description?: string;
    estimatedDurationMinutes: number;
    priority: AiSubtaskPriority;
    /** Optional human-readable justification — shown as a hint in the UI. */
    rationale?: string;
}

export interface DecomposeAiTaskRequest {
    taskId: string;
}

export interface DecomposeAiTaskSuccessResponse {
    success: true;
    parentTaskId: string;
    parentTitle: string;
    proposedSubtasks: ProposedSubtask[];
    summary: string;
    auditLogId: string;
    latencyMs: number;
}

export interface DecomposeAiTaskFallbackResponse {
    success: false;
    error: string;
    zodErrors: unknown[];
    fallbackToManual: true;
}

export type DecomposeAiTaskResponse =
    | DecomposeAiTaskSuccessResponse
    | DecomposeAiTaskFallbackResponse;

/** Subtask payload accepted by confirmAiDecomposition (allows 'none'). */
export interface ConfirmSubtaskInput {
    title: string;
    description?: string;
    estimatedDurationMinutes: number;
    priority: 'low' | 'medium' | 'high' | 'urgent' | 'critical' | 'none';
}

export interface ConfirmAiDecompositionRequest {
    parentTaskId: string;
    auditLogId?: string;
    subtasks: ConfirmSubtaskInput[];
}

export interface ConfirmAiDecompositionResponse {
    success: boolean;
    parentTaskId: string;
    createdTaskIds: string[];
}

/**
 * Generate a preview decomposition for an existing task.
 * No subtasks are written until confirmAiDecomposition is called.
 */
export async function decomposeAiTask(
    request: DecomposeAiTaskRequest,
): Promise<DecomposeAiTaskResponse> {
    const callable = httpsCallable<DecomposeAiTaskRequest, DecomposeAiTaskResponse>(
        functionsEast,
        'decomposeAiTask',
    );
    const result = await callable(request);
    return result.data;
}

/**
 * Apply a (possibly edited) decomposition by creating subtasks under the
 * parent. Subtasks inherit `clientId`, `projectId`, `assignedTo`, `bucket`,
 * and `dueAt` from the parent.
 */
export async function confirmAiDecomposition(
    request: ConfirmAiDecompositionRequest,
): Promise<ConfirmAiDecompositionResponse> {
    const callable = httpsCallable<
        ConfirmAiDecompositionRequest,
        ConfirmAiDecompositionResponse
    >(functionsEast, 'confirmAiDecomposition');
    const result = await callable(request);
    return result.data;
}
