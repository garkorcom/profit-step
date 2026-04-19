/**
 * UC5 — Anomaly Watcher.
 *
 * Scheduled function (daily 06:00) scans posted issue documents from the
 * past 24h that reference a task (relatedTaskId). For each, compares
 * planned cost (from the task's norm) vs. actual cost (sum of
 * `deltaQty × unitCostAtPosting` from the issue's ledger entries). If
 * overrun exceeds BOTH a % and $ threshold, publishes
 * `warehouse.anomaly.detected`.
 *
 * Pure function first — tests exercise it without Firestore. The
 * `scheduled.ts` wrapper pulls context from Firestore and invokes this.
 *
 * Reference: docs/warehouse/improvements/07_auto_writeoff/SPEC.md +
 *            docs/warehouse/MAIN_SPEC.md §UC5.
 */

import type { WhDocument, WhLedgerEntry, WhNorm } from '../core/types';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface PostedIssueSummary {
  document: WhDocument;
  ledgerEntries: WhLedgerEntry[];
  /** Task context loaded by caller. */
  task: { id: string; templateType: string; qty: number; projectId?: string };
  /** Norm associated with task.templateType (null → skip, no baseline). */
  norm: WhNorm | null;
  /** Catalog average costs for lines we'll price-in. */
  averageCostByItemId: Map<string, number>;
}

export interface AnomalyReport {
  taskId: string;
  documentId: string;
  projectId?: string;
  plannedCost: number;
  actualCost: number;
  varianceUsd: number;
  overrunPercent: number;
  isAnomaly: boolean;
  byItem: Array<{
    itemId: string;
    plannedQty: number;
    actualQty: number;
    plannedCost: number;
    actualCost: number;
  }>;
}

export interface DetectAnomaliesOptions {
  overrunPercentThreshold?: number; // default 25
  overrunValueThreshold?: number;   // default 50 USD
}

// ═══════════════════════════════════════════════════════════════════
//  Pure detection
// ═══════════════════════════════════════════════════════════════════

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

/**
 * Compute an AnomalyReport for a single posted-issue summary.
 */
export function analyzeSingleTaskUsage(
  summary: PostedIssueSummary,
  options: DetectAnomaliesOptions = {},
): AnomalyReport {
  const pctThresh = options.overrunPercentThreshold ?? 25;
  const valThresh = options.overrunValueThreshold ?? 50;

  // Planned: norm items × task qty × averageCost (best-effort)
  const plannedByItem = new Map<string, { qty: number; cost: number }>();
  let plannedCost = 0;
  if (summary.norm) {
    for (const ni of summary.norm.items) {
      const qty = ni.qtyPerUnit * summary.task.qty;
      const unitCost = summary.averageCostByItemId.get(ni.itemId) ?? 0;
      const cost = qty * unitCost;
      plannedByItem.set(ni.itemId, { qty, cost });
      plannedCost += cost;
    }
  }

  // Actual: sum ledger entries by item (outbound only — deltaQty < 0)
  const actualByItem = new Map<string, { qty: number; cost: number }>();
  let actualCost = 0;
  for (const entry of summary.ledgerEntries) {
    if (entry.documentId !== summary.document.id) continue;
    if (entry.deltaQty >= 0) continue; // only outbound is consumption
    const qty = Math.abs(entry.deltaQty);
    const cost = qty * (entry.unitCostAtPosting ?? 0);
    const prev = actualByItem.get(entry.itemId) ?? { qty: 0, cost: 0 };
    actualByItem.set(entry.itemId, { qty: prev.qty + qty, cost: prev.cost + cost });
    actualCost += cost;
  }

  const varianceUsd = roundTo(actualCost - plannedCost, 2);
  const overrunPercent = plannedCost > 0 ? roundTo((varianceUsd / plannedCost) * 100, 2) : 0;
  const isAnomaly = plannedCost > 0 && overrunPercent > pctThresh && varianceUsd > valThresh;

  const allItemIds = new Set<string>([...plannedByItem.keys(), ...actualByItem.keys()]);
  const byItem = Array.from(allItemIds).map((itemId) => {
    const planned = plannedByItem.get(itemId) ?? { qty: 0, cost: 0 };
    const actual = actualByItem.get(itemId) ?? { qty: 0, cost: 0 };
    return {
      itemId,
      plannedQty: planned.qty,
      actualQty: actual.qty,
      plannedCost: roundTo(planned.cost, 2),
      actualCost: roundTo(actual.cost, 2),
    };
  });

  return {
    taskId: summary.task.id,
    documentId: summary.document.id,
    projectId: summary.task.projectId,
    plannedCost: roundTo(plannedCost, 2),
    actualCost: roundTo(actualCost, 2),
    varianceUsd,
    overrunPercent,
    isAnomaly,
    byItem,
  };
}

/**
 * Batch analysis — caller passes N posted-issue summaries, we return all
 * anomaly candidates + a separate list of clean/below-threshold.
 */
export function detectAnomaliesBatch(
  summaries: PostedIssueSummary[],
  options: DetectAnomaliesOptions = {},
): { anomalies: AnomalyReport[]; clean: AnomalyReport[] } {
  const anomalies: AnomalyReport[] = [];
  const clean: AnomalyReport[] = [];
  for (const s of summaries) {
    const report = analyzeSingleTaskUsage(s, options);
    (report.isAnomaly ? anomalies : clean).push(report);
  }
  return { anomalies, clean };
}
