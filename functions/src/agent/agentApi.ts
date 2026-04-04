/**
 * Agent API — Express Application (v4.2.0)
 *
 * 48 endpoints for OpenClaw agent integration.
 * Routes are modularized into domain-specific modules in ./routes/
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

import {
  clientRoutes, dashboardRoutes, taskRoutes, costRoutes,
  timeTrackingRoutes, financeRoutes, userRoutes,
  estimateRoutes, projectRoutes, siteRoutes, erpRoutes, inventoryRoutes,
} from './routes';
import docsRoutes from './routes/docs';

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '60mb' }));
app.use(requestLogger);

// ─── Health Check (before auth — public endpoint) ───────────────────

const API_VERSION = '4.2.0';
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

// ─── Public Routes (before auth) ────────────────────────────────────

app.use(docsRoutes);

// ─── Auth & Rate Limiting ───────────────────────────────────────────

app.use(authMiddleware);
app.use(rateLimitMiddleware);

// ─── Register Domain Routes ────────────────────────────────────────

const routes = [
  clientRoutes, dashboardRoutes, taskRoutes, costRoutes,
  timeTrackingRoutes, financeRoutes, userRoutes,
  estimateRoutes, projectRoutes, siteRoutes, erpRoutes, inventoryRoutes,
];
routes.forEach(r => app.use(r));

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export ─────────────────────────────────────────────────────────

export { app as agentApp };

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '512MB', timeoutSeconds: 120 })
  .https.onRequest(app);
