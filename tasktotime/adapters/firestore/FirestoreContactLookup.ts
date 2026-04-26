/**
 * FirestoreContactLookup — `contacts/{id}` adapter.
 *
 * Implements {@link ContactLookupPort}. Used to resolve
 * `Task.linkedContactIds[]` for display (phones, messengers) without N+1
 * reads — `findByIds` chunks at the Firestore 30-id limit.
 *
 * See spec/04-storage/adapter-mapping.md §7 ContactLookupPort and
 * spec/04-storage/data-dependencies.md §contacts/{contactId}.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type {
  ContactLookupPort,
  ContactSnapshot,
} from '../../ports/lookups/ContactLookupPort';
import {
  asCompanyId,
  asContactId,
  asProjectId,
  type ContactId,
  type ProjectId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, getAllChunked, noopLogger } from './_shared';

const COLLECTION = 'contacts';

export class FirestoreContactLookup implements ContactLookupPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single contact by id.
   *
   * Adapter mapping: §7 row 1 — `get contacts/{id}`.
   */
  async findById(id: ContactId): Promise<ContactSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreContactLookup.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'ContactLookup.findById', id });
    }
  }

  /**
   * Multi-doc read using `getAll`. Chunked at 30 to mitigate N+1 on
   * `Task.linkedContactIds[]`.
   *
   * Adapter mapping: §7 row 2.
   */
  async findByIds(ids: ContactId[]): Promise<ContactSnapshot[]> {
    if (ids.length === 0) return [];
    try {
      return await getAllChunked(this.db, COLLECTION, ids, (data, id) =>
        mapToSnapshot(id, data),
      );
    } catch (err) {
      this.logger.error?.('FirestoreContactLookup.findByIds failed', {
        count: ids.length,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'ContactLookup.findByIds',
        count: ids.length,
      });
    }
  }

  /**
   * Contacts linked to a project. Field is `linkedProjects[]` (array
   * of project ids); we use `array-contains` for the lookup.
   *
   * Adapter mapping: §7 row 3 — `where('linkedProjects','array-contains',X)`.
   */
  async findByProject(projectId: ProjectId): Promise<ContactSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('linkedProjects', 'array-contains', projectId);
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(d.id, data) : null;
        })
        .filter((x): x is ContactSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreContactLookup.findByProject failed', {
        projectId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'ContactLookup.findByProject',
        projectId,
      });
    }
  }
}

// ─── Internal: Firestore data → ContactSnapshot ────────────────────────

function mapToSnapshot(id: string, data: FirebaseFirestore.DocumentData): ContactSnapshot {
  const roles = Array.isArray(data.roles)
    ? data.roles.map((x: unknown) => String(x))
    : [];
  const phones = Array.isArray(data.phones)
    ? data.phones.map((x: unknown) => String(x))
    : [];
  const emails = Array.isArray(data.emails)
    ? data.emails.map((x: unknown) => String(x))
    : [];

  const result: ContactSnapshot = {
    id: asContactId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    name: String(data.name ?? ''),
    roles,
    phones,
    emails,
  };

  const messengers = data.messengers as
    | { telegram?: unknown; whatsapp?: unknown }
    | undefined;
  if (messengers && typeof messengers === 'object') {
    const m: { telegram?: string; whatsapp?: string } = {};
    if (typeof messengers.telegram === 'string') m.telegram = messengers.telegram;
    if (typeof messengers.whatsapp === 'string') m.whatsapp = messengers.whatsapp;
    if (m.telegram !== undefined || m.whatsapp !== undefined) {
      result.messengers = m;
    }
  }

  if (Array.isArray(data.linkedProjects)) {
    result.linkedProjectIds = data.linkedProjects
      .map((x: unknown) => (typeof x === 'string' ? asProjectId(x) : null))
      .filter((x): x is ProjectId => x !== null);
  }

  return result;
}
