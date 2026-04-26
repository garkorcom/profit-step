/**
 * AutoApprovePolicy — decides whether a `complete` transition should
 * automatically chain into `accept` (skipping the manual review step).
 *
 * Pure rule. No I/O. Used by TaskService.transition() before deciding
 * whether to also emit a synthetic `accept` action.
 *
 * Trade-off: in Phase 1 we keep the policy conservative (auto-accept ONLY
 * when explicit flags are set). Future iterations may consider:
 *   - reviewer is the same as assignee
 *   - task value (priceClient) below threshold
 *   - client preference toggle
 */

import type { Task } from '../Task';

export interface AutoApproveDecision {
  approved: boolean;
  reason: string;
}

export interface AutoApproveContext {
  /** Optional flag from company settings — feature gate. */
  featureEnabled?: boolean;
  /** Auto-approve threshold (priceClient.amount). */
  thresholdAmount?: number;
  /** Time-of-day window (24h). */
  todayHourLocal?: number;
}

/**
 * Decide whether to auto-accept after `complete`. Default: NO. Caller may
 * still emit `accept` action manually with full acceptance payload.
 */
export function shouldAutoApprove(
  task: Task,
  ctx: AutoApproveContext = {},
): AutoApproveDecision {
  if (!ctx.featureEnabled) {
    return { approved: false, reason: 'feature_disabled' };
  }
  if (task.lifecycle !== 'completed') {
    return { approved: false, reason: 'not_completed' };
  }
  if (task.acceptance) {
    return { approved: true, reason: 'acceptance_present' };
  }
  if (
    typeof ctx.thresholdAmount === 'number' &&
    task.priceClient.amount <= ctx.thresholdAmount
  ) {
    return { approved: true, reason: 'below_threshold' };
  }
  // Default conservative answer: do not auto-approve
  return { approved: false, reason: 'manual_review_required' };
}
