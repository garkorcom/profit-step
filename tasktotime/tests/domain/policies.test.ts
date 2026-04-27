/**
 * Tests for domain/policies/* — pure rules.
 */

import { computeBonusPenalty } from '../../domain/policies/BonusPenaltyPolicy';
import { resolveEffectiveWiki } from '../../domain/policies/WikiInheritancePolicy';
import { shouldAutoApprove } from '../../domain/policies/AutoApprovePolicy';
import { makeTask } from '../../shared/test-helpers/makeTask';
import { asTaskId } from '../../domain/identifiers';

const T0 = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('computeBonusPenalty', () => {
  test('awards bonus when on time', () => {
    const task = makeTask({
      lifecycle: 'completed',
      dueAt: (T0 + 24 * HOUR) as never,
      completedAt: (T0 + 12 * HOUR) as never,
      bonusOnTime: { amount: 100, currency: 'USD' },
      penaltyOverdue: { amount: 50, currency: 'USD' },
    });
    const result = computeBonusPenalty(task);
    expect(result.bonus).toEqual({ amount: 100, currency: 'USD' });
    expect(result.penalty).toBeUndefined();
  });

  test('applies penalty when overdue', () => {
    const task = makeTask({
      lifecycle: 'completed',
      dueAt: (T0 + 1 * HOUR) as never,
      completedAt: (T0 + 4 * HOUR) as never,
      bonusOnTime: { amount: 100, currency: 'USD' },
      penaltyOverdue: { amount: 50, currency: 'USD' },
    });
    const result = computeBonusPenalty(task);
    expect(result.bonus).toBeUndefined();
    expect(result.penalty).toEqual({ amount: 50, currency: 'USD' });
  });

  test('returns nothing if no bonus/penalty configured', () => {
    const task = makeTask({
      lifecycle: 'completed',
      dueAt: (T0 + 1 * HOUR) as never,
      completedAt: (T0 + 4 * HOUR) as never,
    });
    const result = computeBonusPenalty(task);
    expect(result.bonus).toBeUndefined();
    expect(result.penalty).toBeUndefined();
  });

  test('zero amount is treated as no bonus/penalty', () => {
    const task = makeTask({
      lifecycle: 'completed',
      dueAt: (T0 + 1 * HOUR) as never,
      completedAt: (T0 + 4 * HOUR) as never,
      penaltyOverdue: { amount: 0, currency: 'USD' },
    });
    const result = computeBonusPenalty(task);
    expect(result.penalty).toBeUndefined();
  });

  test('boundary: completedAt === dueAt counts as on-time', () => {
    const task = makeTask({
      lifecycle: 'completed',
      dueAt: (T0 + 1 * HOUR) as never,
      completedAt: (T0 + 1 * HOUR) as never,
      bonusOnTime: { amount: 10, currency: 'USD' },
    });
    const result = computeBonusPenalty(task);
    expect(result.bonus).toEqual({ amount: 10, currency: 'USD' });
  });
});

describe('resolveEffectiveWiki', () => {
  const baseSubtask = makeTask({
    id: asTaskId('sub'),
    isSubtask: true,
    parentTaskId: asTaskId('parent'),
    wikiInheritsFromParent: true,
    wiki: {
      contentMd: 'Subtask own content',
      updatedAt: T0 as never,
      updatedBy: { id: 'u' as never, name: 'U' },
      version: 1,
    },
  });

  const baseParent = makeTask({
    id: asTaskId('parent'),
    title: 'Parent task',
    isSubtask: false,
    wiki: {
      contentMd: 'Parent content',
      updatedAt: T0 as never,
      updatedBy: { id: 'u' as never, name: 'U' },
      version: 1,
    },
  });

  test('root task: returns own wiki only', () => {
    const result = resolveEffectiveWiki({ task: baseParent, parent: null });
    expect(result).toBe('Parent content');
  });

  test('subtask with inherits=false: own only', () => {
    const sub = { ...baseSubtask, wikiInheritsFromParent: false };
    const result = resolveEffectiveWiki({ task: sub, parent: baseParent });
    expect(result).toBe('Subtask own content');
  });

  test('subtask with inherits=true and own content: parent + own', () => {
    const result = resolveEffectiveWiki({ task: baseSubtask, parent: baseParent });
    expect(result).toContain('Parent content');
    expect(result).toContain('Subtask own content');
    expect(result).toContain('---'); // separator
  });

  test('subtask with inherits=true but no own wiki: parent only', () => {
    const sub = { ...baseSubtask, wiki: undefined };
    const result = resolveEffectiveWiki({ task: sub, parent: baseParent });
    expect(result).toBe('Parent content');
  });

  test('subtask with inherits=true but parent missing: own only', () => {
    const result = resolveEffectiveWiki({ task: baseSubtask, parent: null });
    expect(result).toBe('Subtask own content');
  });

  test('includeParentTitle option prepends "# {title}" header', () => {
    const result = resolveEffectiveWiki(
      { task: baseSubtask, parent: baseParent },
      { includeParentTitle: true },
    );
    expect(result).toContain('# Parent task');
  });
});

describe('shouldAutoApprove', () => {
  test('disabled by default (feature gate off)', () => {
    const task = makeTask({ lifecycle: 'completed' });
    expect(shouldAutoApprove(task).approved).toBe(false);
  });

  test('approved when feature enabled and acceptance present', () => {
    const task = makeTask({
      lifecycle: 'completed',
      acceptance: {
        signedAt: 1 as never,
        signedBy: { id: 'u' as never, name: 'U' },
      },
    });
    const result = shouldAutoApprove(task, { featureEnabled: true });
    expect(result.approved).toBe(true);
  });

  test('approved when below threshold', () => {
    const task = makeTask({
      lifecycle: 'completed',
      priceClient: { amount: 50, currency: 'USD' },
    });
    const result = shouldAutoApprove(task, {
      featureEnabled: true,
      thresholdAmount: 100,
    });
    expect(result.approved).toBe(true);
    expect(result.reason).toBe('below_threshold');
  });

  test('not approved when not yet completed', () => {
    const task = makeTask({ lifecycle: 'started' });
    const result = shouldAutoApprove(task, { featureEnabled: true });
    expect(result.approved).toBe(false);
  });
});
