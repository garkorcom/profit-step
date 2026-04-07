/**
 * @fileoverview useAiTask — React hook for AI Task Generation
 *
 * Connects the Task Wizard to generateAiTask Cloud Function
 * and manages the full AI draft → preview → confirm flow.
 *
 * State machine: idle → loading → preview → confirming → confirmed
 *                                  ↘ error ↙
 */

import { useState, useCallback, useRef } from 'react';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import app from '../firebase/firebase';

// ============================================================
// 1. TYPES
// ============================================================

export interface AiTaskDraft {
    title: string;
    description?: string;
    assigneeIds: string[];
    projectId: string;
    dueDate: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    estimatedMinutes?: number;
    zone?: string;
    checklist?: Array<{ title: string; isDone: false }>;
}

export interface AiAnalysis {
    scopeStatus:
    | 'in_estimate_pending'
    | 'in_estimate_completed'
    | 'in_change_order'
    | 'not_in_estimate'
    | 'uncertain';
    matchedEstimateItem?: string;
    scopeExplanation: string;
    assigneeReasoning: string;
    confidence: {
        assignee: number;
        project: number;
        dueDate: number;
        scope: number;
    };
    possibleDuplicate?: {
        found: boolean;
        existingTaskTitle?: string;
        suggestion?: 'merge' | 'link' | 'ignore';
    };
}

export interface AiGenerateResult {
    success: true;
    draft: AiTaskDraft;
    analysis: AiAnalysis;
    auditLogId: string;
    latencyMs: number;
}

export interface AiGenerateError {
    success: false;
    error: string;
    zodErrors?: Array<Record<string, unknown>>;
    fallbackToManual: boolean;
}

type AiResult = AiGenerateResult | AiGenerateError;

export type AiTaskStatus =
    | 'idle'           // nothing happening
    | 'loading'        // waiting for Cloud Function
    | 'preview'        // draft ready, user reviewing
    | 'confirming'     // saving confirmed task
    | 'confirmed'      // done, task saved
    | 'error';         // something went wrong

export interface UserEdit {
    field: string;
    aiValue: AiTaskDraft[keyof AiTaskDraft] | undefined;
    userValue: AiTaskDraft[keyof AiTaskDraft];
}

// ============================================================
// 2. HELPER: Format client datetime with timezone
// ============================================================

function getClientDatetime(): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
    };
    // Example output: "Monday, Feb 16, 2026, 2:30 PM EST"
    return now.toLocaleString('en-US', options);
}

// ============================================================
// 3. Firebase Functions instance (us-east1)
// ============================================================

const functionsEast = getFunctions(app, 'us-east1');

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
    connectFunctionsEmulator(functionsEast, '127.0.0.1', 5001);
}

// ============================================================
// 4. THE HOOK
// ============================================================

export function useAiTask() {
    // --- State ---
    const [status, setStatus] = useState<AiTaskStatus>('idle');
    const [draft, setDraft] = useState<AiTaskDraft | null>(null);
    const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
    const [auditLogId, setAuditLogId] = useState<string | null>(null);
    const [latencyMs, setLatencyMs] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [userEdits, setUserEdits] = useState<UserEdit[]>([]);

    // Keep a ref to the original AI draft for diff tracking
    const originalDraftRef = useRef<AiTaskDraft | null>(null);

    // --- Generate: call Cloud Function ---
    const generate = useCallback(
        async (params: {
            userInput: string;
            projectId: string;
            inputMethod: 'text' | 'voice' | 'photo';
        }) => {
            setStatus('loading');
            setError(null);
            setDraft(null);
            setAnalysis(null);
            setUserEdits([]);

            try {
                const callable = httpsCallable<{ userInput: string; projectId: string; inputMethod: string; clientDatetime: string }, AiResult>(
                    functionsEast,
                    'generateAiTask'
                );

                const { data } = await callable({
                    userInput: params.userInput,
                    projectId: params.projectId,
                    inputMethod: params.inputMethod,
                    clientDatetime: getClientDatetime(),
                });

                if (data.success) {
                    const result = data as AiGenerateResult;
                    setDraft(result.draft);
                    setAnalysis(result.analysis);
                    setAuditLogId(result.auditLogId);
                    setLatencyMs(result.latencyMs);
                    originalDraftRef.current = { ...result.draft };
                    setStatus('preview');
                } else {
                    const err = data as AiGenerateError;
                    setError(err.error);
                    setStatus('error');
                    // If fallbackToManual, the UI should show manual form
                }
            } catch (err: unknown) {
                console.error('generateAiTask failed:', err);
                setError(err instanceof Error ? err.message : 'AI generation failed');
                setStatus('error');
            }
        },
        []
    );

    // --- Edit draft field (tracks user changes for audit) ---
    const editDraft = useCallback(
        (field: keyof AiTaskDraft, value: AiTaskDraft[keyof AiTaskDraft]) => {
            if (!draft) return;

            // Track the edit for audit log
            const aiValue = originalDraftRef.current
                ? originalDraftRef.current[field]
                : undefined;

            if (JSON.stringify(aiValue) !== JSON.stringify(value)) {
                setUserEdits((prev) => {
                    // Replace existing edit for same field, or add new
                    const filtered = prev.filter((e) => e.field !== field);
                    return [...filtered, { field, aiValue, userValue: value }];
                });
            }

            setDraft((prev) => (prev ? { ...prev, [field]: value } : null));
        },
        [draft]
    );

    // --- Confirm: save the task via confirmAiTask ---
    const confirm = useCallback(
        async (scopeDecision?: string) => {
            if (!draft || !auditLogId) return;

            setStatus('confirming');

            try {
                const callable = httpsCallable(functionsEast, 'confirmAiTask');
                const { data } = await callable({
                    taskData: draft,
                    auditLogId,
                    userEdits,
                    scopeDecision: scopeDecision || null,
                });

                setStatus('confirmed');
                return data;
            } catch (err: unknown) {
                console.error('confirmAiTask failed:', err);
                setError(err instanceof Error ? err.message : 'Failed to save task');
                setStatus('error');
            }
        },
        [draft, auditLogId, userEdits]
    );

    // --- Cancel: reset local state ---
    const cancel = useCallback(() => {
        setStatus('idle');
        setDraft(null);
        setAnalysis(null);
        setAuditLogId(null);
        setLatencyMs(0);
        setError(null);
        setUserEdits([]);
        originalDraftRef.current = null;
    }, []);

    // --- Alias for semantic clarity ---
    const reset = cancel;

    // --- Derived state ---
    const isLoading = status === 'loading';
    const isPreview = status === 'preview';
    const hasError = status === 'error';
    const isConfirming = status === 'confirming';

    return {
        // State
        status,
        draft,
        analysis,
        latencyMs,
        error,
        userEdits,
        auditLogId,

        // Derived
        isLoading,
        isPreview,
        hasError,
        isConfirming,

        // Actions
        generate,
        editDraft,
        confirm,
        cancel,
        reset,
    };
}
