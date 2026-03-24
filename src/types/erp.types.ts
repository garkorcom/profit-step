/**
 * @fileoverview ERP V4.0 — New Collection Types
 *
 * Phase 1 MVP: ChangeOrder, PurchaseOrder, PunchListItem, WorkAct,
 * PaymentScheduleItem, WarrantyTask, NpsRequest, CatalogItem extensions.
 *
 * All types follow Firestore-first design with denormalized fields
 * for list-view performance. FK references use plain string IDs.
 */

import { Timestamp } from 'firebase/firestore';
import { CostCategoryId } from './finance.types';

// ═══════════════════════════════════════
// SHARED ENUMS & TYPES
// ═══════════════════════════════════════

export type ErpItemType = 'material' | 'labor' | 'subcontract' | 'equipment' | 'other';

// ═══════════════════════════════════════
// CATALOG ITEM V4 EXTENSIONS
// ═══════════════════════════════════════

export interface CatalogSupplier {
    name: string;
    price: number;
    lastUpdated: Timestamp;
    contactInfo?: string;
}

/** New fields added on top of InventoryCatalogItem */
export interface CatalogItemV4Extensions {
    costPrice?: number;
    sellPrice?: number;
    markupPercent: number; // default 20
    preferredSupplier?: string;
    suppliers?: CatalogSupplier[];
    itemType: ErpItemType;
}

// ═══════════════════════════════════════
// CHANGE ORDERS
// Firestore: companies/{companyId}/change_orders/{id}
// ═══════════════════════════════════════

export type ChangeOrderStatus = 'draft' | 'pending' | 'approved' | 'rejected';

export interface ChangeOrderItem {
    id: string;
    catalogItemId?: string;
    description: string;
    type: ErpItemType;
    quantity: number;
    unit: string;
    unitCostPrice: number;
    totalCost: number;
    unitClientPrice: number;
    totalClientPrice: number;
    markupPercent: number;
}

export interface ChangeOrder {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    parentEstimateId: string;
    number: string;             // CO-001, CO-002…
    title: string;
    description?: string;
    status: ChangeOrderStatus;
    items: ChangeOrderItem[];

    // Totals
    internalTotal: number;
    clientTotal: number;
    markupTotal: number;
    defaultMarkupPercent: number;

    // Approval
    approvedAt?: Timestamp;
    approvedBy?: string;
    rejectedAt?: Timestamp;
    rejectionReason?: string;

    // Meta
    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ═══════════════════════════════════════
// PURCHASE ORDERS (receipts / actual purchases)
// Firestore: companies/{companyId}/purchase_orders/{id}
// ═══════════════════════════════════════

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'approved' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
    id: string;
    catalogItemId?: string;
    catalogItemName?: string;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    total: number;
    plannedUnitPrice?: number;
    variancePercent?: number;
}

export interface PurchaseOrder {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    taskId?: string;
    taskTitle?: string;
    estimateId?: string;
    vendor: string;
    vendorContact?: string;
    items: PurchaseOrderItem[];
    category: CostCategoryId;
    subtotal: number;
    taxAmount?: number;
    total: number;
    plannedTotal?: number;
    varianceAmount?: number;
    variancePercent?: number;
    receiptPhotoUrl?: string;
    receiptPhotoUrls?: string[];
    status: PurchaseOrderStatus;
    purchaseDate: Timestamp;
    legacyCostId?: string;

    createdBy: string;
    createdByName: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ═══════════════════════════════════════
// PUNCH LIST
// Firestore: companies/{companyId}/punch_lists/{id}
// ═══════════════════════════════════════

export type PunchItemStatus = 'open' | 'in_progress' | 'fixed' | 'verified' | 'wont_fix';
export type PunchItemPriority = 'critical' | 'major' | 'minor' | 'cosmetic';

export interface PunchListItem {
    id: string;
    description: string;
    photoUrls: string[];
    fixedPhotoUrls?: string[];
    status: PunchItemStatus;
    location?: string;
    priority: PunchItemPriority;
    assigneeId?: string;
    assigneeName?: string;
    reportedAt: Timestamp;
    fixedAt?: Timestamp;
    verifiedAt?: Timestamp;
    verifiedBy?: string;
    notes?: string;
}

export interface PunchList {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    workActId?: string;
    title: string;
    items: PunchListItem[];
    totalItems: number;
    openItems: number;
    fixedItems: number;
    verifiedItems: number;
    isResolved: boolean;
    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    resolvedAt?: Timestamp;
}

// ═══════════════════════════════════════
// WORK ACTS (milestone acceptance)
// Firestore: companies/{companyId}/work_acts/{id}
// ═══════════════════════════════════════

export type WorkActStatus =
    | 'draft'
    | 'pending_review'
    | 'punch_list'
    | 'ready_to_sign'
    | 'signed'
    | 'disputed';

export interface WorkAct {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    estimateId?: string;
    number: string;             // ACT-001
    phaseName: string;
    phaseDescription?: string;
    plannedAmount: number;
    actualAmount: number;
    completionPercent: number;
    status: WorkActStatus;
    punchListId?: string;
    blockedByPunchList: boolean;

