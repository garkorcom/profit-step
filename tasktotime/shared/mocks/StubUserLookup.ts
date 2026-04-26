/**
 * StubUserLookup — returns canned user snapshots.
 */

import type { CompanyId, UserId } from '../../domain/identifiers';
import type {
  UserLookupPort,
  UserSnapshot,
} from '../../ports/lookups/UserLookupPort';

export class StubUserLookup implements UserLookupPort {
  private users = new Map<UserId, UserSnapshot>();

  seed(users: UserSnapshot[]): void {
    for (const u of users) this.users.set(u.id, u);
  }
  clear(): void {
    this.users.clear();
  }

  async findById(id: UserId): Promise<UserSnapshot | null> {
    return this.users.get(id) ?? null;
  }
  async findByIds(ids: UserId[]): Promise<UserSnapshot[]> {
    const result: UserSnapshot[] = [];
    for (const id of ids) {
      const u = this.users.get(id);
      if (u) result.push(u);
    }
    return result;
  }
  async findByTelegramId(telegramId: string): Promise<UserSnapshot | null> {
    for (const u of this.users.values()) {
      if (u.telegramId === telegramId) return u;
    }
    return null;
  }
  async listActive(companyId: CompanyId): Promise<UserSnapshot[]> {
    return [...this.users.values()].filter(
      (u) => u.companyId === companyId && u.status === 'active',
    );
  }
}
