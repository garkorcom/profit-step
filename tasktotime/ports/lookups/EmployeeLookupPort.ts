/**
 * EmployeeLookupPort — legacy `employees/{id}` namespace bridge.
 *
 * See spec/04-storage/data-dependencies.md §employees/{employeeId}.
 *
 * Two namespaces exist for the same human worker (legacy worker bot vs new
 * users collection). This port lets the application resolve UserRef.id
 * regardless of namespace; UserRef MAY be a String(telegramId) for legacy
 * bot users.
 *
 * STALE risk: VERY HIGH — eventual cleanup is to merge namespaces.
 */

import type { CompanyId } from '../../domain/identifiers';

export interface EmployeeSnapshot {
  /** Legacy id (string). May be telegram numeric id. */
  id: string;
  companyId: CompanyId;
  name: string;
  hourlyRate?: number;
  telegramId?: string;
  /** Bridge to users/{uid} if migrated. */
  linkedUserId?: string;
}

export interface EmployeeLookupPort {
  findById(id: string): Promise<EmployeeSnapshot | null>;
  findByTelegramId(telegramId: string): Promise<EmployeeSnapshot | null>;
}
