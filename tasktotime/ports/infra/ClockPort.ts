/**
 * ClockPort — wall-clock abstraction for testability.
 *
 * Domain code that needs `now` (transitions, derived states, weather cron)
 * MUST receive a ClockPort, NOT call `Date.now()` directly. Tests pass
 * `FakeClock` which can `advance()` deterministically.
 */

export interface ClockPort {
  /** Epoch milliseconds. */
  now(): number;
  /** YYYY-MM-DD in local TZ (per adapter config). */
  todayIso(): string;
}
