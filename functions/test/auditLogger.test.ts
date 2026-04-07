/**
 * Unit tests for auditLogger pure helpers.
 *
 * Only tests functions that don't touch Firestore (AuditHelpers,
 * extractAuditContext). The logAudit / withAuditLog integration with
 * the Firestore emulator is covered separately by the existing
 * functions/test/agentApi/ suite.
 *
 * Purpose: lock down the shape of audit log entries so accidental
 * field rename or removal (which would break compliance / audit
 * trail queries) fails CI instead of silently corrupting data.
 */

import { AuditHelpers, extractAuditContext, type AuditLogEntry } from '../src/agent/utils/auditLogger';

describe('AuditHelpers', () => {
  describe('create', () => {
    it('builds a CREATE entry with the expected shape', () => {
      const entry = AuditHelpers.create(
        'client',
        'client-123',
        { name: 'Jim Dvorkin', type: 'person' },
        'user-abc',
        'openclaw'
      );

      expect(entry.action).toBe('CREATE');
      expect(entry.entityType).toBe('client');
      expect(entry.entityId).toBe('client-123');
      expect(entry.changes).toEqual({
        to: { name: 'Jim Dvorkin', type: 'person' },
      });
      expect(entry.source).toBe('openclaw');
      expect(entry.performedBy).toBe('user-abc');
      // changes.from should NOT be present on CREATE (no previous state)
      expect((entry.changes as Record<string, unknown>).from).toBeUndefined();
    });

    it('supports all source values', () => {
      const sources: AuditLogEntry['source'][] = ['jarvis', 'web', 'bot', 'openclaw', 'system'];
      for (const source of sources) {
        const entry = AuditHelpers.create('project', 'p-1', { name: 'test' }, 'u-1', source);
        expect(entry.source).toBe(source);
      }
    });
  });

  describe('update', () => {
    it('builds an UPDATE entry with both from and to', () => {
      const oldData = { name: 'Jim', status: 'active' };
      const newData = { name: 'James', status: 'active' };
      const entry = AuditHelpers.update(
        'client',
        'client-123',
        oldData,
        newData,
        'user-abc',
        'web'
      );

      expect(entry.action).toBe('UPDATE');
      expect(entry.entityType).toBe('client');
      expect(entry.entityId).toBe('client-123');
      expect(entry.changes).toEqual({ from: oldData, to: newData });
      expect(entry.source).toBe('web');
    });

    it('preserves the full from/to objects without mutation', () => {
      const oldData = { deeply: { nested: { value: 42 } } };
      const newData = { deeply: { nested: { value: 99 } } };
      const entry = AuditHelpers.update('x', 'y', oldData, newData, 'u', 'system');
      expect(entry.changes?.from).toBe(oldData);
      expect(entry.changes?.to).toBe(newData);
    });
  });

  describe('delete', () => {
    it('builds a DELETE entry with from only', () => {
      const entry = AuditHelpers.delete(
        'estimate',
        'est-1',
        { id: 'est-1', total: 100000 },
        'user-xyz',
        'jarvis'
      );

      expect(entry.action).toBe('DELETE');
      expect(entry.entityType).toBe('estimate');
      expect(entry.changes).toEqual({ from: { id: 'est-1', total: 100000 } });
      // to should NOT be present on DELETE
      expect((entry.changes as Record<string, unknown>).to).toBeUndefined();
    });
  });

  describe('customAction', () => {
    it('builds a custom action entry without changes key', () => {
      const entry = AuditHelpers.customAction(
        'APPROVE',
        'estimate',
        'est-1',
        'user-1',
        'web',
        { approvedByClientIp: '1.2.3.4' }
      );

      expect(entry.action).toBe('APPROVE');
      expect(entry.entityType).toBe('estimate');
      expect(entry.entityId).toBe('est-1');
      expect(entry.performedBy).toBe('user-1');
      expect(entry.source).toBe('web');
      expect(entry.metadata).toEqual({ approvedByClientIp: '1.2.3.4' });
      expect((entry as Record<string, unknown>).changes).toBeUndefined();
    });

    it('allows omitting metadata', () => {
      const entry = AuditHelpers.customAction('LOGIN', 'user', 'u-1', 'u-1', 'web');
      expect(entry.action).toBe('LOGIN');
      expect(entry.metadata).toBeUndefined();
    });
  });
});

describe('extractAuditContext', () => {
  it('extracts from authenticated agent request', () => {
    const req = {
      agentUserId: 'agent-user-1',
      agentUserName: 'Agent Jim',
      headers: {
        'user-agent': 'Mozilla/5.0 Test',
        'x-source': 'openclaw',
      },
      ip: '192.168.1.1',
      connection: { remoteAddress: '192.168.1.1' },
    };

    const ctx = extractAuditContext(req);

    expect(ctx.performedBy).toBe('agent-user-1');
    expect(ctx.performedByName).toBe('Agent Jim');
    expect(ctx.source).toBe('openclaw');
    expect(ctx.userAgent).toBe('Mozilla/5.0 Test');
    expect(ctx.ipAddress).toBe('192.168.1.1');
  });

  it('falls back to req.user for web session requests', () => {
    const req = {
      user: {
        uid: 'user-abc',
        displayName: 'Denis',
      },
      headers: {
        'user-agent': 'Chrome',
      },
      ip: '10.0.0.1',
      connection: { remoteAddress: '10.0.0.1' },
    };

    const ctx = extractAuditContext(req);

    expect(ctx.performedBy).toBe('user-abc');
    expect(ctx.performedByName).toBe('Denis');
    expect(ctx.source).toBe('openclaw'); // default when x-source header not set
  });

  it('defaults to anonymous when no auth info present', () => {
    const req = {
      headers: {},
      connection: { remoteAddress: '127.0.0.1' },
    };

    const ctx = extractAuditContext(req);

    expect(ctx.performedBy).toBe('anonymous');
    expect(ctx.performedByName).toBe('Unknown');
    expect(ctx.ipAddress).toBe('127.0.0.1');
  });

  it('respects x-source header when set', () => {
    const req = {
      agentUserId: 'u-1',
      headers: {
        'x-source': 'bot',
      },
      connection: { remoteAddress: '127.0.0.1' },
    };

    const ctx = extractAuditContext(req);
    expect(ctx.source).toBe('bot');
  });

  it('prefers req.ip over connection.remoteAddress', () => {
    const req = {
      headers: {},
      ip: '203.0.113.1',
      connection: { remoteAddress: '10.0.0.1' },
    };

    const ctx = extractAuditContext(req);
    expect(ctx.ipAddress).toBe('203.0.113.1');
  });
});
