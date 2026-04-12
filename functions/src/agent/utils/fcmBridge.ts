/**
 * FCM Bridge — Phase 10c
 *
 * Sends push notifications to employee devices via Firebase Cloud Messaging.
 * Reads FCM tokens from users/{uid}/fcmTokens subcollection.
 *
 * Fire-and-forget — never blocks the caller.
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import { AgentEvent } from './eventPublisher';

const db = admin.firestore();
const logger = functions.logger;

/** Emoji map for notification titles */
const EVENT_EMOJI: Record<string, string> = {
  task: '📋',
  session: '⏱️',
  cost: '💰',
  estimate: '📝',
  project: '🏗️',
  inventory: '📦',
  payroll: '💵',
  alert: '🚨',
};

/** Action labels for human-readable titles */
const ACTION_LABELS: Record<string, string> = {
  created: 'New',
  updated: 'Updated',
  assigned: 'Assigned',
  completed: 'Completed',
  blocked: 'Blocked',
  started: 'Started',
  stopped: 'Stopped',
  paused: 'Paused',
  auto_closed: 'Auto-closed',
  voided: 'Voided',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  low_stock: 'Low Stock',
  period_closed: 'Period Closed',
  overtime_alert: 'Overtime Alert',
};

/**
 * Build notification title and body from an event.
 */
function buildNotification(event: AgentEvent): { title: string; body: string } {
  const emoji = EVENT_EMOJI[event.type] || '🔔';
  const action = ACTION_LABELS[event.action] || event.action;
  const entityLabel = event.entityType.replace(/_/g, ' ');

  return {
    title: `${emoji} ${action} — ${entityLabel}`,
    body: event.summary,
  };
}

/**
 * Send FCM push notifications to an employee's registered devices.
 *
 * Fire-and-forget — errors are logged, never thrown.
 */
export function notifyViaFCM(event: AgentEvent): void {
  if (!event.employeeId) return; // Broadcast events — skip FCM (would need topic)

  // Don't send bot-sourced events via FCM (avoid noise)
  if (event.source === 'bot') return;

  _sendAsync(event).catch((err: any) => {
    logger.error('⚠️ FCM bridge error', {
      error: err.message,
      employeeId: event.employeeId,
    });
  });
}

async function _sendAsync(event: AgentEvent): Promise<void> {
  const uid = event.employeeId!;

  // Read all FCM tokens for this user
  const tokensSnap = await db.collection('users').doc(uid)
    .collection('fcmTokens')
    .get();

  if (tokensSnap.empty) return;

  const { title, body } = buildNotification(event);

  // Build data payload for notification click handling
  const dataPayload: Record<string, string> = {
    eventType: event.type,
    eventAction: event.action,
    entityId: event.entityId,
    entityType: event.entityType,
    // Navigate to relevant page on click
    url: getUrlForEvent(event),
  };

  // Collect all tokens
  const tokens: string[] = [];
  const tokenDocRefs: admin.firestore.DocumentReference[] = [];

  for (const doc of tokensSnap.docs) {
    const data = doc.data();
    if (data.token) {
      tokens.push(data.token);
      tokenDocRefs.push(doc.ref);
    }
  }

  if (tokens.length === 0) return;

  // Send to all devices via sendEachForMulticast
  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: dataPayload,
      webpush: {
        notification: {
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: event.entityId, // Group by entity
          renotify: true,
        },
        fcmOptions: {
          link: getUrlForEvent(event),
        },
      },
    });

    // Clean up invalid tokens
    if (response.failureCount > 0) {
      const invalidTokens: admin.firestore.DocumentReference[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const code = resp.error?.code;
          // Remove tokens that are no longer valid
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokenDocRefs[idx]);
          }
        }
      });

      // Batch delete invalid tokens
      if (invalidTokens.length > 0) {
        const batch = db.batch();
        invalidTokens.forEach(ref => batch.delete(ref));
        await batch.commit();
        logger.info('🗑️ FCM: cleaned up invalid tokens', {
          count: invalidTokens.length, employeeId: uid,
        });
      }
    }

    logger.info('📱 FCM: push sent', {
      employeeId: uid,
      eventType: `${event.type}.${event.action}`,
      success: response.successCount,
      failure: response.failureCount,
    });
  } catch (err: any) {
    logger.error('❌ FCM: send failed', {
      employeeId: uid,
      error: err.message,
    });
  }
}

/**
 * Map event to a deep-link URL for notification click.
 */
function getUrlForEvent(event: AgentEvent): string {
  switch (event.entityType) {
    case 'gtd_task':
      return `/crm/gtd?task=${event.entityId}`;
    case 'work_session':
      return '/crm/time-tracking';
    case 'cost':
      return '/crm/costs';
    case 'estimate':
      return `/crm/estimates/${event.entityId}`;
    case 'project':
      return `/crm/projects/${event.entityId}`;
    case 'inventory':
      return '/crm/inventory';
    case 'payroll_period':
      return '/crm/payroll';
    default:
      return '/crm/gtd';
  }
}
