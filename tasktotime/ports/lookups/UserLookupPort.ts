/**
 * UserLookupPort — read-only access to `users/{uid}`.
 *
 * See spec/04-storage/data-dependencies.md §users/{uid}. Resolves
 * `UserRef.id` to a profile (display name, telegramId, hourlyRate).
 *
 * Stale data risk: HIGH — user renames and role changes need
 * reconciliation across all assigned tasks (cron-triggered, application
 * layer concern).
 */

import type { CompanyId, UserId } from '../../domain/identifiers';

export interface UserSnapshot {
  id: UserId;
  companyId: CompanyId;
  displayName: string;
  email?: string;
  role: 'admin' | 'pm' | 'worker' | 'reviewer' | 'observer';
  hourlyRate?: number;
  telegramId?: string;
  status: 'active' | 'inactive' | 'invited';
  hierarchyPath?: string[];
}

export interface UserLookupPort {
  findById(id: UserId): Promise<UserSnapshot | null>;
  findByIds(ids: UserId[]): Promise<UserSnapshot[]>;
  findByTelegramId(telegramId: string): Promise<UserSnapshot | null>;
  listActive(companyId: CompanyId): Promise<UserSnapshot[]>;
}
