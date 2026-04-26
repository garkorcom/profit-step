/**
 * ProjectLookupPort — read-only access to `projects/{id}`.
 *
 * See spec/04-storage/data-dependencies.md §projects/{projectId}.
 * Used for default-project resolution per client (Cockpit) and
 * Task.projectName denormalization.
 */

import type { CompanyId, ProjectId, ClientId } from '../../domain/identifiers';

export interface ProjectSnapshot {
  id: ProjectId;
  companyId: CompanyId;
  name: string;
  clientId: ClientId;
  clientName?: string;
  address?: string;
  status: 'active' | 'on_hold' | 'completed' | 'cancelled';
}

export interface ProjectLookupPort {
  findById(id: ProjectId): Promise<ProjectSnapshot | null>;
  findByClientId(clientId: ClientId): Promise<ProjectSnapshot[]>;
  listActive(companyId: CompanyId): Promise<ProjectSnapshot[]>;
}
