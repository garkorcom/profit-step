/**
 * @fileoverview Types for AI Estimation Cache system
 * 
 * Provides caching for AI task estimations to reduce API costs
 * and improve response times for similar/repeated task descriptions.
 */

import { Timestamp } from 'firebase-admin/firestore';

/**
 * Cached AI estimation result
 * Stored in Firestore: ai_estimate_cache/{cacheKey}
 */
export interface AIEstimateCache {
    /** MD5 hash of normalized description + role */
    id: string;

    /** Original user input (for debugging/analytics) */
    originalDescription: string;

    /** Normalized key: lowercase, trimmed, numbers replaced */
    normalizedKey: string;

    /** Employee role (affects estimation) */
    employeeRole: string;

    // ═══════════════════════════════════════
    // CACHED AI RESPONSE
    // ═══════════════════════════════════════

    /** Estimated hours for the task */
    estimatedHours: number;

    /** Calculated cost (hours × rate) */
    calculatedCost: number;

    /** AI reasoning explanation */
    reasoning: string;

    /** Suggested materials list */
    suggestedMaterials: string[];

    /** Suggested tools list */
    suggestedTools: string[];

    // ═══════════════════════════════════════
    // ANALYTICS & METADATA
    // ═══════════════════════════════════════

    /** Number of times this cache entry was used */
    hitCount: number;

    /** When this entry was created */
    createdAt: Timestamp;

    /** Last time this cache was hit */
    lastUsedAt: Timestamp;

    /** When this cache entry expires (TTL: 30 days) */
    expiresAt: Timestamp;

    /** Hourly rate used for cost calculation */
    hourlyRate: number;
}

/**
 * Result from cache lookup
 */
export interface CacheLookupResult {
    /** Whether cache was found and valid */
    hit: boolean;

    /** Cached data if hit */
    data?: AIEstimateCache;

    /** Cache key used for lookup */
    cacheKey: string;
}

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
    /** TTL in days */
    TTL_DAYS: 30,

    /** Collection name in Firestore */
    COLLECTION: 'ai_estimate_cache',

    /** Minimum description length to cache */
    MIN_DESCRIPTION_LENGTH: 10,
} as const;
