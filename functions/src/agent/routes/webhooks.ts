/**
 * Webhook Subscription Routes — CRUD + delivery log (5 endpoints)
 *
 * Subscriptions live in `webhook_subscriptions` collection. Each has:
 *   - url: target endpoint
 *   - events: pattern array (e.g. ["task.*", "cost.approved"])
 *   - secret: auto-generated HMAC-SHA256 key (32 bytes hex)
 *   - active: boolean
 *   - createdBy: userId
 *
 * Delivery logs in `webhook_deliveries` (written by webhookDelivery.ts).
 *
 * RLS: admin/manager can manage webhooks. Others read-only (own subs).
 */
import { Router } from 'express';
import * as crypto from 'crypto';

import { db, FieldValue, logger, logAgentActivity } from '../routeContext';
import { CreateWebhookSchema, UpdateWebhookSchema } from '../schemas';
import { requireScope, SCOPES } from '../utils/scopeGuard';

const router = Router();

// ─── GET /api/webhooks ─────────────────────────────────────────────────

router.get('/api/webhooks', requireScope(SCOPES.WEBHOOKS_READ, SCOPES.WEBHOOKS_MANAGE), async (req, res, next) => {
  try {
    const rlsRole = req.effectiveRole || 'admin';
    const rlsUserId = req.effectiveUserId || req.agentUserId;

    logger.info('🔔 webhooks:list', { role: rlsRole });

    const snap = await db.collection('webhook_subscriptions').get();
    let subs = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        url: data.url,
        events: data.events || [],
        description: data.description || '',
        active: data.active ?? true,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        // Don't expose secret — only show masked version
        secretMask: data.secret ? `${data.secret.slice(0, 8)}...` : null,
      };
    });

    // Non-admin: only own subscriptions
    if (rlsRole !== 'admin' && rlsRole !== 'manager') {
      subs = subs.filter(s => s.createdBy === rlsUserId);
    }

    res.json({ webhooks: subs, total: subs.length });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/webhooks/:id ─────────────────────────────────────────────

router.get('/api/webhooks/:id', requireScope(SCOPES.WEBHOOKS_READ, SCOPES.WEBHOOKS_MANAGE), async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await db.collection('webhook_subscriptions').doc(id).get();

    if (!doc.exists) {
      res.status(404).json({ error: `Webhook ${id} not found` });
      return;
    }

    const data = doc.data()!;
    res.json({
      id: doc.id,
      url: data.url,
      events: data.events || [],
      description: data.description || '',
      active: data.active ?? true,
      createdBy: data.createdBy,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      secretMask: data.secret ? `${data.secret.slice(0, 8)}...` : null,
    });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/webhooks ────────────────────────────────────────────────

router.post('/api/webhooks', requireScope(SCOPES.WEBHOOKS_MANAGE), async (req, res, next) => {
  try {
    const data = CreateWebhookSchema.parse(req.body);
    logger.info('🔔 webhooks:create', { url: data.url, events: data.events.length });

    // Auto-generate HMAC secret (32 bytes = 64 hex chars)
    const secret = crypto.randomBytes(32).toString('hex');

    const docRef = await db.collection('webhook_subscriptions').add({
      url: data.url,
      events: data.events,
      description: data.description || '',
      secret,
      active: data.active,
      createdBy: req.agentUserId || 'system',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deliveryStats: { total: 0, success: 0, failed: 0 },
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'webhook_created',
      endpoint: '/api/webhooks',
      metadata: { webhookId: docRef.id, url: data.url, events: data.events },
    });

    res.status(201).json({
      id: docRef.id,
      url: data.url,
      events: data.events,
      active: data.active,
      // Show secret ONLY on creation — this is the only time it's revealed
      secret,
      message: 'Webhook created. Save the secret — it won\'t be shown again.',
    });
  } catch (e) {
    next(e);
  }
});

// ─── PUT /api/webhooks/:id ─────────────────────────────────────────────

router.put('/api/webhooks/:id', requireScope(SCOPES.WEBHOOKS_MANAGE), async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = UpdateWebhookSchema.parse(req.body);
    logger.info('🔔 webhooks:update', { webhookId: id, ...data });

    const doc = await db.collection('webhook_subscriptions').doc(id).get();
    if (!doc.exists) {
      res.status(404).json({ error: `Webhook ${id} not found` });
      return;
    }

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.url !== undefined) update.url = data.url;
    if (data.events !== undefined) update.events = data.events;
    if (data.description !== undefined) update.description = data.description;
    if (data.active !== undefined) update.active = data.active;

    await db.collection('webhook_subscriptions').doc(id).update(update);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'webhook_updated',
      endpoint: `/api/webhooks/${id}`,
      metadata: { webhookId: id, ...data },
    });

    res.json({ id, ...data, message: 'Webhook updated' });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/webhooks/:id ──────────────────────────────────────────

router.delete('/api/webhooks/:id', requireScope(SCOPES.WEBHOOKS_MANAGE), async (req, res, next) => {
  try {
    const { id } = req.params;
    logger.info('🔔 webhooks:delete', { webhookId: id });

    const doc = await db.collection('webhook_subscriptions').doc(id).get();
    if (!doc.exists) {
      res.status(404).json({ error: `Webhook ${id} not found` });
      return;
    }

    await db.collection('webhook_subscriptions').doc(id).delete();

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'webhook_deleted',
      endpoint: `/api/webhooks/${id}`,
      metadata: { webhookId: id, url: doc.data()?.url },
    });

    res.json({ deleted: true, id });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/webhooks/:id/deliveries ──────────────────────────────────

router.get('/api/webhooks/:id/deliveries', requireScope(SCOPES.WEBHOOKS_READ, SCOPES.WEBHOOKS_MANAGE), async (req, res, next) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const snap = await db.collection('webhook_deliveries')
      .where('subscriptionId', '==', id)
      .orderBy('deliveredAt', 'desc')
      .limit(limit)
      .get();

    const deliveries = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    }));

    res.json({ deliveries, count: deliveries.length });
  } catch (e) {
    next(e);
  }
});

export default router;
