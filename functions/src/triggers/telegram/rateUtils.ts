/**
 * Rate Resolution Utility
 * 
 * Single source of truth for resolving a worker's hourly rate.
 * Priority chain:
 *   1. platformUser.defaultRate
 *   2. platformUser.hourlyRate
 *   3. employees.hourlyRate
 *   4. Fallback: 0
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

export interface RateResult {
    hourlyRate: number;
    platformUser: any | null;
    platformUserId: string | null;
    companyId: string | null;
    employeeName: string;
}

/**
 * Resolve the hourly rate for a user by checking all sources.
 * Also returns identity info (platformUser, employeeName) to avoid extra lookups.
 */
export async function resolveHourlyRate(userId: number): Promise<RateResult> {
    let hourlyRate = 0;
    let platformUser: any | null = null;
    let platformUserId: string | null = null;
    let companyId: string | null = null;
    let employeeName = 'Worker';

    // Parallel fetch: platformUser + employee
    const [platformUserResult, empDoc] = await Promise.all([
        findPlatformUserForRate(userId),
        db.collection('employees').doc(String(userId)).get()
    ]);

    platformUser = platformUserResult;
    const empData = empDoc.exists ? empDoc.data() : null;

    if (platformUser) {
        employeeName = platformUser.displayName || 'Worker';
        platformUserId = platformUser.id;
        companyId = platformUser.companyId || null;

        // Priority: defaultRate → hourlyRate → employee rate
        if (platformUser.defaultRate) {
            hourlyRate = platformUser.defaultRate;
        } else if (platformUser.hourlyRate) {
            hourlyRate = platformUser.hourlyRate;
        } else if (empData?.hourlyRate) {
            hourlyRate = empData.hourlyRate;
        }
    } else if (empData) {
        employeeName = empData.name || 'Worker';
        hourlyRate = empData.hourlyRate || 0;
    }

    return { hourlyRate, platformUser, platformUserId, companyId, employeeName };
}

/**
 * Find platform user by Telegram ID (for rate resolution only).
 */
async function findPlatformUserForRate(telegramId: number): Promise<any | null> {
    try {
        const snapshot = await db.collection('users')
            .where('telegramId', '==', String(telegramId))
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        }
    } catch (error) {
        console.error("Error finding platform user for rate:", error);
    }
    return null;
}
