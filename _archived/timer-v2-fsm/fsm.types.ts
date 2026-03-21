import { Timestamp } from 'firebase/firestore';

// --- Site (Object) ---

export interface Site {
    id: string;
    clientId: string;
    companyId: string;

    name: string;
    address: string;

    geo: {
        lat: number;
        lng: number;
        radius: number; // Default 150m
    };

    contacts: string[]; // Phone numbers of on-site contacts
    accessNotes?: string; // "Key under mat", "Code *1234#"

    photos: string[];

    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// --- Task (Supercharged) ---

export type TaskStatus = 'backlog' | 'todo' | 'scheduled' | 'traveling' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
    id: string;
    companyId: string;
    number: string; // TASK-1024
    title: string;
    description?: string;

    // Relations
    clientId: string;
    siteId: string;
    assigneeId?: string;
    estimatorId: string;

    // Status
    status: TaskStatus;
    priority: TaskPriority;

    // 💰 Financials (Real Costing)
    salesPrice: number;        // Price for client

    costLabor: number;         // Labor cost (Hours * Rate)
    costTravel: number;        // Travel cost (Hours * Travel Rate)
    costMaterials: number;     // Materials cost
    totalCost: number;         // Sum of all costs

    grossMargin: number;       // salesPrice - totalCost

    // 📸 Photos
    photosBefore: string[];
    photosAfter: string[];

    // Time Tracking
    estimatedDuration: number; // Minutes
    actualDuration: number;    // Minutes (sum of time logs)
    deadline?: Timestamp;
    scheduledStart?: Timestamp;
    scheduledEnd?: Timestamp;

    createdAt: Timestamp;
    updatedAt: Timestamp;
    completedAt?: Timestamp;
}

// --- Time Log (Advanced) ---

export type TimeLogType = 'work' | 'travel';

export interface TimeLog {
    id: string;
    companyId: string;
    taskId: string;
    userId: string;

    type: TimeLogType;

    // Start
    startTime: Timestamp;
    startGeo: {
        lat: number;
        lng: number;
        accuracy: number;
    };

    isManualOverride: boolean; // ⚠️ If GPS check failed
    overrideReason?: string;   // "GPS drift", "Forgot phone"
    startPhotoUrl: string;     // Proof of Presence

    // Stop
    endTime?: Timestamp;
    durationMinutes?: number;

    // Auto-stop
    closedBySystem: boolean;   // Watchdog closed this

    note?: string;
}

// --- Material Usage ---

export interface TaskMaterialUsage {
    id: string;
    taskId: string;
    companyId: string;

    itemId: string;            // Catalog Item ID
    name: string;              // Snapshot of name
    qty: number;               // Quantity used
    unitCost: number;          // Cost at moment of usage
    totalCost: number;         // qty * unitCost

    addedBy: string;           // userId
    addedAt: Timestamp;
}
