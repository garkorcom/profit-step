/**
 * Tests for domain/lifecycle.ts — pure state machine.
 *
 * Covers all 7 valid transitions plus 4 forbidden ones.
 */

import {
  canTransition,
  nextState,
  isValidTransition,
  isTerminal,
  TRANSITIONS_TABLE,
  TERMINAL_STATES,
} from '../../domain/lifecycle';

describe('canTransition - valid transitions', () => {
  test('draft -> ready via ready()', () => {
    expect(canTransition('draft', 'ready')).toBe(true);
    expect(nextState('draft', 'ready')).toBe('ready');
  });

  test('ready -> started via start()', () => {
    expect(canTransition('ready', 'start')).toBe(true);
    expect(nextState('ready', 'start')).toBe('started');
  });

  test('started -> blocked via block()', () => {
    expect(canTransition('started', 'block')).toBe(true);
    expect(nextState('started', 'block')).toBe('blocked');
  });

  test('blocked -> ready via unblock()', () => {
    expect(canTransition('blocked', 'unblock')).toBe(true);
    expect(nextState('blocked', 'unblock')).toBe('ready');
  });

  test('started -> completed via complete()', () => {
    expect(canTransition('started', 'complete')).toBe(true);
    expect(nextState('started', 'complete')).toBe('completed');
  });

  test('completed -> accepted via accept()', () => {
    expect(canTransition('completed', 'accept')).toBe(true);
    expect(nextState('completed', 'accept')).toBe('accepted');
  });

  test('cancel allowed from all non-cancelled states', () => {
    const sources = ['draft', 'ready', 'started', 'blocked', 'completed', 'accepted'] as const;
    for (const from of sources) {
      expect(canTransition(from, 'cancel')).toBe(true);
      expect(nextState(from, 'cancel')).toBe('cancelled');
    }
  });
});

describe('canTransition - forbidden transitions', () => {
  test('draft -> started directly is forbidden', () => {
    expect(canTransition('draft', 'start')).toBe(false);
    expect(nextState('draft', 'start')).toBeNull();
  });

  test('accepted -> started is forbidden', () => {
    expect(canTransition('accepted', 'start')).toBe(false);
  });

  test('accepted -> completed is forbidden (cannot un-sign)', () => {
    expect(canTransition('accepted', 'complete')).toBe(false);
  });

  test('completed -> started is forbidden (no resume)', () => {
    expect(canTransition('completed', 'start')).toBe(false);
  });

  test('cancelled is terminal — cannot transition out', () => {
    const actions = ['ready', 'start', 'block', 'unblock', 'complete', 'accept'] as const;
    for (const action of actions) {
      expect(canTransition('cancelled', action)).toBe(false);
    }
  });
});

describe('isValidTransition (pair-based check)', () => {
  test('draft -> ready is valid', () => {
    expect(isValidTransition('draft', 'ready')).toBe(true);
  });

  test('ready -> draft is invalid (no rewind)', () => {
    expect(isValidTransition('ready', 'draft')).toBe(false);
  });

  test('same-state self transition is invalid', () => {
    expect(isValidTransition('ready', 'ready')).toBe(false);
  });

  test('any state -> cancelled is valid (except cancelled itself)', () => {
    expect(isValidTransition('draft', 'cancelled')).toBe(true);
    expect(isValidTransition('accepted', 'cancelled')).toBe(true);
  });
});

describe('isTerminal', () => {
  test('accepted is terminal', () => {
    expect(isTerminal('accepted')).toBe(true);
  });
  test('cancelled is terminal', () => {
    expect(isTerminal('cancelled')).toBe(true);
  });
  test('TERMINAL_STATES contains expected entries', () => {
    expect(TERMINAL_STATES).toEqual(expect.arrayContaining(['accepted', 'cancelled']));
  });
  test('non-terminal states are not terminal', () => {
    expect(isTerminal('draft')).toBe(false);
    expect(isTerminal('ready')).toBe(false);
    expect(isTerminal('started')).toBe(false);
    expect(isTerminal('blocked')).toBe(false);
    expect(isTerminal('completed')).toBe(false);
  });
});

describe('TRANSITIONS_TABLE structure invariants', () => {
  test('every key in table is a valid lifecycle', () => {
    const keys = Object.keys(TRANSITIONS_TABLE);
    expect(keys).toEqual(
      expect.arrayContaining([
        'draft',
        'ready',
        'started',
        'blocked',
        'completed',
        'accepted',
        'cancelled',
      ]),
    );
  });

  test('cancelled has empty transition map', () => {
    expect(Object.keys(TRANSITIONS_TABLE.cancelled)).toHaveLength(0);
  });
});
