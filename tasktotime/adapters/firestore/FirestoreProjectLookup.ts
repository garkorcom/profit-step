/**
 * FirestoreProjectLookup — `projects/{id}` adapter.
 *
 * Implements {@link ProjectLookupPort} on top of the Firebase Admin SDK.
 * Read-only — tasktotime never writes to `projects/` directly.
 *
 * See spec/04-storage/adapter-mapping.md §4 ProjectLookupPort and
 * spec/04-storage/data-dependencies.md §projects/{projectId}.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type {
  ProjectLookupPort,
  ProjectSnapshot,
} from '../../ports/lookups/ProjectLookupPort';
import {
  asClientId,
  asCompanyId,
  asProjectId,
  type ClientId,
  type CompanyId,
  type ProjectId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger } from './_shared';

const COLLECTION = 'projects';

export class FirestoreProjectLookup implements ProjectLookupPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single project by id.
   *
   * Adapter mapping: §4 row 1 — `get projects/{id}`.
   */
  async findById(id: ProjectId): Promise<ProjectSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreProjectLookup.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'ProjectLookup.findById', id });
    }
  }

  /**
   * Active projects for a given client. Used by Cockpit default-project
   * resolution.
   *
   * Adapter mapping: §4 row 2 — `where('clientId','==',X).where('status','==','active')`.
   */
  async findByClientId(clientId: ClientId): Promise<ProjectSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('clientId', '==', clientId)
        .where('status', '==', 'active');
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(d.id, data) : null;
        })
        .filter((x): x is ProjectSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreProjectLookup.findByClientId failed', {
        clientId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'ProjectLookup.findByClientId',
        clientId,
      });
    }
  }

  /**
   * List active projects for a company. Composite index:
   * `companyId + status` (see indexes.md / adapter-mapping.md §4).
   *
   * Adapter mapping: §4 row 3.
   */
  async listActive(companyId: CompanyId): Promise<ProjectSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('companyId', '==', companyId)
        .where('status', '==', 'active');
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(d.id, data) : null;
        })
        .filter((x): x is ProjectSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreProjectLookup.listActive failed', { companyId, err });
      throw mapFirestoreError(err, { op: 'ProjectLookup.listActive', companyId });
    }
  }
}

// ─── Internal: Firestore data → ProjectSnapshot ────────────────────────

function mapToSnapshot(id: string, data: FirebaseFirestore.DocumentData): ProjectSnapshot {
  const status = (data.status ?? 'active') as ProjectSnapshot['status'];
  const result: ProjectSnapshot = {
    id: asProjectId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    name: String(data.name ?? ''),
    clientId: asClientId(String(data.clientId ?? '')),
    status,
  };
  if (typeof data.clientName === 'string') {
    result.clientName = data.clientName;
  }
  if (typeof data.address === 'string') {
    result.address = data.address;
  }
  return result;
}
