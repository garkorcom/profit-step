/**
 * Unit tests for webhookDelivery.ts — Phase 10
 *
 * Tests pattern matching, HMAC signing, and delivery logic.
 * Does NOT test actual HTTP delivery (would need nock/msw).
 */
import * as crypto from 'crypto';
import { matchPattern, signPayload } from '../src/agent/utils/webhookDelivery';

describe('webhookDelivery', () => {
  // ─── matchPattern ──────────────────────────────────────────

  describe('matchPattern', () => {
    test('exact match', () => {
      expect(matchPattern('task.assigned', 'task.assigned')).toBe(true);
    });

    test('exact mismatch', () => {
      expect(matchPattern('task.assigned', 'task.created')).toBe(false);
    });

    test('wildcard action: task.* matches task.assigned', () => {
      expect(matchPattern('task.*', 'task.assigned')).toBe(true);
    });

    test('wildcard action: task.* matches task.completed', () => {
      expect(matchPattern('task.*', 'task.completed')).toBe(true);
    });

    test('wildcard action: alert.* does NOT match task.assigned', () => {
      expect(matchPattern('alert.*', 'task.assigned')).toBe(false);
    });

    test('wildcard type: *.assigned matches task.assigned', () => {
      expect(matchPattern('*.assigned', 'task.assigned')).toBe(true);
    });

    test('wildcard type: *.assigned matches session.assigned', () => {
      expect(matchPattern('*.assigned', 'session.assigned')).toBe(true);
    });

    test('wildcard type: *.created does NOT match task.assigned', () => {
      expect(matchPattern('*.created', 'task.assigned')).toBe(false);
    });

    test('double wildcard: *.* matches everything', () => {
      expect(matchPattern('*.*', 'task.assigned')).toBe(true);
      expect(matchPattern('*.*', 'alert.budget_warning')).toBe(true);
    });

    test('single star matches everything', () => {
      expect(matchPattern('*', 'task.assigned')).toBe(true);
    });

    test('inventory.low_stock exact match', () => {
      expect(matchPattern('inventory.low_stock', 'inventory.low_stock')).toBe(true);
    });

    test('payroll.* matches payroll.overtime_alert', () => {
      expect(matchPattern('payroll.*', 'payroll.overtime_alert')).toBe(true);
    });
  });

  // ─── signPayload ───────────────────────────────────────────

  describe('signPayload', () => {
    test('returns valid HMAC-SHA256 hex digest', () => {
      const payload = '{"type":"task","action":"created"}';
      const secret = 'test-secret-123';

      const result = signPayload(payload, secret);

      // Verify it's a valid hex string
      expect(result).toMatch(/^[a-f0-9]{64}$/);

      // Verify it matches manual crypto
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(result).toBe(expected);
    });

    test('different payloads produce different signatures', () => {
      const secret = 'test-secret';
      const sig1 = signPayload('{"a":1}', secret);
      const sig2 = signPayload('{"a":2}', secret);
      expect(sig1).not.toBe(sig2);
    });

    test('different secrets produce different signatures', () => {
      const payload = '{"type":"task"}';
      const sig1 = signPayload(payload, 'secret-a');
      const sig2 = signPayload(payload, 'secret-b');
      expect(sig1).not.toBe(sig2);
    });

    test('same inputs produce same signature (deterministic)', () => {
      const payload = '{"type":"task","action":"created"}';
      const secret = 'test-secret';
      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload(payload, secret);
      expect(sig1).toBe(sig2);
    });

    test('empty payload produces valid signature', () => {
      const result = signPayload('', 'secret');
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
