/**
 * Webhook Delivery — Phase 10
 *
 * Delivers agent events to registered webhook URLs.
 * - HMAC-SHA256 signed payloads
 * - Pattern-based event filtering (e.g. "task.*", "alert.budget_warning")
 * - 3 retries with exponential backoff
 * - Fire-and-forget — never blocks the caller
 */
import * as crypto from 'crypto';
import axios from 'axios';
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

import { AgentEvent } from './eventPublisher';

const db = admin.firestore();
const logger = functions.logger;

interface WebhookTokenDoc {
  employeeId: string;
  webhookUrl: string;
  webhookSecret: string;
  webhookEvents: string[] | null;
  scopes: string[];
}

/**
 * Match an event key (e.g. "task.assigned") against a pattern.
 * Supports exact match and wildcard (*) in the action part.
 *
 * Examples:
 *   matchPattern("task.assigned", "task.assigned") → true
 *   matchPattern("task.*", "task.assigned") → true
 *   matchPattern("alert.*", "task.assigned") → false
 *   matchPattern("*.assigned", "task.assigned") → true
 */
export function matchPattern(pattern: string, eventKey: string): boolean {
  if (pattern === '*' || pattern === '*.*') return true;

  const [patType, patAction] = pattern.split('.');
  const [evType, evAction] = eventKey.split('.');

  const typeMatch = patType === '*' || patType === evType;
  const actionMatch = patAction === '*' || patAction === evAction;

  return typeMatch && actionMatch;
}

/**
 * Sign a payload with HMAC-SHA256.
 */
export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver a webhook to a single URL with retries.
 * Returns true if delivered successfully, false after all retries exhausted.
 */
export async function deliverToUrl(
  url: string,
  payload: string,
  signature: string,
  eventKey: string,
  retries = 3,
): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Event-Type': eventKey,
          'X-Delivery-Attempt': String(attempt + 1),
          'User-Agent': 'ProfitStep-Webhook/1.0',
        },
        timeout: 10_000, // 10 second timeout per attempt
        // Accept any 2xx as success
        validateStatus: (status: number) => status >= 200 && status < 300,
      });
      logger.info('✅ Webhook delivered', { url, eventKey, status: response.status, attempt: attempt + 1 });
      return true;
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.message || 'Unknown error';
      logger.warn('⚠️ Webhook delivery attempt failed', {
        url, eventKey, attempt: attempt + 1, status, error: msg,
      });

      // Don't retry on 4xx client errors (except 408/429)
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        logger.error('❌ Webhook rejected (4xx), not retrying', { url, eventKey, status });
        return false;
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  logger.error('❌ Webhook delivery failed after all retries', { url, eventKey, retries });
  return false;
}

/**
 * Dispatch an event to all registered webhooks.
 * Queries agent_tokens for active tokens with webhookUrl set,
 * filters by event pattern, signs and delivers.
 *
 * Fire-and-forget — errors are logged, never thrown.
 */
export function dispatchWebhooks(event: AgentEvent & { id?: string }): void {
  // Run async in background — never block the caller
  _dispatchAsync(event).catch((err: any) => {
    logger.error('⚠️ Webhook dispatch error', { error: err.message, eventType: event.type });
  });
}

async function _dispatchAsync(event: AgentEvent & { id?: string }): Promise<void> {
  // Query active (non-revoked, non-expired) tokens that have a webhookUrl
  const now = admin.firestore.Timestamp.now();

  let query: FirebaseFirestore.Query = db.collection('agent_tokens')
    .where('revokedAt', '==', null)
    .where('webhookUrl', '!=', null);

  // If the event is for a specific employee, also include broadcast tokens
  // We fetch all webhook-enabled tokens and filter in code for simplicity
  const snap = await query.get();

  if (snap.empty) return;

  const eventKey = `${event.type}.${event.action}`;

  const deliveries: Promise<void>[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as WebhookTokenDoc & {
      expiresAt: admin.firestore.Timestamp;
      webhookUrl: string;
      webhookSecret: string;
    };

    // Skip expired tokens
    if (data.expiresAt && data.expiresAt.toMillis() < now.toMillis()) continue;

    // If event is employee-scoped, only deliver to that employee's tokens (or broadcast)
    if (event.employeeId && data.employeeId !== event.employeeId) continue;

    // Check event filter patterns
    if (data.webhookEvents && data.webhookEvents.length > 0) {
      const matches = data.webhookEvents.some((p: string) => matchPattern(p, eventKey));
      if (!matches) continue;
    }

    // Build payload
    const payload = JSON.stringify({
      id: event.id || null,
      type: event.type,
      action: event.action,
      entityId: event.entityId,
      entityType: event.entityType,
      summary: event.summary,
      data: event.data || null,
      employeeId: event.employeeId || null,
      source: event.source || 'api',
      timestamp: new Date().toISOString(),
    });

    const signature = data.webhookSecret
      ? signPayload(payload, data.webhookSecret)
      : '';

    deliveries.push(
      deliverToUrl(data.webhookUrl, payload, signature, eventKey)
        .then(() => { /* success logged inside deliverToUrl */ })
    );
  }

  // Run all deliveries concurrently (don't wait for slow endpoints to block others)
  await Promise.allSettled(deliveries);
}