    // Signing
    signedByClient?: string;
    signedByClientContactId?: string;
    signedByCompany?: string;
    clientSignatureUrl?: string;
    companySignatureUrl?: string;
    signedAt?: Timestamp;

    // Payment link
    invoiceId?: string;
    paymentScheduleItemId?: string;

    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ═══════════════════════════════════════
// PAYMENT SCHEDULE
// Firestore: companies/{companyId}/payment_schedules/{id}
// ═══════════════════════════════════════

export type PaymentMilestoneStatus =
    | 'upcoming'
    | 'pending'
    | 'invoiced'
    | 'partially_paid'
    | 'paid'
    | 'overdue';

export interface PaymentScheduleItem {
    id: string;
    milestoneName: string;
    workActId?: string;
    amount: number;
    percentOfTotal: number;
    dueDate: Timestamp;
    status: PaymentMilestoneStatus;
    invoiceId?: string;
    paidAmount: number;
    paidAt?: Timestamp;
}

export interface PaymentSchedule {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    estimateId: string;
    totalAmount: number;
    milestones: PaymentScheduleItem[];
    totalPaid: number;
    totalPending: number;
    totalOverdue: number;
    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ═══════════════════════════════════════
// WARRANTY TASKS
// Firestore: companies/{companyId}/warranty_tasks/{id}
// ═══════════════════════════════════════

export type WarrantyStatus = 'reported' | 'assessed' | 'in_progress' | 'resolved' | 'rejected';
export type WarrantyPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface WarrantyTask {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    description: string;
    photoUrls?: string[];
    resolvedPhotoUrls?: string[];
    status: WarrantyStatus;
    cost: number;
    costBreakdown?: {
        labor: number;
        materials: number;
        subcontract: number;
    };
    taskId?: string;
    purchaseOrderIds?: string[];
    warrantyExpiresAt?: Timestamp;
    priority: WarrantyPriority;
    reportedAt: Timestamp;
    assessedAt?: Timestamp;
    resolvedAt?: Timestamp;
    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// ═══════════════════════════════════════
// NPS REQUESTS (auto-review collection)
// Firestore: companies/{companyId}/nps_requests/{id}
// ═══════════════════════════════════════

export type NpsStatus = 'scheduled' | 'sent' | 'opened' | 'responded' | 'expired';
export type NpsChannel = 'email' | 'sms' | 'whatsapp';

export interface NpsRequest {
    id: string;
    companyId: string;
    projectId: string;
    projectName: string;
    clientId: string;
    clientName: string;
    contactEmail?: string;
    contactPhone?: string;
    channel: NpsChannel;
    status: NpsStatus;
    autoTriggered: boolean;
    scheduledAt: Timestamp;
    sentAt?: Timestamp;
    openedAt?: Timestamp;
    respondedAt?: Timestamp;
    expiresAt: Timestamp;
    score?: number;             // NPS 0-10
    reviewText?: string;
    externalReviewUrl?: string;
    publishConsent?: boolean;
    createdBy: string;
    createdAt: Timestamp;
}

// ═══════════════════════════════════════
// PROJECT LIFECYCLE (extensions for Project type)
// ═══════════════════════════════════════

export type ProjectLifecyclePhase =
    | 'lead'
    | 'estimation'
    | 'approval'
    | 'in_progress'
    | 'punch_list'
    | 'closing'
    | 'warranty'
    | 'closed';

/** Optional V4 fields to add to Project */
export interface ProjectV4Extensions {
    lifecyclePhase?: ProjectLifecyclePhase;
    warrantyMonths?: number;
    warrantyExpiresAt?: Timestamp;
    closedAt?: Timestamp;
    closedBy?: string;
    totalBudget?: number;
    internalBudget?: number;
    actualCost?: number;
    progressPercent?: number;
    primaryEstimateId?: string;
    paymentScheduleId?: string;
}

// ═══════════════════════════════════════
// PLAN vs FACT — API Response Types
// ═══════════════════════════════════════

export interface PlanVsFactBucket {
    materials: number;
    labor: number;
    subcontract: number;
    total: number;
}

export interface PlanVsFactResponse {
    clientId: string;
    clientName: string;
    planned: PlanVsFactBucket;
    actual: PlanVsFactBucket;
    variance: PlanVsFactBucket;
    margin: {
        planned: number;        // %
        actual: number;         // %
    };
    alerts: string[];
}
