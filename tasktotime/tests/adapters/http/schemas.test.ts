/**
 * Tests for `adapters/http/schemas.ts` — focused on `parseTransitionBody`'s
 * per-action payload requirements (the recently-added validation that fixed
 * the silent 400 on Block / Accept clicks from the frontend).
 *
 * Coverage:
 *   - `block` requires `blockedReason` (non-empty, >= 5 chars)
 *   - `accept` requires `acceptance: { signedAt, signedBy: UserRef, signature? }`
 *   - Happy paths return `{ ok: true, value: TransitionTaskCommand }`
 *   - Errors come back as structured `{ path, message }[]` so the frontend
 *     can render field-level feedback.
 *
 * Other actions (`ready`, `start`, `unblock`, `complete`, `cancel`) don't
 * require additional payload — they're sanity-checked here too.
 */

import { parseTransitionBody } from '../../../adapters/http/schemas';
import type { UserRef } from '../../../domain/Task';
import { asUserId } from '../../../domain/identifiers';

const TEST_USER: UserRef = { id: asUserId('user_test'), name: 'Test User' };
const TASK_ID = 'task_abc123';

// Common acceptance payload fixture. Tests build on top of this so each case
// stays focused on what it's trying to assert.
const VALID_ACCEPTANCE = {
  signedAt: 1_700_000_000_000,
  signedBy: { id: 'client_jim', name: 'Jim Dvorkin' },
  signature: 'https://example.com/act.pdf',
};

// ─── block ──────────────────────────────────────────────────────────────

describe('parseTransitionBody — action: block', () => {
  test('rejects when blockedReason is missing', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'block', idempotencyKey: 'k1' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return; // type narrow
    expect(result.errors).toEqual([
      expect.objectContaining({ path: 'blockedReason' }),
    ]);
  });

  test('rejects when blockedReason is empty string', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'block', idempotencyKey: 'k1', blockedReason: '' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('blockedReason');
  });

  test('rejects when blockedReason is shorter than 5 chars', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'block', idempotencyKey: 'k1', blockedReason: 'abc' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('blockedReason');
    expect(result.errors[0]!.message).toMatch(/at least 5 characters/);
  });

  test('rejects when blockedReason is whitespace-only', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'block', idempotencyKey: 'k1', blockedReason: '     ' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('blockedReason');
  });

  test('accepts when blockedReason is exactly 5 chars', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'block',
        idempotencyKey: 'k1',
        blockedReason: 'short',
      },
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('block');
    expect(result.value.blockedReason).toBe('short');
  });

  test('accepts a longer blockedReason and forwards it through', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'block',
        idempotencyKey: 'k1',
        blockedReason: 'Waiting on permit committee approval',
      },
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blockedReason).toBe(
      'Waiting on permit committee approval',
    );
    expect(result.value.taskId).toBe(TASK_ID);
    expect(result.value.idempotencyKey).toBe('k1');
  });
});

// ─── accept ─────────────────────────────────────────────────────────────

describe('parseTransitionBody — action: accept', () => {
  test('rejects when acceptance is missing entirely', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'accept', idempotencyKey: 'k1' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('acceptance');
  });

  test('rejects when acceptance is null', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'accept', idempotencyKey: 'k1', acceptance: null },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('acceptance');
  });

  test('rejects when acceptance is missing signedAt', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: {
          signedBy: { id: 'u', name: 'U' },
        },
      },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.path === 'acceptance.signedAt'),
    ).toBe(true);
  });

  test('rejects when acceptance.signedAt is non-positive', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: {
          signedAt: 0,
          signedBy: { id: 'u', name: 'U' },
        },
      },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.path === 'acceptance.signedAt'),
    ).toBe(true);
  });

  test('rejects when acceptance.signedBy is missing', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: { signedAt: 1_700_000_000_000 },
      },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.path === 'acceptance.signedBy'),
    ).toBe(true);
  });

  test('rejects when acceptance.signedBy is missing fields', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: {
          signedAt: 1_700_000_000_000,
          signedBy: { id: 'u' }, // missing name
        },
      },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.path.startsWith('acceptance.signedBy')),
    ).toBe(true);
  });

  test('rejects when acceptance.signature is non-string', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: {
          signedAt: 1_700_000_000_000,
          signedBy: { id: 'u', name: 'U' },
          signature: 42,
        },
      },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.path === 'acceptance.signature'),
    ).toBe(true);
  });

  test('accepts a complete payload with signature', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: VALID_ACCEPTANCE,
      },
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe('accept');
    expect(result.value.acceptance).toEqual({
      signedAt: VALID_ACCEPTANCE.signedAt,
      signedBy: {
        id: VALID_ACCEPTANCE.signedBy.id,
        name: VALID_ACCEPTANCE.signedBy.name,
      },
      signature: VALID_ACCEPTANCE.signature,
    });
  });

  test('accepts a payload without optional signature', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'accept',
        idempotencyKey: 'k1',
        acceptance: {
          signedAt: 1_700_000_000_000,
          signedBy: { id: 'client_jim', name: 'Jim Dvorkin' },
        },
      },
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.acceptance).toBeDefined();
    expect(result.value.acceptance!.signature).toBeUndefined();
    expect(result.value.acceptance!.signedBy.name).toBe('Jim Dvorkin');
  });
});

// ─── other actions don't need extra payloads ───────────────────────────

describe('parseTransitionBody — actions without payload requirements', () => {
  test.each([
    ['ready'],
    ['start'],
    ['unblock'],
    ['complete'],
    ['cancel'],
  ] as const)('action %s parses with just idempotencyKey', (action) => {
    const result = parseTransitionBody(
      TASK_ID,
      { action, idempotencyKey: 'k1' },
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe(action);
  });

  test('action complete + reason forwards through', () => {
    const result = parseTransitionBody(
      TASK_ID,
      {
        action: 'complete',
        idempotencyKey: 'k1',
        reason: 'closed via cron sweep',
      },
      TEST_USER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reason).toBe('closed via cron sweep');
  });
});

// ─── basic structural failures ─────────────────────────────────────────

describe('parseTransitionBody — top-level errors', () => {
  test('rejects non-object body', () => {
    const result = parseTransitionBody(TASK_ID, null, TEST_USER);
    expect(result.ok).toBe(false);
  });

  test('rejects unknown action', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'magic', idempotencyKey: 'k1' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('action');
  });

  test('rejects missing idempotencyKey', () => {
    const result = parseTransitionBody(
      TASK_ID,
      { action: 'cancel' },
      TEST_USER,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.path).toBe('idempotencyKey');
  });
});
