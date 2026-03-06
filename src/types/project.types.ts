import { Timestamp } from 'firebase/firestore';

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

export interface Project {
    id: string;
    companyId: string;
    clientId?: string;
    clientName?: string; // Denormalized for display
    name: string;
    description?: string;
    status: ProjectStatus;
    address?: string;

    // Estimate Context Meta
    areaSqft?: number;
    projectType?: string;
    facilityUse?: string;

    // Files library
    files?: ProjectFile[];

    createdBy: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
