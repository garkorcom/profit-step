/**
 * Non-secret environment configuration for Cloud Functions.
 *
 * Anything here is visible in function metadata and is expected to be
 * committed (via `functions/.env.example`). Actual values live in
 * `functions/.env` (gitignored) locally and in the Cloud Functions
 * environment variables in prod.
 *
 * Contrast with `./secrets.ts` which handles true secrets via Secret Manager.
 */

// ============================================================================
// Firebase / GCP runtime — auto-populated, safe defaults
// ============================================================================
export const GCLOUD_PROJECT =
  process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? '';

export const IS_EMULATOR =
  process.env.FUNCTIONS_EMULATOR === 'true' ||
  !!process.env.FIRESTORE_EMULATOR_HOST;

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const IS_PRODUCTION = NODE_ENV === 'production' && !IS_EMULATOR;

// ============================================================================
// Owner / company metadata (used for logging, fallback authorship)
// ============================================================================
export const OWNER_UID          = process.env.OWNER_UID ?? '';
export const OWNER_COMPANY_ID   = process.env.OWNER_COMPANY_ID ?? '';
export const OWNER_DISPLAY_NAME = process.env.OWNER_DISPLAY_NAME ?? '';

// ============================================================================
// Email SMTP (non-secret part — host/port/user/from)
// Password lives in secrets.ts as EMAIL_PASSWORD.
// ============================================================================
export const EMAIL_HOST = process.env.EMAIL_HOST ?? 'smtp-relay.brevo.com';
export const EMAIL_PORT = parseInt(process.env.EMAIL_PORT ?? '587', 10);
export const EMAIL_USER = process.env.EMAIL_USER ?? '';
export const EMAIL_FROM = process.env.EMAIL_FROM ?? '';

// ============================================================================
// External service URLs
// ============================================================================
export const BLUEPRINT_AI_URL =
  process.env.BLUEPRINT_AI_URL ?? 'http://localhost:8000';

// ============================================================================
// Telegram admin / group ids (public routing info, not credentials)
// ============================================================================
export const ADMIN_GROUP_ID = process.env.ADMIN_GROUP_ID ?? '';

// ============================================================================
// WhatsApp webhook verify token
// Not really secret (verifies handshake), but convention says don't show it.
// Kept here because it's an identifier more than a credential.
// ============================================================================
export const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
