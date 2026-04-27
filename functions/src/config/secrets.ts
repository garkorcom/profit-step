/**
 * Centralized secret definitions for Cloud Functions.
 *
 * Every real secret (token, password, API key) is declared here once via
 * `defineSecret()` from firebase-functions/params. In production runtime the
 * value is pulled from Google Secret Manager; locally Firebase CLI falls back
 * to `functions/.env`.
 *
 * Usage:
 *   import { WORKER_BOT_TOKEN, WORKER_BOT_SECRETS } from '../../config/secrets';
 *
 *   export const myFn = onRequest(
 *     { secrets: WORKER_BOT_SECRETS },
 *     async (req, res) => {
 *       const token = WORKER_BOT_TOKEN.value();  // guaranteed non-empty at runtime
 *       // ...
 *     }
 *   );
 *
 * To provision a new secret in prod:
 *   firebase functions:secrets:set <NAME>
 * (see scripts/setup-secrets.sh for bulk operations)
 */

import { defineSecret } from 'firebase-functions/params';

// ============================================================================
// Telegram bots
// ============================================================================
export const WORKER_BOT_TOKEN   = defineSecret('WORKER_BOT_TOKEN');
export const COSTS_BOT_TOKEN    = defineSecret('COSTS_BOT_TOKEN');
export const TELEGRAM_TOKEN     = defineSecret('TELEGRAM_TOKEN');
export const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
export const WORKER_PASSWORD    = defineSecret('WORKER_PASSWORD');

// ============================================================================
// AI providers
// ============================================================================
export const GEMINI_API_KEY    = defineSecret('GEMINI_API_KEY');
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const OPENAI_API_KEY    = defineSecret('OPENAI_API_KEY');

// ============================================================================
// Internal / external APIs
// ============================================================================
export const AGENT_API_KEY = defineSecret('AGENT_API_KEY');

// ============================================================================
// Email (Brevo SMTP)
// ============================================================================
export const EMAIL_PASSWORD = defineSecret('EMAIL_PASSWORD');
export const BREVO_API_KEY  = defineSecret('BREVO_API_KEY');

// ============================================================================
// Per-function secret groups
// ----------------------------------------------------------------------------
// These are the least-privilege bundles that each Cloud Function should bind
// via { secrets: [...] } in its runtime options. Keep these lists tight — if
// you don't use a secret, don't include it here (IAM tracks which functions
// get access).
// ============================================================================

export const WORKER_BOT_SECRETS = [
  WORKER_BOT_TOKEN,
  WORKER_PASSWORD,
  GEMINI_API_KEY,
  ANTHROPIC_API_KEY,
] as const;

export const COSTS_BOT_SECRETS = [
  COSTS_BOT_TOKEN,
  GEMINI_API_KEY,
] as const;

export const AI_BOT_SECRETS = [
  TELEGRAM_TOKEN,
  OPENAI_API_KEY,
  GEMINI_API_KEY,
] as const;

export const AI_CALLABLE_SECRETS = [
  GEMINI_API_KEY,
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
] as const;

export const EMAIL_SECRETS = [
  EMAIL_PASSWORD,
] as const;

export const AGENT_API_SECRETS = [
  AGENT_API_KEY,
  GEMINI_API_KEY,
  ANTHROPIC_API_KEY,
  TELEGRAM_BOT_TOKEN,
  // Tasktotime mounts under /api/tasktotime; its adapters need worker-bot
  // (Telegram notifications) + Brevo (email notifications).
  WORKER_BOT_TOKEN,
  BREVO_API_KEY,
] as const;

export const SCHEDULED_WORKER_SECRETS = [
  WORKER_BOT_TOKEN,
] as const;

export const WHATSAPP_SECRETS = [
  // verify token is non-secret (public), but whatsapp triggers also call AI
  GEMINI_API_KEY,
] as const;

/**
 * Tasktotime trigger / Pub/Sub Cloud Functions need the worker-bot token
 * (Telegram notifications on transitions) and Brevo (email notifications).
 * AI secrets aren't needed here — AI flows live in PR-D as separate
 * callables.
 */
export const TASKTOTIME_TRIGGER_SECRETS = [
  WORKER_BOT_TOKEN,
  BREVO_API_KEY,
] as const;
