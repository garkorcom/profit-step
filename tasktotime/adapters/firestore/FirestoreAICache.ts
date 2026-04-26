/**
 * FirestoreAICache — `aiCache/{key}` adapter.
 *
 * Implements {@link AICachePort} on top of Firebase Admin Firestore.
 * Caches AI predictions (e.g. estimated minutes for hash(role+description))
 * to reduce repeat OpenAI calls for similar inputs.
 *
 * See spec/04-storage/adapter-mapping.md §16 AICachePort.
 *
 * TTL strategy:
 *   - Each entry stores `expiresAt` as a Firestore Timestamp.
 *   - Adapter `get` returns `null` if `expiresAt < now()`.
 *   - Cleanup is delegated to a Firestore native TTL policy on `expiresAt`
 *     (configured outside this adapter — see deployment runbook).
 *
 * Conventions:
 *   - Doc id IS the cache key (caller chooses hash strategy).
 *   - `set` always overwrites (cache semantics — no CAS).
 *   - `incrementHit` is non-blocking / fire-and-forget eligible.
 *   - Type-safe via generics; payload is opaque to the adapter.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import type { AICachePort, AICacheEntry } from '../../ports/ai/AICachePort';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger, toEpochMs } from './_shared';

const COLLECTION = 'aiCache';

export class FirestoreAICache implements AICachePort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a cache entry. Returns `null` if the doc does not exist OR
   * is expired (`expiresAt < now()`).
   *
   * Adapter mapping (§16 row 1):
   *   `get aiCache/{key}` then guard on `expiresAt`.
   */
  async get<T = unknown>(key: string): Promise<AICacheEntry<T> | null> {
    try {
      const snap = await this.db.collection(COLLECTION).doc(key).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;

      const expiresAt = toEpochMs(data.expiresAt);
      if (expiresAt == null || expiresAt < Date.now()) {
        return null;
      }

      return {
        key: snap.id,
        value: data.value as T,
        hitCount: typeof data.hitCount === 'number' ? data.hitCount : 0,
        expiresAt,
      };
    } catch (err) {
      this.logger.error?.('FirestoreAICache.get failed', { key, err });
      throw mapFirestoreError(err, { op: 'AICache.get', key });
    }
  }

  /**
   * Overwrite (or insert) a cache entry. Resets `hitCount` to 0 so a new
   * entry isn't unfairly weighted by stale stats.
   *
   * Adapter mapping (§16 row 2):
   *   `set aiCache/{key} { value, hitCount: 0, expiresAt: now+ttlMs }`.
   */
  async set<T = unknown>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      const expiresAtMs = Date.now() + ttlMs;
      await this.db
        .collection(COLLECTION)
        .doc(key)
        .set({
          value,
          hitCount: 0,
          expiresAt: Timestamp.fromMillis(expiresAtMs),
        });
    } catch (err) {
      this.logger.error?.('FirestoreAICache.set failed', { key, err });
      throw mapFirestoreError(err, { op: 'AICache.set', key });
    }
  }

  /**
   * Atomic increment of `hitCount` via `FieldValue.increment(1)`.
   * Caller may treat this as fire-and-forget (no critical correctness).
   *
   * Adapter mapping (§16 row 3):
   *   `update aiCache/{key} { hitCount: FieldValue.increment(1) }`.
   */
  async incrementHit(key: string): Promise<void> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(key)
        .update({ hitCount: FieldValue.increment(1) });
    } catch (err) {
      this.logger.warn?.('FirestoreAICache.incrementHit failed', { key, err });
      throw mapFirestoreError(err, { op: 'AICache.incrementHit', key });
    }
  }
}
