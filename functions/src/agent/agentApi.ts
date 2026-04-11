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
  clientRoutes, dashboardRoutes, dashboardClientRoutes, taskRoutes, costRoutes,
  timeTrackingRoutes, financeRoutes, userRoutes,
  estimateRoutes, projectRoutes, siteRoutes, erpRoutes, inventoryRoutes,
  sharingRoutes, agentTokenRoutes, eventRoutes,
} from './routes';
import docsRoutes from './routes/docs';
import portalRoutes from './routes/portal';

// ─── Validate required environment variables ───────────────────────

const logger = functions.logger;
const REQUIRED_ENV = ['OWNER_UID', 'AGENT_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`❌ Missing required environment variable: ${key}`);
  }
}

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

// Client portal — token-based auth inside the route, NOT bearer.
// Clients must not need a logged-in agent token to access their portal.
app.use(portalRoutes);

// ─── Auth & Rate Limiting ───────────────────────────────────────────

app.use(authMiddleware);
app.use(rateLimitMiddleware);

// ─── Register Domain Routes ────────────────────────────────────────

const routes = [
  agentTokenRoutes, eventRoutes,  // token management + event queue (first — admin routes)
  clientRoutes, dashboardRoutes, dashboardClientRoutes, taskRoutes, costRoutes,
  timeTrackingRoutes, financeRoutes, userRoutes,
  estimateRoutes, projectRoutes, siteRoutes, erpRoutes, inventoryRoutes,
  sharingRoutes,
];
routes.forEach(r => app.use(r));

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export ─────────────────────────────────────────────────────────

export { app as agentApp };

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '512MB', timeoutSeconds: 120 })
  .https.onRequest(app);
