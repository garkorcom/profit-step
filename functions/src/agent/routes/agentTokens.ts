/**
 * Agent Token Management Routes (admin-only)
 *
 * Manages per-employee API tokens for remote agent access.
 * Each employee gets their own token with scoped permissions.
 *
 * Collection: agent_tokens
 * Document schema:
 *   - token: string (40 hex chars, unique)
 *   - employeeId: string (Firebase UID)
 *   - employeeName: string
 *   - label: string (human-readable, e.g. "Vasya MacBook")
 *   - scopes: string[] (permission scopes)
 *   - createdAt: Timestamp
 *   - createdBy: string (admin who created)
 *   - expiresAt: Timestamp
 *   - revokedAt: Timestamp | null
 *   - revokedBy: string | null
 *   - lastUsedAt: Timestamp | null
 *   - useCount: number
 */
import { Router } from 'express';
import * as crypto from 'crypto';

import { db, FieldValue, Timestamp, logger, logAgentActivity } from '../routeContext';
import { requireAdmin } from '../agentMiddleware';
import { CreateAgentTokenSchema, ListAgentTokensSchema, UpdateWebhookSchema } from '../schemas/agentTokenSchemas';

const router = Router();

// All token management routes require admin role
router.use('/api/agent-tokens', requireAdmin);

// ─── POST /api/agent-tokens — Generate new token ────────────────────

router.post('/api/agent-tokens', async (req, res, next) => {
  try {
    const data = CreateAgentTokenSchema.parse(req.body);
    logger.info('🔑 agent-tokens:create', { employeeId: data.employeeId, label: data.label });

    // Verify employee exists
    const userDoc = await db.collection('users').doc(data.employeeId).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: `Employee ${data.employeeId} not found` });
      return;
    }
    const userData = userDoc.data()!;

    // Generate cryptographically secure token (40 hex chars = 160 bits)
    const token = crypto.randomBytes(20).toString('hex');

    // Calculate expiry
    const expiresAt = Timestamp.fromMillis(
      Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000
    );

    // Phase 10: Generate webhook secret if webhookUrl is provided
    const webhookUrl = data.webhookUrl || null;
    const webhookSecret = webhookUrl
      ? crypto.randomBytes(32).toString('hex')
      : null;
    const webhookEvents = data.webhookEvents || null;

    const docRef = db.collection('agent_tokens').doc();
    await docRef.set({
      token,
      employeeId: data.employeeId,
      employeeName: userData.displayName || data.employeeId,
      label: data.label,
      scopes: data.scopes,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.agentUserId,
      expiresAt,
      revokedAt: null,
      revokedBy: null,
      lastUsedAt: null,
      useCount: 0,
      // Phase 10: webhook config
      webhookUrl,
      webhookSecret,
      webhookEvents,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'agent_token_created',
      endpoint: '/api/agent-tokens',
      metadata: {
        tokenId: docRef.id,
        employeeId: data.employeeId,
        label: data.label,
        scopes: data.scopes,
        expiresInDays: data.expiresInDays,
      },
    });

    res.status(201).json({
      tokenId: docRef.id,
      token,  // Only returned once at creation — store securely!
      employeeId: data.employeeId,
      employeeName: userData.displayName,
      label: data.label,
      scopes: data.scopes,
      expiresAt: expiresAt.toDate().toISOString(),
      // Phase 10: webhook info (secret only shown once at creation)
      webhookUrl,
      webhookSecret,
      webhookEvents,
      warning: 'Save this token and webhook secret now — they will not be shown again.',
    });
  } catch (e) {
    next(e);
  }
});

// ─── GET /api/agent-tokens — List tokens ─────────────────────────────

router.get('/api/agent-tokens', async (req, res, next) => {
  try {
    const params = ListAgentTokensSchema.parse(req.query);

    let query: FirebaseFirestore.Query = db.collection('agent_tokens');

    if (params.employeeId) {
      query = query.where('employeeId', '==', params.employeeId);
    }
    if (!params.includeRevoked) {
      query = query.where('revokedAt', '==', null);
    }

    query = query.orderBy('createdAt', 'desc').limit(50);
    const snap = await query.get();

    const tokens = snap.docs.map(d => {
      const data = d.data();
      return {
        tokenId: d.id,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        label: data.label,
        scopes: data.scopes,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
        expiresAt: data.expiresAt?.toDate?.()?.toISOString() || null,
        revokedAt: data.revokedAt?.toDate?.()?.toISOString() || null,
        lastUsedAt: data.lastUsedAt?.toDate?.()?.toISOString() || null,
        useCount: data.useCount || 0,
        isExpired: data.expiresAt && Date.now() > (data.expiresAt.toMillis?.() || data.expiresAt),
        // Phase 10: webhook config (secret never exposed in list)
        webhookUrl: data.webhookUrl || null,
        webhookEvents: data.webhookEvents || null,
        hasWebhook: !!data.webhookUrl,
        // Token value is NEVER returned in list — only at creation
      };
    });

    res.json({ tokens, count: tokens.length });
  } catch (e) {
    next(e);
  }
});

