/**
 * IdempotencyPort — protects triggers from re-firing the same event.
 *
 * Backed by `processedEvents/{key}` collection in Firestore (adapter side).
 * MUST be used by every transition handler — Firebase trigger retries are
 * unavoidable, and the $10k billing-bomb scenario (CLAUDE.md §2.1) is a
 * real risk without idempotency guards.
 */

export interface IdempotencyPort {
  /**
   * Reserve key. Returns `true` if first time (caller should proceed),
   * `false` if already processed (caller should skip).
   * Reservation is auto-released after `ttlMs` (default 5 minutes).
   */
  reserve(key: string, ttlMs?: number): Promise<boolean>;

  /** Returns true if key is currently reserved. */
  isProcessed(key: string): Promise<boolean>;

  /** Release reservation early (manual cleanup). */
  release(key: string): Promise<void>;
}
