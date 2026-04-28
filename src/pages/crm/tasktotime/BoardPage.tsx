/**
 * @fileoverview Tasktotime — Kanban Board view (`/crm/tasktotime/board`).
 *
 * Phase 4.4 replaces the `ComingSoonView` placeholder for `board` with a real
 * 7-column kanban grouped by lifecycle:
 *
 *   draft → ready → started → blocked → completed → accepted → cancelled
 *
 * Drag a card onto another column to fire the matching lifecycle transition.
 * The `block` and `accept` transitions need structured payloads, so they
 * route through the existing `BlockDialog` / `AcceptDialog` (extracted from
 * `TaskDetailPage` into `src/components/tasktotime/`). Every other transition
 * fires immediately with a fresh idempotency key.
 *
 * Drag-and-drop technology choice:
 *   The spec said "use HTML5 drag-and-drop with React event handlers (no new
 *   dep)". `react-beautiful-dnd` isn't in the project; `@hello-pangea/dnd`
 *   is, but the spec explicitly directed native HTML5 to keep the bundle
 *   minimal. So this view wires `draggable` + the native `dragstart` /
 *   `dragenter` / `dragover` / `dragleave` / `drop` events directly. No
 *   extra runtime dep for drag/drop.
 *
 * URL contract:
 *   filters mirror the list view (`?priority=`, `?bucket=`, `?search=`).
 *   `?lifecycle=` is intentionally ignored on board (the board IS lifecycle
 *   — the columns ARE the lifecycle filter), but is preserved on the URL
 *   so the user can flip back to `/list` and keep their filter set.
 *
 * What this view deliberately does NOT do (future PRs):
 *   - Group by anything other than lifecycle (priority / assignee / project).
 *   - Swimlanes (e.g. priority rows × lifecycle columns).
 *   - WIP limits with visual badges.
 *   - In-place card edit / multi-select.
 *   - Reordering within a column (priority is its own field — the column
 *     already represents lifecycle).
 *
 * Empty / loading / error are per-view (a column-level skeleton on cold load,
 * and a single inline alert on fetch failure — same surface as the list view).
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    IconButton,
    Paper,
    Skeleton,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';

import { useAuth } from '../../../auth/AuthContext';
import { useTaskListPaginated, useTransitionTask } from '../../../hooks/useTasktotime';
import type {
    ListTasksParams,
    TaskBucket,
    TaskDto,
    TaskLifecycle,
    TaskPriority,
    TransitionAction,
} from '../../../api/tasktotimeApi';
import {
    AcceptDialog,
    BlockDialog,
    FALLBACK_CHIP,
    LIFECYCLE_COLORS,
    PRIORITY_COLORS,
    newIdempotencyKey,
    resolvePriorityKey,
} from '../../../components/tasktotime';
import type { AcceptDialogPayload } from '../../../components/tasktotime';

// ─── Constants ───────────────────────────────────────────────────────────

const LIFECYCLE_OPTIONS: TaskLifecycle[] = [
    'draft',
    'ready',
    'started',
    'blocked',
    'completed',
    'accepted',
    'cancelled',
];

const PRIORITY_OPTIONS: TaskPriority[] = ['critical', 'high', 'medium', 'low'];

const BUCKET_OPTIONS: TaskBucket[] = ['inbox', 'next', 'someday', 'archive'];

/**
 * Lifecycle state machine — mirror of `TaskDetailPage.ALLOWED_ACTIONS`.
 *
 * Maps `(fromLifecycle, toLifecycle) → TransitionAction` so a drop event can
 * decide which lifecycle action to fire. `null` means the transition isn't
 * legal from the source column. We use a nested map (not a flat lookup) so
 * the source column can early-return without hitting every entry.
 *
 * Keep in sync with the backend `TRANSITIONS_TABLE`. On drift the API will
 * reject with `TransitionNotAllowed` and the inline error surface will
 * display the message verbatim — no silent failures.
 */
const TRANSITION_MAP: Readonly<
    Record<TaskLifecycle, Partial<Record<TaskLifecycle, TransitionAction>>>
> = Object.freeze({
    draft: { ready: 'ready', cancelled: 'cancel' },
    ready: { started: 'start', cancelled: 'cancel' },
    started: { blocked: 'block', completed: 'complete', cancelled: 'cancel' },
    blocked: { started: 'unblock', cancelled: 'cancel' },
    completed: { accepted: 'accept', cancelled: 'cancel' },
    accepted: { cancelled: 'cancel' },
    cancelled: {},
});

