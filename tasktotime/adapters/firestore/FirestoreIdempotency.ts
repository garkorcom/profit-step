/**
 * FirestoreIdempotency — `processedEvents/{tt_<key>}` adapter.
 *
 * Implements {@link IdempotencyPort} on top of Firebase Admin Firestore.
 * Protects every transition handler from re-firing the same Firebase
 * event (CLAUDE.md §2.1 — the $10k billing-bomb scenario).
 *
 * See spec/04-storage/adapter-mapping.md §17 IdempotencyPort.
 *
 * Co-tenancy with the legacy `processedEvents/` collection:
 *   We DO NOT create a new collection. Tasktotime keys are prefixed
 *   `tt_${eventId}` to coexist with the legacy `guards.ts` system.
 *
 * Fail-open contract (CRITICAL):
 *   `reserve` returns `true` on any Firestore error — we must NOT block
 *   the trigger if the lock store is unhealthy. This matches existing
 *   behaviour in `functions/src/utils/guards.ts:55-58`. We log a warning
 *   so Operations can investigate.
 *
 * TTL: default 5 minutes. Native Firestore TTL policy on `expiresAt`
 * handles eventual cleanup; the legacy `cleanupProcessedEvents` cron is
 * a fallback safety net.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import type { IdempotencyPort } from '../../ports/ai/IdempotencyPort';
import { type AdapterLogger, noopLogger, toEpochMs } from './_shared';

const COLLECTION = 'processedEvents';
const KEY_PREFIX = 'tt_';
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const FUNCTION_NAME = 'tasktotime';

export class FirestoreIdempotency implements IdempotencyPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Reserve a key with a TTL. Returns:
   *   - `true`  → first time (or previous reservation expired) — caller proceeds.
   *   - `false` → already reserved within TTL — caller must skip.
   *
   * Adapter mapping (§17 row 1):
   *   `runTransaction`:
   *     1. read processedEvents/tt_${key}
   *     2. if exists AND not expired → return false
   *     3. else set { reservedAt, expiresAt, functionName } → return true
   *
   * Fail-open: any Firestore error → return `true` and log warn so the
   * domain handler keeps moving. Mirrors `guards.ts` behaviour.
   */
  async reserve(key: string, ttlMs?: number): Promise<boolean> {
    const docId = `${KEY_PREFIX}${key}`;
    const effectiveTtl = ttlMs ?? DEFAULT_TTL_MS;

    try {
      return await this.db.runTransaction(async (tx) => {
        const ref = this.db.collection(COLLECTION).doc(docId);
        const snap = await tx.get(ref);
        const now = Date.now();

        if (snap.exists) {
          const data = snap.data();
          const existingExpiresAt = data ? toEpochMs(data.expiresAt) : null;
          if (existingExpiresAt != null && existingExpiresAt > now) {
            // Active reservation.
            return false;
          }
          // Expired — fall through to overwrite.
        }

        tx.set(ref, {
          reservedAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + effectiveTtl),
          functionName: FUNCTION_NAME,
        });
        return true;
      });
    } catch (err) {
      // Fail-open — never block the domain handler.
      this.logger.warn?.('FirestoreIdempotency.reserve fail-open', {
        key,
        docId,
        err,
      });
      return true;
    }
  }

  /**
   * Returns true if the key is currently reserved and not expired.
   *
   * Adapter mapping (§17 row 2):
   *   `get processedEvents/tt_${key}` then check `expiresAt > now`.
   *
   * Errors propagate (caller decides retry/fallback) — only `reserve` is
   * fail-open.
   */
  async isProcessed(key: string): Promise<boolean> {
    const docId = `${KEY_PREFIX}${key}`;
    try {
      const snap = await this.db.collection(COLLECTION).doc(docId).get();
      if (!snap.exists) return false;
      const data = snap.data();
      if (!data) return false;
      const expiresAt = toEpochMs(data.expiresAt);
      if (expiresAt == null) return false;
      return expiresAt > Date.now();
    } catch (err) {
      this.logger.warn?.('FirestoreIdempotency.isProcessed failed', {
        key,
        docId,
        err,
      });
      // Conservative: assume not processed so caller can retry; aligns
      // with fail-open spirit on lock-store outage.
      return false;
    }
  }

  /**
   * Manual cleanup — delete the reservation. Rarely used; the TTL policy
   * normally handles cleanup.
   *
   * Adapter mapping (§17 row 3):
   *   `delete processedEvents/tt_${key}`.
   */
  async release(key: string): Promise<void> {
    const docId = `${KEY_PREFIX}${key}`;
    try {
      await this.db.collection(COLLECTION).doc(docId).delete();
    } catch (err) {
      this.logger.warn?.('FirestoreIdempotency.release failed', {
        key,
        docId,
        err,
      });
      // Swallow — release is best-effort.
    }
  }
}
