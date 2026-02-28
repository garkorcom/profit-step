import { Timestamp } from 'firebase/firestore';

export interface SavedEstimate {
    id: string;
    companyId: string;
    createdBy: string;
    // Project info
    projectName: string;
    address?: string;
    description?: string;
    areaSqft?: number;
    // AI batch reference
    batchId: string;
    quantities: Record<string, number>;
    originalQuantities: Record<string, number>;
    // Cost snapshot
    laborRate: number;
    wirePrice: number;
    totalMaterials: number;
    totalLabor: number;
    totalWire: number;
    grandTotal: number;
    // Meta
    filesCount: number;
    electricalCount: number;
    status: 'draft' | 'final';
    notes?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
