/**
 * Agent API Middleware
 * - Auth: Bearer token verification
 * - Rate Limiting: Firestore-based hybrid (fast path + tx near threshold)
 * - Request Logger: timing + structured logging
 * - Error Handler: Zod validation errors + unhandled errors
 */

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

const logger = functions.logger;
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// Extend Express Request to include agent fields
declare global {
  namespace Express {
    interface Request {
      agentUserId?: string;
      agentUserName?: string;
      // ── Multi-user (impersonation) ──
      agentTokenType?: 'master' | 'employee' | 'jwt';
      effectiveUserId?: string;
      effectiveRole?: string;
      effectiveScopes?: string[];
      effectiveTeamId?: string | null;
      effectiveTeamMemberUids?: string[];
      impersonatedBy?: string | null;
    }
  }
}

/** Default scopes per role — used when user doc has no explicit scopes field */
function scopesForRole(role: string): string[] {
  const map: Record<string, string[]> = {
    worker:     ['tasks:read', 'tasks:write', 'time:read', 'time:write', 'costs:write', 'files:write', 'inventory:read'],
    driver:     ['tasks:read', 'tasks:write', 'time:read', 'time:write', 'costs:write', 'files:write', 'inventory:read'],
    supply:     ['inventory:read', 'inventory:write', 'costs:read'],
    foreman:    ['tasks:read', 'tasks:write', 'time:read', 'time:write', 'costs:read', 'files:read', 'inventory:read', 'team:read', 'team:write'],
    manager:    ['tasks:read', 'tasks:write', 'costs:read', 'costs:write', 'time:read', 'inventory:read', 'finance:read', 'finance:write', 'team:read', 'team:write', 'users:read', 'users:manage', 'webhooks:read', 'webhooks:manage'],
    accountant: ['costs:read', 'time:read', 'payroll:read', 'payroll:write', 'finance:read'],
    admin:      ['admin'],
  };
  return map[role] || map.worker;
}

export { scopesForRole };

