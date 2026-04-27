/**
 * Status drift map — legacy `gtd_tasks.status` → canonical `Task.lifecycle`.
 *
 * Canonical source: `tasktotime/spec/04-storage/migration-mapping.md` lines
 * 96-113 ("Status enum drift mapping"). The mapping table is intentionally
 * declared at module top so spec changes are one-line edits and the diff
 * for any future drift-fix is trivial to review.
 *
 * Multiple legacy writers (standard CRUD, `mediaHandler.ts`, cron, dead-code
 * paths) wrote inconsistent status strings into `gtd_tasks`. The canonical
 * 7-state lifecycle in `tasktotime/domain/lifecycle.ts` is the single source
 * of truth going forward.
 *
 * Rules:
 *   - `legacyStatusToLifecycle` returns `null` for unknown legacy strings —
 *     the proxy router translates that to a 400 Bad Request with a helpful
 *     error so the caller (the AI bot) gets immediate feedback about the
 *     drift, instead of a silent fallback to `'draft'`.
 *   - `lifecycleToLegacyStatus` ALWAYS produces a value the bot's existing
 *     prompt understands. We pick the most-used legacy synonym per
 *     lifecycle (e.g. `'started' → 'in_progress'`, not `'started'`) so that
 *     existing bot regex / string-matching logic keeps working.
 *
 * Do NOT silently extend the table without spec update. The mapping is the
 * contract between the bot prompt and our backend; ambiguity here means
 * silent data drift downstream.
 */

import type { TaskLifecycle } from '../../../../domain/lifecycle';

// ─── Legacy → canonical (for inbound translation) ──────────────────────

/**
 * Inbound mapping table. Keys are case-insensitive on lookup but the table
 * uses the lowercase form of every value seen in production logs.
 *
 * Sources observed in production (spec/04-storage/migration-mapping.md):
 *   - Standard CRUD writers: 'draft', 'pending', 'in_progress', 'completed',
 *                            'accepted', 'cancelled'
 *   - `mediaHandler.ts`:     'todo', 'in_progress', 'done'
 *   - Cron jobs:             'next', 'scheduled'
 *   - Dead code path:        'approved'
 *   - GTD bucket-style       'inbox', 'next_action', 'waiting', 'projects',
 *     (legacy schemas):      'estimate', 'someday' — these are bucket
 *                            tags, not lifecycles. The proxy maps them all
 *                            to `'ready'` since they all denote "this exists
 *                            and is awaiting work" in lifecycle terms.
 *   - Soft-delete:           'archived' — maps to `'cancelled'` because
 *                            `archive` is a bucket, not a lifecycle. The
 *                            proxy then sets `bucket: 'archive'` separately
 *                            (handled by the route layer, not this map).
 */
export const LEGACY_TO_LIFECYCLE: Readonly<Record<string, TaskLifecycle>> = Object.freeze({
  // Standard CRUD
  draft: 'draft',
  pending: 'ready',
  in_progress: 'started',
  inProgress: 'started', // camelCase variant seen in some bot payloads
  completed: 'completed',
  done: 'completed', // mediaHandler synonym
  accepted: 'accepted',
  cancelled: 'cancelled',
  canceled: 'cancelled', // US English variant

  // mediaHandler.ts
  todo: 'ready',

  // Cron jobs
  next: 'ready',
  scheduled: 'ready',

  // Dead code path
  approved: 'accepted',

  // GTD bucket-style (legacy schemas treated bucket tags as status)
  inbox: 'ready',
  next_action: 'ready',
  waiting: 'blocked',
  projects: 'ready',
  estimate: 'ready',
  someday: 'ready',

  // Soft-delete (the proxy emits bucket='archive' alongside)
  archived: 'cancelled',
});

// ─── Canonical → legacy (for outbound translation) ─────────────────────

/**
 * Outbound mapping. Picks ONE canonical legacy synonym per lifecycle so the
 * bot's existing prompt can match on stable strings. Sticking to the
 * underscore form (snake_case) because the standard-CRUD writer used it.
 *
 * Note: there is no inverse for `'ready'` because the legacy world had four
 * different "ready" synonyms (`pending`, `next`, `scheduled`, `inbox`); we
 * pick `'pending'` as it best matches the meaning a downstream caller would
 * expect ("the task exists and is awaiting an owner").
 */
export const LIFECYCLE_TO_LEGACY: Readonly<Record<TaskLifecycle, string>> = Object.freeze({
  draft: 'draft',
  ready: 'pending',
  started: 'in_progress',
  blocked: 'waiting',
  completed: 'completed',
  accepted: 'accepted',
  cancelled: 'cancelled',
});

// ─── Pure functions ─────────────────────────────────────────────────────

/**
 * Translate a legacy `status` string to the canonical lifecycle. Returns
 * `null` for unknown values — the proxy must treat that as 400 Bad Request,
 * NOT silently default to `'draft'`. Silent defaults hide bot prompt
 * regressions which is exactly the failure mode the proxy is meant to catch.
 *
 * Lookup is case-insensitive against the lowercase keys of `LEGACY_TO_LIFECYCLE`.
 * Empty / non-string input also returns `null`.
 */
export function legacyStatusToLifecycle(status: unknown): TaskLifecycle | null {
  if (typeof status !== 'string' || status.length === 0) return null;
  // Try the value as-is first (preserves casing for camelCase keys like
  // `'inProgress'`), then a lowercased fallback for inputs like `'TODO'`.
  if (status in LEGACY_TO_LIFECYCLE) {
    return LEGACY_TO_LIFECYCLE[status];
  }
  const lower = status.toLowerCase();
  return LEGACY_TO_LIFECYCLE[lower] ?? null;
}

/**
 * Translate a canonical lifecycle back to a legacy status string. Total
 * function — every lifecycle has exactly one canonical legacy form (see
 * `LIFECYCLE_TO_LEGACY`).
 */
export function lifecycleToLegacyStatus(lifecycle: TaskLifecycle): string {
  return LIFECYCLE_TO_LEGACY[lifecycle];
}

/**
 * Convenience guard for callers that want to know if a value is a known
 * legacy status before calling `legacyStatusToLifecycle`. Used by the proxy
 * to disambiguate "user sent garbage" from "user genuinely sent
 * `'cancelled'` and we should treat it as cancelled".
 */
export function isKnownLegacyStatus(status: unknown): boolean {
  return legacyStatusToLifecycle(status) !== null;
}
