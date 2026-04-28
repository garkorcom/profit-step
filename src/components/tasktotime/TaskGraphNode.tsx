/**
 * @fileoverview Tasktotime — custom @xyflow/react node for the dependency graph.
 *
 * Renders a single task as an MUI Card with:
 *   - title + task number
 *   - lifecycle chip (matches TaskListPage colours so the graph visually
 *     maps to the list view a user just came from)
 *   - duration + slack metadata (read from the TaskDto fields we know are
 *     populated by the backend critical-path recompute)
 *   - critical-path treatment: thicker red border + red text on the slack
 *     readout when `isCriticalPath === true`
 *
 * Click the card → navigate to `/crm/tasktotime/tasks/:id`. We use
 * `useNavigate` rather than a `<Link>` wrapper because @xyflow/react manages
 * the wrapping div and intercepts events for drag/zoom; a plain anchor would
 * fight that. The whole card is a click target — safer for fingers on the
 * mobile pinch/zoom flow.
 *
 * Accessibility:
 *   - role="button" + tabIndex={0} so keyboard users can focus and Enter to
 *     navigate. The default React Flow `<Handle>` elements are decorative
 *     (we don't allow editing the graph), so they're hidden from AT via
 *     `aria-hidden`.
 *   - WCAG 2.2 §2.5.8: card minimum target is 200x80 — well above 24×24.
 *
 * @xyflow/react expects the `data` prop to be the type we plug into the
 * generic `<ReactFlow<NodeType, EdgeType>>` mount. We export `TaskGraphNodeData`
 * so the page can build typed `Node<TaskGraphNodeData>` instances without
 * losing inference.
 */

