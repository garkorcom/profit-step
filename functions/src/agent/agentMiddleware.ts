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
      agentRole?: string;          // user role: superadmin | admin | manager | user | worker
      agentScopes?: string[];      // permission scopes from agent_tokens
      agentCompanyId?: string;     // company ID from user profile
      agentTokenId?: string;       // agent_tokens doc ID (for audit)
    }
  }
}

/**
 * Bearer token authentication.
 * Supports three modes:
 *   1. Static AGENT_API_KEY (for OpenClaw owner / server-to-server — full admin)
 *   2. Firebase Auth JWT (for browser / ReconciliationPage)
 *   3. Per-employee agent token (from agent_tokens collection — scoped)
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    logger.warn('🔐 Auth failed: no token', { ip: req.ip });
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  // Mode 1: Static API key (owner / server calls — full admin access)
  if (token === process.env.AGENT_API_KEY) {
    req.agentUserId = process.env.OWNER_UID;
    req.agentUserName = process.env.OWNER_DISPLAY_NAME;
    req.agentRole = 'superadmin';
    req.agentScopes = ['admin'];
    next();
    return;
  }

  // Mode 3: Per-employee agent token (lookup in agent_tokens collection)
  // Tokens are 40-hex-char strings — check format before DB lookup
  if (/^[a-f0-9]{40}$/.test(token)) {
    try {
      const tokenSnap = await db.collection('agent_tokens')
        .where('token', '==', token)
        .where('revokedAt', '==', null)
        .limit(1)
        .get();

      if (!tokenSnap.empty) {
        const tokenDoc = tokenSnap.docs[0];
        const tokenData = tokenDoc.data();

        // Check expiry
        const expiresAt = tokenData.expiresAt?.toMillis ? tokenData.expiresAt.toMillis() : tokenData.expiresAt;
        if (expiresAt && Date.now() > expiresAt) {
          logger.warn('🔐 Agent token expired', { tokenId: tokenDoc.id, employeeId: tokenData.employeeId });
          res.status(401).json({ error: 'Agent token expired' });
          return;
        }

        // Lookup employee profile for role & company
        const userDoc = await db.collection('users').doc(tokenData.employeeId).get();
        const userData = userDoc.exists ? userDoc.data() : null;

        req.agentUserId = tokenData.employeeId;
        req.agentUserName = tokenData.employeeName || userData?.displayName || tokenData.employeeId;
        req.agentRole = userData?.role || 'user';
        req.agentScopes = tokenData.scopes || [];
        req.agentCompanyId = userData?.companyId || null;
        req.agentTokenId = tokenDoc.id;

        // Update lastUsedAt (fire-and-forget, don't block request)
        tokenDoc.ref.update({
          lastUsedAt: FieldValue.serverTimestamp(),
          useCount: FieldValue.increment(1),
        }).catch(() => {});

        next();
        return;
      }
    } catch (e: any) {
      logger.error('🔐 Agent token lookup error', { error: e.message });
      // Fall through to Firebase JWT check
    }
  }

  // Mode 2: Firebase Auth JWT (browser calls)
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.agentUserId = decoded.uid;
    req.agentUserName = decoded.name || decoded.email || decoded.uid;

    // Lookup role from Firestore profile
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    req.agentRole = userData?.role || 'user';
    req.agentScopes = ['admin']; // JWT users get full access (same as before)
    req.agentCompanyId = userData?.companyId || null;

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

// ─── Scope Check Helper ─────────────────────────────────────────────

/**
 * Middleware factory: require specific scope(s).
 * Admin tokens and JWT users bypass scope checks.
 * Per-employee tokens must have at least one of the listed scopes.
 *
 * Usage: router.get('/api/tasks/list', requireScope('tasks:read'), handler)
 */
export function requireScope(...scopes: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userScopes = req.agentScopes || [];

    // Admin scope grants everything
    if (userScopes.includes('admin')) {
      next();
      return;
    }

    // Check if user has at least one required scope
    const hasScope = scopes.some(s => userScopes.includes(s));
    if (!hasScope) {
      logger.warn('🔐 Scope denied', {
        userId: req.agentUserId,
        required: scopes,
        actual: userScopes,
        path: req.path,
      });
      res.status(403).json({
        error: 'Insufficient permissions',
        required: scopes,
        hint: 'Ask admin to update your agent token scopes',
      });
      return;
    }

    next();
  };
}

/**
 * Check if the requesting user is admin (superadmin, company_admin, admin).
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.agentRole || 'user';
  if (['superadmin', 'company_admin', 'admin'].includes(role)) {
    next();
    return;
  }
  res.status(403).json({ error: 'Admin access required' });
}

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
      errors: err.errors.map((e: any) => ({ path: e.path, message: e.message })),
    };
    if (process.env.NODE_ENV !== 'production') {
      logPayload.body = req.body;
    }
    logger.warn('❌ Validation failed', logPayload);
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      requestId,
      details: err.errors.map((e: any) => ({
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

