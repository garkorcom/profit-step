/**
 * @fileoverview Utilities for AI Estimation Cache
 * 
 * Provides functions for:
 * - Normalizing task descriptions for cache lookup
 * - Generating cache keys
 * - Reading/writing cache entries
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { AIEstimateCache, CacheLookupResult, CACHE_CONFIG } from '../types/aiCache';
import { AIEstimateResponse } from '../types/aiEstimate';

const db = admin.firestore();

/**
 * Normalize description for consistent cache matching
 * 
 * Transformations:
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Remove punctuation
 * - Replace numbers with 'N' (so "5 розеток" = "3 розетки")
 * 
 * @example
 * normalizeDescription("Установить 5 розеток на кухне!")
 * // Returns: "установить n розеток на кухне"
 */
export function normalizeDescription(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')           // Multiple spaces → one
        .replace(/[.,!?;:()[\]{}""''«»]/g, '')  // Remove punctuation
        .replace(/\d+/g, 'N');          // Numbers → N
}

/**
 * Generate MD5 hash for cache key
 * Combines normalized description + employee role
 */
export function generateCacheKey(description: string, role: string): string {
    const normalized = normalizeDescription(description);
    const combined = `${normalized}|${role.toLowerCase()}`;
    return crypto.createHash('md5').update(combined).digest('hex');
}

/**
 * Look up cache entry by description and role
 * Returns hit=true if valid cache found, hit=false otherwise
 */
export async function getCachedEstimate(
    description: string,
    role: string
): Promise<CacheLookupResult> {
    const cacheKey = generateCacheKey(description, role);

    try {
        const doc = await db
            .collection(CACHE_CONFIG.COLLECTION)
            .doc(cacheKey)
            .get();

        if (!doc.exists) {
            return { hit: false, cacheKey };
        }

        const data = doc.data() as AIEstimateCache;
        const now = admin.firestore.Timestamp.now();

        // Check if expired
        if (data.expiresAt.toMillis() < now.toMillis()) {
            console.log(`[AI Cache] Expired entry for key: ${cacheKey}`);
            return { hit: false, cacheKey };
        }

        console.log(`[AI Cache] HIT! Key: ${cacheKey}, hitCount: ${data.hitCount}`);
        return { hit: true, data, cacheKey };

    } catch (error) {
        console.error('[AI Cache] Lookup error:', error);
        return { hit: false, cacheKey };
    }
}

/**
 * Increment hit counter and update lastUsedAt
 */
export async function incrementHitCount(cacheKey: string): Promise<void> {
    try {
        await db.collection(CACHE_CONFIG.COLLECTION).doc(cacheKey).update({
            hitCount: admin.firestore.FieldValue.increment(1),
            lastUsedAt: admin.firestore.Timestamp.now(),
        });
    } catch (error) {
        console.error('[AI Cache] Failed to increment hit count:', error);
    }
}

/**
 * Save new AI estimate to cache
 */
export async function saveToCache(
    cacheKey: string,
    description: string,
    role: string,
    hourlyRate: number,
    response: AIEstimateResponse
): Promise<void> {
    // Skip caching very short descriptions
    if (description.length < CACHE_CONFIG.MIN_DESCRIPTION_LENGTH) {
        console.log('[AI Cache] Description too short, skipping cache');
        return;
    }

    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
        now.toMillis() + CACHE_CONFIG.TTL_DAYS * 24 * 60 * 60 * 1000
    );

    const cacheEntry: AIEstimateCache = {
        id: cacheKey,
        originalDescription: description,
        normalizedKey: normalizeDescription(description),
        employeeRole: role,

        estimatedHours: response.estimated_hours,
        calculatedCost: response.calculated_cost,
        reasoning: response.reasoning,
        suggestedMaterials: response.suggested_materials || [],
        suggestedTools: response.suggested_tools || [],

        hitCount: 1,
        createdAt: now,
        lastUsedAt: now,
        expiresAt,
        hourlyRate,
    };

    try {
        await db.collection(CACHE_CONFIG.COLLECTION).doc(cacheKey).set(cacheEntry);
        console.log(`[AI Cache] Saved new entry: ${cacheKey}`);
    } catch (error) {
        console.error('[AI Cache] Failed to save:', error);
    }
}

/**
 * Convert cached data to AIEstimateResponse format
 * Adds fromCache flag for frontend
 */
export function cacheToResponse(cache: AIEstimateCache): AIEstimateResponse & { fromCache: boolean } {
    return {
        estimated_hours: cache.estimatedHours,
        calculated_cost: cache.calculatedCost,
        reasoning: cache.reasoning,
        suggested_materials: cache.suggestedMaterials,
        suggested_tools: cache.suggestedTools,
        fromCache: true,
    };
}
