/**
 * @fileoverview Tasktotime — shared visual tokens (chip palettes + helpers).
 *
 * Phase 4.4 introduces the Board (kanban) view, which needs the same lifecycle
 * + priority chip colors that TaskListPage and TaskDetailPage already use.
 * Rather than triple-duplicate the palette literal across three files, the
 * tokens (and the priority-int -> string fallback) move here. Both pages still
 * own their *layout* — only the colour map and the priority resolver are
 * shared. New views (Gantt / Calendar / etc) should import from this module
 * too instead of re-declaring the palette.
 *
 * Why a separate file (not a top-level theme): the existing site uses MUI's
 * runtime theme for global app chrome. The tasktotime chips intentionally
 * sit OUTSIDE that theme so the palette can be tuned independently of the
 * rest of the CRM (each lifecycle bucket is its own colour, not a palette
 * shade). Keeping the literals here keeps that intent explicit.
 */
import type { TaskDto, TaskLifecycle, TaskPriority } from '../../api/tasktotimeApi';

export interface ChipPalette {
    bg: string;
    fg: string;
}

export const LIFECYCLE_COLORS: Record<TaskLifecycle, ChipPalette> = {
    draft: { bg: '#F3F4F6', fg: '#6B7280' },
    ready: { bg: '#DBEAFE', fg: '#1E40AF' },
    started: { bg: '#FEF3C7', fg: '#92400E' },
    blocked: { bg: '#FEE2E2', fg: '#991B1B' },
    completed: { bg: '#DCFCE7', fg: '#166534' },
    accepted: { bg: '#D1FAE5', fg: '#064E3B' },
    cancelled: { bg: '#E5E7EB', fg: '#374151' },
};

export const PRIORITY_COLORS: Record<TaskPriority, ChipPalette> = {
    critical: { bg: '#FEE2E2', fg: '#991B1B' },
    high: { bg: '#FED7AA', fg: '#9A3412' },
    medium: { bg: '#FEF3C7', fg: '#92400E' },
    low: { bg: '#E0F2FE', fg: '#075985' },
};

export const FALLBACK_CHIP: ChipPalette = { bg: '#E5E7EB', fg: '#374151' };

/**
 * Backend currently persists priority as an integer 0..3 (wire mismatch with
 * the Priority string domain type — see backend audit). Map int → string so
 * legacy data still chips correctly until the schema fix lands.
 */
export const PRIORITY_INT_TO_STRING: Record<number, TaskPriority> = {
    0: 'low',
    1: 'medium',
    2: 'high',
    3: 'critical',
};

/**
 * Resolve a `TaskDto.priority` (which may arrive as the canonical string OR
 * the legacy integer encoding) to a priority key suitable for indexing into
 * `PRIORITY_COLORS`. Returns `undefined` for unknown shapes so the caller can
 * fall back to a neutral chip.
 */
export function resolvePriorityKey(p: TaskDto['priority']): TaskPriority | undefined {
    if (typeof p === 'string') return p as TaskPriority;
    if (typeof p === 'number') return PRIORITY_INT_TO_STRING[p];
    return undefined;
}

/**
 * Generate a fresh idempotency key for one transition request.
 *
 * The backend treats two `(taskId, action, idempotencyKey)` tuples as
 * identical → returns the cached outcome on retry. We want every fresh user
 * click to produce a fresh key (otherwise a re-block after an unblock would
 * be skipped). `crypto.randomUUID()` is on every modern browser; the
 * fallback exists only for old Safari / testing environments that polyfill
 * before injecting a `crypto` global.
 */
export function newIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `transition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
