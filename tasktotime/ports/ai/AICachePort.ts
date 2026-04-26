/**
 * AICachePort — read/write cache for AI predictions (e.g. estimated minutes
 * by hash(role + description)).
 *
 * Reduces repeat calls for similar inputs. TTL-based eviction.
 */

export interface AICacheEntry<T = unknown> {
  /** Hash key — typically hash(role + description). */
  key: string;
  value: T;
  hitCount: number;
  /** epoch ms — entry is invalid after this. */
  expiresAt: number;
}

export interface AICachePort {
  get<T = unknown>(key: string): Promise<AICacheEntry<T> | null>;
  set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void>;
  incrementHit(key: string): Promise<void>;
}
