/**
 * InventoryTxPort — read-only access to `inventory_transactions` filtered
 * by `relatedTaskId`.
 *
 * Used to compute `Task.materialsCostActual` (sum of out-transactions tied
 * to the task). Service-side aggregation; per-row reads happen here.
 *
 * See spec/04-storage/data-dependencies.md §inventory_transactions.
 */

import type { TaskId, CatalogItemId } from '../../domain/identifiers';

export interface InventoryTxSnapshot {
  id: string;
  relatedTaskId?: TaskId;
  catalogItemId: CatalogItemId;
  qty: number;
  totalAmount: number;
  type: 'in' | 'out' | 'transfer' | 'adjust';
  timestamp: number;
}

export interface InventoryTxPort {
  findByTask(taskId: TaskId): Promise<InventoryTxSnapshot[]>;
  /**
   * Returns sum of `out` transactions for the task. Used to compute
   * `Task.materialsCostActual` after `complete` action.
   */
  sumActualCostByTask(taskId: TaskId): Promise<number>;
}