// ─── DELETE /api/agent-tokens/:id — Revoke token ─────────────────────

router.delete('/api/agent-tokens/:id', async (req, res, next) => {
  try {
    const tokenId = req.params.id;
    const ref = db.collection('agent_tokens').doc(tokenId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }

    const data = doc.data()!;
    if (data.revokedAt) {
      res.status(400).json({ error: 'Token already revoked' });
      return;
    }

    await ref.update({
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: req.agentUserId,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'agent_token_revoked',
      endpoint: `/api/agent-tokens/${tokenId}`,
      metadata: { tokenId, employeeId: data.employeeId, label: data.label },
    });

    logger.info('🔑 agent-tokens:revoked', { tokenId, employeeId: data.employeeId });
    res.json({ revoked: true, tokenId, employeeId: data.employeeId });
  } catch (e) {
    next(e);
  }
});

// ─── POST /api/agent-tokens/:id/rotate — Rotate token ────────────────

router.post('/api/agent-tokens/:id/rotate', async (req, res, next) => {
  try {
    const tokenId = req.params.id;
    const ref = db.collection('agent_tokens').doc(tokenId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }

    const data = doc.data()!;
    if (data.revokedAt) {
      res.status(400).json({ error: 'Token is revoked — create a new one instead' });
      return;
    }

    // Generate new token value, keep everything else
    const newToken = crypto.randomBytes(20).toString('hex');

    await ref.update({
      token: newToken,
      lastRotatedAt: FieldValue.serverTimestamp(),
      rotatedBy: req.agentUserId,
    });

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'agent_token_rotated',
      endpoint: `/api/agent-tokens/${tokenId}/rotate`,
      metadata: { tokenId, employeeId: data.employeeId },
    });

    res.json({
      tokenId,
      token: newToken,
      employeeId: data.employeeId,
      warning: 'Old token is now invalid. Save the new token — it will not be shown again.',
    });
  } catch (e) {
    next(e);
  }
});

// ─── PATCH /api/agent-tokens/:id/webhook — Update webhook config ─────

router.patch('/api/agent-tokens/:id/webhook', async (req, res, next) => {
  try {
    const tokenId = req.params.id;
    const data = UpdateWebhookSchema.parse(req.body);

    const ref = db.collection('agent_tokens').doc(tokenId);
    const doc = await ref.get();

    if (!doc.exists) {
      res.status(404).json({ error: 'Token not found' });
      return;
    }

    const tokenData = doc.data()!;
    if (tokenData.revokedAt) {
      res.status(400).json({ error: 'Cannot update webhook on revoked token' });
      return;
    }

    const update: Record<string, any> = {
      webhookUrl: data.webhookUrl,
      webhookEvents: data.webhookEvents !== undefined ? data.webhookEvents : tokenData.webhookEvents || null,
    };

    // Generate new secret if URL is being set (and wasn't set before, or is changing)
    if (data.webhookUrl && data.webhookUrl !== tokenData.webhookUrl) {
      update.webhookSecret = crypto.randomBytes(32).toString('hex');
    }

    // Clear secret if URL is being removed
    if (data.webhookUrl === null) {
      update.webhookSecret = null;
      update.webhookEvents = null;
    }

    await ref.update(update);

    await logAgentActivity({
      userId: req.agentUserId!,
      action: 'agent_token_webhook_updated',
      endpoint: `/api/agent-tokens/${tokenId}/webhook`,
      metadata: {
        tokenId,
        employeeId: tokenData.employeeId,
        webhookUrl: data.webhookUrl,
        hasEvents: !!(data.webhookEvents && data.webhookEvents.length),
      },
    });

    logger.info('🔔 agent-tokens:webhook-updated', {
      tokenId,
      employeeId: tokenData.employeeId,
      webhookUrl: data.webhookUrl ? '***' : null,
    });

    res.json({
      updated: true,
      tokenId,
      webhookUrl: data.webhookUrl,
      webhookEvents: update.webhookEvents,
      // New secret only returned when URL changes
      ...(update.webhookSecret ? {
        webhookSecret: update.webhookSecret,
        warning: 'Save this webhook secret now — it will not be shown again.',
      } : {}),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
