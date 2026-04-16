/**
 * Teams CRUD — schema validation + role guard tests
 */
import { CreateTeamSchema, UpdateTeamSchema, TeamMemberSchema } from '../src/agent/schemas';

describe('Teams schemas', () => {
  // ─── CreateTeamSchema ──────────────────────────────────────────────
  describe('CreateTeamSchema', () => {
    it('accepts valid team with name and lead', () => {
      const result = CreateTeamSchema.safeParse({
        name: 'Tampa Crew',
        leadUid: 'uid-foreman-1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Tampa Crew');
        expect(result.data.leadUid).toBe('uid-foreman-1');
        expect(result.data.memberUids).toEqual([]); // default
      }
    });

    it('accepts team with explicit memberUids', () => {
      const result = CreateTeamSchema.safeParse({
        name: 'Sarasota Team',
        leadUid: 'uid-lead',
        memberUids: ['uid-worker-1', 'uid-worker-2'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memberUids).toEqual(['uid-worker-1', 'uid-worker-2']);
      }
    });

    it('rejects empty name', () => {
      const result = CreateTeamSchema.safeParse({
        name: '',
        leadUid: 'uid-1',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing leadUid', () => {
      const result = CreateTeamSchema.safeParse({
        name: 'Test Team',
      });
      expect(result.success).toBe(false);
    });

    it('rejects name over 100 chars', () => {
      const result = CreateTeamSchema.safeParse({
        name: 'A'.repeat(101),
        leadUid: 'uid-1',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── UpdateTeamSchema ──────────────────────────────────────────────
  describe('UpdateTeamSchema', () => {
    it('accepts partial update — name only', () => {
      const result = UpdateTeamSchema.safeParse({ name: 'New Name' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('New Name');
        expect(result.data.leadUid).toBeUndefined();
      }
    });

    it('accepts partial update — leadUid only', () => {
      const result = UpdateTeamSchema.safeParse({ leadUid: 'uid-new-lead' });
      expect(result.success).toBe(true);
    });

    it('accepts empty object (no-op update)', () => {
      const result = UpdateTeamSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects empty name string', () => {
      const result = UpdateTeamSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });
  });

  // ─── TeamMemberSchema ──────────────────────────────────────────────
  describe('TeamMemberSchema', () => {
    it('accepts valid uid', () => {
      const result = TeamMemberSchema.safeParse({ uid: 'user-123' });
      expect(result.success).toBe(true);
    });

    it('rejects empty uid', () => {
      const result = TeamMemberSchema.safeParse({ uid: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing uid', () => {
      const result = TeamMemberSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

// ─── Role guard logic ────────────────────────────────────────────────

describe('Team role guards', () => {
  function canManageTeams(role: string): boolean {
    return role === 'admin' || role === 'manager';
  }

  function canManageOwnTeam(role: string): boolean {
    return role === 'foreman';
  }

  const allRoles = ['admin', 'manager', 'foreman', 'worker', 'driver', 'supply', 'accountant'];

  test('admin and manager can manage all teams', () => {
    expect(canManageTeams('admin')).toBe(true);
    expect(canManageTeams('manager')).toBe(true);
  });

  test('other roles cannot manage all teams', () => {
    for (const role of ['foreman', 'worker', 'driver', 'supply', 'accountant']) {
      expect(canManageTeams(role)).toBe(false);
    }
  });

  test('only foreman can manage own team', () => {
    expect(canManageOwnTeam('foreman')).toBe(true);
    for (const role of allRoles.filter(r => r !== 'foreman')) {
      expect(canManageOwnTeam(role)).toBe(false);
    }
  });
});
