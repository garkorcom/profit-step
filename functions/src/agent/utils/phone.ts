/**
 * Phone normalization — E.164 format for US numbers.
 *
 * Examples:
 *   "7542520827"           → "+17542520827"
 *   "+1 (305) 965-0408"   → "+13059650408"
 *   "305-965-0408"         → "+13059650408"
 *   "1-305-965-0408"       → "+13059650408"
 *   "+44 20 7946 0958"    → "+442079460958" (international passthrough)
 *   ""                     → ""
 */
export function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) return raw.trim(); // non-numeric input, keep as-is

  // US local: 10 digits → +1XXXXXXXXXX
  if (digits.length === 10) return `+1${digits}`;

  // US with country code: 11 digits starting with 1
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;

  // International: had a + prefix originally
  if (raw.trim().startsWith('+')) return `+${digits}`;

  // Fallback: return cleaned digits (don't lose data)
  return digits;
}

/**
 * Check if a string looks like a phone number (for search routing).
 */
export function looksLikePhone(query: string): boolean {
  const digits = query.replace(/\D/g, '');
  return digits.length >= 7;
}
