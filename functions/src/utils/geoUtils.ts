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
    let closestProject: ProjectLocation | null = null;
    let closestDistance = Infinity;

    // 1. Check legacy project_locations
    const snapshot = await db.collection('project_locations').get();

    // Helper to process candidate
    const processCandidate = (candidate: ProjectLocation, dist: number, radius: number) => {
        if (dist <= radius && dist < closestDistance) {
            closestDistance = dist;
            closestProject = candidate;
        }
    };

    if (!snapshot.empty) {
        for (const doc of snapshot.docs) {
            const data = doc.data() as Omit<ProjectLocation, 'id'>;
            const distance = getDistanceMiles(latitude, longitude, data.latitude, data.longitude);
            const radius = data.radiusMiles || DEFAULT_RADIUS_MILES;
            processCandidate({ id: doc.id, ...data } as ProjectLocation, distance, radius);
        }
    }

    // 2. Check Clients with workLocation
    // Optimization: In a real large DB, we'd use GeoFire or bounded queries. 
    // Here we assume manageable client count or filter by status 'active/customer'.
    const clientsSnap = await db.collection('clients')
        .where('workLocation', '!=', null)
        .get();

    for (const doc of clientsSnap.docs) {
        const client = doc.data();
        if (client.workLocation) { // Double check
            const loc = client.workLocation;
            // Use 5 miles default if not set (though UI defaults to 5)
            const radius = loc.radius || 5;
            const distance = getDistanceMiles(latitude, longitude, loc.latitude, loc.longitude);

            // Map Client to ProjectLocation interface
            const candidate: ProjectLocation = {
                id: doc.id, // Use client ID as project ID to avoid duplicates
                clientId: doc.id,
                clientName: client.name,
                latitude: loc.latitude,
                longitude: loc.longitude,
                radiusMiles: radius,
                createdAt: client.createdAt,
                lastUsed: client.updatedAt || client.createdAt,
                createdBy: 0 // System/Admin
            };

            processCandidate(candidate, distance, radius);
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
 * Will silently ignore if the document doesn't exist (e.g., when falling back to Client doc directly).
 */
export async function updateLocationLastUsed(locationId: string): Promise<void> {
    try {
        const docRef = db.collection('project_locations').doc(locationId);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            await docRef.update({
                lastUsed: admin.firestore.Timestamp.now()
            });
        }
    } catch (e) {
        console.warn(`Could not update lastUsed for location ${locationId}:`, e);
    }
}

/**
 * Extract GPS coordinates from photo EXIF metadata.
 * Works only with original photos (sent as documents), not compressed ones.
 * 
 * @param fileBuffer - Raw photo file buffer
 * @returns GPS coordinates or null if not found
 */
export async function extractGPSFromPhoto(fileBuffer: Buffer): Promise<{ latitude: number; longitude: number } | null> {
    try {
        // Dynamic import to handle missing types
        const ExifParser = require('exif-parser');

        const parser = ExifParser.create(fileBuffer);
        const result = parser.parse();

        // Check for GPS data in tags
        if (result.tags && result.tags.GPSLatitude !== undefined && result.tags.GPSLongitude !== undefined) {
            const latitude = result.tags.GPSLatitude;
            const longitude = result.tags.GPSLongitude;

            // Validate coordinates
            if (typeof latitude === 'number' && typeof longitude === 'number' &&
                latitude >= -90 && latitude <= 90 &&
                longitude >= -180 && longitude <= 180) {
                console.log(`📍 EXIF GPS found: ${latitude}, ${longitude}`);
                return { latitude, longitude };
            }
        }

        console.log('📍 No GPS in EXIF metadata');
        return null;
    } catch (error) {
        console.log('📍 EXIF parsing failed:', error);
        return null;
    }
}
