import { Timestamp } from 'firebase/firestore';

// ═══════════════════════════════════════
// UNIFIED PROJECT TYPES
// ═══════════════════════════════════════

/**
 * Project type discriminator.
 * - work: Active work project (GTD tasks, time tracking, ledger)
 * - estimate: AI blueprint analysis project (files, versions, QA)
 * - financial: Financial tracking only (ledger entries)
 * - other: Uncategorized
 */
export type ProjectType = 'work' | 'estimate' | 'financial' | 'other';

export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'archived';

export interface ProjectFile {
    id: string;
    name: string;
    path: string; // Firebase Storage path
    url?: string; // Firebase Download URL (optional)
    size: number;
    type: string; // Mime type e.g. 'application/pdf'
    uploadedAt: Timestamp;
    uploadedBy: string;
}

/**
 * Unified Project — single source of truth for all project types.
 * 
 * Merges CRM financial projects (totalDebit/totalCredit/balance)
 * with Estimates workspace projects (areaSqft/files/projectType).
 * 
 * All projects belong to a Client via clientId.
 */
export interface Project {
    id: string;
    companyId: string;
    clientId: string;           // Required — every project belongs to a client
    clientName: string;         // Denormalized for display
    name: string;
    description?: string;
    status: ProjectStatus;
    type: ProjectType;          // Discriminator: work | estimate | financial | other
    address?: string;

    /**
     * AI-friendly aliases for project matching (RAG context).
     * Used by Smart Dispatcher to match voice mentions to project IDs.
     * Examples: ["Кухня", "Kitchen Reno", "Phase 2"]
     */
    aliases?: string[];

    // ── Financial fields (type: work | financial) ──
    totalDebit?: number;        // All charges
    totalCredit?: number;       // All payments
    balance?: number;           // Saldo = debit - credit

    // ── Estimate fields (type: estimate) ──
    areaSqft?: number;          // Property area
    projectType?: string;       // Project classification
    facilityUse?: string;       // Facility usage type

    // ── Files library (type: estimate) ──
    files?: ProjectFile[];

    // ── Metadata ──
    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
