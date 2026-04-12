/**
 * Cleanup Agent Events — scheduled function
 *
 * Runs daily at 3 AM ET. Deletes expired events from:
 * - agent_events (TTL 7 days via expiresAt field)
 * - _processedEvents (TTL 24h via expiresAt)
 * - _idempotency (TTL 24h via expiresAt)
 *
 * Batch delete, 500 per iteration to stay within Firestore limits.
 */
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

const db = admin.firestore();
const logger = functions.logger;

/**
 * Delete expired documents from a collection in batches.
 * Returns total number of deleted documents.
 */
async function cleanupCollection(
  collectionName: string,
  expiryField: string,
): Promise<number> {
  let totalDeleted = 0;
  const now = Date.now();

  while (true) {
    // For Timestamp fields use Timestamp comparison, for number fields use number
    const query = db.collection(collectionName)
      .where(expiryField, '<', expiryField === 'expiresAt'
        ? admin.firestore.Timestamp.fromMillis(now)
        : now)
      .limit(500);

    const snap = await query.get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    totalDeleted += snap.size;
    logger.info(`🧹 ${collectionName}: deleted ${snap.size} expired docs (total: ${totalDeleted})`);

    if (snap.size < 500) break; // No more to delete
  }

  return totalDeleted;
}

export const cleanupAgentEvents = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    logger.info('🧹 cleanupAgentEvents: starting');

    const [eventsDeleted, processedDeleted, idempotencyDeleted] = await Promise.all([
      cleanupCollection('agent_events', 'expiresAt'),
      cleanupCollection('_processedEvents', 'expiresAt').catch(() => 0),
      cleanupCollection('_idempotency', 'expiresAt').catch(() => 0),
    ]);

    logger.info('🧹 cleanupAgentEvents: done', {
      eventsDeleted,
      processedDeleted,
      idempotencyDeleted,
      total: eventsDeleted + processedDeleted + idempotencyDeleted,
    });

    return null;
  });
