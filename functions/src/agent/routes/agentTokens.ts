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
import { CreateAgentTokenSchema, ListAgentTokensSchema } from '../schemas/agentTokenSchemas';

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
      warning: 'Save this token now — it will not be shown again.',
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

export default router;
