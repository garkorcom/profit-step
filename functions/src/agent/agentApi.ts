/**
 * Agent API — Express Application
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

// ─── Route Modules ──────────────────────────────────────────────────

import clientRoutes from './routes/clients';
import dashboardRoutes from './routes/dashboard';
import taskRoutes from './routes/tasks';
import costRoutes from './routes/costs';
import timeTrackingRoutes from './routes/timeTracking';
import financeRoutes from './routes/finance';
import userRoutes from './routes/users';
import estimateRoutes from './routes/estimates';
import projectRoutes from './routes/projects';
import siteRoutes from './routes/sites';
import erpRoutes from './routes/erp';

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

// ─── Auth & Rate Limiting ───────────────────────────────────────────

app.use(authMiddleware);
app.use(rateLimitMiddleware);

// ─── Register Domain Routes ────────────────────────────────────────

app.use(clientRoutes);
app.use(dashboardRoutes);
app.use(taskRoutes);
app.use(costRoutes);
app.use(timeTrackingRoutes);
app.use(financeRoutes);
app.use(userRoutes);
app.use(estimateRoutes);
app.use(projectRoutes);
app.use(siteRoutes);
app.use(erpRoutes);

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export Express app for testing ─────────────────────────────────

export { app as agentApp };

// ─── Export as Firebase Function ────────────────────────────────────

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '512MB', timeoutSeconds: 120 })
  .https.onRequest(app);