import React, { useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

import type { TaskLifecycle, TaskPriority } from '../../api/tasktotimeApi';

// ─── Visual tokens (mirrors TaskListPage so the graph nodes visually
// rhyme with the list a user just came from) ──────────────────────────────

const LIFECYCLE_COLORS: Record<TaskLifecycle, { bg: string; fg: string }> = {
    draft: { bg: '#F3F4F6', fg: '#6B7280' },
    ready: { bg: '#DBEAFE', fg: '#1E40AF' },
    started: { bg: '#FEF3C7', fg: '#92400E' },
    blocked: { bg: '#FEE2E2', fg: '#991B1B' },
    completed: { bg: '#DCFCE7', fg: '#166534' },
    accepted: { bg: '#D1FAE5', fg: '#064E3B' },
    cancelled: { bg: '#E5E7EB', fg: '#374151' },
};

const FALLBACK_CHIP = { bg: '#E5E7EB', fg: '#374151' };

// Critical path styling. Sourced from MUI red 700 — bright enough to read
// against pale lifecycle chip backgrounds, dark enough to pass WCAG 1.4.11
// non-text contrast against white card surfaces.
const CRITICAL_PATH_RED = '#D32F2F';

/**
 * Shape of the `data` payload we plug onto each @xyflow/react node.
 *
 * Kept narrow on purpose — the graph view doesn't need the full TaskDto and
 * we don't want to balloon the Flow internal store with fields it can't use.
 */
export interface TaskGraphNodeData extends Record<string, unknown> {
    taskId: string;
    title: string;
    taskNumber: string;
    lifecycle: TaskLifecycle;
    priority?: TaskPriority;
    estimatedDurationMinutes: number;
    slackMinutes: number;
    isCriticalPath: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Format a minute count into a compact human-readable label.
 *
 * Examples:
 *   45      -> "45m"
 *   60      -> "1h"
 *   90      -> "1h 30m"
 *   480     -> "8h"
 *   1440    -> "1d"
 *   2880    -> "2d"
 *
 * Days bucket at 8-hour workdays (industry-standard for construction
 * scheduling — mirrors how the backend critical-path computes shift bounds).
 * Stops at days; weeks/months would only confuse on a graph that's anchored
 * around dependency relationships, not calendar layout.
 */
function formatMinutes(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
    const HOUR = 60;
    const WORK_DAY = 8 * HOUR;
    if (minutes >= WORK_DAY) {
        const days = Math.floor(minutes / WORK_DAY);
        const remainderHours = Math.floor((minutes % WORK_DAY) / HOUR);
        if (remainderHours === 0) return `${days}d`;
        return `${days}d ${remainderHours}h`;
    }
    if (minutes >= HOUR) {
        const hours = Math.floor(minutes / HOUR);
        const remainder = minutes % HOUR;
        if (remainder === 0) return `${hours}h`;
        return `${hours}h ${remainder}m`;
    }
    return `${minutes}m`;
}

/**
 * Format a slack value. Negative slack means the task is over-committed —
 * surface that as "−Xh" so the operator notices at a glance.
 */
function formatSlack(minutes: number): string {
    if (!Number.isFinite(minutes)) return '—';
    if (minutes === 0) return '0m';
    if (minutes < 0) return `−${formatMinutes(Math.abs(minutes))}`;
    return formatMinutes(minutes);
}

// ─── Component ──────────────────────────────────────────────────────────

const TaskGraphNode: React.FC<NodeProps> = ({ data, selected }) => {
    const navigate = useNavigate();
    // Cast `data` from `Record<string, unknown>` (NodeProps default) to our
    // typed payload. The page-level <ReactFlow> mount feeds us this shape
    // verbatim — we own both ends of the contract.
    const nodeData = data as TaskGraphNodeData;

    const lifecycle =
        LIFECYCLE_COLORS[nodeData.lifecycle] ?? FALLBACK_CHIP;

    const handleOpen = useCallback(() => {
        navigate(`/crm/tasktotime/tasks/${nodeData.taskId}`);
    }, [navigate, nodeData.taskId]);

    /**
     * Keyboard navigation parity. @xyflow/react manages focus on the parent
     * wrapper for drag/select, but we want Enter/Space on the inner card to
     * route to the detail page (matches table row click in TaskListPage).
     */
    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleOpen();
            }
        },
        [handleOpen],
    );

    const isCritical = nodeData.isCriticalPath;
    const slackLabel = formatSlack(nodeData.slackMinutes);
    const slackColor = isCritical ? CRITICAL_PATH_RED : '#6B7280';
    const slackWeight = isCritical ? 700 : 500;

    // Border treatment:
    //   - default: 1px #E5E7EB (matches list view paper border)
    //   - selected: 2px #007AFF (MUI brand blue, picks up @xyflow/react's
    //     selection contract without us needing to wire a context provider)
    //   - critical path: 2px red, beats both default & selected because the
    //     scheduling signal trumps the UI focus signal on this view
    const borderWidth = isCritical || selected ? 2 : 1;
    const borderColor = isCritical
        ? CRITICAL_PATH_RED
        : selected
            ? '#007AFF'
            : '#E5E7EB';

    return (
        <>
            {/*
              Decorative handles — required by @xyflow/react so edges can
              attach. Hidden from AT (no semantic meaning to a screen reader),
              and kept tiny so they don't visually compete with the card body.
              We use Left/Right because the page lays out LR; if we ever
              switch to TB, the page-level layout will re-anchor edges
              automatically since dagre returns positioned coordinates.
            */}
            <Handle
                type="target"
                position={Position.Left}
                aria-hidden="true"
                style={{ background: '#9CA3AF', width: 6, height: 6 }}
            />
            <Card
                role="button"
                tabIndex={0}
                aria-label={`Open task ${nodeData.taskNumber}: ${nodeData.title}`}
                onClick={handleOpen}
                onKeyDown={handleKeyDown}
                elevation={0}
                sx={{
                    minWidth: 200,
                    maxWidth: 240,
                    minHeight: 80,
                    border: `${borderWidth}px solid ${borderColor}`,
                    bgcolor: '#FFFFFF',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s ease-in-out',
                    // WCAG 2.2 §2.4.11 — focus indicator must be visible &
                    // ≥2px. Use outline (not border) so the layout doesn't
                    // shift on focus.
                    '&:focus-visible': {
                        outline: '2px solid #007AFF',
                        outlineOffset: 2,
                    },
                    '&:hover': {
                        boxShadow:
                            '0 4px 12px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
                    },
                }}
            >
                <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
                    <Stack spacing={0.5}>
                        {/* Header row — task number + lifecycle */}
                        <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                            justifyContent="space-between"
                        >
                            <Typography
                                variant="caption"
                                sx={{
                                    fontFamily:
                                        '"SF Mono", Menlo, Consolas, monospace',
                                    color: '#6B7280',
                                    fontSize: '0.7rem',
                                }}
                            >
                                {nodeData.taskNumber}
                            </Typography>
                            <Chip
                                label={nodeData.lifecycle}
                                size="small"
                                sx={{
                                    bgcolor: lifecycle.bg,
                                    color: lifecycle.fg,
                                    fontWeight: 600,
                                    height: 18,
                                    fontSize: '0.65rem',
                                    textTransform: 'capitalize',
                                    '& .MuiChip-label': { px: 0.75 },
                                }}
                            />
                        </Stack>

                        {/* Title — clamped to 2 lines */}
                        <Typography
                            variant="body2"
                            fontWeight={600}
                            sx={{
                                fontSize: '0.8rem',
                                lineHeight: 1.3,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                color: '#111827',
                            }}
                        >
                            {nodeData.title}
                        </Typography>

                        {/* Duration + slack */}
                        <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ pt: 0.25 }}
                        >
                            <Typography
                                variant="caption"
                                sx={{ color: '#374151', fontSize: '0.7rem' }}
                            >
                                {formatMinutes(nodeData.estimatedDurationMinutes)}
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ color: '#D1D5DB', fontSize: '0.7rem' }}
                            >
                                |
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: slackColor,
                                    fontWeight: slackWeight,
                                    fontSize: '0.7rem',
                                }}
                                title={
                                    isCritical
                                        ? 'On critical path'
                                        : `Slack: ${slackLabel}`
                                }
                            >
                                {isCritical ? 'critical' : `slack ${slackLabel}`}
                            </Typography>
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>
            <Handle
                type="source"
                position={Position.Right}
                aria-hidden="true"
                style={{ background: '#9CA3AF', width: 6, height: 6 }}
            />
        </>
    );
};

export default TaskGraphNode;
