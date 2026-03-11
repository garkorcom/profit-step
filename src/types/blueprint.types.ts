import { Timestamp } from 'firebase/firestore';

export type BlueprintJobStatus =
    | 'pending'
    | 'processing' // Both models are analyzing
    | 'comparing'  // AI Arbitration is running
    | 'reconciling' // V3: Iterative Cross-Evaluation Engine running
    | 'completed'
    | 'failed';

export interface BlueprintCoordinates {
    x: number;
    y: number;
}

export interface BlueprintItemResult {
    id: string; // matches DEVICES or GEAR id (e.g., 'recessed_ic', 'duplex')
    quantity: number;
    coordinates?: BlueprintCoordinates[];
}

// A dictionary where key is the item id, and value is the quantity or detailed object
export type BlueprintAgentResult = Record<string, number>;

// Bounding boxes format: { box: [ymin, xmin, ymax, xmax], confidence: number } normalized 0-1000
export type BlueprintAgentV3Result = Record<string, { box: [number, number, number, number]; confidence: number }[]>;

export interface BlueprintDiscrepancy {
    itemId: string;
    geminiQty: number | null;
    claudeQty: number | null;
    openAiQty: number | null;
    match: boolean;
    suggestedQty: number; // The AI arbiter's suggestion
    userSelectedQty?: number; // Manual override by user
}

export interface BlueprintJob {
    id?: string;
    companyId: string;
    createdBy: string;

    // File details
    fileName: string;
    fileUrl: string;
    referencePath: string; // bucket path

    status: BlueprintJobStatus;

    // Progress tracking
    progress: number; // 0 to 100
    message?: string;
    logs?: { timestamp: number; message: string; type: 'info' | 'gemini' | 'claude' | 'openAi' | 'error' | 'success' }[];

    // Agent Results
    geminiStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    claudeStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    openAiStatus?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    geminiResult?: BlueprintAgentResult;
    claudeResult?: BlueprintAgentResult;
    openAiResult?: BlueprintAgentResult;

    // Agent Diagnostics
    geminiTimeMs?: number;
    claudeTimeMs?: number;
    openAiTimeMs?: number;
    geminiErrorLog?: string;
    claudeErrorLog?: string;
    openAiErrorLog?: string;

    // Metadata
    metadata?: {
        description?: string;
        address?: string;
        areaSqft?: number;
    };

    // Consensus / Discrepancies
    discrepancies?: BlueprintDiscrepancy[];
    finalResult?: BlueprintAgentResult; // Derived from discrepancies

    error?: string;

    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

// ===== Multi-File Batch Pipeline =====

export type BlueprintFileClassification = 'electrical_plan' | 'schedule' | 'cover' | 'specification' | 'other' | 'pending';
export type BlueprintFileStatus = 'uploading' | 'validating' | 'classifying' | 'converting' | 'analyzing' | 'completed' | 'failed' | 'skipped';
export type BlueprintBatchStatus = 'uploading' | 'converting' | 'previewing' | 'classifying' | 'analyzing' | 'verifying' | 'completed' | 'failed';

// Per-page tracking (V2 Pipeline)
export interface BlueprintPageEntry {
    pageIndex: number;
    previewPath: string;          // Storage path for PNG preview
    previewUrl?: string;          // Signed/public URL
    selected: boolean;            // User selected for analysis
    classification?: BlueprintFileClassification;
    geminiResult?: BlueprintAgentResult;
    claudeResult?: BlueprintAgentResult;
    analysisResult?: BlueprintAgentResult;
    discrepancies?: BlueprintDiscrepancy[];
    status?: 'pending' | 'analyzing' | 'completed' | 'failed';
}

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
    // V2: Per-page data
    pages?: BlueprintPageEntry[];
    pageCount?: number;
}

export interface BlueprintBatchJob {
    id?: string;
    companyId: string;
    createdBy: string;
    status: BlueprintBatchStatus;
    totalFiles: number;
    electricalCount?: number;
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
    // V2: Per-page results for cross-verification
    pageResults?: { fileIndex: number; pageIndex: number; result: BlueprintAgentResult }[];
    verificationFlags?: { itemId: string; flags: string[]; confidence: string }[];
    refinementRound?: number;
    error?: string;
    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}

// ===== V3 Session (Pausable Pipeline) =====
export interface BlueprintV3Session {
    id: string; // The same as projectId or batchId
    companyId: string;
    createdBy: string;
    status: 'uploading' | 'previewing' | 'configuring' | 'analyzing' | 'completed' | 'failed';
    currentStep: number;
    
    // Core state
    images: {
        id: string;
        originalFileName: string;
        pageNumber: number;
        storageUrl: string; // Remote URL (Base64 is dropped to save memory)
        selected: boolean;
        dimensions?: { width: number; height: number };
    }[];
    promptConfig?: {
        templateId: string;
        customInstructions: string;
    };
    
    // Results
    v3Results?: Record<string, BlueprintAgentV3Result>; // Raw bounding boxes and confidence
    aggregatedResult?: BlueprintAgentResult;
    anomalies?: { itemKey: string; reason: string }[];

    createdAt: Timestamp | Date;
    updatedAt: Timestamp | Date;
}
