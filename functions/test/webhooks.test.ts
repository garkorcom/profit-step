/**
 * Webhooks — schema validation + pattern matching + HMAC signing + scope guard
 */
import { CreateWebhookSchema, UpdateWebhookSchema, WebhookEventPatternSchema } from '../src/agent/schemas';
import { matchesPattern, computeSignature } from '../src/agent/utils/webhookDelivery';
import { hasScope, hasAnyScope } from '../src/agent/utils/scopeGuard';

// ─── Schema Tests ─────────────────────────────────────────────────────

describe('WebhookEventPatternSchema', () => {
  const valid = ['task.created', 'task.*', '*.created', 'cost.approved', 'inventory.low_stock'];
  const invalid = ['task', '*', 'task.', '.created', 'TASK.CREATED', 'task created', 'task.created.extra'];

  valid.forEach(p => {
    it(`accepts valid pattern: ${p}`, () => {
      expect(WebhookEventPatternSchema.safeParse(p).success).toBe(true);
    });
  });

  invalid.forEach(p => {
    it(`rejects invalid pattern: "${p}"`, () => {
      expect(WebhookEventPatternSchema.safeParse(p).success).toBe(false);
    });
  });
});

describe('CreateWebhookSchema', () => {
  it('accepts valid webhook with URL and events', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com/webhook',
      events: ['task.created', 'cost.*'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://example.com/webhook');
      expect(result.data.events).toHaveLength(2);
      expect(result.data.active).toBe(true); // default
    }
  });

  it('accepts inactive webhook', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://hook.example.com',
      events: ['task.*'],
      active: false,
      description: 'Test hook',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(false);
      expect(result.data.description).toBe('Test hook');
    }
  });

  it('rejects empty events array', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com',
      events: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL', () => {
    const result = CreateWebhookSchema.safeParse({
      url: 'not-a-url',
      events: ['task.*'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 50 events', () => {
    const events = Array.from({ length: 51 }, (_, i) => `task.event_${i}`);
    const result = CreateWebhookSchema.safeParse({
      url: 'https://example.com',
      events,
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateWebhookSchema', () => {
  it('accepts partial updates', () => {
    expect(UpdateWebhookSchema.safeParse({ active: false }).success).toBe(true);
    expect(UpdateWebhookSchema.safeParse({ url: 'https://new.url' }).success).toBe(true);
    expect(UpdateWebhookSchema.safeParse({}).success).toBe(true);
  });
});

// ─── Pattern Matching ─────────────────────────────────────────────────

describe('matchesPattern', () => {
  it('exact match: task.created matches task.created', () => {
    expect(matchesPattern('task.created', 'task.created')).toBe(true);
  });

  it('wildcard action: task.* matches task.created', () => {
    expect(matchesPattern('task.created', 'task.*')).toBe(true);
  });

  it('wildcard action: task.* matches task.deleted', () => {
    expect(matchesPattern('task.deleted', 'task.*')).toBe(true);
  });

  it('wildcard domain: *.created matches task.created', () => {
    expect(matchesPattern('task.created', '*.created')).toBe(true);
  });

  it('wildcard domain: *.created matches cost.created', () => {
    expect(matchesPattern('cost.created', '*.created')).toBe(true);
  });

  it('double wildcard: *.* matches anything', () => {
    expect(matchesPattern('task.created', '*.*')).toBe(true);
    expect(matchesPattern('inventory.low_stock', '*.*')).toBe(true);
  });

  it('no match: cost.* does not match task.created', () => {
    expect(matchesPattern('task.created', 'cost.*')).toBe(false);
  });

  it('no match: task.deleted does not match task.created', () => {
    expect(matchesPattern('task.created', 'task.deleted')).toBe(false);
  });

  it('handles malformed patterns gracefully', () => {
    expect(matchesPattern('task.created', 'task')).toBe(false);
    expect(matchesPattern('task', 'task.created')).toBe(false);
    expect(matchesPattern('', '')).toBe(false);
  });
});

// ─── HMAC Signing ─────────────────────────────────────────────────────

describe('computeSignature', () => {
  it('produces consistent HMAC for same payload and secret', () => {
    const sig1 = computeSignature('{"type":"task.created"}', 'secret123');
    const sig2 = computeSignature('{"type":"task.created"}', 'secret123');
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different payloads', () => {
    const sig1 = computeSignature('payload1', 'secret');
    const sig2 = computeSignature('payload2', 'secret');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different secrets', () => {
    const sig1 = computeSignature('payload', 'secret1');
    const sig2 = computeSignature('payload', 'secret2');
    expect(sig1).not.toBe(sig2);
  });

  it('returns 64 hex characters (SHA-256)', () => {
    const sig = computeSignature('test', 'key');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Scope Guard ──────────────────────────────────────────────────────

describe('hasScope', () => {
  it('returns true when scope is present', () => {
    expect(hasScope(['tasks:read', 'costs:read'], 'tasks:read')).toBe(true);
  });

  it('returns false when scope is absent', () => {
    expect(hasScope(['tasks:read'], 'finance:read')).toBe(false);
  });

  it('admin scope grants access to anything', () => {
    expect(hasScope(['admin'], 'finance:read')).toBe(true);
    expect(hasScope(['admin'], 'webhooks:manage')).toBe(true);
    expect(hasScope(['admin'], 'anything:here')).toBe(true);
  });

  it('returns false for undefined/empty scopes', () => {
    expect(hasScope(undefined, 'tasks:read')).toBe(false);
    expect(hasScope([], 'tasks:read')).toBe(false);
  });
});

describe('hasAnyScope', () => {
  it('returns true when any of the required scopes match', () => {
    expect(hasAnyScope(['costs:read', 'time:read'], ['finance:read', 'costs:read'])).toBe(true);
  });

  it('returns false when none match', () => {
    expect(hasAnyScope(['tasks:read'], ['finance:read', 'webhooks:manage'])).toBe(false);
  });

  it('admin passes any check', () => {
    expect(hasAnyScope(['admin'], ['finance:read', 'webhooks:manage'])).toBe(true);
  });
});

// ─── scopesForRole regression ─────────────────────────────────────────

import { scopesForRole } from '../src/agent/agentMiddleware';

describe('scopesForRole — Phase 4 updates', () => {
  it('manager has users:manage scope', () => {
    expect(scopesForRole('manager')).toContain('users:manage');
  });

  it('manager has webhooks:manage scope', () => {
    expect(scopesForRole('manager')).toContain('webhooks:manage');
  });

  it('manager has finance:write scope', () => {
    expect(scopesForRole('manager')).toContain('finance:write');
  });

  it('foreman has team:write scope', () => {
    expect(scopesForRole('foreman')).toContain('team:write');
  });

  it('worker still has basic scopes', () => {
    const scopes = scopesForRole('worker');
    expect(scopes).toContain('tasks:read');
    expect(scopes).toContain('tasks:write');
    expect(scopes).toContain('time:read');
    expect(scopes).not.toContain('finance:read');
    expect(scopes).not.toContain('users:manage');
  });

  it('accountant has payroll but not users:manage', () => {
    const scopes = scopesForRole('accountant');
    expect(scopes).toContain('payroll:read');
    expect(scopes).toContain('payroll:write');
    expect(scopes).not.toContain('users:manage');
    expect(scopes).not.toContain('webhooks:manage');
  });

  it('admin has wildcard', () => {
    expect(scopesForRole('admin')).toEqual(['admin']);
  });

  it('unknown role falls back to worker', () => {
    expect(scopesForRole('ghost')).toEqual(scopesForRole('worker'));
  });
});
