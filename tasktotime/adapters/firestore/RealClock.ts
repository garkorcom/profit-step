/**
 * RealClock — production `ClockPort` implementation.
 *
 * Implements {@link ClockPort} via `Date.now()` and ISO date slicing.
 * Tests pass `FakeClock` (NOT this class) so that `now()` is
 * deterministic.
 *
 * See spec/04-storage/adapter-mapping.md §25 ClockPort.
 *
 * Timezone:
 *   - `now()` is timezone-agnostic — epoch ms is UTC by definition.
 *   - `todayIso()` defaults to UTC; pass a `timezone` to the constructor
 *     to scope the date string to a different IANA zone (forward-compat;
 *     the spec accepts UTC for now).
 *
 * No Firestore dependency.
 */

import type { ClockPort } from '../../ports/infra/ClockPort';

const ISO_DATE_LENGTH = 10; // 'YYYY-MM-DD'

export class RealClock implements ClockPort {
  /**
   * Optional IANA timezone (e.g. 'America/New_York'). `undefined` → UTC.
   * Forward-compatible — spec currently accepts UTC.
   */
  private readonly timezone?: string;

  constructor(timezone?: string) {
    this.timezone = timezone;
  }

  /**
   * Wall-clock epoch milliseconds.
   *
   * Adapter mapping (§25 row 1): `Date.now()`.
   */
  now(): number {
    return Date.now();
  }

  /**
   * `YYYY-MM-DD` for "today" in the configured timezone (UTC by default).
   *
   * Adapter mapping (§25 row 2):
   *   - default: `new Date().toISOString().slice(0, 10)` (UTC).
   *   - with `timezone`: derive Y/M/D via `Intl.DateTimeFormat`.
   */
  todayIso(): string {
    if (!this.timezone) {
      return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
    }
    // Locale-stable format, parts in target TZ.
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // 'en-CA' returns 'YYYY-MM-DD'.
    return fmt.format(new Date());
  }
}
