/**
 * Unit tests for the backfill helpers.
 *
 * Self-contained — uses `node:assert/strict`. Runs without jest config:
 *
 *   npx ts-node scripts/__tests__/backfill-tasktotime-priority-and-titleLowercase.test.ts
 *
 * Exits non-zero on first failure. Each test prints a one-line summary so
 * CI logs are scannable.
 *
 * The Firestore write path (batched commits, auth resolution) is intentionally
 * NOT covered here — it would require an emulator harness for a one-shot
 * script. The pure helpers are the part that needs locking down: the int→
 * string priority table MUST stay in sync with `tasktotime/adapters/http/
 * schemas.ts:335` (PR #82) or backfilled docs will mismatch every downstream
 * consumer.
 */

import assert from 'node:assert/strict';

import {
  PRIORITY_INT_TO_STRING,
  computeTitleLowercase,
  mapPriorityIntToString,
  planUpdate,
} from '../backfill-tasktotime-priority-and-titleLowercase';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`    ${(e as Error).message}`);
  }
}

console.log('backfill-tasktotime-priority-and-titleLowercase — unit tests\n');

// ─── PRIORITY_INT_TO_STRING table ──────────────────────────────────────

test('priority table — index 0 is "low"', () => {
  assert.equal(PRIORITY_INT_TO_STRING[0], 'low');
});

test('priority table — index 1 is "medium"', () => {
  assert.equal(PRIORITY_INT_TO_STRING[1], 'medium');
});

test('priority table — index 2 is "high"', () => {
  assert.equal(PRIORITY_INT_TO_STRING[2], 'high');
});

test('priority table — index 3 is "critical"', () => {
  assert.equal(PRIORITY_INT_TO_STRING[3], 'critical');
});

test('priority table — exactly 4 entries (mirrors PR #82 mapping)', () => {
  assert.equal(PRIORITY_INT_TO_STRING.length, 4);
});

// ─── mapPriorityIntToString ────────────────────────────────────────────

test('mapPriorityIntToString — full int→string mapping', () => {
  assert.equal(mapPriorityIntToString(0), 'low');
  assert.equal(mapPriorityIntToString(1), 'medium');
  assert.equal(mapPriorityIntToString(2), 'high');
  assert.equal(mapPriorityIntToString(3), 'critical');
});

test('mapPriorityIntToString — out-of-range integers return null', () => {
  assert.equal(mapPriorityIntToString(-1), null);
  assert.equal(mapPriorityIntToString(4), null);
  assert.equal(mapPriorityIntToString(99), null);
});

test('mapPriorityIntToString — non-integers return null', () => {
  assert.equal(mapPriorityIntToString(1.5), null);
  assert.equal(mapPriorityIntToString(NaN), null);
  assert.equal(mapPriorityIntToString(Infinity), null);
});

test('mapPriorityIntToString — non-numbers return null (already-canonical strings)', () => {
  // String values are already canonical — backfill should treat them as
  // "no work needed" (null = no transformation).
  assert.equal(mapPriorityIntToString('low'), null);
  assert.equal(mapPriorityIntToString('high'), null);
  assert.equal(mapPriorityIntToString(undefined), null);
  assert.equal(mapPriorityIntToString(null), null);
  assert.equal(mapPriorityIntToString({}), null);
});

// ─── computeTitleLowercase ─────────────────────────────────────────────

test('computeTitleLowercase — basic lowercase + trim', () => {
  assert.equal(computeTitleLowercase('Demo Kitchen'), 'demo kitchen');
  assert.equal(computeTitleLowercase('  Padded  '), 'padded');
});

test('computeTitleLowercase — already-lowercase passes through (after trim)', () => {
  assert.equal(computeTitleLowercase('foo'), 'foo');
});

test('computeTitleLowercase — empty / whitespace-only return null', () => {
  assert.equal(computeTitleLowercase(''), null);
  assert.equal(computeTitleLowercase('   '), null);
  assert.equal(computeTitleLowercase('\t\n'), null);
});

test('computeTitleLowercase — non-string returns null', () => {
  assert.equal(computeTitleLowercase(123), null);
  assert.equal(computeTitleLowercase(undefined), null);
  assert.equal(computeTitleLowercase(null), null);
});

test('computeTitleLowercase — unicode lowercased correctly', () => {
  assert.equal(computeTitleLowercase('Кухня ДЕМО'), 'кухня демо');
});

// ─── planUpdate (composite logic) ──────────────────────────────────────

test('planUpdate — legacy doc (int priority + missing titleLowercase) → both fields', () => {
  const update = planUpdate({ priority: 2, title: 'Wire Bedroom' });
  assert.deepEqual(update, { priority: 'high', titleLowercase: 'wire bedroom' });
});

test('planUpdate — already-canonical doc → null (no-op)', () => {
  const update = planUpdate({
    priority: 'medium',
    title: 'Kitchen Demo',
    titleLowercase: 'kitchen demo',
  });
  assert.equal(update, null);
});

test('planUpdate — only priority needs fix', () => {
  const update = planUpdate({
    priority: 1,
    title: 'Wire Living',
    titleLowercase: 'wire living',
  });
  assert.deepEqual(update, { priority: 'medium' });
});

test('planUpdate — only titleLowercase needs fix', () => {
  const update = planUpdate({ priority: 'critical', title: 'Permit Inspection' });
  assert.deepEqual(update, { titleLowercase: 'permit inspection' });
});

test('planUpdate — empty titleLowercase string treated as missing', () => {
  const update = planUpdate({
    priority: 'low',
    title: 'Foo Bar',
    titleLowercase: '',
  });
  assert.deepEqual(update, { titleLowercase: 'foo bar' });
});

test('planUpdate — null titleLowercase treated as missing', () => {
  const update = planUpdate({
    priority: 'low',
    title: 'Foo Bar',
    titleLowercase: null,
  });
  assert.deepEqual(update, { titleLowercase: 'foo bar' });
});

test('planUpdate — title missing entirely → no titleLowercase write attempted', () => {
  // Defensive: a doc with no title at all should not synthesise `titleLowercase`.
  // Priority still gets fixed if int form is present.
  const update = planUpdate({ priority: 0 });
  assert.deepEqual(update, { priority: 'low' });
});

test('planUpdate — title is empty string + int priority → only priority fixed', () => {
  const update = planUpdate({ priority: 3, title: '' });
  assert.deepEqual(update, { priority: 'critical' });
});

test('planUpdate — doc with no recoverable fields → null', () => {
  // No priority, no title at all = nothing to do.
  assert.equal(planUpdate({}), null);
});

test('planUpdate — already-string priority + present titleLowercase → null', () => {
  const update = planUpdate({
    priority: 'critical',
    title: 'Kitchen Demo',
    titleLowercase: 'kitchen demo',
  });
  assert.equal(update, null);
});

test('planUpdate — int priority 0 (falsy) is still recognised', () => {
  // Guard against `if (data.priority)` style shortcuts that would skip 0.
  const update = planUpdate({ priority: 0, titleLowercase: 'x', title: 'X' });
  assert.deepEqual(update, { priority: 'low' });
});

// ─── Summary ───────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
