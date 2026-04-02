/**
 * Agent API — Express Application
 *
 * 48 endpoints for OpenClaw agent integration.
 * Routes are modularized into:
 *   - routes/clients.ts     — Client CRUD + search
 *   - routes/allRoutes.ts   — All remaining domain routes
 */

import * as functions from 'firebase-functions';
import * as express from 'express';
import * as cors from 'cors';

import {
  authMiddleware,
  rateLimitMiddleware,
  requestLogger,
  errorHandler,
} from './agentMiddleware';

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '60mb' }));
app.use(requestLogger);

// ─── Health Check (before auth — public endpoint) ───────────────────

const API_VERSION = '4.1.0';
const startedAt = Date.now();

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: API_VERSION,
    uptime: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
  });
});

// ─── Auth & Rate Limiting ───────────────────────────────────────────

app.use(authMiddleware);
app.use(rateLimitMiddleware);

// ─── Route Modules ──────────────────────────────────────────────────

import clientRoutes from './routes/clients';
import allRoutes from './routes/allRoutes';

app.use(clientRoutes);
app.use(allRoutes);

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export Express app for testing ─────────────────────────────────

export { app as agentApp };

// ─── Export as Firebase Function ────────────────────────────────────

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '512MB', timeoutSeconds: 120 })
  .https.onRequest(app);
