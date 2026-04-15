/**
 * Unit tests for multi-user backend code.
 *
 * Covers:
 *   1. scopesForRole() — default scope sets for all 7 roles + unknown fallback
 *   2. TelegramLinkSchema — telegramId validation
 *   3. BotNotifySchema — message length, type enum, defaults
 *   4. ListTasksQuerySchema — date string validation (dueBefore / dueAfter)
 *   5. ListCostsQuerySchema — date string validation (from / to)
 */

import { scopesForRole } from '../src/agent/agentMiddleware';
import {
  TelegramLinkSchema,
  BotNotifySchema,
} from '../src/agent/schemas/userSchemas';
import { ListTasksQuerySchema } from '../src/agent/schemas/taskSchemas';
import { ListCostsQuerySchema } from '../src/agent/schemas/costSchemas';

// ─── 1. scopesForRole() ─────────────────────────────────────────────

describe('scopesForRole', () => {
  it('returns worker scopes', () => {
    expect(scopesForRole('worker')).toEqual([
      'tasks:read', 'tasks:write',
      'time:read', 'time:write',
      'costs:write', 'files:write',
      'inventory:read',
    ]);
  });

  it('returns driver scopes (same as worker)', () => {
    expect(scopesForRole('driver')).toEqual(scopesForRole('worker'));
  });

  it('returns supply scopes', () => {
    const scopes = scopesForRole('supply');
    expect(scopes).toContain('inventory:read');
    expect(scopes).toContain('inventory:write');
    expect(scopes).toContain('costs:read');
    expect(scopes).toHaveLength(3);
  });

  it('returns foreman scopes with team:read', () => {
    const scopes = scopesForRole('foreman');
    expect(scopes).toContain('team:read');
    expect(scopes).toContain('tasks:read');
    expect(scopes).toContain('tasks:write');
    expect(scopes).toContain('time:read');
    expect(scopes).toContain('time:write');
    expect(scopes).toContain('costs:read');
    expect(scopes).toContain('files:read');
    expect(scopes).toContain('inventory:read');
    expect(scopes).toHaveLength(8);
  });

  it('returns manager scopes with finance:read', () => {
    const scopes = scopesForRole('manager');
    expect(scopes).toContain('finance:read');
    expect(scopes).toContain('tasks:read');
    expect(scopes).toContain('tasks:write');
    expect(scopes).toContain('costs:read');
    expect(scopes).toContain('costs:write');
    expect(scopes).toContain('time:read');
    expect(scopes).toContain('inventory:read');
    expect(scopes).toHaveLength(7);
  });

  it('returns accountant scopes with payroll access', () => {
    const scopes = scopesForRole('accountant');
    expect(scopes).toContain('payroll:read');
    expect(scopes).toContain('payroll:write');
    expect(scopes).toContain('costs:read');
    expect(scopes).toContain('time:read');
    expect(scopes).toContain('finance:read');
    expect(scopes).toHaveLength(5);
  });

  it('returns admin scope (single wildcard)', () => {
    expect(scopesForRole('admin')).toEqual(['admin']);
  });

  it('falls back to worker scopes for unknown role', () => {
    expect(scopesForRole('intern')).toEqual(scopesForRole('worker'));
    expect(scopesForRole('')).toEqual(scopesForRole('worker'));
    expect(scopesForRole('superadmin')).toEqual(scopesForRole('worker'));
  });
});

// ─── 2. TelegramLinkSchema ──────────────────────────────────────────

