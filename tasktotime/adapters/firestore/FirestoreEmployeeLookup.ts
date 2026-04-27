/**
 * FirestoreEmployeeLookup — legacy `employees/{id}` adapter.
 *
 * Implements {@link EmployeeLookupPort}. The `employees/` collection is the
 * legacy worker-bot namespace; for human workers it coexists with the
 * newer `users/` collection. The application layer chooses which port to
 * call (see resolution algorithm in adapter-mapping.md §6).
 *
 * See spec/04-storage/adapter-mapping.md §6 EmployeeLookupPort and
 * spec/04-storage/data-dependencies.md §employees/{employeeId}.
 *
 * Quirks:
 *   - `id` may be `String(telegramUserId)` for legacy bot users.
 *   - `findByTelegramId` is intentionally NOT company-scoped — see
 *     adapter-mapping.md Convention notes §"CompanyId scope".
 */
import type { Firestore } from 'firebase-admin/firestore';

import type {
  EmployeeLookupPort,
  EmployeeSnapshot,
} from '../../ports/lookups/EmployeeLookupPort';
import { asCompanyId } from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger } from './_shared';

const COLLECTION = 'employees';

export class FirestoreEmployeeLookup implements EmployeeLookupPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Read a single employee by id.
   *
   * Adapter mapping: §6 row 1 — `get employees/{id}`. `id` may be a numeric
   * telegram id stringified (legacy convention).
   */
  async findById(id: string): Promise<EmployeeSnapshot | null> {
    try {
      const ref = this.db.collection(COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data) return null;
      return mapToSnapshot(snap.id, data);
    } catch (err) {
      this.logger.error?.('FirestoreEmployeeLookup.findById failed', { id, err });
      throw mapFirestoreError(err, { op: 'EmployeeLookup.findById', id });
    }
  }

  /**
   * Resolve an employee by Telegram numeric id (string). Fallback path for
   * notify flows after `UserLookupPort.findByTelegramId` returns null.
   *
   * Adapter mapping: §6 row 2 — `where('telegramId','==',X).limit(1)`.
   * Note: NOT company-scoped (legacy compat).
   */
  async findByTelegramId(telegramId: string): Promise<EmployeeSnapshot | null> {
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
      this.logger.error?.('FirestoreEmployeeLookup.findByTelegramId failed', {
        telegramId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'EmployeeLookup.findByTelegramId',
        telegramId,
      });
    }
  }
}

// ─── Internal: Firestore data → EmployeeSnapshot ───────────────────────

function mapToSnapshot(
  id: string,
  data: FirebaseFirestore.DocumentData,
): EmployeeSnapshot {
  const result: EmployeeSnapshot = {
    id,
    companyId: asCompanyId(String(data.companyId ?? '')),
    name: String(data.name ?? ''),
  };
  if (typeof data.hourlyRate === 'number') {
    result.hourlyRate = data.hourlyRate;
  }
  if (data.telegramId !== undefined && data.telegramId !== null) {
    result.telegramId = String(data.telegramId);
  }
  if (typeof data.linkedUserId === 'string') {
    result.linkedUserId = data.linkedUserId;
  }
  return result;
}
