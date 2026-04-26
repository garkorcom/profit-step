/**
 * Task lifecycle state machine.
 *
 * 7 states + transition table. See:
 *   - spec/03-state-machine/lifecycle.md
 *   - spec/03-state-machine/transitions.md
 *
 * Pure module — zero I/O, zero Firebase imports.
 */

export type TaskLifecycle =
  | 'draft'
  | 'ready'
  | 'started'
  | 'blocked'
  | 'completed'
  | 'accepted'
  | 'cancelled';

export type TransitionAction =
  | 'create'
  | 'ready'
  | 'start'
  | 'block'
  | 'unblock'
  | 'complete'
  | 'accept'
  | 'cancel';

/**
 * Map: from-state -> action -> to-state. Encodes the allowed transitions
 * from spec/03-state-machine/transitions.md §Таблица.
 *
 * `cancel` is allowed from any state — handled separately in `canTransition`.
 */
export const TRANSITIONS_TABLE: Readonly<
  Record<TaskLifecycle, Partial<Record<TransitionAction, TaskLifecycle>>>
> = Object.freeze({
  draft: { ready: 'ready', cancel: 'cancelled' },
  ready: { start: 'started', cancel: 'cancelled' },
  started: { block: 'blocked', complete: 'completed', cancel: 'cancelled' },
  blocked: { unblock: 'ready', cancel: 'cancelled' },
  completed: { accept: 'accepted', cancel: 'cancelled' },
  accepted: { cancel: 'cancelled' },
  cancelled: {},
});

/**
 * Returns true if `action` is permitted from `from` state.
 * Pure function — no side effects.
 */
export function canTransition(from: TaskLifecycle, action: TransitionAction): boolean {
  return TRANSITIONS_TABLE[from][action] !== undefined;
}

/**
 * Resolve target state for given action; null if not permitted.
 */
export function nextState(from: TaskLifecycle, action: TransitionAction): TaskLifecycle | null {
  return TRANSITIONS_TABLE[from][action] ?? null;
}

/**
 * Returns true if direct from->to lifecycle transition is allowed by
 * any action. Useful for validation when action name is unknown.
 */
export function isValidTransition(from: TaskLifecycle, to: TaskLifecycle): boolean {
  if (from === to) return false;
  const map = TRANSITIONS_TABLE[from];
  for (const next of Object.values(map)) {
    if (next === to) return true;
  }
  return false;
}

/**
 * Terminal states — no further transitions are useful.
 */
export const TERMINAL_STATES: ReadonlyArray<TaskLifecycle> = ['accepted', 'cancelled'];

export function isTerminal(state: TaskLifecycle): boolean {
  return TERMINAL_STATES.includes(state);
}