describe('TelegramLinkSchema', () => {
  it('accepts valid telegramId only', () => {
    const result = TelegramLinkSchema.safeParse({ telegramId: 111111 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.telegramId).toBe(111111);
      expect(result.data.telegramUsername).toBeUndefined();
    }
  });

  it('accepts telegramId + telegramUsername', () => {
    const result = TelegramLinkSchema.safeParse({
      telegramId: 111111,
      telegramUsername: 'vasya',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.telegramId).toBe(111111);
      expect(result.data.telegramUsername).toBe('vasya');
    }
  });

  it('rejects negative telegramId', () => {
    const result = TelegramLinkSchema.safeParse({ telegramId: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer telegramId', () => {
    const result = TelegramLinkSchema.safeParse({ telegramId: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects missing telegramId', () => {
    const result = TelegramLinkSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects telegramId = 0 (not positive)', () => {
    const result = TelegramLinkSchema.safeParse({ telegramId: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects string telegramId', () => {
    const result = TelegramLinkSchema.safeParse({ telegramId: '111111' });
    expect(result.success).toBe(false);
  });
});

// ─── 3. BotNotifySchema ─────────────────────────────────────────────

describe('BotNotifySchema', () => {
  it('accepts minimal valid payload with defaults', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 111,
      message: 'hello',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetTelegramId).toBe(111);
      expect(result.data.message).toBe('hello');
      // Check defaults
      expect(result.data.type).toBe('general');
      expect(result.data.priority).toBe('normal');
      expect(result.data.parseMode).toBe('Markdown');
      expect(result.data.relatedEntityId).toBeUndefined();
    }
  });

  it('accepts full payload with all fields', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 999999,
      message: 'Task assigned to you',
      type: 'task_assigned',
      relatedEntityId: 'task_abc123',
      priority: 'urgent',
      parseMode: 'HTML',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('task_assigned');
      expect(result.data.relatedEntityId).toBe('task_abc123');
      expect(result.data.priority).toBe('urgent');
      expect(result.data.parseMode).toBe('HTML');
    }
  });

  it('accepts all valid type values', () => {
    const types = ['task_assigned', 'stock_low', 'estimate_approved', 'overtime_alert', 'general'] as const;
    for (const type of types) {
      const result = BotNotifySchema.safeParse({
        targetTelegramId: 1,
        message: 'test',
        type,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects message exceeding 4096 chars', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 111,
      message: 'x'.repeat(4097),
    });
    expect(result.success).toBe(false);
  });

  it('accepts message at exactly 4096 chars', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 111,
      message: 'x'.repeat(4096),
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty message', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 111,
      message: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown type', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 111,
      message: 'test',
      type: 'unknown_type',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing message', () => {
    const result = BotNotifySchema.safeParse({
      targetTelegramId: 111,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing targetTelegramId', () => {
    const result = BotNotifySchema.safeParse({
      message: 'hello',
    });
    expect(result.success).toBe(false);
  });
});

// ─── 4. ListTasksQuerySchema — date validation ──────────────────────

describe('ListTasksQuerySchema date validation', () => {
  it('accepts valid dueBefore ISO date', () => {
    const result = ListTasksQuerySchema.safeParse({ dueBefore: '2026-04-15' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dueBefore).toBe('2026-04-15');
    }
  });

  it('accepts valid dueAfter ISO date', () => {
    const result = ListTasksQuerySchema.safeParse({ dueAfter: '2026-01-01' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dueAfter).toBe('2026-01-01');
    }
  });

  it('accepts both dueBefore and dueAfter together', () => {
    const result = ListTasksQuerySchema.safeParse({
      dueAfter: '2026-01-01',
      dueBefore: '2026-12-31',
    });
    expect(result.success).toBe(true);
  });

  it('rejects dueBefore = "tomorrow" with descriptive message', () => {
    const result = ListTasksQuerySchema.safeParse({ dueBefore: 'tomorrow' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0].message;
      expect(msg).toContain('valid ISO date');
    }
  });

  it('rejects dueAfter = "not-a-date"', () => {
    const result = ListTasksQuerySchema.safeParse({ dueAfter: 'not-a-date' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0].message;
      expect(msg).toContain('valid ISO date');
    }
  });

  it('rejects empty string dueBefore', () => {
    const result = ListTasksQuerySchema.safeParse({ dueBefore: '' });
    expect(result.success).toBe(false);
  });

  it('applies defaults when no date fields provided', () => {
    const result = ListTasksQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.sortBy).toBe('createdAt');
      expect(result.data.sortDir).toBe('desc');
    }
  });
});

// ─── 5. ListCostsQuerySchema — date validation ─────────────────────

describe('ListCostsQuerySchema date validation', () => {
  it('accepts valid from and to dates', () => {
    const result = ListCostsQuerySchema.safeParse({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBe('2026-01-01');
      expect(result.data.to).toBe('2026-12-31');
    }
  });

  it('accepts from alone', () => {
    const result = ListCostsQuerySchema.safeParse({ from: '2026-01-01' });
    expect(result.success).toBe(true);
  });

  it('accepts to alone', () => {
    const result = ListCostsQuerySchema.safeParse({ to: '2026-12-31' });
    expect(result.success).toBe(true);
  });

  it('rejects from = "yesterday" with descriptive message', () => {
    const result = ListCostsQuerySchema.safeParse({ from: 'yesterday' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0].message;
      expect(msg).toContain('valid ISO date');
    }
  });

  it('rejects to = "abc"', () => {
    const result = ListCostsQuerySchema.safeParse({ to: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0].message;
      expect(msg).toContain('valid ISO date');
    }
  });

  it('rejects empty string from', () => {
    const result = ListCostsQuerySchema.safeParse({ from: '' });
    expect(result.success).toBe(false);
  });

  it('applies defaults when no fields provided', () => {
    const result = ListCostsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.sortBy).toBe('createdAt');
      expect(result.data.sortDir).toBe('desc');
    }
  });
});
