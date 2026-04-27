/**
 * Tests for the status-drift mapping module.
 *
 * Coverage:
 *   - Round-trip: every canonical lifecycle survives `legacy → canonical
 *     → legacy` (lossy, but the canonical-form check passes).
 *   - Every documented legacy synonym maps to the spec-defined canonical
 *     lifecycle (per spec/04-storage/migration-mapping.md).
 *   - Unknown / empty / wrong-type input returns `null` (caller raises 400).
 *   - Case-insensitive lookup for upper / mixed casing.
 *   - `lifecycleToLegacyStatus` is total (no `null` returns).
 */

import {
  legacyStatusToLifecycle,
  lifecycleToLegacyStatus,
  isKnownLegacyStatus,
  LEGACY_TO_LIFECYCLE,
  LIFECYCLE_TO_LEGACY,
} from '../../../../adapters/http/handlers/legacyGtdProxy/statusDriftMap';
import type { TaskLifecycle } from '../../../../domain/lifecycle';

describe('statusDriftMap', () => {
  describe('legacyStatusToLifecycle', () => {
    test.each([
      ['draft', 'draft'],
      ['pending', 'ready'],
      ['in_progress', 'started'],
      ['inProgress', 'started'],
      ['completed', 'completed'],
      ['done', 'completed'],
      ['accepted', 'accepted'],
      ['cancelled', 'cancelled'],
      ['canceled', 'cancelled'],
      ['todo', 'ready'],
      ['next', 'ready'],
      ['scheduled', 'ready'],
      ['approved', 'accepted'],
      ['inbox', 'ready'],
      ['next_action', 'ready'],
      ['waiting', 'blocked'],
      ['projects', 'ready'],
      ['estimate', 'ready'],
      ['someday', 'ready'],
      ['archived', 'cancelled'],
    ] as const)('maps legacy %s → lifecycle %s', (legacy, expected) => {
      expect(legacyStatusToLifecycle(legacy)).toBe(expected);
    });

    test('case-insensitive on lowercase keys', () => {
      expect(legacyStatusToLifecycle('TODO')).toBe('ready');
      expect(legacyStatusToLifecycle('In_Progress')).toBe('started');
      expect(legacyStatusToLifecycle('PENDING')).toBe('ready');
    });

    test('returns null for unknown strings', () => {
      expect(legacyStatusToLifecycle('definitely_not_real')).toBeNull();
      expect(legacyStatusToLifecycle('  ')).toBeNull();
    });

    test('returns null for empty / non-string input', () => {
      expect(legacyStatusToLifecycle('')).toBeNull();
      expect(legacyStatusToLifecycle(undefined)).toBeNull();
      expect(legacyStatusToLifecycle(null)).toBeNull();
      expect(legacyStatusToLifecycle(42)).toBeNull();
      expect(legacyStatusToLifecycle({})).toBeNull();
      expect(legacyStatusToLifecycle([])).toBeNull();
    });
  });

  describe('lifecycleToLegacyStatus', () => {
    test.each<[TaskLifecycle, string]>([
      ['draft', 'draft'],
      ['ready', 'pending'],
      ['started', 'in_progress'],
      ['blocked', 'waiting'],
      ['completed', 'completed'],
      ['accepted', 'accepted'],
      ['cancelled', 'cancelled'],
    ])('maps lifecycle %s → legacy %s', (lifecycle, expected) => {
      expect(lifecycleToLegacyStatus(lifecycle)).toBe(expected);
    });

    test('every TaskLifecycle has a legacy form (total function)', () => {
      const lifecycles: TaskLifecycle[] = [
        'draft',
        'ready',
        'started',
        'blocked',
        'completed',
        'accepted',
        'cancelled',
      ];
      for (const l of lifecycles) {
        const legacy = lifecycleToLegacyStatus(l);
        expect(typeof legacy).toBe('string');
        expect(legacy.length).toBeGreaterThan(0);
      }
    });
  });

  describe('round-trip stability', () => {
    test('lifecycle → legacy → lifecycle is identity for canonical forms', () => {
      const lifecycles: TaskLifecycle[] = [
        'draft',
        'ready',
        'started',
        'blocked',
        'completed',
        'accepted',
        'cancelled',
      ];
      for (const original of lifecycles) {
        const legacy = lifecycleToLegacyStatus(original);
        const back = legacyStatusToLifecycle(legacy);
        expect(back).toBe(original);
      }
    });
  });

  describe('isKnownLegacyStatus', () => {
    test('true for known synonyms', () => {
      expect(isKnownLegacyStatus('todo')).toBe(true);
      expect(isKnownLegacyStatus('in_progress')).toBe(true);
      expect(isKnownLegacyStatus('archived')).toBe(true);
    });
    test('false for unknown / non-string', () => {
      expect(isKnownLegacyStatus('???')).toBe(false);
      expect(isKnownLegacyStatus(undefined)).toBe(false);
    });
  });

  describe('table invariants', () => {
    test('every key in LEGACY_TO_LIFECYCLE points to a valid lifecycle', () => {
      const valid: TaskLifecycle[] = [
        'draft',
        'ready',
        'started',
        'blocked',
        'completed',
        'accepted',
        'cancelled',
      ];
      for (const [key, value] of Object.entries(LEGACY_TO_LIFECYCLE)) {
        expect(valid).toContain(value as TaskLifecycle);
        expect(key.length).toBeGreaterThan(0);
      }
    });

    test('LIFECYCLE_TO_LEGACY covers all 7 lifecycles', () => {
      expect(Object.keys(LIFECYCLE_TO_LEGACY).sort()).toEqual(
        ['accepted', 'blocked', 'cancelled', 'completed', 'draft', 'ready', 'started'],
      );
    });
  });
});
