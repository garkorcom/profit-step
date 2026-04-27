/**
 * @fileoverview Tasktotime — Task List view.
 *
 * Phase 4.0 minimum-viable list. Renders rows from
 * `GET /api/tasktotime/tasks` with no filters, no search, no kanban — just a
 * table that proves the wiring (auth + API client + hook + types).
 *
 * Filters / search / inline editing / drawer / detail page / kanban / wiki
 * editor are explicit follow-up PRs. Each row IS a link to a `:id` page that
 * doesn't exist yet — clicking shows a placeholder; this is intentional, the
 * routing target is reserved here so the URL contract is stable across PRs.
 *
 * Empty / loading / error states all render in-table so the column widths
 * stay consistent (no layout shift between data states).
 */

import React from 'react';
import {
    Alert,
    Box,
    Chip,
    CircularProgress,
    IconButton,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../../auth/AuthContext';
import { useTaskList } from '../../../hooks/useTasktotime';
import type {
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

/**
 * Single row component — extracted for clarity. Also makes it trivial to add
 * row-level mutations (transition button, drawer trigger) in a follow-up
 * without touching the rest of the table.
 */
const TaskRow: React.FC<{ task: TaskDto; onOpen: (id: string) => void }> = ({
    task,
    onOpen,
}) => {
    const lifecycle = LIFECYCLE_COLORS[task.lifecycle];
    const priority = PRIORITY_COLORS[task.priority];
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
                    label={task.priority}
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

const TaskListPage: React.FC = () => {
    const { userProfile } = useAuth();
    const navigate = useNavigate();

    const companyId = userProfile?.companyId ?? null;

    // Phase 4.0 fixed filter: top-level, non-archived tasks for this company,
    // most-recent first. Filter UI is a follow-up PR.
    const { tasks, loading, error, refetch } = useTaskList(
        companyId
            ? {
                  companyId,
                  parentTaskId: null,
                  orderBy: 'updatedAt',
                  direction: 'desc',
                  limit: 100,
              }
            : null,
    );

    const handleOpen = (taskId: string) => {
        navigate(`/crm/tasktotime/tasks/${taskId}`);
    };

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
                    {!loading && !error && (
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

                        <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #E0E0E0' }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow sx={{ '& th': { bgcolor: '#F9FAFB', fontWeight: 700 } }}>
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
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ py: 6 }}>
                                                <CircularProgress size={28} />
                                            </TableCell>
                                        </TableRow>
                                    ) : tasks.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ py: 6 }}>
                                                <Typography variant="body2" color="text.secondary">
                                                    No tasks yet. Create one via the API or wait for
                                                    estimate decomposition to push tasks here.
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        tasks.map((task) => (
                                            <TaskRow key={task.id} task={task} onOpen={handleOpen} />
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </>
                )}
            </Box>
        </Box>
    );
};

export default TaskListPage;
