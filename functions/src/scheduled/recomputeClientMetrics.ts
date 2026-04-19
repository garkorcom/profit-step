/**
 * Scheduled cron — daily full rebuild of Client V2 materialized metrics.
 *
 * Spec: docs/tasks/CLIENT_CARD_V2_SPEC.md §7.2.
 *
 * Runs every day at 04:00 UTC. Iterates all clients and recomputes
 * healthScore / churnRisk / LTV / counters. On prod (24 clients) runs in
 * < 30 seconds. At 1000+ clients, add Pub/Sub fan-out.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

import { ClientMetricsService } from '../services/clientMetricsService';

export const recomputeClientMetrics = functions
  .region('us-central1')
  .pubsub.schedule('0 4 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();
    const svc = new ClientMetricsService(db);

    const snap = await db.collection('clients').get();
    functions.logger.info(`[recomputeClientMetrics] starting — ${snap.size} clients`);

    const startedAt = Date.now();
    let ok = 0;
    let failed = 0;

    for (const doc of snap.docs) {
      try {
        const metrics = await svc.recomputeClientMetrics(doc.id);
        await svc.writeMetricsToClient(doc.id, metrics);
        ok++;
      } catch (e) {
        failed++;
        functions.logger.warn('[recomputeClientMetrics] client failed', {
          clientId: doc.id,
          error: String(e),
        });
      }
    }

    functions.logger.info('[recomputeClientMetrics] done', {
      ok,
      failed,
      durationMs: Date.now() - startedAt,
    });

    return null;
  });
