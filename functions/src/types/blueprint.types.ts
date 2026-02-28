/**
 * Blueprint types — LOCAL copy for Cloud Functions.
 *
 * This is a copy of src/types/blueprint.types.ts without the
 * firebase/firestore Timestamp import (which pulls in the client SDK
 * and causes cross-boundary import issues with tsc outDir).
 *
 * IMPORTANT: Keep in sync with src/types/blueprint.types.ts!
 */

export type BlueprintJobStatus =
    | 'pending'
    | 'processing'
    | 'comparing'
    | 'reconciling'
    | 'completed'
    | 'failed';

export interface BlueprintCoordinates {
    x: number;
    y: number;
}

export interface BlueprintItemResult {
    id: string;
    quantity: number;
    coordinates?: BlueprintCoordinates[];
}

export type BlueprintAgentResult = Record<string, number>;

export interface BlueprintDiscrepancy {
    itemId: string;
    geminiQty: number | null;
    claudeQty: number | null;
    openAiQty: number | null;
    match: boolean;
    suggestedQty: number;
    userSelectedQty?: number;
}

export interface BlueprintJob {
    id?: string;
    companyId: string;
    createdBy: string;

    fileName: string;
    fileUrl: string;
    referencePath: string;

    status: BlueprintJobStatus;

    progress: number;
    message?: string;
    logs?: { timestamp: number; message: string; type: 'info' | 'gemini' | 'claude' | 'openAi' | 'error' | 'success' }[];

    geminiStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    claudeStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    openAiStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    geminiResult?: BlueprintAgentResult;
    claudeResult?: BlueprintAgentResult;
    openAiResult?: BlueprintAgentResult;

    geminiTimeMs?: number;
    claudeTimeMs?: number;
    openAiTimeMs?: number;
    geminiErrorLog?: string;
    claudeErrorLog?: string;
    openAiErrorLog?: string;

    metadata?: {
        description?: string;
        address?: string;
        areaSqft?: number;
    };

    discrepancies?: BlueprintDiscrepancy[];
    finalResult?: BlueprintAgentResult;

    error?: string;

    createdAt: any;
    updatedAt: any;
}

// ===== Multi-File Batch Pipeline =====

export type BlueprintFileClassification = 'electrical_plan' | 'schedule' | 'cover' | 'specification' | 'other' | 'pending';
export type BlueprintFileStatus = 'uploading' | 'validating' | 'classifying' | 'analyzing' | 'completed' | 'failed' | 'skipped';
export type BlueprintBatchStatus = 'uploading' | 'classifying' | 'analyzing' | 'completed' | 'failed';

export interface BlueprintFileEntry {
    fileName: string;
    referencePath: string;
    mimeType: string;
    sizeKb: number;
    classification: BlueprintFileClassification;
    status: BlueprintFileStatus;
    error?: string;
    result?: BlueprintAgentResult;
    geminiResult?: BlueprintAgentResult;
    claudeResult?: BlueprintAgentResult;
    discrepancies?: BlueprintDiscrepancy[];
}

export interface BlueprintBatchJob {
    id?: string;
    companyId: string;
    createdBy: string;
    status: BlueprintBatchStatus;
    totalFiles: number;
    electricalCount?: number; // how many classified as electrical_plan
    files: BlueprintFileEntry[];
    progress: number;
    message?: string;
    logs?: { timestamp: number; message: string; type: 'info' | 'gemini' | 'claude' | 'openAi' | 'error' | 'success' | 'classify' }[];
    metadata?: {
        description?: string;
        address?: string;
        areaSqft?: number;
    };
    finalResult?: BlueprintAgentResult;
    error?: string;
    createdAt: any;
    updatedAt: any;
}
