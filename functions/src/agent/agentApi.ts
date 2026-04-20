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
  sharingRoutes, activityRoutes, fileRoutes, feedbackRoutes, teamRoutes,
  webhookRoutes, meetingRoutes, clientInsightsRoutes, dealRoutes, projectAutomationRoutes,
  paymentScheduleRoutes,
} from './routes';
import docsRoutes from './routes/docs';
import portalRoutes from './routes/portal';

// ─── Express App ────────────────────────────────────────────────────

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '60mb' }));
app.use(requestLogger);

// ─── Health Check (before auth — public endpoint) ───────────────────

const API_VERSION = '4.5.0';
const startedAt = Date.now();

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: API_VERSION,
    uptime: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production', // non-secret runtime info; ok to read directly
  });
});

// ─── Secrets Health — audit that every function-declared secret resolves ───
// Returns ONLY metadata (name + presence + length). Never values.
// Useful for verifying a fresh deploy picked up every secret correctly.
app.get('/api/health/secrets', (_req, res) => {
  const check = (name: string) => {
    const v = process.env[name] ?? '';
    return { present: !!v, length: v.length };
  };
  res.json({
    status: 'ok',
    secrets: {
      WORKER_BOT_TOKEN:   check('WORKER_BOT_TOKEN'),
      COSTS_BOT_TOKEN:    check('COSTS_BOT_TOKEN'),
      TELEGRAM_TOKEN:     check('TELEGRAM_TOKEN'),
      TELEGRAM_BOT_TOKEN: check('TELEGRAM_BOT_TOKEN'),
      WORKER_PASSWORD:    check('WORKER_PASSWORD'),
      GEMINI_API_KEY:     check('GEMINI_API_KEY'),
      ANTHROPIC_API_KEY:  check('ANTHROPIC_API_KEY'),
      OPENAI_API_KEY:     check('OPENAI_API_KEY'),
      AGENT_API_KEY:      check('AGENT_API_KEY'),
      EMAIL_PASSWORD:     check('EMAIL_PASSWORD'),
      BREVO_API_KEY:      check('BREVO_API_KEY'),
    },
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
  clientRoutes, dashboardRoutes, taskRoutes, costRoutes,
  timeTrackingRoutes, financeRoutes, userRoutes,
  estimateRoutes, projectRoutes, siteRoutes, erpRoutes, inventoryRoutes,
  sharingRoutes, activityRoutes, fileRoutes, feedbackRoutes, teamRoutes,
  webhookRoutes, meetingRoutes, clientInsightsRoutes, dealRoutes, projectAutomationRoutes,
  paymentScheduleRoutes,
];
routes.forEach(r => app.use(r));

// ─── Error Handler (must be last) ──────────────────────────────────

app.use(errorHandler);

// ─── Export ─────────────────────────────────────────────────────────

export { app as agentApp };

import { AGENT_API_SECRETS } from '../config';

export const agentApi = functions
  .runWith({ minInstances: 1, memory: '512MB', timeoutSeconds: 120, secrets: [...AGENT_API_SECRETS] })
  .https.onRequest(app);
