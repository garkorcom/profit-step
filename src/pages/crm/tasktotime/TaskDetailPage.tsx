/**
 * @fileoverview Tasktotime — Task Detail view (Phase 4.1).
 *
 * Renders one task at `/crm/tasktotime/tasks/:id`. Reuses the existing
 * `useTask` query hook (Phase 4.0) plus `useTransitionTask` mutation hook
 * to drive lifecycle changes from the action bar at the bottom of the page.
 *
 * Explicit punts (other PRs in the same Phase 4 wave):
 *   - 4.2: TaskListPage filters / search / kanban — owned by parallel PR
 *   - 4.3: Markdown editor for `wiki.contentMd` — this view shows it as a
 *          read-only `<pre>` for now.
 *   - Later: dependency-graph viz, comments thread, subtask drilldown,
 *            inline edit of metadata fields, history audit log UI.
 *
 * Transition rules are sourced from the canonical state machine in
 * `tasktotime/domain/lifecycle.ts` (the domain package). Because the root
 * `src/` build excludes that package, the table is mirrored here as a frozen
 * literal — the same trade-off `tasktotimeApi.ts` makes for wire types.
 * If this drifts, the backend is the source of truth and will reject
 * disallowed actions with `TransitionNotAllowed`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
    Alert,
    Box,
    Breadcrumbs,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    Grid,
    IconButton,
    Link as MuiLink,
    Paper,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import LinkIcon from '@mui/icons-material/Link';
import dayjs from 'dayjs';
import { Controller, useForm } from 'react-hook-form';

import { useAuth } from '../../../auth/AuthContext';
import { useTask, useTransitionTask } from '../../../hooks/useTasktotime';
import type {
    TaskDependencyDto,
    TaskDto,
    TaskLifecycle,
    TaskPriority,
    TransitionAction,
} from '../../../api/tasktotimeApi';

// ─── Visual tokens (mirrors TaskListPage so chips stay consistent) ──────

const LIFECYCLE_COLORS: Record<TaskLifecycle, { bg: string; fg: string }> = {
    draft: { bg: '#F3F4F6', fg: '#6B7280' },
    ready: { bg: '#DBEAFE', fg: '#1E40AF' },
    started: { bg: '#FEF3C7', fg: '#92400E' },
    blocked: { bg: '#FEE2E2', fg: '#991B1B' },
    completed: { bg: '#DCFCE7', fg: '#166534' },
    accepted: { bg: '#D1FAE5', fg: '#064E3B' },
    cancelled: { bg: '#E5E7EB', fg: '#374151' },
};

const PRIORITY_COLORS: Record<TaskPriority, { bg: string; fg: string }> = {
    critical: { bg: '#FEE2E2', fg: '#991B1B' },
    high: { bg: '#FED7AA', fg: '#9A3412' },
    medium: { bg: '#FEF3C7', fg: '#92400E' },
    low: { bg: '#E0F2FE', fg: '#075985' },
};

const FALLBACK_CHIP = { bg: '#E5E7EB', fg: '#374151' };

// Backend currently persists priority as an integer 0..3 (wire mismatch with
// the Priority string domain type — see backend audit). Map int → string so
// the legacy data still chips correctly until the schema fix lands.
const PRIORITY_INT_TO_STRING: Record<number, TaskPriority> = {
    0: 'low',
    1: 'medium',
    2: 'high',
    3: 'critical',
};

function resolvePriorityKey(p: unknown): TaskPriority | undefined {
    if (typeof p === 'string') return p as TaskPriority;
    if (typeof p === 'number') return PRIORITY_INT_TO_STRING[p];
    return undefined;
}

// ─── Lifecycle state machine (mirror of tasktotime/domain/lifecycle.ts) ─

/**
 * Allowed transitions per from-state. `cancel` is allowed from every
 * non-terminal state. Keep in sync with backend `TRANSITIONS_TABLE`; on
 * drift the API will reject with `TransitionNotAllowed` and the UI will
 * surface that error verbatim.
 */
