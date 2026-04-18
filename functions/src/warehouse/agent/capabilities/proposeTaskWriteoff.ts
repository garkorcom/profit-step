/**
 * UC3 — Auto-writeoff proposal on task start.
 *
 * When a worker starts a task ("Install 3 outlets at Dvorkin"), this
 * capability looks up the norm, computes required materials, checks the
 * worker's van stock, and returns a proposal. The UI presents it as
 * "Списать по норме? [✅]" — on confirm the caller creates a draft issue
 * via POST /api/warehouse/documents.
 *
 * Reference: docs/warehouse/improvements/07_auto_writeoff/SPEC.md.
 */

import type { WhBalance, WhItem, WhNorm } from '../../core/types';

// ═══════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════

export interface ProposeTaskWriteoffInput {
  taskId: string;
  templateType: string; // matches WhNorm.taskType
  taskQty: number; // how many of that template (e.g. 3 outlets)
  workerId: string;
  locationId: string; // worker's van
  projectId?: string;
  phaseCode?: string;

  /** Injected data — loaded by caller from Firestore. */
  norms: WhNorm[]; // filtered or full list; we find by taskType
  items: Map<string, WhItem>;
  balances: Map<string, WhBalance>; // key = locationId__itemId
}

export interface ProposedWriteoffLine {
  itemId: string;
  itemName: string;
  baseUOM: string;
  qtyRequired: number;
  qtyAvailable: number;
  qtyToWriteOff: number;
  qtyShortfall: number;
  estimatedCost: number; // qtyToWriteOff × item.averageCost
  /** When qtyShortfall > 0, the caller may trigger an auto-transfer proposal. */
  hasShortfall: boolean;
}

export interface ProposeTaskWriteoffOk {
  ok: true;
  taskId: string;
  normId: string;
  lines: ProposedWriteoffLine[];
  totalEstimatedCost: number;
  hasAnyShortfall: boolean;
  draftPayload: {
    docType: 'issue';
    sourceLocationId: string;
    reason: 'project_installation' | 'internal_shop_use';
    projectId?: string;
    phaseCode?: string;
    costCategory: 'materials';
    relatedTaskId: string;
    lines: Array<{ itemId: string; uom: string; qty: number }>;
    source: 'ai';
  };
}

export type ProposeTaskWriteoffResult =
  | ProposeTaskWriteoffOk
  | { ok: false; reason: 'no_norm' | 'empty_norm' | 'invalid_input' };

// ═══════════════════════════════════════════════════════════════════
//  Implementation
// ═══════════════════════════════════════════════════════════════════

/**
 * Pure function: given loaded norms/items/balances, compute writeoff proposal.
 * Does not touch Firestore. Caller is responsible for loading the inputs and
 * (on confirm) creating the draft document.
 */
export function proposeTaskWriteoff(input: ProposeTaskWriteoffInput): ProposeTaskWriteoffResult {
  if (!input.templateType || input.taskQty <= 0) {
    return { ok: false, reason: 'invalid_input' };
  }

  const norm = input.norms.find((n) => n.taskType === input.templateType && (n.isActive ?? true));
  if (!norm) return { ok: false, reason: 'no_norm' };
  if (!norm.items || norm.items.length === 0) return { ok: false, reason: 'empty_norm' };

  const lines: ProposedWriteoffLine[] = [];
  let totalEstimatedCost = 0;
  let hasAnyShortfall = false;

  for (const normItem of norm.items) {
    const item = input.items.get(normItem.itemId);
    if (!item) {
      // Skip silently but caller can detect via shortfall=qtyRequired
      lines.push({
        itemId: normItem.itemId,
        itemName: `(missing catalog item ${normItem.itemId})`,
        baseUOM: 'unknown',
        qtyRequired: normItem.qtyPerUnit * input.taskQty,
        qtyAvailable: 0,
        qtyToWriteOff: 0,
        qtyShortfall: normItem.qtyPerUnit * input.taskQty,
        estimatedCost: 0,
        hasShortfall: true,
      });
      hasAnyShortfall = true;
      continue;
    }
    if (!item.isActive) continue;

    const qtyRequired = normItem.qtyPerUnit * input.taskQty;
    const balanceKey = `${input.locationId}__${normItem.itemId}`;
    const balance = input.balances.get(balanceKey);
    const qtyAvailable = balance?.onHandQty ?? 0;

    const qtyToWriteOff = Math.min(qtyRequired, Math.max(0, qtyAvailable));
    const qtyShortfall = Math.max(0, qtyRequired - qtyAvailable);
    const unitCost = item.averageCost ?? item.lastPurchasePrice ?? 0;
    const estimatedCost = roundTo(qtyToWriteOff * unitCost, 2);

    totalEstimatedCost += estimatedCost;
    if (qtyShortfall > 0) hasAnyShortfall = true;

    lines.push({
      itemId: item.id,
      itemName: item.name,
      baseUOM: item.baseUOM,
      qtyRequired,
      qtyAvailable,
      qtyToWriteOff,
      qtyShortfall,
      estimatedCost,
      hasShortfall: qtyShortfall > 0,
    });
  }

  const reason: 'project_installation' | 'internal_shop_use' = input.projectId
    ? 'project_installation'
    : 'internal_shop_use';

  return {
    ok: true,
    taskId: input.taskId,
    normId: norm.id,
    lines,
    totalEstimatedCost: roundTo(totalEstimatedCost, 2),
    hasAnyShortfall,
    draftPayload: {
      docType: 'issue',
      sourceLocationId: input.locationId,
      reason,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.phaseCode ? { phaseCode: input.phaseCode as any } : {}),
      costCategory: 'materials',
      relatedTaskId: input.taskId,
      lines: lines
        .filter((l) => l.qtyToWriteOff > 0)
        .map((l) => ({ itemId: l.itemId, uom: l.baseUOM, qty: l.qtyToWriteOff })),
      source: 'ai',
    },
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ═══════════════════════════════════════════════════════════════════
//  Overrun detection (for task-complete reconciliation)
// ═══════════════════════════════════════════════════════════════════

export interface TaskOverrunInput {
  plannedCost: number;
  actualCost: number;
  overrunPercentThreshold?: number; // default 25
  overrunValueThreshold?: number; // default 50 (USD)
}

export interface TaskOverrunResult {
  isAnomaly: boolean;
  plannedCost: number;
  actualCost: number;
  varianceUsd: number;
  overrunPercent: number;
}

/**
 * Detect whether a task overran by enough (both %) and $) to warrant
 * an admin-level alert.
 */
export function detectTaskOverrun(input: TaskOverrunInput): TaskOverrunResult {
  const pctThresh = input.overrunPercentThreshold ?? 25;
  const valThresh = input.overrunValueThreshold ?? 50;

  const varianceUsd = roundTo(input.actualCost - input.plannedCost, 2);
  const overrunPercent =
    input.plannedCost > 0 ? roundTo((varianceUsd / input.plannedCost) * 100, 2) : 0;
  const isAnomaly = overrunPercent > pctThresh && varianceUsd > valThresh;

  return {
    isAnomaly,
    plannedCost: input.plannedCost,
    actualCost: input.actualCost,
    varianceUsd,
    overrunPercent,
  };
}
