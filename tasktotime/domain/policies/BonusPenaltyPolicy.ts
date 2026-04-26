/**
 * BonusPenaltyPolicy — pure rule for computing on-time bonus / overdue
 * penalty when a task is accepted.
 *
 * Per spec/03-state-machine/transitions.md §accept(): "рассчитать
 * bonusOnTime/penaltyOverdue в payroll".
 *
 * Inputs: task fields. Output: { bonus?, penalty? }. No I/O.
 */

import type { Task, Money } from '../Task';

export interface BonusPenaltyResult {
  bonus?: Money;
  penalty?: Money;
}

/**
 * Compute bonus and/or penalty for a completed/accepted task.
 *
 * Rules (Phase 1, simple):
 *   - If `completedAt <= dueAt` AND `bonusOnTime` is set → award bonus.
 *   - If `completedAt > dueAt` AND `penaltyOverdue` is set → apply penalty.
 *   - If neither field is set on the task → no payroll adjustment.
 *
 * Both can be present (rare: graceful but spec-compliant — caller decides
 * what to actually persist).
 */
export function computeBonusPenalty(task: Task): BonusPenaltyResult {
  const result: BonusPenaltyResult = {};
  if (!task.completedAt || !task.dueAt) return result;

  const onTime = task.completedAt <= task.dueAt;

  if (onTime && task.bonusOnTime && task.bonusOnTime.amount > 0) {
    result.bonus = { ...task.bonusOnTime };
  } else if (!onTime && task.penaltyOverdue && task.penaltyOverdue.amount > 0) {
    result.penalty = { ...task.penaltyOverdue };
  }

  return result;
}