/**
 * Bearer token authentication.
 * Supports two modes:
 *   1. Static AGENT_API_KEY (for OpenClaw / server-to-server)
 *   2. Firebase Auth JWT (for browser / ReconciliationPage)
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    logger.warn('🔐 Auth failed: no token', { ip: req.ip });
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  // Mode 1: Static API key (agent / server calls — Master Token)
  if (token === process.env.AGENT_API_KEY) {
    req.agentUserId = process.env.OWNER_UID;
    req.agentUserName = process.env.OWNER_DISPLAY_NAME;
    req.agentTokenType = 'master';

    // ── X-Impersonate-User: allow master token to act as another user ──
    const impersonateUid = req.headers['x-impersonate-user'] as string | undefined;
    if (impersonateUid) {
      try {
        const userDoc = await db.collection('users').doc(impersonateUid).get();
        if (!userDoc.exists) {
          res.status(404).json({ error: `User ${impersonateUid} not found`, code: 'USER_NOT_FOUND' });
          return;
        }
        const userData = userDoc.data()!;
        if (userData.status === 'inactive' || userData.status === 'deleted') {
          res.status(403).json({ error: `User ${impersonateUid} is not active`, code: 'USER_INACTIVE' });
          return;
        }

        const role = userData.role || 'worker';
        req.effectiveUserId = impersonateUid;
        req.effectiveRole = role;
        req.effectiveScopes = userData.scopes || scopesForRole(role);
        req.effectiveTeamId = userData.teamId || null;
        req.effectiveTeamMemberUids = [];
        req.impersonatedBy = req.agentUserId;

        // Load team members if foreman
        if (role === 'foreman' && userData.teamId) {
          const teamSnap = await db.collection('users')
            .where('teamId', '==', userData.teamId)
            .where('status', '==', 'active')
            .get();
          req.effectiveTeamMemberUids = teamSnap.docs.map(d => d.id);
        }

        logger.info('🎭 Impersonation', {
          masterUid: req.agentUserId,
          effectiveUid: impersonateUid,
          effectiveRole: role,
        });
      } catch (e: any) {
        logger.error('🎭 Impersonation failed', { error: e.message });
        res.status(500).json({ error: 'Impersonation lookup failed' });
        return;
      }
    } else {
      // No impersonation — master token acts as admin
      req.effectiveUserId = req.agentUserId;
      req.effectiveRole = 'admin';
      req.effectiveScopes = ['admin'];
      req.effectiveTeamId = null;
      req.effectiveTeamMemberUids = [];
    }

    next();
    return;
  }

  // Mode 2: Firebase Auth JWT (browser calls)
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.agentUserId = decoded.uid;
    req.agentUserName = decoded.name || decoded.email || decoded.uid;
    req.agentTokenType = 'jwt';

    // JWT users: effective = self. X-Impersonate-User header IGNORED.
    req.effectiveUserId = decoded.uid;
    req.effectiveRole = 'admin'; // Browser users (Denis) = admin
    req.effectiveScopes = ['admin'];
    req.effectiveTeamId = null;
    req.effectiveTeamMemberUids = [];

    next();
  } catch (e: any) {
    logger.warn('🔐 Auth failed: invalid token', { ip: req.ip, error: e.message });
    res.status(401).json({ error: 'Invalid authorization token' });
  }
};

/**
 * Hybrid rate limiter: Firestore-based counter.
 * - Fast path (count < 55): simple increment (no tx)
 * - Near threshold (55-59): transaction for exact count
 * - Over limit (≥60): reject with 429
 */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export const rateLimitMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const userId = req.agentUserId;
  if (!userId) { next(); return; }

  const ref = db.doc(`_rate_limits/${userId}`);
  const now = Date.now();

  try {
    // All paths use transaction to prevent race condition where
    // concurrent requests read count=0 and all set count=1
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const data = doc.data();
      const count = data?.count || 0;
      const resetAt = data?.resetAt || 0;

      // Window expired → reset
      if (now >= resetAt) {
        tx.set(ref, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return { allowed: true };
      }

      // Over limit
      if (count >= RATE_LIMIT) {
        return { allowed: false, retryAfterMs: resetAt - now };
      }

      // Increment atomically within transaction
      tx.update(ref, { count: FieldValue.increment(1) });
      return { allowed: true };
    });

    if (!result.allowed) {
      logger.warn('⚠️ Rate limit hit', { userId });
      res.status(429).json({ error: 'Rate limit exceeded', retryAfterMs: result.retryAfterMs });
      return;
    }
    next();
  } catch (e: any) {
    if (e.message === 'RATE_LIMITED') {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    // Rate limit failure should not block the request
    logger.error('⚠️ Rate limit check failed, allowing request', { error: e.message });
    next();
  }
};

/**
 * Request logger: logs method, path, status, duration on response finish.
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('📊 API Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.agentUserId,
      source: 'openclaw',
    });
  });
  next();
};

/**
 * Global error handler: Zod validation errors + unhandled.
 * req.body is logged only in non-production for security.
 */
export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction): void => {
  const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  // ─── Zod Validation ────────────────────────────────────
  if (err instanceof z.ZodError) {
    const logPayload: Record<string, any> = {
      requestId,
      path: req.path,
      errors: err.errors.map((e) => ({ path: e.path, message: e.message })),
    };
    if (process.env.NODE_ENV !== 'production') {
      logPayload.body = req.body;
    }
    logger.warn('❌ Validation failed', logPayload);
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      requestId,
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  // ─── Known application errors ──────────────────────────
  if (err.status && err.status >= 400 && err.status < 500) {
    logger.warn('⚠️ Client error', { requestId, status: err.status, message: err.message, path: req.path });
    res.status(err.status).json({
      error: err.message || 'Bad request',
      code: err.code || 'CLIENT_ERROR',
      requestId,
    });
    return;
  }

  // ─── Firebase / Firestore errors ───────────────────────
  if (err.code && typeof err.code === 'string' && err.code.startsWith('firestore/')) {
    logger.error('🔥 Firestore error', { requestId, code: err.code, message: err.message, path: req.path });
    res.status(503).json({
      error: 'Database temporarily unavailable',
      code: 'DATABASE_ERROR',
      requestId,
    });
    return;
  }

  // ─── Unhandled ─────────────────────────────────────────
  logger.error('💥 Unhandled error', { requestId, error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId,
  });
};

