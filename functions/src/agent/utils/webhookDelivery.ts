/**
 * Webhook Delivery Engine
 *
 * Finds matching webhook subscriptions for an event, delivers payloads
 * with HMAC-SHA256 signatures, retries on failure (3 attempts, exponential backoff).
 *
 * Usage:
 *   import { emitWebhookEvent } from './utils/webhookDelivery';
 *   await emitWebhookEvent('task.created', { taskId: '...', title: '...' });
 */
import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as crypto from 'crypto';

const db = admin.firestore();
const logger = functions.logger;

// ─── Pattern Matching ─────────────────────────────────────────────────

/**
 * Check if an event type (e.g. "task.created") matches a subscription
 * pattern (e.g. "task.*", "*.created", "task.created", "*.*").
 */
export function matchesPattern(eventType: string, pattern: string): boolean {
  const [eventDomain, eventAction] = eventType.split('.');
  const [patDomain, patAction] = pattern.split('.');

  if (!eventDomain || !eventAction || !patDomain || !patAction) return false;

  const domainMatch = patDomain === '*' || patDomain === eventDomain;
  const actionMatch = patAction === '*' || patAction === eventAction;

  return domainMatch && actionMatch;
}

// ─── HMAC Signing ─────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 signature for a payload.
 * The receiving end verifies: HMAC(secret, body) === X-Webhook-Signature
 */
export function computeSignature(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
}

// ─── Delivery ─────────────────────────────────────────────────────────

interface DeliveryResult {
  subscriptionId: string;
  url: string;
  statusCode: number | null;
  success: boolean;
  attempt: number;
  error?: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000]; // exponential backoff

async function deliverToUrl(
  url: string,
  payload: string,
  signature: string,
  eventType: string,
  eventId: string,
): Promise<{ statusCode: number | null; success: boolean; error?: string }> {
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': eventType,
        'X-Webhook-Id': eventId,
        'User-Agent': 'ProfitStep-Webhooks/1.0',
      },
      body: payload,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    return {
      statusCode: resp.status,
      success: resp.status >= 200 && resp.status < 300,
    };
  } catch (e: any) {
    return {
      statusCode: null,
      success: false,
      error: e.message || 'Network error',
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deliver webhook to a single subscription with retries.
 */
async function deliverWithRetry(
  subscriptionId: string,
  url: string,
  secret: string,
  payload: string,
  eventType: string,
  eventId: string,
): Promise<DeliveryResult> {
  const signature = computeSignature(payload, secret);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await deliverToUrl(url, payload, signature, eventType, eventId);

    if (result.success) {
      return {
        subscriptionId,
        url,
        statusCode: result.statusCode,
        success: true,
        attempt,
      };
    }

    logger.warn('🔔 Webhook delivery failed', {
      subscriptionId,
      url,
      attempt,
      statusCode: result.statusCode,
      error: result.error,
    });

    // Don't retry on 4xx (client error) — only on 5xx or network errors
    if (result.statusCode && result.statusCode >= 400 && result.statusCode < 500) {
      return {
        subscriptionId,
        url,
        statusCode: result.statusCode,
        success: false,
        attempt,
        error: `HTTP ${result.statusCode} — not retrying client errors`,
      };
    }

    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  return {
    subscriptionId,
    url,
    statusCode: null,
    success: false,
    attempt: MAX_RETRIES,
    error: `Failed after ${MAX_RETRIES} attempts`,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Emit a webhook event. Finds all active subscriptions whose event
 * patterns match, delivers payload to each with HMAC signing and retry.
 *
 * Fire-and-forget safe — catches all errors internally, logs results.
 *
 * @param eventType e.g. "task.created", "cost.approved"
 * @param data Arbitrary payload data
 * @returns Array of delivery results (for testing/logging)
 */
export async function emitWebhookEvent(
  eventType: string,
  data: Record<string, unknown>,
): Promise<DeliveryResult[]> {
  try {
    // Find active subscriptions
    const snap = await db.collection('webhook_subscriptions')
      .where('active', '==', true)
      .get();

    if (snap.empty) return [];

    // Filter by event pattern matching
    const matching = snap.docs.filter(doc => {
      const events: string[] = doc.data().events || [];
      return events.some(pattern => matchesPattern(eventType, pattern));
    });

    if (matching.length === 0) return [];

    // Build event payload
    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      type: eventType,
      timestamp: new Date().toISOString(),
      data,
    };
    const payload = JSON.stringify(event);

    logger.info('🔔 Webhook emit', {
      eventType,
      matchingSubscriptions: matching.length,
      eventId,
    });

    // Deliver to all matching subscriptions in parallel
    const results = await Promise.all(
      matching.map(doc => {
        const sub = doc.data();
        return deliverWithRetry(
          doc.id,
          sub.url,
          sub.secret,
          payload,
          eventType,
          eventId,
        );
      }),
    );

    // Log delivery results
    const batch = db.batch();
    for (const result of results) {
      const logRef = db.collection('webhook_deliveries').doc();
      batch.set(logRef, {
        subscriptionId: result.subscriptionId,
        eventType,
        eventId,
        url: result.url,
        statusCode: result.statusCode,
        success: result.success,
        attempts: result.attempt,
        error: result.error || null,
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    const successes = results.filter(r => r.success).length;
    const failures = results.length - successes;
    if (failures > 0) {
      logger.warn('🔔 Webhook delivery summary', { eventType, successes, failures });
    }

    return results;
  } catch (e: any) {
    // Never let webhook delivery crash the calling function
    logger.error('🔔 Webhook emit error', { eventType, error: e.message });
    return [];
  }
}
