/**
 * FirestoreIdGenerator — `IdGeneratorPort` implementation.
 *
 * Two responsibilities (see spec/04-storage/adapter-mapping.md §26):
 *
 *   1. `newTaskId()` — pure, in-memory `crypto.randomUUID()`. No Firestore.
 *   2. `nextTaskNumber(companyId, year)` — atomic CAS counter at
 *      `companies/{companyId}/_meta/taskNumberSequence_{year}`.
 *
 * The CAS pattern follows the existing example in
 * `functions/src/triggers/firestore/clientJourneyTriggers.ts:407-421`:
 * read → mutate → write inside the same `runTransaction` so concurrent
 * task creations cannot collide on the same number.
 *
 * The counter document is auto-initialised on first call:
 *   `{ value: 1 }` if the doc does not exist yet, returning `T-{year}-0001`.
 *
 * Output format:
 *   `T-${year}-${seq.padStart(4, '0')}`  e.g. `T-2026-0042`.
 */

import { randomUUID } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

import type { IdGeneratorPort } from '../../ports/infra/IdGeneratorPort';
import {
  asTaskId,
  type CompanyId,
  type TaskId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger } from './_shared';

const TASK_NUMBER_PAD = 4;
const COMPANIES_COLLECTION = 'companies';
const META_SUBCOLLECTION = '_meta';

export class FirestoreIdGenerator implements IdGeneratorPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * Generate a new opaque task id. Pure / in-memory — does NOT hit
   * Firestore.
   *
   * Adapter mapping (§26 row 1):
   *   `crypto.randomUUID()` cast to `TaskId`.
   */
  newTaskId(): TaskId {
    return asTaskId(randomUUID());
  }

  /**
   * Atomic CAS increment of the per-company / per-year task counter.
   *
   * Adapter mapping (§26 row 2):
   *   path: `companies/{companyId}/_meta/taskNumberSequence_{year}`
   *   `runTransaction`:
   *     - read current `value` (or treat missing as 0)
   *     - write `{ value: current+1, lastIssuedAt: serverTime }`
   *   format result: `T-${year}-${(current+1).padStart(4, '0')}`
   *
   * The transaction guarantees no two concurrent calls return the same
   * sequence number for the same `(companyId, year)` pair.
   */
  async nextTaskNumber(companyId: CompanyId, year: number): Promise<string> {
    try {
      return await this.db.runTransaction(async (tx) => {
        const ref = this.db
          .collection(COMPANIES_COLLECTION)
          .doc(companyId)
          .collection(META_SUBCOLLECTION)
          .doc(`taskNumberSequence_${year}`);
        const snap = await tx.get(ref);

        const current = snap.exists
          ? typeof snap.data()?.value === 'number'
            ? (snap.data()!.value as number)
            : 0
          : 0;
        const next = current + 1;

        tx.set(
          ref,
          {
            value: next,
            lastIssuedAt: Timestamp.now(),
          },
          { merge: true },
        );

        return `T-${year}-${String(next).padStart(TASK_NUMBER_PAD, '0')}`;
      });
    } catch (err) {
      this.logger.error?.('FirestoreIdGenerator.nextTaskNumber failed', {
        companyId,
        year,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'IdGenerator.nextTaskNumber',
        companyId,
        year,
      });
    }
  }
}