const PAGE_SIZE = 200;

const COLUMN_MIN_WIDTH = 280;
const COLUMN_MAX_WIDTH = 320;

// ─── URL filter parsing (subset of TaskListPage's contract) ──────────────

/**
 * Filters the board honors. `lifecycle` is *not* in this shape — the board
 * is grouped by lifecycle, so a lifecycle filter would just hide entire
 * columns and confuse the user. We do preserve the param on the URL so a
 * user toggling back to `/list` keeps their filter set.
 */
interface BoardFilters {
    priority: TaskPriority[];
    bucket: TaskBucket | '';
    search: string;
}

function parseCsv<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map((v) => v.trim())
        .filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function parseSingle<T extends string>(raw: string | null, allowed: readonly T[]): T | '' {
    if (!raw) return '';
    return (allowed as readonly string[]).includes(raw) ? (raw as T) : '';
}

/**
 * Parse the URL search params into the subset of filters this view applies.
 *
 * `lifecycle` is intentionally NOT consumed here (see `BoardFilters` doc).
 * The list view's parser duplicates this logic — when both views need to
 * change in lockstep, lift this into a shared module. For now we keep the
 * board self-contained so future tweaks (extra column-level filters, e.g.
 * assignee chips) don't ripple into the list page's tighter filter bar UX.
 */
