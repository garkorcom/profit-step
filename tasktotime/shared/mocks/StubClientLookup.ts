/**
 * StubClientLookup — returns canned client snapshots.
 */

import type { CompanyId, ClientId } from '../../domain/identifiers';
import type {
  ClientLookupPort,
  ClientSnapshot,
} from '../../ports/lookups/ClientLookupPort';

export class StubClientLookup implements ClientLookupPort {
  private clients = new Map<ClientId, ClientSnapshot>();

  seed(clients: ClientSnapshot[]): void {
    for (const c of clients) this.clients.set(c.id, c);
  }
  clear(): void {
    this.clients.clear();
  }

  async findById(id: ClientId): Promise<ClientSnapshot | null> {
    return this.clients.get(id) ?? null;
  }
  async findByIds(ids: ClientId[]): Promise<ClientSnapshot[]> {
    const result: ClientSnapshot[] = [];
    for (const id of ids) {
      const c = this.clients.get(id);
      if (c) result.push(c);
    }
    return result;
  }
  async listActive(companyId: CompanyId): Promise<ClientSnapshot[]> {
    return [...this.clients.values()].filter(
      (c) => c.companyId === companyId && c.status === 'active',
    );
  }
}
