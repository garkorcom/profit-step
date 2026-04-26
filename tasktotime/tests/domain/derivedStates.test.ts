/**
 * Tests for domain/derivedStates.ts — pure predicates.
 */

import {
  isOverdue,
  isAtRisk,
  isActive,
  isAwaitingAct,
  computeDerivedStates,
} from '../../domain/derivedStates';
import { makeTask } from '../../shared/test-helpers/makeTask';
import { asTaskId } from '../../domain/identifiers';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('isOverdue', () => {
  test('true when ready and dueAt < now', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'ready',
      dueAt: (T0 - HOUR) as never,
    });
    expect(isOverdue(task, T0)).toBe(true);
  });

  test('false when accepted (no longer actionable)', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'accepted',
      dueAt: (T0 - HOUR) as never,
    });
    expect(isOverdue(task, T0)).toBe(false);
  });

  test('false when completed (no longer actionable)', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'completed',
      dueAt: (T0 - HOUR) as never,
    });
    expect(isOverdue(task, T0)).toBe(false);
  });

  test('true when started and overdue', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'started',
      dueAt: (T0 - 1) as never,
    });
    expect(isOverdue(task, T0)).toBe(true);
  });

  test('true when blocked and overdue', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'blocked',
      dueAt: (T0 - 1) as never,
    });
    expect(isOverdue(task, T0)).toBe(true);
  });

  test('false when due in the future', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'ready',
      dueAt: (T0 + HOUR) as never,
    });
    expect(isOverdue(task, T0)).toBe(false);
  });
});

describe('isAtRisk', () => {
  test('true when remaining time < estimatedDurationMinutes', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'ready',
      dueAt: (T0 + 30 * 60_000) as never, // 30 minutes left
      estimatedDurationMinutes: 60, // need 60 minutes
    });
    expect(isAtRisk(task, T0)).toBe(true);
  });

  test('false when plenty of time', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'ready',
      dueAt: (T0 + 5 * HOUR) as never,
      estimatedDurationMinutes: 60,
    });
    expect(isAtRisk(task, T0)).toBe(false);
  });

  test('false when already overdue (overdue, not at-risk)', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'ready',
      dueAt: (T0 - HOUR) as never,
      estimatedDurationMinutes: 60,
    });
    expect(isAtRisk(task, T0)).toBe(false);
  });

  test('false when terminal', () => {
    const task = makeTask({
      id: asTaskId('t'),
      lifecycle: 'completed',
      dueAt: (T0 + 30 * 60_000) as never,
      estimatedDurationMinutes: 60,
    });
    expect(isAtRisk(task, T0)).toBe(false);
  });
});

describe('isActive', () => {
  test('true when started', () => {
    expect(isActive(makeTask({ lifecycle: 'started' }))).toBe(true);
  });
  test('false otherwise', () => {
    expect(isActive(makeTask({ lifecycle: 'ready' }))).toBe(false);
    expect(isActive(makeTask({ lifecycle: 'blocked' }))).toBe(false);
    expect(isActive(makeTask({ lifecycle: 'completed' }))).toBe(false);
  });
});

describe('isAwaitingAct', () => {
  test('true when completed and no acceptance', () => {
    expect(
      isAwaitingAct(makeTask({ lifecycle: 'completed', acceptance: undefined })),
    ).toBe(true);
  });

  test('false when completed but acceptance present', () => {
    expect(
      isAwaitingAct(
        makeTask({
          lifecycle: 'completed',
          acceptance: {
            url: 'x',
            signedAt: 1 as never,
            signedBy: 'u',
            signedByName: 'U',
          },
        }),
      ),
    ).toBe(false);
  });

  test('false when accepted', () => {
    expect(isAwaitingAct(makeTask({ lifecycle: 'accepted' }))).toBe(false);
  });
});

describe('computeDerivedStates', () => {
  test('bundles all four predicates', () => {
    const task = makeTask({
      lifecycle: 'started',
      dueAt: (T0 - 1) as never,
      estimatedDurationMinutes: 60,
    });
    const result = computeDerivedStates(task, T0);
    expect(result.active).toBe(true);
    expect(result.overdue).toBe(true);
    expect(result.atRisk).toBe(false);
    expect(result.awaitingAct).toBe(false);
  });
});
