/**
 * Backwards-compatible re-export — canonical location is @profit-step/shared.
 * Existing imports (src/utils/phone) continue to work; new code should use:
 *   import { normalizePhone } from '@profit-step/shared';
 */
export { normalizePhone, formatPhoneDisplay, looksLikePhone } from '@profit-step/shared';
