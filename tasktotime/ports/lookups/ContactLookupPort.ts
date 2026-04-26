/**
 * ContactLookupPort — read-only access to `contacts/{id}`.
 *
 * See spec/04-storage/data-dependencies.md §contacts/{contactId}.
 * `Task.linkedContactIds[]` references contacts; this port resolves them
 * for display (phone numbers, messengers) without N+1 reads.
 */

import type { CompanyId, ContactId, ProjectId } from '../../domain/identifiers';

export interface ContactSnapshot {
  id: ContactId;
  companyId: CompanyId;
  name: string;
  /** e.g. ['electrician', 'plumber']. */
  roles: string[];
  phones: string[];
  emails: string[];
  messengers?: { telegram?: string; whatsapp?: string };
  linkedProjectIds?: ProjectId[];
}

export interface ContactLookupPort {
  findById(id: ContactId): Promise<ContactSnapshot | null>;
  findByIds(ids: ContactId[]): Promise<ContactSnapshot[]>;
  findByProject(projectId: ProjectId): Promise<ContactSnapshot[]>;
}
