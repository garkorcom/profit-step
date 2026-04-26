/**
 * ClientLookupPort — read-only access to `clients/{id}`.
 *
 * See spec/04-storage/data-dependencies.md §clients/{clientId} for usage:
 *  - One-time read for Cockpit task creation
 *  - Bulk read for client dropdown
 *  - AI scope analysis (loadContextSnapshot)
 *
 * Stale data risk: HIGH — client.name not auto-synced to denormalized
 * `Task.clientName`. Application-layer reconciler addresses this.
 */

import type { CompanyId, ClientId } from '../../domain/identifiers';

export interface ClientSnapshot {
  id: ClientId;
  companyId: CompanyId;
  name: string;
  status: 'active' | 'archived' | 'lead';
  defaultProjectId?: string;
  address?: string;
}

export interface ClientLookupPort {
  findById(id: ClientId): Promise<ClientSnapshot | null>;
  findByIds(ids: ClientId[]): Promise<ClientSnapshot[]>;
  listActive(companyId: CompanyId): Promise<ClientSnapshot[]>;
}