const ALLOWED_ACTIONS: Readonly<Record<TaskLifecycle, ReadonlyArray<TransitionAction>>> =
    Object.freeze({
        draft: ['ready', 'cancel'],
        ready: ['start', 'cancel'],
        started: ['block', 'complete', 'cancel'],
        blocked: ['unblock', 'cancel'],
        completed: ['accept', 'cancel'],
        accepted: ['cancel'],
        cancelled: [],
    });

const ACTION_LABELS: Record<TransitionAction, string> = {
    create: 'Create',
    ready: 'Mark ready',
    start: 'Start',
    block: 'Block',
    unblock: 'Unblock',
    complete: 'Complete',
    accept: 'Accept',
    cancel: 'Cancel',
};

const ACTION_VARIANTS: Record<TransitionAction, 'contained' | 'outlined' | 'text'> = {
    create: 'contained',
    ready: 'contained',
    start: 'contained',
    block: 'outlined',
    unblock: 'contained',
    complete: 'contained',
    accept: 'contained',
    cancel: 'outlined',
};

const ACTION_COLORS: Record<TransitionAction, 'primary' | 'success' | 'error' | 'warning' | 'info'> = {
    create: 'primary',
    ready: 'primary',
    start: 'primary',
    block: 'warning',
    unblock: 'primary',
    complete: 'success',
    accept: 'success',
    cancel: 'error',
};

// ─── Helpers ────────────────────────────────────────────────────────────

function formatDateTime(epochMs?: number): string {
    if (!epochMs || !Number.isFinite(epochMs)) return '—';
    const d = dayjs(epochMs);
    if (!d.isValid()) return '—';
    return d.format('MMM D, YYYY h:mm A');
}

function formatDate(epochMs?: number): string {
    if (!epochMs || !Number.isFinite(epochMs)) return '—';
    const d = dayjs(epochMs);
    if (!d.isValid()) return '—';
    return d.format('MMM D, YYYY');
}

function formatDuration(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours <= 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
}

function joinAssignees(task: TaskDto): string {
    const names = [task.assignedTo?.name, ...(task.coAssignees ?? []).map((u) => u.name)]
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
    return names.length > 0 ? names.join(', ') : '—';
}

// ─── Small layout primitives ─────────────────────────────────────────────

const MetadataItem: React.FC<{ label: string; children: React.ReactNode }> = ({
    label,
    children,
}) => (
    <Box>
        <Typography
            variant="caption"
            sx={{
                color: '#6B7280',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                display: 'block',
                mb: 0.5,
            }}
        >
            {label}
        </Typography>
        <Typography variant="body2" sx={{ color: '#111827' }}>
            {children}
        </Typography>
    </Box>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography
        variant="overline"
        sx={{
            color: '#6B7280',
            fontWeight: 700,
            letterSpacing: 0.8,
            display: 'block',
            mb: 1,
        }}
    >
        {children}
    </Typography>
);

/**
 * One dependency, rendered as a clickable chip that navigates to the linked
 * task's detail page.
 *
 * Label resolution:
 *   - If the linked task is loaded, show its `taskNumber` (e.g. "T-042"),
 *     because raw cuids are opaque to humans.
 *   - While loading or if the lookup fails, fall back to the raw `taskId`.
 *   - The full `taskId` (and dependency type, when relevant) is always in the
 *     tooltip so the user can disambiguate.
 *
 * Why a per-chip `useTask` (instead of a single batched fetch):
 *   `ListTasksParams` doesn't currently accept an `in: ids[]` filter — only
 *   `companyId / parentTaskId / lifecycle / bucket / search / etc`. A single
 *   batch fetch would need a backend change. Per-chip fetch costs N requests
 *   per render, but typical tasks have 0–5 dependencies and the responses are
 *   cached at the route level by the browser. When a `taskIds: string[]`
 *   filter lands server-side we can swap to a batch fetch in one place.
 */
