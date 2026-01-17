/**
 * Employee Name Normalization Utilities
 * 
 * Centralizes employee name resolution to ensure consistent display
 * across all reports and UI components.
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase/firebase';

interface EmployeeNameInfo {
    id: string;
    canonicalName: string;
    email?: string;
}

// Cache for employee names to avoid repeated Firestore calls
const employeeNameCache = new Map<string, EmployeeNameInfo>();

/**
 * Get the canonical display name for an employee.
 * Priority: displayName > name > email > 'Unknown'
 */
export async function getCanonicalEmployeeName(employeeId: string | number): Promise<string> {
    const idStr = String(employeeId);

    // Check cache first
    const cached = employeeNameCache.get(idStr);
    if (cached) {
        return cached.canonicalName;
    }

    try {
        // Strategy 1: Look up in 'users' collection by odooId or telegramId
        const usersRef = collection(db, 'users');

        // Try odooId first (for web-created sessions)
        let q = query(usersRef, where('odooId', '==', employeeId));
        let snapshot = await getDocs(q);

        if (snapshot.empty) {
            // Try numeric odooId
            q = query(usersRef, where('odooId', '==', Number(employeeId)));
            snapshot = await getDocs(q);
        }

        if (snapshot.empty) {
            // Try telegramId (for bot-created sessions)
            q = query(usersRef, where('telegramId', '==', Number(employeeId)));
            snapshot = await getDocs(q);
        }

        if (!snapshot.empty) {
            const userData = snapshot.docs[0].data();
            const canonicalName = userData.displayName || userData.name || userData.email || 'Unknown';

            employeeNameCache.set(idStr, {
                id: idStr,
                canonicalName,
                email: userData.email
            });

            return canonicalName;
        }

        // Strategy 2: Fallback to 'employees' collection (legacy bot data)
        const empDoc = await getDoc(doc(db, 'employees', idStr));
        if (empDoc.exists()) {
            const empData = empDoc.data();
            const canonicalName = empData.name || 'Unknown';

            employeeNameCache.set(idStr, {
                id: idStr,
                canonicalName
            });

            return canonicalName;
        }
    } catch (error) {
        console.error('Error resolving employee name:', error);
    }

    return 'Unknown';
}

/**
 * Build a map of employeeId -> canonical name from a list of sessions.
 * Uses the 'users' collection as the source of truth.
 */
export async function buildEmployeeNameMap(
    sessions: Array<{ employeeId: string | number; employeeName?: string }>
): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>();
    const uniqueIds = new Set(sessions.map(s => String(s.employeeId)));

    // Batch resolve all unique employee IDs
    const uniqueIdsArray = Array.from(uniqueIds);
    for (const id of uniqueIdsArray) {
        const canonicalName = await getCanonicalEmployeeName(id);
        nameMap.set(id, canonicalName);
    }

    return nameMap;
}

/**
 * Get unique employees from sessions with normalized names.
 * Groups by employeeId and uses canonical name.
 */
export async function getUniqueEmployeesFromSessions(
    sessions: Array<{ employeeId: string | number; employeeName?: string }>
): Promise<Array<{ id: string; name: string }>> {
    const nameMap = await buildEmployeeNameMap(sessions);

    return Array.from(nameMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Clear the employee name cache (useful after profile updates)
 */
export function clearEmployeeNameCache(): void {
    employeeNameCache.clear();
}
