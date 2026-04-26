/**
 * Pure predicates for derived states (NOT lifecycle).
 *
 * "Просрочена" / "под риском" / "ждёт акта" — computed from `task.dueAt`,
 * `now`, `lifecycle`, `acceptance`. These are NOT separate lifecycle states
 * (see spec/03/derived-states.md).
 *
 * Time uses epoch ms (number) — adapter passes a Clock-derived `now`.
 */

import type { Task, EpochMs } from './Task';

const ACTIVE_LIFECYCLES = new Set(['ready', 'started', 'blocked'] as const);
const MINUTE_MS = 60_000;

/**
 * "Просрочена" — overdue.
 *
 * Task is overdue when:
 *   - lifecycle ∈ {ready, started, blocked} (still actionable)
 *   - dueAt < now
 */
export function isOverdue(task: Task, now: EpochMs): boolean {
  if (!ACTIVE_LIFECYCLES.has(task.lifecycle as 'ready' | 'started' | 'blocked')) {
    return false;
  }
  return task.dueAt > 0 && task.dueAt < now;
}

/**
 * "Под риском" — at risk of going overdue.
 *
 * Time remaining until dueAt is less than estimatedDurationMinutes
 * (i.e. we cannot complete in the time left), and task is still ready/started.
 */
export function isAtRisk(task: Task, now: EpochMs): boolean {
  if (!ACTIVE_LIFECYCLES.has(task.lifecycle as 'ready' | 'started' | 'blocked')) {
    return false;
  }
  if (task.dueAt <= 0) return false;
  const remainingMs = task.dueAt - now;
  if (remainingMs <= 0) return false; // already overdue, not "at risk"
  const neededMs = task.estimatedDurationMinutes * MINUTE_MS;
  return remainingMs < neededMs;
}

/**
 * "Активная" — actively being worked.
 */
export function isActive(task: Task): boolean {
  return task.lifecycle === 'started';
}

/**
 * "Ждёт акта" — completed but no signed acceptance yet.
 */
export function isAwaitingAct(task: Task): boolean {
  return task.lifecycle === 'completed' && !task.acceptance;
}

/**
 * Bundle: compute all derived states at once. Useful for UI badges.
 */
export interface DerivedTaskStates {
  overdue: boolean;
  atRisk: boolean;
  active: boolean;
  awaitingAct: boolean;
}

export function computeDerivedStates(task: Task, now: EpochMs): DerivedTaskStates {
  return {
    overdue: isOverdue(task, now),
    atRisk: isAtRisk(task, now),
    active: isActive(task),
    awaitingAct: isAwaitingAct(task),
  };
}
