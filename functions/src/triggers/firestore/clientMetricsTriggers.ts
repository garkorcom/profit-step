/**
 * Firestore triggers that refresh Client V2 materialized metrics when
 * upstream entities change (invoice paid, meeting completed, deal status
 * flipped). Additive to the daily cron — keeps metrics fresh for the
 * highest-signal events without waiting 24 hours.
 *
 * Spec: docs/tasks/CLIENT_CARD_V2_SPEC.md §7.3.
 *
 * ⚠️ Idempotency guards (CLAUDE.md §2.1):
 *   - Field-change check: skip if relevant fields didn't actually change
 *   - Never write to the collection that triggered us
 *   - Errors in metrics compute swallowed with a logger.warn, never throw
 *     (don't want a metrics failure to block user-facing writes)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

import { ClientMetricsService } from '../../services/clientMetricsService';

function safeMetricsRecompute(clientId: string | null | undefined, trigger: string): Promise<void> {
  if (!clientId) return Promise.resolve();
  const db = admin.firestore();
  const svc = new ClientMetricsService(db);
  return svc
    .recomputeClientMetrics(clientId)
    .then(metrics => svc.writeMetricsToClient(clientId, metrics))
    .catch(e => {
      functions.logger.warn('[clientMetricsTrigger] recompute failed', {
        trigger,
        clientId,
        error: String(e),
      });
    });
}

/**
 * onInvoicePaid: when `invoices/{id}.status` transitions to 'paid'.
 * Recomputes LTV + avgPaymentDelay + healthScore.
 */
export const onInvoicePaidRecomputeMetrics = functions
  .region('us-central1')
  .firestore.document('invoices/{invoiceId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    // Field-change guard — only act on transition TO paid
    if (before.status === after.status) return null;
    if (after.status !== 'paid') return null;

    await safeMetricsRecompute(after.clientId, 'onInvoicePaid');
    return null;
  });

/**
 * onMeetingCompleted: when `meetings/{id}.status` transitions to 'completed'.
 * Refreshes lastContactAt + healthScore (contact freshness component).
 */
export const onMeetingCompletedRecomputeMetrics = functions
  .region('us-central1')
  .firestore.document('meetings/{meetingId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status) return null;
    if (after.status !== 'completed') return null;

    await safeMetricsRecompute(after.clientId, 'onMeetingCompleted');
    return null;
  });

/**
 * onDealStatusChange: any open→closed transition (won/lost).
 * Refreshes activeDealsCount + dealHealth component of healthScore.
 */
export const onDealStatusChangeRecomputeMetrics = functions
  .region('us-central1')
  .firestore.document('deals/{dealId}')
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status) return null;
    // Only care about open↔closed transitions
    const wasOpen = before.status === 'open';
    const isOpen = after.status === 'open';
    if (wasOpen === isOpen) return null;

    await safeMetricsRecompute(after.clientId, 'onDealStatusChange');
    return null;
  });
