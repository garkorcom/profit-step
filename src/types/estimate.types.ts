import { Timestamp } from 'firebase/firestore';

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted';

export type EstimateItemType = 'labor' | 'material' | 'service' | 'other';

export interface EstimateItem {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    type: EstimateItemType;
}

export interface Estimate {
    id: string;
    companyId: string;
    clientId: string;
    clientName: string; // Denormalized for list view

    number: string; // E.g., EST-001
    status: EstimateStatus;

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
}

export interface CreateEstimateDTO {
    clientId: string;
    clientName: string;
    items: EstimateItem[];
    notes?: string;
    terms?: string;
    validUntil?: Date;
    taxRate?: number;
}
