/**
 * FirestoreSiteLookup — `sites/{id}` adapter.
 *
 * Implements {@link SiteLookupPort}. Resolves `Task.location.siteId` to
 * address + geo + permit info.
 *
 * See spec/04-storage/adapter-mapping.md §8 SiteLookupPort and
 * spec/04-storage/data-dependencies.md §sites/{siteId}.
 *
 * Indexes used:
 *   - `(clientId, createdAt desc)` — existing in firestore.indexes.json:769-781.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type { SiteLookupPort, SiteSnapshot } from '../../ports/lookups/SiteLookupPort';
import {
  asClientId,
  asCompanyId,
  asSiteId,
  type ClientId,
  type SiteId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger } from './_shared';

const COLLECTION = 'sites';

export class FirestoreSiteLookup implements SiteLookupPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single site by id.
   *
   * Adapter mapping: §8 row 1 — `get sites/{id}`.
   */
  async findById(id: SiteId): Promise<SiteSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreSiteLookup.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'SiteLookup.findById', id });
    }
  }

  /**
   * Sites for a client, newest first.
   *
   * Adapter mapping: §8 row 2 — `where('clientId','==',X).orderBy('createdAt','desc')`.
   * Uses existing composite index `(clientId, createdAt desc)`.
   */
  async findByClient(clientId: ClientId): Promise<SiteSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('clientId', '==', clientId)
        .orderBy('createdAt', 'desc');
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(d.id, data) : null;
        })
        .filter((x): x is SiteSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreSiteLookup.findByClient failed', { clientId, err });
      throw mapFirestoreError(err, { op: 'SiteLookup.findByClient', clientId });
    }
  }
}

// ─── Internal: Firestore data → SiteSnapshot ───────────────────────────

function mapToSnapshot(id: string, data: FirebaseFirestore.DocumentData): SiteSnapshot {
  const result: SiteSnapshot = {
    id: asSiteId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    name: String(data.name ?? ''),
    address: String(data.address ?? ''),
  };

  const geo = data.geo as { lat?: unknown; lng?: unknown } | undefined;
  if (
    geo &&
    typeof geo === 'object' &&
    typeof geo.lat === 'number' &&
    typeof geo.lng === 'number'
  ) {
    result.geo = { lat: geo.lat, lng: geo.lng };
  }
  if (typeof data.clientId === 'string' && data.clientId.length > 0) {
    result.clientId = asClientId(data.clientId);
  }
  if (typeof data.permitNumber === 'string') {
    result.permitNumber = data.permitNumber;
  }
  return result;
}
