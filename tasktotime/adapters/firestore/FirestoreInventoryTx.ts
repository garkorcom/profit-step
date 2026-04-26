/**
 * FirestoreInventoryTx — `inventory_transactions/` adapter.
 *
 * Implements {@link InventoryTxPort} on top of Firebase Admin Firestore.
 * Read-only — `tasktotime` does NOT write inventory transactions; that
 * remains the responsibility of the existing inventory module.
 *
 * See spec/04-storage/adapter-mapping.md §12 InventoryTxPort.
 *
 * Indexes:
 *   - `relatedTaskId + timestamp(desc)`            (NEW PR-A)
 *   - `relatedTaskId + type + timestamp(desc)`     (NEW PR-A)
 *
 * Conventions:
 *   - Timestamps converted at the boundary via `toEpochMs`.
 *   - `null`/missing → snapshot field omitted (per `InventoryTxSnapshot` shape).
 */

import type { Firestore } from 'firebase-admin/firestore';

import type {
  InventoryTxPort,
  InventoryTxSnapshot,
} from '../../ports/inventory/InventoryTxPort';
import {
  asCatalogItemId,
  asTaskId,
  type TaskId,
} from '../../domain/identifiers';
import { mapFirestoreError } from '../errors';
import { type AdapterLogger, noopLogger, toEpochMs } from './_shared';

const COLLECTION = 'inventory_transactions';

export class FirestoreInventoryTx implements InventoryTxPort {
  constructor(
    private readonly db: Firestore,
    private readonly logger: AdapterLogger = noopLogger,
  ) {}

  /**
   * List all inventory transactions tied to a task, newest first.
   *
   * Adapter mapping (§12 row 1):
   *   `where relatedTaskId == X .orderBy timestamp desc`.
   * Composite index: `relatedTaskId + timestamp(desc)`.
   */
  async findByTask(taskId: TaskId): Promise<InventoryTxSnapshot[]> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('relatedTaskId', '==', taskId)
        .orderBy('timestamp', 'desc');
      const snap = await q.get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return data ? mapToSnapshot(data, d.id) : null;
        })
        .filter((x): x is InventoryTxSnapshot => x !== null);
    } catch (err) {
      this.logger.error?.('FirestoreInventoryTx.findByTask failed', { taskId, err });
      throw mapFirestoreError(err, { op: 'InventoryTx.findByTask', taskId });
    }
  }

  /**
   * Sum of `out` transaction amounts for a task — used to compute
   * `Task.materialsCostActual` after the `complete` lifecycle action.
   *
   * Adapter mapping (§12 row 2):
   *   `where relatedTaskId == X .where type == 'out'` then `reduce sum`.
   *
   * No Firestore aggregation API — read all + sum in memory. Acceptable
   * for < 1000 tx per task (typical case is a few dozen).
   */
  async sumActualCostByTask(taskId: TaskId): Promise<number> {
    try {
      const q = this.db
        .collection(COLLECTION)
        .where('relatedTaskId', '==', taskId)
        .where('type', '==', 'out');
      const snap = await q.get();
      let total = 0;
      for (const d of snap.docs) {
        const data = d.data();
        if (!data) continue;
        const amt = typeof data.totalAmount === 'number' ? data.totalAmount : 0;
        total += amt;
      }
      return total;
    } catch (err) {
      this.logger.error?.('FirestoreInventoryTx.sumActualCostByTask failed', {
        taskId,
        err,
      });
      throw mapFirestoreError(err, {
        op: 'InventoryTx.sumActualCostByTask',
        taskId,
      });
    }
  }
}

// ─── Internal: Firestore data → InventoryTxSnapshot ────────────────────

function mapToSnapshot(
  data: FirebaseFirestore.DocumentData,
  id: string,
): InventoryTxSnapshot {
  const type = (data.type ?? 'out') as InventoryTxSnapshot['type'];
  const result: InventoryTxSnapshot = {
    id,
    catalogItemId: asCatalogItemId(String(data.catalogItemId ?? '')),
    qty: typeof data.qty === 'number' ? data.qty : 0,
    totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : 0,
    type,
    timestamp: toEpochMs(data.timestamp) ?? 0,
  };
  if (typeof data.relatedTaskId === 'string' && data.relatedTaskId.length > 0) {
    result.relatedTaskId = asTaskId(data.relatedTaskId);
  }
  return result;
}
