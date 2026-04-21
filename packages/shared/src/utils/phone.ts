/**
 * Phone normalization & formatting utilities.
 * Canonical location — previously duplicated at src/utils/phone.ts and
 * functions/src/agent/utils/phone.ts, now both re-export from here.
 */

/**
 * Normalize phone to E.164 format (for storage & dedup).
 *
 *   "305-965-0408"        → "+13059650408"
 *   "7542520827"           → "+17542520827"
 *   "+1 (305) 965-0408"   → "+13059650408"
 *   "+44 20 7946 0958"    → "+442079460958"
 *   ""                     → ""
 */
export function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return raw.trim();

  // US local: 10 digits
  if (digits.length === 10) return `+1${digits}`;

  // US with country code: 11 digits starting with 1
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;

  // International: had a + prefix originally
  if (raw.trim().startsWith('+')) return `+${digits}`;

  return digits;
}

/**
 * Format E.164 phone for display.
 *
 *   "+13059650408" → "+1 (305) 965-0408"
 *   "+442079460958" → "+44 207 946 0958"
 *   "raw input"    → "raw input" (passthrough)
 */
export function formatPhoneDisplay(phone: string | undefined | null): string {
  if (!phone) return '';

  // US format: +1XXXXXXXXXX
  const usMatch = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (usMatch) return `+1 (${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;

  // Generic international: +CC rest
  if (phone.startsWith('+') && phone.length > 5) {
    const digits = phone.slice(1);
    // Simple grouping: country code (2-3 digits) + rest in groups of 3-4
    if (digits.length <= 12) {
      return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`.trim();
    }
  }

  return phone;
}

/**
 * Check if a string looks like a phone number (for search routing).
 */
export function looksLikePhone(query: string): boolean {
  const digits = query.replace(/\D/g, '');
  return digits.length >= 7;
}
