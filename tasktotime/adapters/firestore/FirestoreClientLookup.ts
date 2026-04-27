/**
 * FirestoreClientLookup — `clients/{id}` adapter.
 *
 * Implements {@link ClientLookupPort} on top of the Firebase Admin Firestore
 * SDK. Read-only — tasktotime never writes to `clients/`.
 *
 * See spec/04-storage/adapter-mapping.md §3 ClientLookupPort and
 * spec/04-storage/data-dependencies.md §clients/{clientId}.
 *
 * Conventions:
 *   - `findById` returns `null` for not-found (per port contract).
 *   - Timestamps converted at the boundary via `toEpochMs`.
 *   - `findByIds` uses `getAll` chunked at Firestore's 30-id limit.
 *   - All multi-doc queries scoped by `companyId` for RLS — see Convention
 *     notes §"CompanyId scope".
 */
import type { Firestore } from 'firebase-admin/firestore';

import type { ClientLookupPort, ClientSnapshot } from '../../ports/lookups/ClientLookupPort';
import {
  asClientId,
  asCompanyId,
  type ClientId,
  type CompanyId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, getAllChunked, noopLogger } from './_shared';

const COLLECTION = 'clients';

export class FirestoreClientLookup implements ClientLookupPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single client by id.
   *
   * Adapter mapping: `get clients/{id}` (see §3 row 1).
   * Returns `null` if document does not exist.
   */
  async findById(id: ClientId): Promise<ClientSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreClientLookup.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'ClientLookup.findById', id });
    }
  }

  /**
   * Multi-doc read using `getAll`. Chunked at the 30-id Firestore limit
   * via {@link getAllChunked}.
   *
   * Adapter mapping: §3 row 2.
   */
  async findByIds(ids: ClientId[]): Promise<ClientSnapshot[]> {
    if (ids.length === 0) return [];
    try {
      return await getAllChunked(this.db, COLLECTION, ids, (data, id) =>
        mapToSnapshot(id, data),
      );
    } catch (err) {
      this.logger.error?.('FirestoreClientLookup.findByIds failed', {
        count: ids.length,
        err,
      });
      throw mapFirestoreError(err, { op: 'ClientLookup.findByIds', count: ids.length });
    }
  }

  /**
   * List active clients for a company, sorted by name.
   *
   * Adapter mapping: §3 row 3 — `where('companyId','==',X).where('status','==','active').orderBy('name')`.
   * Used by dropdown selectors. Composite index: `companyId + status + name`.
   */
  async listActive(companyId: CompanyId): Promise<ClientSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('companyId', '==', companyId)
        .where('status', '==', 'active')
        .orderBy('name');
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(d.id, data) : null;
        })
        .filter((x): x is ClientSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreClientLookup.listActive failed', { companyId, err });
      throw mapFirestoreError(err, { op: 'ClientLookup.listActive', companyId });
    }
  }
}

// ─── Internal: Firestore data → ClientSnapshot ─────────────────────────

function mapToSnapshot(id: string, data: FirebaseFirestore.DocumentData): ClientSnapshot {
  const status = (data.status ?? 'active') as ClientSnapshot['status'];
  const result: ClientSnapshot = {
    id: asClientId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    name: String(data.name ?? ''),
    status,
  };
  if (typeof data.defaultProjectId === 'string') {
    result.defaultProjectId = data.defaultProjectId;
  }
  if (typeof data.address === 'string') {
    result.address = data.address;
  }
  return result;
}