const DependencyChip: React.FC<{
    taskId: string;
    companyId: string | null;
    type?: string;
    tone?: 'block' | 'blocks';
}> = ({ taskId, companyId, type, tone = 'block' }) => {
    // Per-chip fetch. `useTask` short-circuits when companyId is null, so
    // chips render with the raw id fallback in that edge case.
    const { task } = useTask(taskId, companyId);
    const displayLabel = task?.taskNumber ?? taskId;
    const visualLabel = type ? `${displayLabel} (${type})` : displayLabel;
    const tooltipBody = type
        ? `${taskId} (${type})`
        : taskId;

    return (
        <Tooltip title={tooltipBody} arrow>
            <Chip
                size="small"
                clickable
                component={RouterLink}
                to={`/crm/tasktotime/tasks/${taskId}`}
                icon={<LinkIcon style={{ fontSize: 14 }} />}
                label={visualLabel}
                sx={{
                    bgcolor: tone === 'block' ? '#EEF2FF' : '#FEF3C7',
                    color: tone === 'block' ? '#3730A3' : '#92400E',
                    // Keep the typeface monospaced when we're showing the raw
                    // cuid fallback (so it visually telegraphs "this is an
                    // id"); switch to the regular family once the human-
                    // friendly taskNumber is resolved.
                    fontFamily: task?.taskNumber
                        ? '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
                        : 'monospace',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textDecoration: 'none',
                    '&:hover': {
                        bgcolor: tone === 'block' ? '#E0E7FF' : '#FDE68A',
                    },
                    '& .MuiChip-icon': {
                        color: 'inherit',
                        marginLeft: '6px',
                    },
                }}
            />
        </Tooltip>
    );
};

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
function newIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `transition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Block dialog ───────────────────────────────────────────────────────

interface BlockFormFields {
    blockedReason: string;
}

/**
 * Modal that collects the `blockedReason` (>= 5 chars) required by the
 * backend `block` transition. Submit is disabled until the field is valid;
 * the parent re-renders the lifecycle once the mutation resolves.
 *
 * Why react-hook-form: matches the existing house style (e.g.
 * `AddPaymentDialog`, `CreateInvoiceDialog`) — validation rules sit next to
 * the field, `formState.isValid` drives the submit button, and the form
 * resets cleanly on close.
 */
const BlockDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
    submitting: boolean;
}> = ({ open, onClose, onConfirm, submitting }) => {
    const { control, handleSubmit, reset, watch } = useForm<BlockFormFields>({
        mode: 'onChange',
        defaultValues: { blockedReason: '' },
    });

    // Reset on each open so a previous abandoned attempt doesn't leak in.
    useEffect(() => {
        if (open) reset({ blockedReason: '' });
    }, [open, reset]);

    // Live-watch the field for the submit-button disable. Using `watch`
    // instead of `formState.isValid` because v7's `isValid` starts as `true`
    // for `mode: 'onChange'` until the user touches the field — which would
    // leave the button incorrectly enabled on an empty initial form.
    const reasonValue = watch('blockedReason') ?? '';
    const reasonValid = reasonValue.trim().length >= 5;

    const submit = handleSubmit(async (data) => {
        await onConfirm(data.blockedReason.trim());
    });

    return (
        <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Block task</DialogTitle>
            <form onSubmit={submit}>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2 }}>
                        Tell the team why you&apos;re blocking this task. The
                        reason is shown in the task banner and recorded in the
                        history log. Minimum 5 characters.
                    </DialogContentText>
                    <Controller
                        name="blockedReason"
                        control={control}
                        rules={{
                            required: 'Reason is required',
                            validate: (value) =>
                                value.trim().length >= 5 ||
                                'Reason must be at least 5 characters',
                        }}
                        render={({ field, fieldState }) => (
                            <TextField
                                {...field}
                                label="Reason"
                                placeholder="e.g. Waiting on permit committee approval"
                                multiline
                                minRows={2}
                                fullWidth
                                autoFocus
                                error={Boolean(fieldState.error)}
                                helperText={
                                    fieldState.error?.message ??
                                    `${field.value.trim().length}/5 characters minimum`
                                }
                            />
                        )}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        color="warning"
                        disabled={!reasonValid || submitting}
                    >
                        {submitting ? 'Blocking…' : 'Block'}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

// ─── Accept dialog ──────────────────────────────────────────────────────

interface AcceptFormFields {
    signedByName: string;
    signature: string;
}

/**
 * Modal that collects the `acceptance` payload (signedAt, signedBy:
 * UserRef, signature?) required by the backend `accept` transition.
 *
 * UX choices:
 *   - `signedAt` is captured automatically when the dialog opens (no field
 *     for it — the payload represents "the moment the operator clicked
 *     Accept"). Stored in a ref so a slow human typing doesn't drift the
 *     timestamp.
 *   - `signedByName` defaults to the logged-in user's `displayName`. PMs
 *     usually accept on behalf of the client, but the field is editable so
 *     a different name can be entered.
 *   - `signedBy.id` defaults to the logged-in user's `id` so the audit log
 *     ties back to the operator. If the dialog ever evolves to "accept on
 *     behalf of client X" we'd swap this to a contact-picker.
 *   - `signature` is free-form (URL or placeholder text) and optional.
 */
const AcceptDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    onConfirm: (payload: {
        signedAt: number;
        signedBy: { id: string; name: string };
        signature?: string;
    }) => Promise<void>;
    submitting: boolean;
    defaultSignerId: string;
    defaultSignerName: string;
}> = ({
    open,
    onClose,
    onConfirm,
    submitting,
    defaultSignerId,
    defaultSignerName,
}) => {
    const { control, handleSubmit, reset, watch } = useForm<AcceptFormFields>({
        mode: 'onChange',
        defaultValues: { signedByName: defaultSignerName, signature: '' },
    });

    // signedAt is captured at dialog-open time so it represents the user's
    // intent moment, not whenever the form happens to submit. Re-set on each
    // open so a re-opened dialog gets a fresh timestamp.
    const [signedAtMs, setSignedAtMs] = useState<number>(() => Date.now());
    useEffect(() => {
        if (open) {
            setSignedAtMs(Date.now());
            reset({ signedByName: defaultSignerName, signature: '' });
        }
    }, [open, reset, defaultSignerName]);

    // Live-watch for the submit-button disable (see BlockDialog comment).
    const signerName = watch('signedByName') ?? '';
    const signerValid = signerName.trim().length > 0;

    const submit = handleSubmit(async (data) => {
        const trimmedName = data.signedByName.trim();
        const trimmedSignature = data.signature.trim();
        await onConfirm({
            signedAt: signedAtMs,
            signedBy: {
                id: defaultSignerId,
                name: trimmedName,
            },
            signature: trimmedSignature.length > 0 ? trimmedSignature : undefined,
        });
    });

    return (
        <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Accept task</DialogTitle>
            <form onSubmit={submit}>
                <DialogContent dividers>
                    <DialogContentText sx={{ mb: 2 }}>
                        Confirm acceptance. The signed timestamp is captured
                        now ({dayjs(signedAtMs).format('MMM D, YYYY h:mm A')}).
                    </DialogContentText>
                    <Stack spacing={2}>
                        <Controller
                            name="signedByName"
                            control={control}
                            rules={{
                                required: 'Signer name is required',
                                validate: (value) =>
                                    value.trim().length > 0 ||
                                    'Signer name is required',
                            }}
                            render={({ field, fieldState }) => (
                                <TextField
                                    {...field}
                                    label="Signed by"
                                    placeholder="Client name (or your own)"
                                    fullWidth
                                    autoFocus
                                    required
                                    error={Boolean(fieldState.error)}
                                    helperText={
                                        fieldState.error?.message ??
                                        'Name printed on the acceptance act.'
                                    }
                                />
                            )}
                        />
                        <Controller
                            name="signature"
                            control={control}
                            render={({ field }) => (
                                <TextField
                                    {...field}
                                    label="Signature (optional)"
                                    placeholder="https://… or placeholder text"
                                    fullWidth
                                    helperText="URL of the signed PDF / image, or a free-form note. Can be filled later."
                                />
                            )}
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        variant="contained"
                        color="success"
                        disabled={!signerValid || submitting}
                    >
                        {submitting ? 'Accepting…' : 'Accept'}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

// ─── Page ───────────────────────────────────────────────────────────────

const TaskDetailPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { userProfile } = useAuth();

    const companyId = userProfile?.companyId ?? null;
    const taskId = id ?? null;

    const { task, loading, error, refetch } = useTask(taskId, companyId);
    const transitionTask = useTransitionTask();
    const [actionError, setActionError] = useState<string | null>(null);
    const [blockOpen, setBlockOpen] = useState<boolean>(false);
    const [acceptOpen, setAcceptOpen] = useState<boolean>(false);
    /**
     * Which transition button the user just clicked. We still disable every
     * action button while a mutation is in flight (prevents double-submits
     * across actions), but we render an inline spinner only next to this one
     * so the user can tell which action is pending. Cleared in a `useEffect`
     * once `transitionTask.loading` flips back to `false`.
     */
    const [pendingAction, setPendingAction] = useState<TransitionAction | null>(null);
    useEffect(() => {
        if (!transitionTask.loading) setPendingAction(null);
    }, [transitionTask.loading]);

    /**
     * Fire a transition with a fresh idempotency key. Surface backend errors
     * via `actionError` so the user sees them inline above the action bar.
     * Returns the boolean ok-ness so dialog callers can keep themselves open
     * on failure (keeps the user-typed reason / signer name intact).
     */
    const fireTransition = useCallback(
        async (
            action: TransitionAction,
            extras: {
                blockedReason?: string;
                acceptance?: {
                    signedAt: number;
                    signedBy: { id: string; name: string };
                    signature?: string;
                };
            } = {},
        ): Promise<boolean> => {
            if (!task || !companyId) return false;
            setActionError(null);
            // Track which action is in flight so the inline spinner renders
            // next to the right button. Cleared by the `useEffect` watcher on
            // `transitionTask.loading`.
            setPendingAction(action);
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
        [companyId, refetch, task, transitionTask],
    );

    const handleTransition = useCallback(
        (action: TransitionAction) => {
            // Block + accept require structured payloads — open their
            // dialogs instead of firing the transition directly. All other
            // actions go through with no extra payload.
            if (action === 'block') {
                setActionError(null);
                setBlockOpen(true);
                return;
            }
            if (action === 'accept') {
                setActionError(null);
                setAcceptOpen(true);
                return;
            }
            void fireTransition(action);
        },
        [fireTransition],
    );

    const handleBlockConfirm = useCallback(
        async (reason: string) => {
            const okFlag = await fireTransition('block', { blockedReason: reason });
            if (okFlag) setBlockOpen(false);
        },
        [fireTransition],
    );

    const handleAcceptConfirm = useCallback(
        async (payload: {
            signedAt: number;
            signedBy: { id: string; name: string };
            signature?: string;
        }) => {
            const okFlag = await fireTransition('accept', { acceptance: payload });
            if (okFlag) setAcceptOpen(false);
        },
        [fireTransition],
    );

    const allowedActions = useMemo<ReadonlyArray<TransitionAction>>(() => {
        if (!task) return [];
        return ALLOWED_ACTIONS[task.lifecycle] ?? [];
    }, [task]);

    // ─── Top bar (always visible — ties together loading + error states) ──
    const topBar = (
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
            <Stack direction="row" alignItems="center" spacing={1.5}>
                <Tooltip title="Back to task list">
                    <IconButton size="small" onClick={() => navigate('/crm/tasktotime/list')}>
                        <ArrowBackIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Breadcrumbs separator="/" sx={{ fontSize: '0.875rem' }}>
                    <MuiLink
                        component={RouterLink}
                        to="/crm/tasktotime/list"
                        underline="hover"
                        sx={{ color: '#6B7280', fontWeight: 500 }}
                    >
                        Tasktotime
                    </MuiLink>
                    <Typography variant="body2" sx={{ color: '#111827', fontWeight: 600 }}>
                        {task ? task.taskNumber : taskId ?? 'Task'}
                    </Typography>
                </Breadcrumbs>
            </Stack>

            <Tooltip title="Refresh">
                <span>
                    <IconButton
                        onClick={refetch}
                        disabled={loading}
                        size="small"
                        aria-label="Refresh task"
                    >
                        <RefreshIcon />
                    </IconButton>
                </span>
            </Tooltip>
        </Box>
    );

    // ─── Body ─────────────────────────────────────────────────────────────

    if (!companyId) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {topBar}
                <Box sx={{ flex: 1, p: 3 }}>
                    <Alert severity="warning">
                        Your user profile has no company. Please contact an administrator.
                    </Alert>
                </Box>
            </Box>
        );
    }

    if (!taskId) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {topBar}
                <Box sx={{ flex: 1, p: 3 }}>
                    <Alert severity="error">No task id supplied in the URL.</Alert>
                </Box>
            </Box>
        );
    }

    if (loading && !task) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {topBar}
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <CircularProgress />
                </Box>
            </Box>
        );
    }

    if (error && !task) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {topBar}
                <Box sx={{ flex: 1, p: 3 }}>
                    <Alert
                        severity="error"
                        action={
                            <Button color="inherit" size="small" onClick={refetch}>
                                Retry
                            </Button>
                        }
                    >
                        Failed to load task: {error.message}
                    </Alert>
                </Box>
            </Box>
        );
    }

    if (!task) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {topBar}
                <Box sx={{ flex: 1, p: 3 }}>
                    <Alert severity="info">Task not found.</Alert>
                </Box>
            </Box>
        );
    }

    const lifecycleStyle = LIFECYCLE_COLORS[task.lifecycle] ?? FALLBACK_CHIP;
    const priorityKey = resolvePriorityKey(task.priority);
    const priorityStyle = (priorityKey && PRIORITY_COLORS[priorityKey]) ?? FALLBACK_CHIP;
    const priorityLabel = priorityKey ?? String(task.priority ?? '—');

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {topBar}

            {/* Scrollable body — keep action bar pinned at bottom of viewport */}
            <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, md: 3 } }}>
                {/* Header */}
                <Box sx={{ mb: 3 }}>
                    <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1.5}
                        sx={{ mb: 1, flexWrap: 'wrap' }}
                    >
                        <Typography
                            variant="caption"
                            sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.85rem',
                                color: '#6B7280',
                                fontWeight: 600,
                            }}
                        >
                            {task.taskNumber}
                        </Typography>
                        <Chip
                            label={task.lifecycle}
                            size="small"
                            sx={{
                                bgcolor: lifecycleStyle.bg,
                                color: lifecycleStyle.fg,
                                fontWeight: 600,
                                textTransform: 'capitalize',
                            }}
                        />
                        <Chip
                            label={priorityLabel}
                            size="small"
                            sx={{
                                bgcolor: priorityStyle.bg,
                                color: priorityStyle.fg,
                                fontWeight: 600,
                                textTransform: 'capitalize',
                            }}
                        />
                        {task.isCriticalPath && (
                            <Chip
                                label="Critical path"
                                size="small"
                                sx={{
                                    bgcolor: '#FEE2E2',
                                    color: '#991B1B',
                                    fontWeight: 600,
                                }}
                            />
                        )}
                    </Stack>
                    <Typography
                        variant="h4"
                        component="h1"
                        sx={{
                            fontFamily:
                                '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
                            fontWeight: 700,
                            color: '#111827',
                            lineHeight: 1.2,
                        }}
                    >
                        {task.title}
                    </Typography>
                    {task.blockedReason && (
                        <Alert severity="warning" sx={{ mt: 2 }}>
                            <strong>Blocked:</strong> {task.blockedReason}
                        </Alert>
                    )}
                </Box>

                {/* Description */}
                {task.description && (
                    <Paper
                        elevation={0}
                        sx={{
                            p: 2,
                            mb: 3,
                            border: '1px solid #E5E7EB',
                            bgcolor: '#FFFFFF',
                        }}
                    >
                        <SectionTitle>Description</SectionTitle>
                        <Typography
                            variant="body2"
                            sx={{ color: '#374151', whiteSpace: 'pre-wrap' }}
                        >
                            {task.description}
                        </Typography>
                    </Paper>
                )}

                {/* Metadata grid */}
                <Paper
                    elevation={0}
                    sx={{
                        p: { xs: 2, md: 3 },
                        mb: 3,
                        border: '1px solid #E5E7EB',
                        bgcolor: '#FFFFFF',
                    }}
                >
                    <SectionTitle>Details</SectionTitle>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Assignees">{joinAssignees(task)}</MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Project">
                                {task.projectName ?? '—'}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Due">{formatDateTime(task.dueAt)}</MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Planned start">
                                {formatDateTime(task.plannedStartAt)}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Estimated duration">
                                {formatDuration(task.estimatedDurationMinutes)}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Actual duration">
                                {formatDuration(task.actualDurationMinutes)}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Critical path">
                                {task.isCriticalPath ? 'Yes' : 'No'}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Slack">
                                {formatDuration(task.slackMinutes)}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Created">
                                {formatDate(task.createdAt)} by {task.createdBy?.name ?? '—'}
                            </MetadataItem>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <MetadataItem label="Updated">
                                {formatDate(task.updatedAt)}
                            </MetadataItem>
                        </Grid>
                    </Grid>
                </Paper>

                {/* Dependencies */}
                <Paper
                    elevation={0}
                    sx={{
                        p: { xs: 2, md: 3 },
                        mb: 3,
                        border: '1px solid #E5E7EB',
                        bgcolor: '#FFFFFF',
                    }}
                >
                    <SectionTitle>Dependencies</SectionTitle>
                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: '#6B7280',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.5,
                                    display: 'block',
                                    mb: 1,
                                }}
                            >
                                Depends on
                            </Typography>
                            {task.dependsOn && task.dependsOn.length > 0 ? (
                                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                                    {task.dependsOn.map((dep: TaskDependencyDto) => (
                                        <DependencyChip
                                            key={`${dep.taskId}-${dep.type}`}
                                            taskId={dep.taskId}
                                            companyId={companyId}
                                            type={dep.type}
                                            tone="block"
                                        />
                                    ))}
                                </Stack>
                            ) : (
                                <Typography variant="body2" color="text.secondary">
                                    None
                                </Typography>
                            )}
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: '#6B7280',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.5,
                                    display: 'block',
                                    mb: 1,
                                }}
                            >
                                Blocks
                            </Typography>
                            {task.blocksTaskIds && task.blocksTaskIds.length > 0 ? (
                                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                                    {task.blocksTaskIds.map((blockedId: string) => (
                                        <DependencyChip
                                            key={blockedId}
                                            taskId={blockedId}
                                            companyId={companyId}
                                            tone="blocks"
                                        />
                                    ))}
                                </Stack>
                            ) : (
                                <Typography variant="body2" color="text.secondary">
                                    None
                                </Typography>
                            )}
                        </Grid>
                    </Grid>
                </Paper>

                {/* Wiki content (read-only — Markdown editor lands in PR 4.3).
                    When the task has no wiki content yet we still render the
                    section as a friendly empty state so the user knows the
                    surface exists and discovers the (still-disabled) editor
                    affordance — instead of the section silently disappearing. */}
                {task.wiki && task.wiki.contentMd ? (
                    <Paper
                        elevation={0}
                        sx={{
                            p: { xs: 2, md: 3 },
                            mb: 3,
                            border: '1px solid #E5E7EB',
                            bgcolor: '#FFFFFF',
                        }}
                    >
                        <Stack
                            direction="row"
                            alignItems="center"
                            justifyContent="space-between"
                            sx={{ mb: 1 }}
                        >
                            <SectionTitle>Wiki</SectionTitle>
                            <Typography variant="caption" color="text.secondary">
                                v{task.wiki.version} · updated {formatDate(task.wiki.updatedAt)}
                            </Typography>
                        </Stack>
                        <Box
                            component="pre"
                            sx={{
                                m: 0,
                                p: 2,
                                bgcolor: '#F9FAFB',
                                border: '1px solid #E5E7EB',
                                borderRadius: 1,
                                fontFamily:
                                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                fontSize: '0.85rem',
                                color: '#374151',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                overflowX: 'auto',
                            }}
                        >
                            {task.wiki.contentMd}
                        </Box>
                    </Paper>
                ) : (
                    <Paper
                        elevation={0}
                        sx={{
                            p: { xs: 2, md: 3 },
                            mb: 3,
                            border: '1px dashed #D1D5DB',
                            bgcolor: '#FFFFFF',
                        }}
                    >
                        <SectionTitle>Wiki</SectionTitle>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            alignItems={{ xs: 'flex-start', sm: 'center' }}
                            justifyContent="space-between"
                            spacing={2}
                        >
                            <Typography variant="body2" sx={{ color: '#4B5563' }}>
                                No wiki content yet. Edit to add notes.
                            </Typography>
                            <Tooltip title="Coming soon — Markdown editor lands in PR 4.3">
                                <span>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        disabled
                                        aria-label="Edit wiki (coming soon)"
                                        sx={{
                                            // WCAG 2.2 §2.5.8 — keep the
                                            // disabled affordance discoverable
                                            // without violating the 24×24
                                            // minimum target size.
                                            minHeight: 32,
                                        }}
                                    >
                                        Edit Wiki
                                    </Button>
                                </span>
                            </Tooltip>
                        </Stack>
                    </Paper>
                )}
            </Box>

            {/* Transition action bar — pinned to bottom */}
            <Box
                sx={{
                    flexShrink: 0,
                    borderTop: '1px solid #E0E0E0',
                    bgcolor: '#FFFFFF',
                    px: 3,
                    py: 1.5,
                }}
            >
                {actionError && (
                    <Alert
                        severity="error"
                        sx={{ mb: 1.5 }}
                        onClose={() => setActionError(null)}
                    >
                        {actionError}
                    </Alert>
                )}
                <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ flexWrap: 'wrap', gap: 1 }}
                    aria-busy={transitionTask.loading}
                >
                    <Typography
                        variant="caption"
                        sx={{
                            color: '#6B7280',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: 0.5,
                            mr: 1,
                        }}
                    >
                        Transitions
                    </Typography>
                    {allowedActions.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                            No further transitions available (terminal state).
                        </Typography>
                    ) : (
                        allowedActions.map((action) => {
                            // We still disable every button while one
                            // mutation is in flight (prevents racing two
                            // transitions). The spinner is rendered as an
                            // `endIcon` only on the active one — so the
                            // user can tell which click is pending.
                            const isThisPending =
                                transitionTask.loading && pendingAction === action;
                            return (
                                <Button
                                    key={action}
                                    size="small"
                                    variant={ACTION_VARIANTS[action]}
                                    color={ACTION_COLORS[action]}
                                    disabled={transitionTask.loading}
                                    onClick={() => handleTransition(action)}
                                    endIcon={
                                        isThisPending ? (
                                            <CircularProgress
                                                size={14}
                                                color="inherit"
                                                aria-label={`${ACTION_LABELS[action]} in progress`}
                                            />
                                        ) : undefined
                                    }
                                >
                                    {ACTION_LABELS[action]}
                                </Button>
                            );
                        })
                    )}
                </Stack>
            </Box>
            <Divider />

            {/* Block + Accept payload dialogs.
                Always mounted; visibility driven by `blockOpen` / `acceptOpen`
                state. Each dialog re-resets its form on open. */}
            <BlockDialog
                open={blockOpen}
                onClose={() => setBlockOpen(false)}
                onConfirm={handleBlockConfirm}
                submitting={transitionTask.loading}
            />
            <AcceptDialog
                open={acceptOpen}
                onClose={() => setAcceptOpen(false)}
                onConfirm={handleAcceptConfirm}
                submitting={transitionTask.loading}
                defaultSignerId={userProfile?.id ?? ''}
                defaultSignerName={userProfile?.displayName ?? ''}
            />
        </Box>
    );
};

export default TaskDetailPage;
