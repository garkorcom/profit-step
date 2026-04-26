/**
 * SiteLookupPort — read-only access to `sites/{id}`.
 *
 * See spec/04-storage/data-dependencies.md §sites/{siteId}. Resolves
 * `Task.location.siteId` to address + geo + permit info.
 */

import type { CompanyId, SiteId, ClientId } from '../../domain/identifiers';

export interface SiteSnapshot {
  id: SiteId;
  companyId: CompanyId;
  name: string;
  address: string;
  geo?: { lat: number; lng: number };
  clientId?: ClientId;
  permitNumber?: string;
}

export interface SiteLookupPort {
  findById(id: SiteId): Promise<SiteSnapshot | null>;
  findByClient(clientId: ClientId): Promise<SiteSnapshot[]>;
}
