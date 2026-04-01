/**
 * Estimate Validation Utility — Cloud Functions version.
 * 
 * Mirrors src/utils/estimateValidation.ts for use in batch pipeline.
 * KEEP IN SYNC with the frontend version.
 */

// Cost thresholds — reserved for future use when cost data is available in batch pipeline
// const COST_PER_SQFT_MIN = 15;
// const COST_PER_SQFT_MAX = 35;
const ROOM_COUNT_MAX = 15;

export type ValidationStatus = 'ok' | 'warning' | 'error';

export interface CostValidation {
    costPerSqft: number;
    status: ValidationStatus;
    message: string;
}

export interface RoomValidation {
    roomCount: number;
    status: ValidationStatus;
    message: string;
}

export interface BatchValidation {
    areaSqft: number;
    fileCount: number;
    electricalCount: number;
    totalDevices: number;
    costValidation?: CostValidation;   // Only when areaSqft is known
    roomValidation: RoomValidation;
    hasWarnings: boolean;
}

export function validateRoomCount(count: number): RoomValidation {
    if (count > ROOM_COUNT_MAX) {
        return {
            roomCount: count,
            status: 'warning',
            message: `⚠️ ${count} files — Проверить количество: возможно задвоение данных`,
        };
    }
    return {
        roomCount: count,
        status: 'ok',
        message: `✅ ${count} files — Normal`,
    };
}

export function generateBatchValidation(params: {
    areaSqft: number;
    fileCount: number;
    electricalCount: number;
    finalResult: Record<string, number>;
}): BatchValidation {
    const { areaSqft, fileCount, electricalCount, finalResult } = params;
    const totalDevices = Object.values(finalResult).reduce((s, v) => s + v, 0);
    const roomValidation = validateRoomCount(electricalCount);

    return {
        areaSqft,
        fileCount,
        electricalCount,
        totalDevices,
        roomValidation,
        hasWarnings: roomValidation.status !== 'ok',
    };
}

export function formatBatchValidationLog(v: BatchValidation): string {
    const lines = [
        `📋 OVERVIEW: ${v.areaSqft > 0 ? v.areaSqft + ' sq ft' : 'area unknown'}, ${v.electricalCount} electrical files, ${v.totalDevices} devices`,
        `   Room/File validation: ${v.roomValidation.message}`,
    ];
    return lines.join('\n');
}
