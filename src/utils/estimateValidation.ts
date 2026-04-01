/**
 * Estimate Validation Utility
 * 
 * Provides PROJECT OVERVIEW generation and automatic validation warnings
 * for cost/sq.ft ratio and room count anomalies.
 * 
 * Used in:
 * - ElectricalEstimatorPage (frontend display + sidebar)
 * - PDF export (header section)
 * - Batch pipeline completion (Firestore validation field)
 */

// ===== Validation Thresholds =====
const COST_PER_SQFT_MIN = 15;  // Below this → warning
const COST_PER_SQFT_MAX = 35;  // Above this → warning
const COST_PER_SQFT_NORM = 22; // Expected norm for materials + equipment
const ROOM_COUNT_MAX = 15;     // Above this → possible data duplication

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

export interface ProjectOverview {
    areaSqft: number;
    roomCount: number;
    totalDevices: number;
    totalBomCost: number;
    costValidation: CostValidation;
    roomValidation: RoomValidation;
    hasWarnings: boolean;
}

/**
 * Validate cost per square foot.
 * Norm: ~$22/sq.ft for materials + equipment.
 * Warning range: < $15 or > $35
 */
export function validateCostPerSqft(totalBomCost: number, areaSqft: number): CostValidation {
    if (!areaSqft || areaSqft <= 0) {
        return {
            costPerSqft: 0,
            status: 'warning',
            message: 'Area not set — cannot validate cost/sq.ft',
        };
    }

    const costPerSqft = totalBomCost / areaSqft;

    if (costPerSqft < COST_PER_SQFT_MIN) {
        return {
            costPerSqft,
            status: 'warning',
            message: `⚠️ $${costPerSqft.toFixed(2)}/sq.ft — ниже нормы ($${COST_PER_SQFT_MIN}). Проверить правильность просчёта`,
        };
    }

    if (costPerSqft > COST_PER_SQFT_MAX) {
        return {
            costPerSqft,
            status: 'warning',
            message: `⚠️ $${costPerSqft.toFixed(2)}/sq.ft — выше нормы ($${COST_PER_SQFT_MAX}). Проверить правильность просчёта`,
        };
    }

    return {
        costPerSqft,
        status: 'ok',
        message: `✅ $${costPerSqft.toFixed(2)}/sq.ft — Normal range`,
    };
}

/**
 * Validate room/file count.
 * Norm: up to 10-15 rooms.
 * Warning: > 15 rooms → possible data duplication.
 */
export function validateRoomCount(roomCount: number): RoomValidation {
    if (roomCount > ROOM_COUNT_MAX) {
        return {
            roomCount,
            status: 'warning',
            message: `⚠️ ${roomCount} rooms/pages — Проверить количество: возможно задвоение данных`,
        };
    }

    return {
        roomCount,
        status: 'ok',
        message: `✅ ${roomCount} rooms — Normal`,
    };
}

/**
 * Count total devices from a flat quantity map.
 */
export function countTotalDevices(quantities: Record<string, number>): number {
    return Object.values(quantities).reduce((sum, qty) => sum + (qty || 0), 0);
}

/**
 * Generate a full PROJECT OVERVIEW with validations.
 */
export function generateProjectOverview(params: {
    areaSqft: number;
    roomCount: number;            // file count or room count
    quantities: Record<string, number>;
    totalBomCost: number;         // materialsBase (materials + equipment, before markups)
}): ProjectOverview {
    const { areaSqft, roomCount, quantities, totalBomCost } = params;
    const totalDevices = countTotalDevices(quantities);
    const costValidation = validateCostPerSqft(totalBomCost, areaSqft);
    const roomValidation = validateRoomCount(roomCount);

    return {
        areaSqft,
        roomCount,
        totalDevices,
        totalBomCost,
        costValidation,
        roomValidation,
        hasWarnings: costValidation.status !== 'ok' || roomValidation.status !== 'ok',
    };
}

/**
 * Format PROJECT OVERVIEW as a plain text block (for Telegram/CLI/TXT exports).
 */
export function formatProjectOverviewText(overview: ProjectOverview): string {
    const lines = [
        '📋 PROJECT OVERVIEW',
        `• Area: ${overview.areaSqft > 0 ? overview.areaSqft.toLocaleString() : '—'} sq ft`,
        `• Files/Rooms: ${overview.roomCount}`,
        `• Devices: ${overview.totalDevices.toLocaleString()}`,
        `• BOM Cost: $${overview.totalBomCost.toFixed(2)}`,
        `• Cost/sq.ft: ${overview.costValidation.message}`,
        `• Room validation: ${overview.roomValidation.message}`,
        '─────────────────',
    ];
    return lines.join('\n');
}

export { COST_PER_SQFT_MIN, COST_PER_SQFT_MAX, COST_PER_SQFT_NORM, ROOM_COUNT_MAX };
