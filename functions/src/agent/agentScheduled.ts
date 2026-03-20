/**
 * Agent Scheduled Tasks
 * - invalidateClientCache: Firestore trigger on clients collection
 * - cleanupIdempotencyKeys: Cloud Scheduler (every 24h)
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

const logger = functions.logger;
const db = admin.firestore();

/**
 * Invalidate client cache when any client document changes.
 * Sets stale: true (debounced) instead of deleting the cache doc.
 */
export const invalidateClientCache = functions
  .region('us-central1')
  .firestore.document('clients/{clientId}')
  .onWrite(async () => {
    try {
      await db.doc('_cache/active_clients').set({ stale: true }, { merge: true });
      logger.info('🔄 Client cache marked stale');
    } catch (e: any) {
      logger.error('🔄 Failed to invalidate client cache', { error: e.message });
    }
  });

/**
 * Cleanup expired idempotency keys every 24 hours.
 * Paginates through _idempotency collection in batches of 500.
 */
export const cleanupIdempotencyKeys = functions
  .pubsub.schedule('every 24 hours')
  .onRun(async () => {
    let total = 0;
    const now = Date.now();

    while (true) {
      const snap = await db.collection('_idempotency')
        .where('expiresAt', '<', now)
        .limit(500)
        .get();

      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      total += snap.size;
      if (snap.size < 500) break; // last page
    }

    logger.info(`🧹 Cleaned ${total} expired idempotency keys`);
  });
