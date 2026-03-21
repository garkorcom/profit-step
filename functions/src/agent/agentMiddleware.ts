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
    }
  }
}

/**
 * Bearer token authentication.
 * Phase 1: token from AGENT_API_KEY env. Phase 2: JWT decode.
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== process.env.AGENT_API_KEY) {
    logger.warn('🔐 Auth failed', { ip: req.ip, hasToken: !!token });
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  req.agentUserId = process.env.OWNER_UID;
  req.agentUserName = process.env.OWNER_DISPLAY_NAME;
  next();
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
  if (err instanceof z.ZodError) {
    const logPayload: Record<string, any> = {
      path: req.path,
      errors: err.errors.map((e) => ({ path: e.path, message: e.message })),
    };
    if (process.env.NODE_ENV !== 'production') {
      logPayload.body = req.body;
    }
    logger.warn('❌ Validation failed', logPayload);
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  logger.error('💥 Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'Internal server error' });
};
