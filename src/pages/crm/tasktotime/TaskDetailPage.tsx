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

import React, { useCallback, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
    Alert,
    Box,
    Breadcrumbs,
    Button,
    Chip,
    CircularProgress,
    Divider,
    Grid,
    IconButton,
    Link as MuiLink,
    Paper,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import LinkIcon from '@mui/icons-material/Link';
import dayjs from 'dayjs';

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

const DependencyChip: React.FC<{ label: string; tone?: 'block' | 'blocks' }> = ({
    label,
    tone = 'block',
}) => (
    <Chip
        size="small"
        icon={<LinkIcon style={{ fontSize: 14 }} />}
        label={label}
        sx={{
            bgcolor: tone === 'block' ? '#EEF2FF' : '#FEF3C7',
            color: tone === 'block' ? '#3730A3' : '#92400E',
            fontFamily: 'monospace',
            fontSize: '0.75rem',
            fontWeight: 600,
            '& .MuiChip-icon': {
                color: 'inherit',
                marginLeft: '6px',
            },
        }}
    />
);

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

    const handleTransition = useCallback(
        async (action: TransitionAction) => {
            if (!task || !companyId) return;
            setActionError(null);
            try {
                await transitionTask.mutate({
                    taskId: task.id,
                    companyId,
                    input: {
                        action,
                        idempotencyKey:
                            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                                ? crypto.randomUUID()
                                : `transition-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    },
                });
                refetch();
            } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
            }
        },
        [companyId, refetch, task, transitionTask],
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
                    <IconButton onClick={refetch} disabled={loading} size="small">
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

    const lifecycleStyle = LIFECYCLE_COLORS[task.lifecycle];
    const priorityStyle = PRIORITY_COLORS[task.priority];

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
                            label={task.priority}
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
                                            label={`${dep.taskId} (${dep.type})`}
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
                                            label={blockedId}
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

                {/* Wiki content (read-only — Markdown editor lands in PR 4.3) */}
                {task.wiki && task.wiki.contentMd && (
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
                        allowedActions.map((action) => (
                            <Button
                                key={action}
                                size="small"
                                variant={ACTION_VARIANTS[action]}
                                color={ACTION_COLORS[action]}
                                disabled={transitionTask.loading}
                                onClick={() => handleTransition(action)}
                            >
                                {ACTION_LABELS[action]}
                            </Button>
                        ))
                    )}
                    {transitionTask.loading && (
                        <CircularProgress size={18} sx={{ ml: 1 }} />
                    )}
                </Stack>
            </Box>
            <Divider />
        </Box>
    );
};

export default TaskDetailPage;
