/**
 * FirestoreEstimate — `estimates/{id}` adapter.
 *
 * Implements {@link EstimatePort}. Used during estimate-decompose flow
 * (Phase 2) and AI scope analysis (`loadContextSnapshot`).
 *
 * See spec/04-storage/adapter-mapping.md §9 EstimatePort and
 * spec/04-storage/data-dependencies.md §estimates/{estimateId}.
 *
 * Items are stored inline in `estimate.items[]` — no subcollection.
 *
 * Indexes used:
 *   - `(projectId, status, createdAt desc)` — existing in
 *     firestore.indexes.json:677-693.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type {
  EstimateItemSnapshot,
  EstimatePort,
  EstimateSnapshot,
} from '../../ports/lookups/EstimatePort';
import {
  asCompanyId,
  asEstimateId,
  asEstimateItemId,
  asProjectId,
  type EstimateId,
  type EstimateItemId,
  type ProjectId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger, toEpochMs } from './_shared';

const COLLECTION = 'estimates';

export class FirestoreEstimate implements EstimatePort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single estimate by id, including its inline `items[]`.
   *
   * Adapter mapping: §9 row 1 — `get estimates/{id}`.
   */
  async findById(id: EstimateId): Promise<EstimateSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreEstimate.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'Estimate.findById', id });
    }
  }

  /**
   * Resolve a single estimate item via inline filter on `items[]`.
   *
   * Adapter mapping: §9 row 2 — `get estimates/{id}` then in-memory
   * `items.find(i => i.id === itemId)`. Items are not a subcollection.
   */
  async findItem(
    estimateId: EstimateId,
    itemId: EstimateItemId,
  ): Promise<EstimateItemSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(estimateId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      const items = Array.isArray(data.items) ? data.items : [];
      const found = items.find(
        (raw: unknown) =>
          raw !== null &&
          typeof raw === 'object' &&
          (raw as { id?: unknown }).id === itemId,
      );
      if (!found) return null;
      return mapItem(found as Record<string, unknown>);
    } catch (err) {
      this.logger.error?.('FirestoreEstimate.findItem failed', {
        estimateId,
        itemId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'Estimate.findItem',
        estimateId,
        itemId,
      });
    }
  }

  /**
   * Top-2 active estimates for a project (status `sent` or `signed`),
   * newest first.
   *
   * Adapter mapping: §9 row 3 — `where('projectId','==',X).where('status','in',['sent','signed']).orderBy('createdAt','desc').limit(2)`.
   * Uses existing composite index `(projectId, status, createdAt desc)`.
   */
  async findActiveByProject(projectId: ProjectId): Promise<EstimateSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('projectId', '==', projectId)
        .where('status', 'in', ['sent', 'signed'])
        .orderBy('createdAt', 'desc')
        .limit(2);
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(d.id, data) : null;
        })
        .filter((x): x is EstimateSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreEstimate.findActiveByProject failed', {
        projectId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'Estimate.findActiveByProject',
        projectId,
      });
    }
  }
}

// ─── Internal: Firestore data → EstimateSnapshot ───────────────────────

function mapToSnapshot(
  id: string,
  data: FirebaseFirestore.DocumentData,
): EstimateSnapshot {
  const status = (data.status ?? 'draft') as EstimateSnapshot['status'];
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const items: EstimateItemSnapshot[] = itemsRaw
    .map((raw: unknown) =>
      raw !== null && typeof raw === 'object'
        ? mapItem(raw as Record<string, unknown>)
        : null,
    )
    .filter((x): x is EstimateItemSnapshot => x !== null);

  const result: EstimateSnapshot = {
    id: asEstimateId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    projectId: asProjectId(String(data.projectId ?? '')),
    status,
    totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : 0,
    items,
  };

  const signedAt = toEpochMs(data.signedAt);
  if (signedAt !== null) {
    result.signedAt = signedAt;
  }
  return result;
}

function mapItem(raw: Record<string, unknown>): EstimateItemSnapshot {
  const result: EstimateItemSnapshot = {
    id: asEstimateItemId(String(raw.id ?? '')),
    description: String(raw.description ?? ''),
    qty: typeof raw.qty === 'number' ? raw.qty : 0,
    unitPrice: typeof raw.unitPrice === 'number' ? raw.unitPrice : 0,
    totalAmount: typeof raw.totalAmount === 'number' ? raw.totalAmount : 0,
  };
  if (typeof raw.category === 'string') {
    result.category = raw.category;
  }
  return result;
}
