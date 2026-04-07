import { Timestamp } from 'firebase/firestore';
import { ErpItemType } from './erp.types';

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted';

/** V4 adds 'locked' after approval */
export type EstimateStatusV4 = EstimateStatus | 'locked';

export type EstimateItemType = 'labor' | 'material' | 'service' | 'other';

export interface EstimateItem {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    type: EstimateItemType;
}

// ═══════════════════════════════════════
// V4 DUAL-ESTIMATE ITEMS
// ═══════════════════════════════════════

/** Internal estimate item — cost price (company-only view) */
export interface InternalEstimateItem {
    id: string;
    catalogItemId?: string;
    description: string;
    type: ErpItemType;
    quantity: number;
    unit: string;
    unitCostPrice: number;
    totalCost: number;              // quantity * unitCostPrice
    // Labor-specific
    plannedHours?: number;
    hourlyRate?: number;
    laborCost?: number;             // plannedHours * hourlyRate
    // Subcontract
    subcontractorName?: string;
    subcontractCost?: number;
}

/** Client estimate item — sell price (client-facing view) */
export interface ClientEstimateItem {
    id: string;
    internalItemId: string;         // links to InternalEstimateItem.id
    description: string;            // may differ from internal (simplified)
    quantity: number;
    unit: string;
    unitPrice: number;
    total: number;                  // quantity * unitPrice
    markupPercent: number;
}

// ═══════════════════════════════════════
// ESTIMATE (V3 backward-compatible + V4 dual)
// ═══════════════════════════════════════

export interface Estimate {
    id: string;
    companyId: string;
    clientId: string;
    clientName: string; // Denormalized for list view

    number: string; // E.g., EST-001
    status: EstimateStatus | EstimateStatusV4;

    /** Estimate type — internal cost view or commercial client-facing */
    estimateType?: 'internal' | 'commercial';

    /** V3 items — kept for backward compat */
    items: EstimateItem[];

    subtotal: number;
    taxRate: number; // Percentage, e.g., 5 for 5%
    taxAmount: number;
    total: number;

    notes?: string;
    terms?: string;

    validUntil?: Timestamp;

    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;

    // If converted
    convertedToTaskId?: string;
    convertedToProjectId?: string;

    // ── V4 Dual-estimate fields ──

    /** Schema version — 'v3' for legacy, 'v4' for dual-estimate */
    version?: 'v3' | 'v4';

    /** Project link */
    projectId?: string;
    projectName?: string;

    /** Internal (cost) items — company view */
    internalItems?: InternalEstimateItem[];

    /** Client (sell) items — client view */
    clientItems?: ClientEstimateItem[];

    // Internal totals
    internalSubtotal?: number;
    internalLaborCost?: number;
    internalSubcontractCost?: number;
    internalTotal?: number;

    // Client totals
    clientSubtotal?: number;

    // Margin
    totalMarkup?: number;           // clientSubtotal - internalSubtotal
    marginPercent?: number;         // (totalMarkup / clientSubtotal) * 100

    // Approval / Lock
    approvalDate?: Timestamp;
    approvedBy?: string;
    approvedByClientContactId?: string;
    lockedAt?: Timestamp;
    lockedBy?: string;
    lockReason?: string;            // 'auto_after_approval' | 'manual'
}

export interface CreateEstimateDTO {
    clientId: string;
    clientName: string;
    items: EstimateItem[];
    notes?: string;
    terms?: string;
    validUntil?: Date;
    taxRate?: number;
    estimateType?: 'internal' | 'commercial';
}
