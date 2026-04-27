/**
 * @fileoverview Tasktotime — Task List view.
 *
 * Phase 4.2 adds filters / search / pagination on top of the foundation list:
 *   - Lifecycle multiselect (draft / ready / started / blocked / completed /
 *     accepted / cancelled).
 *   - Priority multiselect (critical / high / medium / low).
 *   - Bucket single-select (inbox / next / someday / archive — optional).
 *   - Search box (case-insensitive substring on title — server-side via
 *     `search` param).
 *   - Reset button to clear all filters.
 *   - "Load more" cursor-based pagination — append-on-click.
 *
 * URL contract (sharable links):
 *   ?lifecycle=ready,started&priority=high,medium&bucket=next&search=foo
 *
 * Form state owns the inputs (react-hook-form + Controller for MUI Select).
 * URL is the **source of truth** at mount; user input pushes form -> URL ->
 * data-fetch params (one cycle, no oscillation).
 *
 * Detail page / inline editing / drawer / kanban / wiki editor still live in
 * later PRs.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    OutlinedInput,
    Paper,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ClearIcon from '@mui/icons-material/Clear';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { useAuth } from '../../../auth/AuthContext';
import { useTaskListPaginated } from '../../../hooks/useTasktotime';
import type {
    ListTasksParams,
    TaskBucket,
    TaskDto,
    TaskLifecycle,
    TaskPriority,
} from '../../../api/tasktotimeApi';

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

function resolvePriorityKey(p: TaskDto['priority']): TaskPriority | undefined {
    if (typeof p === 'string') return p as TaskPriority;
    if (typeof p === 'number') return PRIORITY_INT_TO_STRING[p];
    return undefined;
}

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

const PAGE_SIZE = 50;

const SEARCH_DEBOUNCE_MS = 300;

function formatDate(epochMs?: number): string {
    if (!epochMs || !Number.isFinite(epochMs)) return '—';
    const d = new Date(epochMs);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function formatDueRelative(dueAt?: number): { label: string; color: string } {
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

const COLUMN_COUNT = 7;

// ─── URL <-> filter form state ──────────────────────────────────────────

interface FilterFormValues {
    lifecycle: TaskLifecycle[];
    priority: TaskPriority[];
    bucket: TaskBucket | '';
    search: string;
}

const EMPTY_FILTERS: FilterFormValues = {
    lifecycle: [],
    priority: [],
    bucket: '',
    search: '',
};

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

function readFiltersFromSearchParams(sp: URLSearchParams): FilterFormValues {
    return {
        lifecycle: parseCsv(sp.get('lifecycle'), LIFECYCLE_OPTIONS),
        priority: parseCsv(sp.get('priority'), PRIORITY_OPTIONS),
        bucket: parseSingle(sp.get('bucket'), BUCKET_OPTIONS),
        search: sp.get('search')?.trim() ?? '',
    };
}

function writeFiltersToSearchParams(
    sp: URLSearchParams,
    f: FilterFormValues,
): URLSearchParams {
    const next = new URLSearchParams(sp);
    if (f.lifecycle.length > 0) next.set('lifecycle', f.lifecycle.join(','));
    else next.delete('lifecycle');
    if (f.priority.length > 0) next.set('priority', f.priority.join(','));
    else next.delete('priority');
    if (f.bucket) next.set('bucket', f.bucket);
    else next.delete('bucket');
    if (f.search) next.set('search', f.search);
    else next.delete('search');
    return next;
}

function filtersAreEqual(a: FilterFormValues, b: FilterFormValues): boolean {
    if (a.bucket !== b.bucket) return false;
    if (a.search !== b.search) return false;
    if (a.lifecycle.length !== b.lifecycle.length) return false;
    if (a.priority.length !== b.priority.length) return false;
    for (const v of a.lifecycle) if (!b.lifecycle.includes(v)) return false;
    for (const v of a.priority) if (!b.priority.includes(v)) return false;
    return true;
}

function hasAnyFilter(f: FilterFormValues): boolean {
    return (
        f.lifecycle.length > 0 ||
        f.priority.length > 0 ||
        f.bucket !== '' ||
        f.search !== ''
    );
}

// ─── Row ────────────────────────────────────────────────────────────────

const TaskRow: React.FC<{ task: TaskDto; onOpen: (id: string) => void }> = ({
    task,
    onOpen,
}) => {
    const lifecycle = LIFECYCLE_COLORS[task.lifecycle] ?? FALLBACK_CHIP;
    const priorityKey = resolvePriorityKey(task.priority);
    const priority = (priorityKey && PRIORITY_COLORS[priorityKey]) ?? FALLBACK_CHIP;
    const priorityLabel = priorityKey ?? String(task.priority ?? '—');
    const due = formatDueRelative(task.dueAt);

    return (
        <TableRow
            hover
            onClick={() => onOpen(task.id)}
            sx={{ cursor: 'pointer', '&:last-child td': { borderBottom: 0 } }}
        >
            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#6B7280' }}>
                {task.taskNumber}
            </TableCell>
            <TableCell>
                <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 360 }}>
                    {task.title}
                </Typography>
                {task.projectName && (
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {task.projectName}
                    </Typography>
                )}
            </TableCell>
            <TableCell>
                <Chip
                    label={task.lifecycle}
                    size="small"
                    sx={{
                        bgcolor: lifecycle.bg,
                        color: lifecycle.fg,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                    }}
                />
            </TableCell>
            <TableCell>
                <Chip
                    label={priorityLabel}
                    size="small"
                    sx={{
                        bgcolor: priority.bg,
                        color: priority.fg,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                    }}
                />
            </TableCell>
            <TableCell>
                <Typography variant="body2">{task.assignedTo?.name ?? '—'}</Typography>
            </TableCell>
            <TableCell>
                <Typography variant="body2" sx={{ color: due.color, fontWeight: 500 }}>
                    {due.label}
                </Typography>
            </TableCell>
            <TableCell align="right" sx={{ width: 56 }}>
                <Tooltip title="Open">
                    <IconButton
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpen(task.id);
                        }}
                    >
                        <OpenInNewIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </TableCell>
        </TableRow>
    );
};

// ─── Filter bar ─────────────────────────────────────────────────────────

interface FilterBarProps {
    control: ReturnType<typeof useForm<FilterFormValues>>['control'];
    onReset: () => void;
    canReset: boolean;
}

const FilterBar: React.FC<FilterBarProps> = ({ control, onReset, canReset }) => {
    return (
        <Paper
            variant="outlined"
            sx={{ p: 2, mb: 2, bgcolor: '#FFFFFF', borderColor: '#E5E7EB' }}
        >
            <Grid container spacing={2} alignItems="center">
                <Grid size={{ xs: 12, md: 3 }}>
                    <Controller
                        name="lifecycle"
                        control={control}
                        render={({ field }) => (
                            <FormControl fullWidth size="small">
                                <InputLabel id="filter-lifecycle-label">Lifecycle</InputLabel>
                                <Select
                                    {...field}
                                    multiple
                                    labelId="filter-lifecycle-label"
                                    input={<OutlinedInput label="Lifecycle" />}
                                    renderValue={(selected) => (
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: 0.5,
                                            }}
                                        >
                                            {(selected as TaskLifecycle[]).map((value) => (
                                                <Chip
                                                    key={value}
                                                    label={value}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: LIFECYCLE_COLORS[value].bg,
                                                        color: LIFECYCLE_COLORS[value].fg,
                                                        textTransform: 'capitalize',
                                                        fontWeight: 600,
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    )}
                                >
                                    {LIFECYCLE_OPTIONS.map((opt) => (
                                        <MenuItem key={opt} value={opt}>
                                            <Box
                                                sx={{
                                                    display: 'inline-block',
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: '50%',
                                                    bgcolor: LIFECYCLE_COLORS[opt].fg,
                                                    mr: 1,
                                                }}
                                            />
                                            <span style={{ textTransform: 'capitalize' }}>
                                                {opt}
                                            </span>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                    />
                </Grid>

                <Grid size={{ xs: 12, md: 3 }}>
                    <Controller
                        name="priority"
                        control={control}
                        render={({ field }) => (
                            <FormControl fullWidth size="small">
                                <InputLabel id="filter-priority-label">Priority</InputLabel>
                                <Select
                                    {...field}
                                    multiple
                                    labelId="filter-priority-label"
                                    input={<OutlinedInput label="Priority" />}
                                    renderValue={(selected) => (
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: 0.5,
                                            }}
                                        >
                                            {(selected as TaskPriority[]).map((value) => (
                                                <Chip
                                                    key={value}
                                                    label={value}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: PRIORITY_COLORS[value].bg,
                                                        color: PRIORITY_COLORS[value].fg,
                                                        textTransform: 'capitalize',
                                                        fontWeight: 600,
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    )}
                                >
                                    {PRIORITY_OPTIONS.map((opt) => (
                                        <MenuItem key={opt} value={opt}>
                                            <Box
                                                sx={{
                                                    display: 'inline-block',
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: '50%',
                                                    bgcolor: PRIORITY_COLORS[opt].fg,
                                                    mr: 1,
                                                }}
                                            />
                                            <span style={{ textTransform: 'capitalize' }}>
                                                {opt}
                                            </span>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                    />
                </Grid>

                <Grid size={{ xs: 12, md: 2 }}>
                    <Controller
                        name="bucket"
                        control={control}
                        render={({ field }) => (
                            <FormControl fullWidth size="small">
                                <InputLabel id="filter-bucket-label">Bucket</InputLabel>
                                <Select
                                    {...field}
                                    labelId="filter-bucket-label"
                                    input={<OutlinedInput label="Bucket" />}
                                >
                                    <MenuItem value="">
                                        <em>Any</em>
                                    </MenuItem>
                                    {BUCKET_OPTIONS.map((opt) => (
                                        <MenuItem
                                            key={opt}
                                            value={opt}
                                            sx={{ textTransform: 'capitalize' }}
                                        >
                                            {opt}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                    />
                </Grid>

                <Grid size={{ xs: 12, md: 3 }}>
                    <Controller
                        name="search"
                        control={control}
                        render={({ field }) => (
                            <TextField
                                {...field}
                                fullWidth
                                size="small"
                                label="Search title"
                                placeholder="Substring match"
                                InputProps={{
                                    endAdornment: field.value ? (
                                        <IconButton
                                            size="small"
                                            onClick={() => field.onChange('')}
                                            aria-label="Clear search"
                                            edge="end"
                                        >
                                            <ClearIcon fontSize="small" />
                                        </IconButton>
                                    ) : null,
                                }}
                            />
                        )}
                    />
                </Grid>

                <Grid size={{ xs: 12, md: 1 }}>
                    <Button
                        variant="text"
                        onClick={onReset}
                        disabled={!canReset}
                        size="small"
                        fullWidth
                    >
                        Reset
                    </Button>
                </Grid>
            </Grid>
        </Paper>
    );
};

// ─── Page ───────────────────────────────────────────────────────────────

const TaskListPage: React.FC = () => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();

    const companyId = userProfile?.companyId ?? null;

    const [searchParams, setSearchParams] = useSearchParams();

    // Snapshot from URL — used to seed form defaults on mount.
    const initialFilters = useMemo(
        () => readFiltersFromSearchParams(searchParams),
        // Mount-time only; subsequent URL syncs go through the watch->URL
        // path. We don't want re-initialising the form on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    const { control, reset, getValues } = useForm<FilterFormValues>({
        defaultValues: initialFilters,
    });

    // Live-watched form values drive the API params + URL.
    const watched = useWatch({ control });

    // `watched` is `Partial<FilterFormValues>` from useWatch — normalise to
    // a fully-populated form value object.
    const liveFilters: FilterFormValues = useMemo(
        () => ({
            lifecycle: (watched.lifecycle ?? []) as TaskLifecycle[],
            priority: (watched.priority ?? []) as TaskPriority[],
            bucket: (watched.bucket ?? '') as TaskBucket | '',
            search: watched.search ?? '',
        }),
        [watched.lifecycle, watched.priority, watched.bucket, watched.search],
    );

    // Debounced version of `search` only — multi-selects + bucket should
    // react instantly, but typing every character firing the API is wasteful.
    //
    // IMPORTANT: seed from `initialFilters.search` (URL value at mount), NOT
    // from `liveFilters.search`. On cold-load with `?search=foo`, the form
    // is seeded from URL via `defaultValues`, but `useWatch`'s first emission
    // can briefly return the field as empty before settling. If we seeded
    // `debouncedSearch` from that empty snapshot, the form->URL effect would
    // commit it back and wipe `?search=foo` from the URL on first paint.
    const [debouncedSearch, setDebouncedSearch] = React.useState<string>(
        initialFilters.search,
    );
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(liveFilters.search), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [liveFilters.search]);

    // Sync form state -> URL. Skip the no-op case so the history doesn't
    // accumulate identical entries.
    const lastUrlRef = useRef<string>(searchParams.toString());
    // Skip the very first form->URL sync. Reasoning: on cold-load with a
    // deep-link like `?search=kitchen`, this effect fires once before
    // `useWatch` has settled, and the snapshot it builds may not yet
    // reflect the URL-seeded form values. Letting that first run write to
    // the URL can wipe legitimate URL params. The URL is already authoritative
    // at mount (we seeded the form from it) — there's nothing to sync on the
    // first render.
    const skipFirstFormToUrlSync = useRef<boolean>(true);
    useEffect(() => {
        if (skipFirstFormToUrlSync.current) {
            skipFirstFormToUrlSync.current = false;
            return;
        }
        // The URL contract uses the *committed* search value (debounced) to
        // avoid query-string churn on every keystroke.
        const filtersForUrl: FilterFormValues = {
            ...liveFilters,
            search: debouncedSearch,
        };
        const next = writeFiltersToSearchParams(searchParams, filtersForUrl);
        const nextStr = next.toString();
        if (nextStr !== lastUrlRef.current) {
            lastUrlRef.current = nextStr;
            setSearchParams(next, { replace: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        liveFilters.lifecycle,
        liveFilters.priority,
        liveFilters.bucket,
        debouncedSearch,
    ]);

    // Sync URL -> form (back/forward navigation, deep links).
    //
    // The `lastUrlRef` guard is important: when the form->URL effect writes
    // to the URL, this effect re-fires with the new `searchParams`. If we
    // didn't gate on `lastUrlRef`, we'd reset the form to match the URL we
    // just wrote — but the form's `search` field may already hold a newer
    // unconfirmed keystroke (debounce hasn't flushed yet), and the reset
    // would wipe it. Skipping when the URL matches what we wrote keeps the
    // form's live keystroke buffer intact. External URL changes (browser
    // back/forward, deep links) sail through.
    useEffect(() => {
        const currentUrlStr = searchParams.toString();
        if (currentUrlStr === lastUrlRef.current) return;
        lastUrlRef.current = currentUrlStr;
        const fromUrl = readFiltersFromSearchParams(searchParams);
        const current = getValues();
        if (!filtersAreEqual(fromUrl, current)) {
            reset(fromUrl, { keepDefaultValues: false });
            setDebouncedSearch(fromUrl.search);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Build API params from committed filters.
    //
    // Note on `priority`: the backend's `GET /tasks` filter shape (see
    // `ListTasksParams` in `src/api/tasktotimeApi.ts`) doesn't expose a
    // priority filter — only lifecycle / bucket / assignee / project / client /
    // dueBefore / search. We pass `priority` through the URL for sharability
    // and apply it client-side after the response (see `tasks` memo below).
    // When the backend adds a priority param, drop the client-side filter and
    // pass it through here.
    const apiParams: Omit<ListTasksParams, 'cursor'> | null = useMemo(() => {
        if (!companyId) return null;
        const p: Omit<ListTasksParams, 'cursor'> = {
            companyId,
            parentTaskId: null,
            orderBy: 'updatedAt',
            direction: 'desc',
            limit: PAGE_SIZE,
        };
        if (liveFilters.lifecycle.length > 0) p.lifecycle = liveFilters.lifecycle;
        if (liveFilters.bucket) p.bucket = [liveFilters.bucket];
        if (debouncedSearch) p.search = debouncedSearch;
        return p;
    }, [
        companyId,
        liveFilters.lifecycle,
        liveFilters.bucket,
        debouncedSearch,
    ]);

    const {
        tasks: rawTasks,
        nextCursor,
        loading,
        loadingInitial,
        loadingMore,
        error,
        refetch,
        loadMore,
    } = useTaskListPaginated(apiParams);

    // Client-side priority filter — see comment above. If/when the backend
    // adds a `priority` filter param on `GET /tasks`, drop this and pass
    // through via `apiParams`.
    const tasks = useMemo(() => {
        if (liveFilters.priority.length === 0) return rawTasks;
        const allowed = new Set(liveFilters.priority);
        return rawTasks.filter((t) => allowed.has(t.priority));
    }, [rawTasks, liveFilters.priority]);

    const handleOpen = useCallback(
        (taskId: string) => {
            navigate(`/crm/tasktotime/tasks/${taskId}`);
        },
        [navigate],
    );

    const handleReset = useCallback(() => {
        reset(EMPTY_FILTERS);
        setDebouncedSearch('');
    }, [reset]);

    const filtersActive = hasAnyFilter(liveFilters);

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
                        Task List
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

                <Tooltip title="Refresh">
                    <span>
                        <IconButton onClick={refetch} disabled={loading} size="small">
                            <RefreshIcon />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>

            {/* Body */}
            <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, md: 3 } }}>
                {!companyId ? (
                    <Alert severity="warning">
                        Your user profile has no company. Please contact an administrator.
                    </Alert>
                ) : (
                    <>
                        <FilterBar
                            control={control}
                            onReset={handleReset}
                            canReset={filtersActive}
                        />

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

                        <TableContainer
                            component={Paper}
                            elevation={0}
                            sx={{ border: '1px solid #E0E0E0' }}
                        >
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow
                                        sx={{
                                            '& th': { bgcolor: '#F9FAFB', fontWeight: 700 },
                                        }}
                                    >
                                        <TableCell sx={{ width: 100 }}>#</TableCell>
                                        <TableCell>Title</TableCell>
                                        <TableCell sx={{ width: 120 }}>Lifecycle</TableCell>
                                        <TableCell sx={{ width: 110 }}>Priority</TableCell>
                                        <TableCell sx={{ width: 180 }}>Assigned to</TableCell>
                                        <TableCell sx={{ width: 130 }}>Due</TableCell>
                                        <TableCell sx={{ width: 56 }} />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {loadingInitial ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={COLUMN_COUNT}
                                                align="center"
                                                sx={{ py: 6 }}
                                            >
                                                <CircularProgress size={28} />
                                            </TableCell>
                                        </TableRow>
                                    ) : tasks.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={COLUMN_COUNT}
                                                align="center"
                                                sx={{ py: 6 }}
                                            >
                                                <Typography
                                                    variant="body2"
                                                    color="text.secondary"
                                                >
                                                    {filtersActive
                                                        ? 'No tasks match the current filters.'
                                                        : 'No tasks yet. Create one via the API or wait for estimate decomposition to push tasks here.'}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        tasks.map((task) => (
                                            <TaskRow
                                                key={task.id}
                                                task={task}
                                                onOpen={handleOpen}
                                            />
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>

                        {/* Load more */}
                        {!loadingInitial && nextCursor && (
                            <Stack alignItems="center" sx={{ mt: 2 }}>
                                <Button
                                    variant="outlined"
                                    onClick={loadMore}
                                    disabled={loadingMore}
                                    startIcon={
                                        loadingMore ? (
                                            <CircularProgress size={16} />
                                        ) : undefined
                                    }
                                >
                                    {loadingMore ? 'Loading…' : 'Load more'}
                                </Button>
                            </Stack>
                        )}
                    </>
                )}
            </Box>
        </Box>
    );
};

export default TaskListPage;