function readFiltersFromSearchParams(sp: URLSearchParams): BoardFilters {
    return {
        priority: parseCsv(sp.get('priority'), PRIORITY_OPTIONS),
        bucket: parseSingle(sp.get('bucket'), BUCKET_OPTIONS),
        search: sp.get('search')?.trim() ?? '',
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatDate(epochMs?: number): string {
    if (!epochMs || !Number.isFinite(epochMs)) return '—';
    const d = dayjs(epochMs);
    if (!d.isValid()) return '—';
    return d.format('MMM D, YYYY');
}

interface DueChip {
    label: string;
    color: string;
}

function formatDueRelative(dueAt?: number): DueChip {
    if (!dueAt || !Number.isFinite(dueAt)) return { label: '—', color: '#6B7280' };
    const diffMs = dueAt - Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.round(diffMs / dayMs);
    if (days < -1) return { label: `${Math.abs(days)}d overdue`, color: '#991B1B' };
    if (days === -1) return { label: '1d overdue', color: '#991B1B' };
    if (days === 0) return { label: 'today', color: '#9A3412' };
    if (days === 1) return { label: 'tomorrow', color: '#9A3412' };
    if (days <= 7) return { label: `in ${days}d`, color: '#92400E' };
    return { label: formatDate(dueAt), color: '#374151' };
}

/**
 * Initials from a display name — used as the avatar text fallback when the
 * task has no avatar URL. Strips whitespace and takes the first letter of
 * the first two words, so "Jane Doe" → "JD" and "Alice" → "A".
 */
function initialsFor(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
}

// ─── Card ────────────────────────────────────────────────────────────────

interface TaskCardProps {
    task: TaskDto;
    /** Click → navigate to the detail page. Drag fires the column-level handler. */
    onOpen: (taskId: string) => void;
    /** Native HTML5 dragstart wiring. Receives the drag event so we can set
     *  `dataTransfer` on the parent (taskId payload + effectAllowed). */
    onDragStart: (e: React.DragEvent<HTMLDivElement>, task: TaskDto) => void;
    onDragEnd: () => void;
    /** True while THIS card is the active drag source — render at reduced
     *  opacity so the user sees what they're moving. */
    isDragging: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onOpen, onDragStart, onDragEnd, isDragging }) => {
    const priorityKey = resolvePriorityKey(task.priority);
    const priorityStyle = (priorityKey && PRIORITY_COLORS[priorityKey]) ?? FALLBACK_CHIP;
    const priorityLabel = priorityKey ?? String(task.priority ?? '—');
    const due = formatDueRelative(task.dueAt);
    const assigneeName = task.assignedTo?.name ?? '';

    return (
        <Paper
            elevation={0}
            draggable
            onDragStart={(e) => onDragStart(e, task)}
            onDragEnd={onDragEnd}
            onClick={() => onOpen(task.id)}
            // Keyboard fallback for users on assistive tech that don't fire
            // mouse-style drag events. Pressing Enter / Space on a focused
            // card opens it (same as a click). Drag-only reordering via
            // keyboard isn't wired here — a follow-up PR can add an "Move
            // to…" menu when there's appetite.
            tabIndex={0}
            role="button"
            aria-label={`Open task ${task.taskNumber}: ${task.title}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(task.id);
                }
            }}
            sx={{
                p: 1.5,
                mb: 1,
                cursor: 'grab',
                bgcolor: '#FFFFFF',
                border: '1px solid #E5E7EB',
                borderRadius: 1,
                opacity: isDragging ? 0.4 : 1,
                transition: 'border-color 120ms ease, box-shadow 120ms ease',
                '&:hover': {
                    borderColor: '#9CA3AF',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                },
                '&:active': { cursor: 'grabbing' },
                // WCAG 2.2 §2.4.11 — 2px focus outline with sufficient contrast
                '&:focus-visible': {
                    outline: '2px solid #007AFF',
                    outlineOffset: 2,
                },
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 0.5 }}
            >
                <Typography
                    variant="caption"
                    sx={{
                        fontFamily: 'monospace',
                        color: '#6B7280',
                        fontWeight: 600,
                    }}
                >
                    {task.taskNumber}
                </Typography>
                <Chip
                    label={priorityLabel}
                    size="small"
                    sx={{
                        bgcolor: priorityStyle.bg,
                        color: priorityStyle.fg,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        height: 20,
                        fontSize: '0.7rem',
                    }}
                />
            </Stack>

            <Typography
                variant="body2"
                fontWeight={600}
                sx={{
                    color: '#111827',
                    mb: 0.75,
                    // 2-line clamp so cards stay roughly the same height in
                    // a column. Falls back to overflow-hidden in browsers
                    // that don't grok `-webkit-line-clamp`.
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.3,
                }}
            >
                {task.title}
            </Typography>

            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                    {assigneeName ? (
                        <Tooltip title={assigneeName}>
                            <Box
                                sx={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: '50%',
                                    bgcolor: '#E0E7FF',
                                    color: '#3730A3',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                }}
                                aria-hidden
                            >
                                {initialsFor(assigneeName)}
                            </Box>
                        </Tooltip>
                    ) : (
                        <Box
                            sx={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%',
                                bgcolor: '#F3F4F6',
                                color: '#9CA3AF',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.65rem',
                                fontWeight: 700,
                            }}
                            aria-hidden
                        >
                            ?
                        </Box>
                    )}
                    <Typography
                        variant="caption"
                        noWrap
                        sx={{ color: '#374151', maxWidth: 120 }}
                    >
                        {assigneeName || '—'}
                    </Typography>
                </Stack>
                <Typography
                    variant="caption"
                    sx={{ color: due.color, fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                    {due.label}
                </Typography>
            </Stack>
        </Paper>
    );
};

// ─── Column ──────────────────────────────────────────────────────────────

interface ColumnProps {
    lifecycle: TaskLifecycle;
    tasks: TaskDto[];
    loading: boolean;
    /** True while SOMETHING is being dragged. Determines whether to render the
     *  drop affordance on this column. */
    dragInProgress: boolean;
    /** True when the dragged card's source lifecycle has a legal transition
     *  to this column. We dim non-target columns during a drag for clarity. */
    isDropTarget: boolean;
    /** True while the dragged card is hovering over THIS column. */
    isHotTarget: boolean;
    onCardOpen: (taskId: string) => void;
    onCardDragStart: (e: React.DragEvent<HTMLDivElement>, task: TaskDto) => void;
    onCardDragEnd: () => void;
    onColumnDragEnter: (lifecycle: TaskLifecycle) => void;
    onColumnDragLeave: (lifecycle: TaskLifecycle) => void;
    onColumnDrop: (lifecycle: TaskLifecycle) => void;
    draggingTaskId: string | null;
}

const Column: React.FC<ColumnProps> = ({
    lifecycle,
    tasks,
    loading,
    dragInProgress,
    isDropTarget,
    isHotTarget,
    onCardOpen,
    onCardDragStart,
    onCardDragEnd,
    onColumnDragEnter,
    onColumnDragLeave,
    onColumnDrop,
    draggingTaskId,
}) => {
    const palette = LIFECYCLE_COLORS[lifecycle] ?? FALLBACK_CHIP;

    // Visual states for the column shell.
    // - `disabledByDrag`: dim columns that aren't valid drop targets while a
    //   drag is in flight (the user instantly sees where they CAN drop).
    // - `hot`: highlight the column the cursor is currently over (only when
    //   it's also a valid target — illegal drops just stay dimmed).
    const disabledByDrag = dragInProgress && !isDropTarget;
    const hot = isHotTarget && isDropTarget;

    return (
        <Box
            // Native HTML5 drop wiring. `dragover` MUST call preventDefault()
            // for the drop event to fire — if we don't, the browser treats
            // the drop area as inert. `dragenter` is what flips the hot-state
            // bookkeeping on; `dragleave` flips it off (with the firing-on-
            // child-elements caveat handled in the parent — see
            // `handleColumnDragEnter` / `handleColumnDragLeave` notes there).
            onDragOver={(e) => {
                if (isDropTarget) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }
            }}
            onDragEnter={() => onColumnDragEnter(lifecycle)}
            onDragLeave={() => onColumnDragLeave(lifecycle)}
            onDrop={(e) => {
                e.preventDefault();
                if (isDropTarget) onColumnDrop(lifecycle);
            }}
            sx={{
                flex: '0 0 auto',
                width: '100%',
                minWidth: COLUMN_MIN_WIDTH,
                maxWidth: COLUMN_MAX_WIDTH,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: '#F9FAFB',
                border: '1px solid',
                borderColor: hot ? palette.fg : '#E5E7EB',
                borderRadius: 1.5,
                p: 1,
                opacity: disabledByDrag ? 0.55 : 1,
                transition: 'border-color 120ms ease, opacity 120ms ease',
                outline: hot ? `2px dashed ${palette.fg}` : 'none',
                outlineOffset: -4,
            }}
            aria-label={`${lifecycle} column with ${tasks.length} tasks`}
        >
            {/* Column header */}
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{
                    px: 0.5,
                    py: 0.5,
                    mb: 1,
                }}
            >
                <Stack direction="row" alignItems="center" spacing={1}>
                    <Box
                        sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            bgcolor: palette.fg,
                        }}
                        aria-hidden
                    />
                    <Typography
                        variant="subtitle2"
                        fontWeight={700}
                        sx={{ color: '#111827', textTransform: 'capitalize' }}
                    >
                        {lifecycle}
                    </Typography>
                </Stack>
                <Box
                    sx={{
                        bgcolor: palette.bg,
                        color: palette.fg,
                        px: 1,
                        py: 0.25,
                        borderRadius: '12px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        minWidth: 24,
                        textAlign: 'center',
                    }}
                    aria-label={`${tasks.length} tasks`}
                >
                    {tasks.length}
                </Box>
            </Stack>

            {/* Card list */}
            <Box
                sx={{
                    flex: 1,
                    minHeight: 80,
                    overflowY: 'auto',
                    pr: 0.5,
                }}
            >
                {loading ? (
                    <Stack spacing={1}>
                        {[0, 1, 2].map((n) => (
                            <Skeleton
                                key={n}
                                variant="rectangular"
                                height={92}
                                sx={{ borderRadius: 1 }}
                            />
                        ))}
                    </Stack>
                ) : tasks.length === 0 ? (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minHeight: 80,
                            color: '#9CA3AF',
                            fontSize: '0.8rem',
                            fontStyle: 'italic',
                            border: '1px dashed #E5E7EB',
                            borderRadius: 1,
                            mx: 0.25,
                        }}
                    >
                        No tasks
                    </Box>
                ) : (
                    tasks.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onOpen={onCardOpen}
                            onDragStart={onCardDragStart}
                            onDragEnd={onCardDragEnd}
                            isDragging={draggingTaskId === task.id}
                        />
                    ))
                )}
            </Box>
        </Box>
    );
};

// ─── Page ────────────────────────────────────────────────────────────────

interface PendingTransition {
    task: TaskDto;
    target: TaskLifecycle;
    action: TransitionAction;
}

const BoardPage: React.FC = () => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const companyId = userProfile?.companyId ?? null;

    const filters = useMemo<BoardFilters>(
        () => readFiltersFromSearchParams(searchParams),
        [searchParams],
    );

    // ─── Data fetch ──────────────────────────────────────────────────────

    /**
     * `lifecycle` is deliberately NOT in the API params — the board renders
     * every lifecycle column. `bucket` and `search` map directly. `priority`
     * isn't a backend filter (see the long comment in `TaskListPage`), so we
     * filter client-side after the response.
     */
    const apiParams: Omit<ListTasksParams, 'cursor'> | null = useMemo(() => {
        if (!companyId) return null;
        const p: Omit<ListTasksParams, 'cursor'> = {
            companyId,
            parentTaskId: null,
            orderBy: 'updatedAt',
            direction: 'desc',
            limit: PAGE_SIZE,
        };
        if (filters.bucket) p.bucket = [filters.bucket];
        if (filters.search) p.search = filters.search;
        return p;
    }, [companyId, filters.bucket, filters.search]);

    const {
        tasks: rawTasks,
        nextCursor,
        loadingInitial,
        loadingMore,
        error,
        refetch,
        loadMore,
    } = useTaskListPaginated(apiParams);

    // Client-side priority filter (matches TaskListPage's behavior).
    const tasks = useMemo(() => {
        if (filters.priority.length === 0) return rawTasks;
        const allowed = new Set(filters.priority);
        return rawTasks.filter((t) => allowed.has(t.priority));
    }, [rawTasks, filters.priority]);

    // Bucket tasks by lifecycle. Tasks with an unknown lifecycle (shouldn't
    // happen, but defensively) drop into a "draft" fallback so they remain
    // visible.
    const tasksByLifecycle = useMemo(() => {
        const buckets: Record<TaskLifecycle, TaskDto[]> = {
            draft: [],
            ready: [],
            started: [],
            blocked: [],
            completed: [],
            accepted: [],
            cancelled: [],
        };
        for (const t of tasks) {
            const key = (LIFECYCLE_OPTIONS as readonly string[]).includes(t.lifecycle)
                ? t.lifecycle
                : ('draft' as TaskLifecycle);
            buckets[key].push(t);
        }
        return buckets;
    }, [tasks]);

    // ─── Drag state ──────────────────────────────────────────────────────

    /**
     * The card currently being dragged. `null` when idle. We snapshot the
     * full task (not just the id) so the drop handler doesn't need a second
     * lookup — keeps the legal-transition decision branch flat.
     */
    const [draggedTask, setDraggedTask] = useState<TaskDto | null>(null);

    /**
     * Which column the cursor is currently over. The native `dragenter` /
     * `dragleave` events fire for every child element transition, so a
     * single boolean per column would flip on/off many times during a hover.
     * Tracking by `lifecycle` (a single value) is cleaner: we set it on
     * `dragenter` and only clear it on `dragleave` IF the column matches.
     */
    const [hotColumn, setHotColumn] = useState<TaskLifecycle | null>(null);

    const handleCardDragStart = useCallback(
        (e: React.DragEvent<HTMLDivElement>, task: TaskDto) => {
            // Some browsers (notably Firefox) require *some* data on the
            // dataTransfer to actually initiate a drag. Set the taskId; we
            // also keep the task in component state for fast lookup.
            try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', task.id);
            } catch {
                // Some test environments stub dataTransfer; ignore.
            }
            setDraggedTask(task);
        },
        [],
    );

    const handleCardDragEnd = useCallback(() => {
        setDraggedTask(null);
        setHotColumn(null);
    }, []);

    const handleColumnDragEnter = useCallback((lifecycle: TaskLifecycle) => {
        setHotColumn(lifecycle);
    }, []);

    const handleColumnDragLeave = useCallback((lifecycle: TaskLifecycle) => {
        // Only clear if we're leaving the column we last set. Native HTML5
        // dragleave events fire when crossing into child elements too — if
        // we cleared unconditionally, the hot-state would flicker badly.
        setHotColumn((prev) => (prev === lifecycle ? null : prev));
    }, []);

    // ─── Transition wiring ───────────────────────────────────────────────

    const transitionTask = useTransitionTask();
    const [actionError, setActionError] = useState<string | null>(null);
    /**
     * Holds the pending transition while the user fills in the Block /
     * Accept dialog. `null` outside those flows. Other actions go through
     * `fireTransition` immediately and don't park here.
     */
    const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);
    const [blockOpen, setBlockOpen] = useState<boolean>(false);
    const [acceptOpen, setAcceptOpen] = useState<boolean>(false);

    const fireTransition = useCallback(
        async (
            task: TaskDto,
            action: TransitionAction,
            extras: {
                blockedReason?: string;
                acceptance?: AcceptDialogPayload;
            } = {},
        ): Promise<boolean> => {
            if (!companyId) return false;
            setActionError(null);
            try {
                await transitionTask.mutate({
                    taskId: task.id,
                    companyId,
                    input: {
                        action,
                        idempotencyKey: newIdempotencyKey(),
                        ...extras,
                    },
                });
                refetch();
                return true;
            } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
                return false;
            }
        },
        [companyId, refetch, transitionTask],
    );

    /**
     * Resolve the legal lifecycle action for a drop and dispatch.
     *
     * - Same-column drop → no-op (avoid wasting an API call on a no-change
     *   transition).
     * - `block` / `accept` → open the corresponding dialog and stash the
     *   pending transition so the dialog confirm can resume it.
     * - Anything else → fire immediately.
     * - Illegal drop → ignored. The column-level drop affordance already
     *   prevents the user from dropping there visually, but we double-check
     *   here in case a screen reader / programmatic source bypasses it.
     */
    const handleColumnDrop = useCallback(
        (target: TaskLifecycle) => {
            const task = draggedTask;
            setDraggedTask(null);
            setHotColumn(null);
            if (!task) return;
            if (task.lifecycle === target) return;
            const action = TRANSITION_MAP[task.lifecycle]?.[target];
            if (!action) return;
            if (action === 'block') {
                setPendingTransition({ task, target, action });
                setBlockOpen(true);
                return;
            }
            if (action === 'accept') {
                setPendingTransition({ task, target, action });
                setAcceptOpen(true);
                return;
            }
            void fireTransition(task, action);
        },
        [draggedTask, fireTransition],
    );

    const handleBlockConfirm = useCallback(
        async (reason: string) => {
            if (!pendingTransition) return;
            const okFlag = await fireTransition(pendingTransition.task, 'block', {
                blockedReason: reason,
            });
            if (okFlag) {
                setBlockOpen(false);
                setPendingTransition(null);
            }
        },
        [fireTransition, pendingTransition],
    );

    const handleAcceptConfirm = useCallback(
        async (payload: AcceptDialogPayload) => {
            if (!pendingTransition) return;
            const okFlag = await fireTransition(pendingTransition.task, 'accept', {
                acceptance: payload,
            });
            if (okFlag) {
                setAcceptOpen(false);
                setPendingTransition(null);
            }
        },
        [fireTransition, pendingTransition],
    );

    const handleBlockClose = useCallback(() => {
        if (transitionTask.loading) return;
        setBlockOpen(false);
        setPendingTransition(null);
    }, [transitionTask.loading]);

    const handleAcceptClose = useCallback(() => {
        if (transitionTask.loading) return;
        setAcceptOpen(false);
        setPendingTransition(null);
    }, [transitionTask.loading]);

    // ─── Card → detail navigation ────────────────────────────────────────

    const handleCardOpen = useCallback(
        (taskId: string) => {
            navigate(`/crm/tasktotime/tasks/${taskId}`);
        },
        [navigate],
    );

    // Pre-compute the legal target columns for the active drag (used to dim
    // illegal columns during the drag). When idle, every column "passes" so
    // no dim styling is applied.
    const dragInProgress = draggedTask !== null;
    const legalTargets = useMemo<Set<TaskLifecycle>>(() => {
        if (!draggedTask) return new Set(LIFECYCLE_OPTIONS);
        const map = TRANSITION_MAP[draggedTask.lifecycle] ?? {};
        return new Set(Object.keys(map) as TaskLifecycle[]);
    }, [draggedTask]);

    // ─── Render ──────────────────────────────────────────────────────────

    if (!companyId) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <Box sx={{ flex: 1, p: 3 }}>
                    <Alert severity="warning">
                        Your user profile has no company. Please contact an administrator.
                    </Alert>
                </Box>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Page Header */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 3,
                    py: 1.5,
                    borderBottom: '1px solid #E0E0E0',
                    bgcolor: '#FFFFFF',
                    flexShrink: 0,
                }}
            >
                <Box display="flex" alignItems="center" gap={1.5}>
                    <Typography
                        variant="h6"
                        fontWeight={700}
                        sx={{
                            fontFamily:
                                '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                        }}
                    >
                        Board
                    </Typography>
                    {!loadingInitial && !error && (
                        <Box
                            sx={{
                                bgcolor: '#F3F4F6',
                                color: '#6B7280',
                                px: 1,
                                py: 0.25,
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                            }}
                        >
                            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                            {nextCursor && '+'}
                        </Box>
                    )}
                </Box>

                <Stack direction="row" spacing={1} alignItems="center">
                    {nextCursor && !loadingInitial && (
                        <Tooltip title="Load more tasks">
                            <span>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={loadMore}
                                    disabled={loadingMore}
                                    startIcon={
                                        loadingMore ? <CircularProgress size={14} /> : undefined
                                    }
                                >
                                    {loadingMore ? 'Loading…' : 'Load more'}
                                </Button>
                            </span>
                        </Tooltip>
                    )}
                    <Tooltip title="Refresh">
                        <span>
                            <IconButton
                                onClick={refetch}
                                disabled={loadingInitial || loadingMore}
                                size="small"
                                aria-label="Refresh board"
                            >
                                <RefreshIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Stack>
            </Box>

            {/* Body */}
            <Box
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    p: { xs: 2, md: 2.5 },
                    bgcolor: '#FAFBFC',
                }}
            >
                {error && (
                    <Alert
                        severity="error"
                        sx={{ mb: 2 }}
                        action={
                            <IconButton
                                size="small"
                                color="inherit"
                                onClick={refetch}
                                aria-label="Retry"
                            >
                                <RefreshIcon fontSize="small" />
                            </IconButton>
                        }
                    >
                        Failed to load tasks: {error.message}
                    </Alert>
                )}

                {actionError && (
                    <Alert
                        severity="error"
                        sx={{ mb: 2 }}
                        onClose={() => setActionError(null)}
                    >
                        {actionError}
                    </Alert>
                )}

                {/* 7-column grid.
                    On mobile/tablet (<lg): horizontal scroll, columns at min
                    width. On desktop (≥lg/1280): grid wraps gracefully with
                    columns at max width. We use CSS grid with
                    `repeat(7, minmax(280px, 320px))` on wide screens so each
                    column is a fixed slot and the row aligns. On narrow
                    screens we fall back to flex with horizontal overflow so
                    the user can swipe across columns. */}
                <Box
                    sx={{
                        display: 'grid',
                        gridAutoFlow: 'column',
                        gridAutoColumns: `minmax(${COLUMN_MIN_WIDTH}px, ${COLUMN_MAX_WIDTH}px)`,
                        gap: 2,
                        overflowX: 'auto',
                        pb: 1,
                        // On wide viewports, the grid behaves as 7 fixed
                        // tracks so columns line up flush. The horizontal
                        // overflow is still allowed in case the screen is
                        // narrower than 7 × COLUMN_MAX_WIDTH.
                    }}
                >
                    {LIFECYCLE_OPTIONS.map((lifecycle) => (
                        <Column
                            key={lifecycle}
                            lifecycle={lifecycle}
                            tasks={tasksByLifecycle[lifecycle]}
                            loading={loadingInitial}
                            dragInProgress={dragInProgress}
                            isDropTarget={legalTargets.has(lifecycle)}
                            isHotTarget={hotColumn === lifecycle}
                            onCardOpen={handleCardOpen}
                            onCardDragStart={handleCardDragStart}
                            onCardDragEnd={handleCardDragEnd}
                            onColumnDragEnter={handleColumnDragEnter}
                            onColumnDragLeave={handleColumnDragLeave}
                            onColumnDrop={handleColumnDrop}
                            draggingTaskId={draggedTask?.id ?? null}
                        />
                    ))}
                </Box>
            </Box>

            {/* Block + Accept payload dialogs.
                Always mounted; visibility driven by `blockOpen` / `acceptOpen`
                state. Each dialog re-resets its form on open. */}
            <BlockDialog
                open={blockOpen}
                onClose={handleBlockClose}
                onConfirm={handleBlockConfirm}
                submitting={transitionTask.loading}
            />
            <AcceptDialog
                open={acceptOpen}
                onClose={handleAcceptClose}
                onConfirm={handleAcceptConfirm}
                submitting={transitionTask.loading}
                defaultSignerId={userProfile?.id ?? ''}
                defaultSignerName={userProfile?.displayName ?? ''}
            />
        </Box>
    );
};

export default BoardPage;
