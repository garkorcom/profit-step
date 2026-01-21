/**
 * @fileoverview Geo utilities for location-based project detection.
 * Uses Haversine formula to calculate distance between coordinates.
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

// Default radius for location matching (in miles)
export const DEFAULT_RADIUS_MILES = 2;

export interface ProjectLocation {
    id: string;
    clientId: string;
    clientName: string;
    serviceName?: string;
    latitude: number;
    longitude: number;
    radiusMiles: number;
    createdAt: admin.firestore.Timestamp;
    lastUsed: admin.firestore.Timestamp;
    createdBy: number; // Telegram userId
}

/**
 * Calculate distance between two coordinates using Haversine formula.
 * @returns Distance in miles
 */
export function getDistanceMiles(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 3959; // Earth radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Find a nearby project location within radius.
 * Returns the closest match if multiple are found.
 */
export async function findNearbyProject(
    latitude: number,
    longitude: number
): Promise<ProjectLocation | null> {
    const snapshot = await db.collection('project_locations').get();

    if (snapshot.empty) return null;

    let closestProject: ProjectLocation | null = null;
    let closestDistance = Infinity;

    for (const doc of snapshot.docs) {
        const data = doc.data() as Omit<ProjectLocation, 'id'>;
        const distance = getDistanceMiles(
            latitude,
            longitude,
            data.latitude,
            data.longitude
        );

        const radius = data.radiusMiles || DEFAULT_RADIUS_MILES;

        if (distance <= radius && distance < closestDistance) {
            closestDistance = distance;
            closestProject = { id: doc.id, ...data } as ProjectLocation;
        }
    }

    return closestProject;
}

/**
 * Save a new project location to the database.
 */
export async function saveProjectLocation(
    clientId: string,
    clientName: string,
    latitude: number,
    longitude: number,
    createdBy: number,
    serviceName?: string,
    radiusMiles: number = DEFAULT_RADIUS_MILES
): Promise<string> {
    const now = admin.firestore.Timestamp.now();

    const docRef = await db.collection('project_locations').add({
        clientId,
        clientName,
        serviceName: serviceName || null,
        latitude,
        longitude,
        radiusMiles,
        createdAt: now,
        lastUsed: now,
        createdBy
    });

    return docRef.id;
}

/**
 * Update lastUsed timestamp when a location is matched.
 */
export async function updateLocationLastUsed(locationId: string): Promise<void> {
    await db.collection('project_locations').doc(locationId).update({
        lastUsed: admin.firestore.Timestamp.now()
    });
}
