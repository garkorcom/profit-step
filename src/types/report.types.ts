import { Timestamp } from 'firebase/firestore';

// --- Payroll Report ---

export interface PayrollEntry {
    userId: string;
    userName: string;
    userAvatar?: string;

    totalHours: number;
    workHours: number;
    travelHours: number;

    laborRate: number;
    travelRate: number;

    totalPayout: number;

    // Risk Indicators
    manualOverrideCount: number;
    systemClosedCount: number;

    logs: {
        date: string; // YYYY-MM-DD
        siteName: string;
        startTime: string; // HH:mm
        endTime: string; // HH:mm
        type: 'work' | 'travel';
        duration: number; // hours
        payout: number;
        status: 'ok' | 'warn';
    }[];
}

export interface PayrollReport {
    companyId: string;
    periodStart: string; // ISO Date
    periodEnd: string; // ISO Date
    generatedAt: Timestamp;

    entries: PayrollEntry[];
    totalPayout: number;
}

// --- Project Profitability ---

export interface ProjectProfitability {
    projectId: string; // Task ID or Site ID depending on granularity
    projectName: string;
    clientName: string;
    status: string;

    // Budget (Estimate)
    salesPrice: number;

    // Actual Costs
    costLabor: number;
    costTravel: number;
    costMaterials: number;
    totalCost: number;

    // Result
    grossMargin: number; // salesPrice - totalCost
    grossMarginPercent: number; // (grossMargin / salesPrice) * 100
}

// --- Employee Performance ---

export interface EmployeePerformance {
    userId: string;
    userName: string;

    tasksCompleted: number;

    totalEstimatedMinutes: number;
    totalActualMinutes: number;

    efficiencyRatio: number; // totalEstimated / totalActual ( > 1 is good)

    avgRating?: number; // If we implement ratings later
}
