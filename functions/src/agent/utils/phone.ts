/**
 * Backwards-compatible re-export — canonical location is @profit-step/shared.
 * Existing imports (functions/src/agent/utils/phone) continue to work;
 * new code should use:
 *   import { normalizePhone } from '@profit-step/shared';
 */
export { normalizePhone, looksLikePhone } from '@profit-step/shared';
