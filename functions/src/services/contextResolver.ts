/**
 * @fileoverview Context Resolver Service
 * 
 * Determines smart defaults for location/client based on user's session state.
 * Used for Shopping, GTD Tasks, and other context-aware features.
 * 
 * Priority Matrix:
 * - Active/Paused/Break session → session's clientId
 * - Offline → GPS nearby project → null
 */

import * as admin from 'firebase-admin';
import { findNearbyProject } from '../utils/geoUtils';

const db = admin.firestore();

export type UserSessionStatus = 'active' | 'paused' | 'break' | 'offline';

export interface SmartContext {
    /** Client ID from active work session (where user is clocked in) */
    sessionLocationId: string | null;
    sessionLocationName: string | null;

    /** Default target for new tasks (usually same as session, or GPS-based if offline) */
    defaultTargetId: string | null;
    defaultTargetName: string | null;

    /** Current work session status */
    userStatus: UserSessionStatus;

    /** Session document ID for reference */
    workSessionId: string | null;
}

/**
 * Resolve smart context for a user.
 * This NEVER changes the user's session - it only reads state.
 * 
 * @param userId - Telegram user ID
 * @param gps - Optional GPS coordinates for offline fallback
 */
export async function resolveContext(
    userId: number,
    gps?: { latitude: number; longitude: number }
): Promise<SmartContext> {
    // 1. Check for active or paused work session
    const activeSession = await getActiveOrPausedSession(userId);

    if (activeSession) {
        const data = activeSession.data();
        const status: UserSessionStatus = data.status === 'paused' ? 'paused' : 'active';

        return {
            sessionLocationId: data.clientId || null,
            sessionLocationName: data.clientName || null,
            defaultTargetId: data.clientId || null,
            defaultTargetName: data.clientName || null,
            userStatus: status,
            workSessionId: activeSession.id,
        };
    }

    // 2. No session - try GPS fallback
    if (gps) {
        const nearbyProject = await findNearbyProject(gps.latitude, gps.longitude);
        if (nearbyProject) {
            return {
                sessionLocationId: null,
                sessionLocationName: null,
                defaultTargetId: nearbyProject.clientId,
                defaultTargetName: nearbyProject.clientName,
                userStatus: 'offline',
                workSessionId: null,
            };
        }
    }

    // 3. Completely offline with no GPS match
    return {
        sessionLocationId: null,
        sessionLocationName: null,
        defaultTargetId: null,
        defaultTargetName: null,
        userStatus: 'offline',
        workSessionId: null,
    };
}

/**
 * Get active or paused session for user.
 * Reuses logic from telegramUtils but returns full session data.
 */
async function getActiveOrPausedSession(userId: number) {
    // Check for active sessions first
    let qs = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'active')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    // Check for paused sessions
    qs = await db.collection('work_sessions')
        .where('employeeId', '==', userId)
        .where('status', '==', 'paused')
        .orderBy('startTime', 'desc')
        .limit(1)
        .get();

    if (!qs.empty) {
        return qs.docs[0];
    }

    return null;
}

/**
 * Get all clients sorted for selection UI.
 * @param currentClientId - Currently selected client (will be at top)
 * @param gpsLocation - Optional GPS for nearby sorting
 */
export async function getClientsSortedForSelection(
    currentClientId?: string | null,
    gpsLocation?: { latitude: number; longitude: number }
): Promise<{ id: string; name: string; isCurrent: boolean; isNearby: boolean }[]> {
    // Fetch active clients (exclude 'done' status)
    const snapshot = await db.collection('clients')
        .orderBy('name', 'asc')
        .limit(50)
        .get();

    const clients: { id: string; name: string; isCurrent: boolean; isNearby: boolean; distance?: number }[] = [];

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.status === 'done') continue; // Skip done clients

        let distance: number | undefined;
        if (gpsLocation && data.workLocation) {
            const { getDistanceMiles } = await import('../utils/geoUtils');
            distance = getDistanceMiles(
                gpsLocation.latitude,
                gpsLocation.longitude,
                data.workLocation.latitude,
                data.workLocation.longitude
            );
        }

        clients.push({
            id: doc.id,
            name: data.name,
            isCurrent: doc.id === currentClientId,
            isNearby: distance !== undefined && distance < 0.5, // Within 0.5 miles
            distance,
        });
    }

    // Sort: current first, then nearby, then alphabetical
    clients.sort((a, b) => {
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        if (a.isNearby && !b.isNearby) return -1;
        if (!a.isNearby && b.isNearby) return 1;
        if (a.distance !== undefined && b.distance !== undefined) {
            return a.distance - b.distance;
        }
        return a.name.localeCompare(b.name);
    });

    return clients;
}
