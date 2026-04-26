/**
 * FakeClock — deterministic time for tests.
 *
 * Usage:
 *   const clock = new FakeClock(1_700_000_000_000);
 *   service.transition(...);
 *   clock.advance({ minutes: 30 });
 *   service.transition(...);
 */

import type { ClockPort } from '../../ports/infra/ClockPort';

export interface AdvanceInput {
  ms?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class FakeClock implements ClockPort {
  private current: number;

  constructor(initialEpochMs: number = 1_700_000_000_000) {
    this.current = initialEpochMs;
  }

  now(): number {
    return this.current;
  }

  todayIso(): string {
    const d = new Date(this.current);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /** Advance the clock by the supplied delta. */
  advance(input: AdvanceInput): void {
    const delta =
      (input.ms ?? 0) +
      (input.seconds ?? 0) * SECOND +
      (input.minutes ?? 0) * MINUTE +
      (input.hours ?? 0) * HOUR +
      (input.days ?? 0) * DAY;
    this.current += delta;
  }

  /** Set absolute time. */
  setTo(epochMs: number): void {
    this.current = epochMs;
  }
}
