/**
 * FirestoreUserLookup — `users/{uid}` adapter.
 *
 * Implements {@link UserLookupPort} on top of the Firebase Admin SDK. Used
 * to resolve `UserRef.id` → display name, telegramId, hourlyRate, role.
 *
 * See spec/04-storage/adapter-mapping.md §5 UserLookupPort and
 * spec/04-storage/data-dependencies.md §users/{uid}.
 *
 * Note: this adapter handles ONLY `users/{uid}`. The legacy `employees/{id}`
 * fallback lives in {@link FirestoreEmployeeLookup}; the application layer
 * orchestrates the 4-step resolution described in adapter-mapping.md §6.
 */
import type { Firestore } from 'firebase-admin/firestore';

import type { UserLookupPort, UserSnapshot } from '../../ports/lookups/UserLookupPort';
import {
  asCompanyId,
  asUserId,
  type CompanyId,
  type UserId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, getAllChunked, noopLogger } from './_shared';

const COLLECTION = 'users';

export class FirestoreUserLookup implements UserLookupPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single user by uid.
   *
   * Adapter mapping: §5 row 1 — `get users/{id}`.
   */
  async findById(id: UserId): Promise<UserSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreUserLookup.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'UserLookup.findById', id });
    }
  }

  /**
   * Multi-doc read using `getAll`. Chunked at the 30-id Firestore limit.
   *
   * Adapter mapping: §5 row 2.
   */
  async findByIds(ids: UserId[]): Promise<UserSnapshot[]> {
    if (ids.length === 0) return [];
    try {
      return await getAllChunked(this.db, COLLECTION, ids, (data, id) =>
        mapToSnapshot(id, data),
      );
    } catch (err) {
      this.logger.error?.('FirestoreUserLookup.findByIds failed', {
        count: ids.length,
        err,
      });
      throw mapFirestoreError(err, { op: 'UserLookup.findByIds', count: ids.length });
    }
  }

  /**
   * Resolve a user by Telegram numeric id. Used by notify flows
   * (`workerMessaging`, `deadlineReminders`).
   *
   * Adapter mapping: §5 row 3 — `where('telegramId','==',X).limit(1)`.
   * Single-field index auto-maintained by Firestore.
   */
  async findByTelegramId(telegramId: string): Promise<UserSnapshot | null> {
    try {
      const snap = await this.db
        .collection(COLLECTION)
        .where('telegramId', '==', telegramId)
        .limit(1)
        .get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      if (!doc) return null;
      const data = doc.data();
      if (!data) return null;
      return mapToSnapshot(doc.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreUserLookup.findByTelegramId failed', {
        telegramId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'UserLookup.findByTelegramId',
        telegramId,
      });
    }
  }

  /**
   * Active users for a company. Reuses existing
   * `(companyId, status, createdAt desc)` index (firestore.indexes.json:178-194).
   *
   * Adapter mapping: §5 row 4.
   */
  async listActive(companyId: CompanyId): Promise<UserSnapshot[]> {
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
        .filter((x): x is UserSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreUserLookup.listActive failed', { companyId, err });
      throw mapFirestoreError(err, { op: 'UserLookup.listActive', companyId });
    }
  }
}

// ─── Internal: Firestore data → UserSnapshot ───────────────────────────

function mapToSnapshot(id: string, data: FirebaseFirestore.DocumentData): UserSnapshot {
  const role = (data.role ?? 'worker') as UserSnapshot['role'];
  const status = (data.status ?? 'active') as UserSnapshot['status'];
  const result: UserSnapshot = {
    id: asUserId(id),
    companyId: asCompanyId(String(data.companyId ?? '')),
    displayName: String(data.displayName ?? data.name ?? ''),
    role,
    status,
  };
  if (typeof data.email === 'string') {
    result.email = data.email;
  }
  if (typeof data.hourlyRate === 'number') {
    result.hourlyRate = data.hourlyRate;
  }
  if (data.telegramId !== undefined && data.telegramId !== null) {
    result.telegramId = String(data.telegramId);
  }
  if (Array.isArray(data.hierarchyPath)) {
    result.hierarchyPath = data.hierarchyPath.map((x: unknown) => String(x));
  }
  return result;
}
