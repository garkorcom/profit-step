/**
 * Pure unit tests for the self-update guard logic — no emulator needed.
 * Regression coverage for the bug where the old guard stopped ALL updates
 * once lastModifiedBy had ever been stamped by this function (breaking
 * incrementLoginCount test 2, test 4, and any subsequent-login increment
 * in production).
 */

import {
  checkSelfUpdateGuard,
  checkAnyFieldChangeGuard,
  checkFieldChangeGuard,
} from '../src/utils/guards';

describe('checkSelfUpdateGuard', () => {
  const fn = 'incrementLoginCount';

  test('stops when lastModifiedBy transitions to this function (our own write echoing back)', () => {
    const res = checkSelfUpdateGuard(
      { lastModifiedBy: undefined },
      { lastModifiedBy: fn },
      fn
    );
    expect(res.shouldProceed).toBe(false);
  });

  test('proceeds when lastModifiedBy was already our function (user update on our previously-stamped doc)', () => {
    // Was the old bug: this case stopped forever after first trigger run.
    const res = checkSelfUpdateGuard(
      { lastModifiedBy: fn, lastSeen: 't1' },
      { lastModifiedBy: fn, lastSeen: 't2' },
      fn
    );
    expect(res.shouldProceed).toBe(true);
  });

  test('proceeds when lastModifiedBy is not ours (someone else wrote)', () => {
    const res = checkSelfUpdateGuard(
      { lastModifiedBy: 'other' },
      { lastModifiedBy: 'other' },
      fn
    );
    expect(res.shouldProceed).toBe(true);
  });

  test('proceeds when lastModifiedBy is missing on both sides (user update, no metadata)', () => {
    const res = checkSelfUpdateGuard({}, { lastSeen: 't' }, fn);
    expect(res.shouldProceed).toBe(true);
  });

  test('proceeds when another trigger takes over (our fn → other fn)', () => {
    const res = checkSelfUpdateGuard(
      { lastModifiedBy: fn },
      { lastModifiedBy: 'other' },
      fn
    );
    expect(res.shouldProceed).toBe(true);
  });
});

describe('checkFieldChangeGuard', () => {
  test('stops when field unchanged', () => {
    expect(checkFieldChangeGuard({ x: 1 }, { x: 1 }, 'x').shouldProceed).toBe(false);
  });
  test('proceeds when field changed', () => {
    expect(checkFieldChangeGuard({ x: 1 }, { x: 2 }, 'x').shouldProceed).toBe(true);
  });
  test('proceeds when field appears (undefined → value)', () => {
    expect(checkFieldChangeGuard({}, { x: 1 }, 'x').shouldProceed).toBe(true);
  });
});

describe('checkAnyFieldChangeGuard', () => {
  test('stops if none of the fields changed', () => {
    const res = checkAnyFieldChangeGuard(
      { a: 1, b: 2 },
      { a: 1, b: 2, unrelated: 'c' },
      ['a', 'b']
    );
    expect(res.shouldProceed).toBe(false);
  });
  test('proceeds if any field changed', () => {
    const res = checkAnyFieldChangeGuard({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b']);
    expect(res.shouldProceed).toBe(true);
  });
});
