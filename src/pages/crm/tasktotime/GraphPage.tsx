/**
 * @fileoverview Tasktotime — Phase 4.5 dependency graph view.
 *
 * Mounts at `/crm/tasktotime/graph`. Shows the company's open task graph
 * with edges drawn from the canonical `dependsOn[].taskId` field, layouted
 * left-to-right via dagre, and rendered with @xyflow/react.
 *
 * ## Why this stack
 *
 *   - **@xyflow/react v12** is the actively-maintained successor to
 *     react-flow. v12 ships an improved type story (generic `<ReactFlow>`),
 *     React 19 compatibility, and built-in pan/zoom/fit-view controls. ~135KB
 *     gzipped — see PR description for the actual chunk size.
 *   - **dagre** is the smallest, most stable rank-based DAG layouter
 *     available on npm. It's deterministic, has no runtime peer deps, and
 *     runs in <50ms for the project sizes we care about (≤200 tasks).
 *
 * ## Layout direction
 *
 * We picked **LR (left-to-right)** because typical project flow reads as
 * "earlier work on the left, later work on the right" — matches how a PM
 * mentally narrates the project timeline. TB (top-down) would force horizontal
 * scrolling on wide monitors. If a future user study disagrees we can flip it
 * via the dagre `rankdir` setting without touching the rest of the page.
 *
 * ## Critical-path styling
 *
 * The backend's recompute job (PR-B5 in the wider tasktotime work) populates
 * `task.isCriticalPath` and `task.slackMinutes` on every recompute. We do
 * NOT recompute on the client — this view is a visualisation, not a
 * scheduler. Critical-path nodes get a thicker red border (handled inside
 * `TaskGraphNode`) and edges between two critical-path tasks render in red.
 *
 * ## Limitations (Phase 4.6 follow-up)
 *
 *   - Hard-coded fetch limit of 200 tasks. Above that, the dagre layout
 *     starts to take >100ms and the SVG render becomes pannable but visually
 *     overwhelming. Phase 4.6 will add either a project-scoped filter
 *     (most common workflow), pagination, or a different layout (e.g.
 *     elkjs for hierarchical compaction).
 *   - Doesn't include subtasks — `parentTaskId: null` filter scopes to
 *     top-level work only. Subtask graph is a separate view.
 *   - Edges use a simple "blocks" relationship (`A.blocksTaskIds` includes
 *     `B`). The wire `dependsOn[].type` field (`finish_to_start`,
 *     `start_to_start`, etc.) is not yet visualised.
 *   - No export-to-SVG — would be useful for printing site PM packets, but
 *     deferred to keep this PR scoped.
 */

import React, { useEffect, useMemo } from 'react';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
    ReactFlow,
    Background,
    BackgroundVariant,
    Controls,
    MarkerType,
    type Edge,
    type Node,
    type NodeTypes,
} from '@xyflow/react';
import dagre from 'dagre';

import '@xyflow/react/dist/style.css';

import { useAuth } from '../../../auth/AuthContext';
import { useTaskListPaginated } from '../../../hooks/useTasktotime';
import type {
    ListTasksParams,
    TaskBucket,
    TaskDto,
    TaskLifecycle,
    TaskPriority,
} from '../../../api/tasktotimeApi';
import TaskGraphNode, {
    type TaskGraphNodeData,
} from '../../../components/tasktotime/TaskGraphNode';

// ─── Layout constants ───────────────────────────────────────────────────

/**
 * Node bounding box passed to dagre. Should match the rendered card size
 * (see `TaskGraphNode` — minWidth/maxWidth/minHeight) within ~20px so
 * the layouter doesn't allocate dead space.
 */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;

/** Spacing between ranks (columns in LR). Matches MUI grid gutter rhythm. */
const RANK_SEP = 80;

/** Spacing between nodes in the same rank. */
const NODE_SEP = 30;

/** Critical path stroke colour — same red 700 the node border uses. */
const CRITICAL_PATH_RED = '#D32F2F';

/** Default edge stroke. Cool grey so non-critical relationships fade
 *  visually behind the critical path. */
const DEFAULT_EDGE_GREY = '#94A3B8';

/**
 * Hard cap on tasks fetched. We intentionally over-shoot the typical project
 * size (50–80 tasks) but stop short of the dagre layout's perf cliff.
 */
const FETCH_LIMIT = 200;

// ─── Reuse list-page filter parsing (URL-shareable view) ────────────────

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

// ─── Layout helpers ─────────────────────────────────────────────────────

interface LayoutResult {
    nodes: Node<TaskGraphNodeData>[];
    edges: Edge[];
}

/**
 * Build typed @xyflow/react `Node` / `Edge` arrays from the task list,
 * positioned by dagre.
 *
 * Edge contract: an edge `A -> B` means "A blocks B" (i.e. B has A in its
 * `dependsOn[]`, or equivalently A has B in its `blocksTaskIds`). We read
 * `dependsOn` because that's the canonical field the backend writes; the
 * `blocksTaskIds` reverse-index can drift if a recompute is mid-flight, and
 * relying on it would render stale arrows for a few seconds after an edit.
 *
 * Tasks referenced via `dependsOn` but missing from the fetched set
 * (e.g. archived, deleted, or beyond the FETCH_LIMIT cap) are silently
 * dropped from the edge list — drawing dangling edges is worse than just
 * not drawing them.
 */
function buildLayout(tasks: TaskDto[]): LayoutResult {
    const taskIds = new Set(tasks.map((t) => t.id));

    // 1. Build the dagre graph.
    const g = new dagre.graphlib.Graph<{}>({ multigraph: false, compound: false });
    g.setGraph({
        rankdir: 'LR',
        ranksep: RANK_SEP,
        nodesep: NODE_SEP,
        marginx: 20,
        marginy: 20,
    });
    // Required for dagre.layout to work — even though our edges hold no
    // metadata, the call signature wants a default-edge-label fn.
    g.setDefaultEdgeLabel(() => ({}));

    for (const task of tasks) {
        g.setNode(task.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    // 2. Collect edges. Each TaskDto.dependsOn entry implies an inbound
    // edge from `dep.taskId` -> task.id (because A is what we depend on,
    // and we read top-down in scheduling: predecessor -> successor).
    interface PreEdge {
        sourceId: string;
        targetId: string;
        sourceCritical: boolean;
        targetCritical: boolean;
    }
    const preEdges: PreEdge[] = [];
    const taskById = new Map(tasks.map((t) => [t.id, t] as const));
    for (const task of tasks) {
        const deps = task.dependsOn ?? [];
        for (const dep of deps) {
            if (!taskIds.has(dep.taskId)) continue; // dangling dep — drop
            const source = taskById.get(dep.taskId);
            if (!source) continue;
            preEdges.push({
                sourceId: dep.taskId,
                targetId: task.id,
                sourceCritical: source.isCriticalPath,
                targetCritical: task.isCriticalPath,
            });
            g.setEdge(dep.taskId, task.id);
        }
    }

    // 3. Run the layout. dagre mutates `g` in place — node coordinates
    // become available on `.x` / `.y` after this call.
    dagre.layout(g);

    // 4. Translate dagre output → @xyflow/react Node[] + Edge[].
    // dagre returns *centre* coordinates; @xyflow/react wants top-left.
    const positionedNodes: Node<TaskGraphNodeData>[] = tasks.map((task) => {
        const layoutNode = g.node(task.id);
        const x = (layoutNode?.x ?? 0) - NODE_WIDTH / 2;
        const y = (layoutNode?.y ?? 0) - NODE_HEIGHT / 2;
        return {
            id: task.id,
            type: 'task',
            position: { x, y },
            data: {
                taskId: task.id,
                title: task.title,
                taskNumber: task.taskNumber,
                lifecycle: task.lifecycle,
                priority:
                    typeof task.priority === 'string'
                        ? (task.priority as TaskPriority)
                        : undefined,
                estimatedDurationMinutes: task.estimatedDurationMinutes,
                slackMinutes: task.slackMinutes,
                isCriticalPath: task.isCriticalPath,
            },
            // We don't allow user-edits in this view — the graph is read-only.
            // `connectable: false` prevents the handle drag-to-create-edge
            // gesture; `draggable: true` is kept so the user can nudge nodes
            // away from each other when dagre's auto-layout overlaps a label.
            connectable: false,
            draggable: true,
        };
    });

    // Critical-path edges: both source AND target are on the critical path
    // AND they're directly adjacent. Promotes the visual to "this is the
    // path that controls finish date" rather than "any edge touching a
    // critical task".
    const builtEdges: Edge[] = preEdges.map((p, idx) => {
        const isCritical = p.sourceCritical && p.targetCritical;
        return {
            id: `e_${p.sourceId}__${p.targetId}_${idx}`,
            source: p.sourceId,
            target: p.targetId,
            // Smoothstep has a clean orthogonal feel that visually rhymes
            // with construction phase boundaries. Other choices (default
            // bezier, straight) all looked busier in the spike.
            type: 'smoothstep',
            animated: false,
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: isCritical ? CRITICAL_PATH_RED : DEFAULT_EDGE_GREY,
                width: 18,
                height: 18,
            },
            style: {
                stroke: isCritical ? CRITICAL_PATH_RED : DEFAULT_EDGE_GREY,
                strokeWidth: isCritical ? 2.5 : 1.5,
            },
        };
    });

    return { nodes: positionedNodes, edges: builtEdges };
}

// ─── Page ───────────────────────────────────────────────────────────────

/**
 * `nodeTypes` MUST be referentially stable across renders or @xyflow/react
 * issues a console warning ("nodeTypes/edgeTypes prop should be memoized").
 * Defining once at module scope is the cleanest fix.
 */
const NODE_TYPES: NodeTypes = {
    task: TaskGraphNode,
};

const GraphPage: React.FC = () => {
    const { userProfile } = useAuth();
    const companyId = userProfile?.companyId ?? null;

    const [searchParams] = useSearchParams();

    // Read filters from URL so a `/crm/tasktotime/graph?lifecycle=ready,started`
    // deep-link works the same as it does for the list view. We don't render a
    // <FilterBar> here yet — keeping the visible UI minimal while we validate
    // the layout. Filtering is still useful for project-scoped graphs you'd
    // want to share via URL.
    const apiParams: Omit<ListTasksParams, 'cursor'> | null = useMemo(() => {
        if (!companyId) return null;
        const lifecycle = parseCsv(searchParams.get('lifecycle'), LIFECYCLE_OPTIONS);
        // priority filter is server-unsupported — applied client-side in the
        // sibling memo below. We don't parse it here.
        const bucket = parseSingle(searchParams.get('bucket'), BUCKET_OPTIONS);
        const search = searchParams.get('search')?.trim() ?? '';
        const projectId = searchParams.get('projectId') ?? undefined;
        const clientId = searchParams.get('clientId') ?? undefined;

        const p: Omit<ListTasksParams, 'cursor'> = {
            companyId,
            parentTaskId: null,
            // The graph layout doesn't care about ordering — dagre lays out
            // by topological rank — but `createdAt` keeps fetches stable
            // across reloads (so dagre's deterministic layout produces the
            // same diagram for a given task set).
            orderBy: 'updatedAt',
            direction: 'desc',
            limit: FETCH_LIMIT,
        };
        if (lifecycle.length > 0) p.lifecycle = lifecycle;
        if (bucket) p.bucket = [bucket];
        if (search) p.search = search;
        if (projectId) p.projectId = projectId;
        if (clientId) p.clientId = clientId;
        // priority filter is server-unsupported — filtered client-side below
        return p;
    }, [companyId, searchParams]);

    const {
        tasks: rawTasks,
        loading,
        loadingInitial,
        error,
        refetch,
    } = useTaskListPaginated(apiParams);

    // Mirror TaskListPage's client-side priority filter (the backend
    // `GET /tasks` endpoint doesn't accept a priority param). When the
    // backend gains support, drop this and pass priority into apiParams.
    const tasks = useMemo(() => {
        const priority = parseCsv(searchParams.get('priority'), PRIORITY_OPTIONS);
        if (priority.length === 0) return rawTasks;
        const allowed = new Set(priority);
        return rawTasks.filter((t) => {
            const p = typeof t.priority === 'string' ? (t.priority as TaskPriority) : null;
            return p ? allowed.has(p) : false;
        });
    }, [rawTasks, searchParams]);

    // Layout is pure — recompute whenever the task set changes.
    const { nodes, edges } = useMemo(() => {
        if (tasks.length === 0) return { nodes: [], edges: [] };
        return buildLayout(tasks);
    }, [tasks]);

    /**
     * After a successful (re)layout, fit the viewport to the new bounds.
     * @xyflow/react's `<ReactFlow fitView>` prop handles the initial fit, but
     * subsequent task-set changes don't re-fit unless we force it. The
     * `fitViewOptions` keyed by node count is the simplest re-fit trigger
     * @xyflow/react provides without us reaching for the imperative API.
     */
    const fitViewKey = useMemo(() => `${nodes.length}_${edges.length}`, [
        nodes.length,
        edges.length,
    ]);

    // Pre-Phase 4.5 the route showed `<ComingSoonView label="Graph" />`. We
    // log on first mount so the deploy team can grep production for the
    // graph view rolling out — saves a Slack ping.
    useEffect(() => {
        // eslint-disable-next-line no-console
        console.info('[tasktotime/GraphPage] mounted (Phase 4.5)');
    }, []);

    // ── Renderers ──────────────────────────────────────────────────────

    if (!companyId) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning">
                    Your user profile has no company. Please contact an administrator.
                </Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Header — matches TaskListPage rhythm */}
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
                        Dependency Graph
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
                            {nodes.length} {nodes.length === 1 ? 'task' : 'tasks'}
                            {' · '}
                            {edges.length} {edges.length === 1 ? 'edge' : 'edges'}
                        </Box>
                    )}
                    {/* When the API returned exactly FETCH_LIMIT we very likely
                        truncated. The backend doesn't return total count, so we
                        can't show "X of Y" — just warn that more may exist. */}
                    {!loadingInitial && !error && tasks.length >= FETCH_LIMIT && (
                        <Box
                            role="status"
                            sx={{
                                bgcolor: '#FEF3C7',
                                color: '#92400E',
                                px: 1,
                                py: 0.25,
                                borderRadius: '12px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                            }}
                        >
                            Showing first {FETCH_LIMIT} — narrow with filters
                        </Box>
                    )}
                </Box>

                <Tooltip title="Refresh">
                    <span>
                        <IconButton
                            onClick={refetch}
                            disabled={loading}
                            size="small"
                            aria-label="Refresh dependency graph"
                        >
                            <RefreshIcon />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>

            {/* Body */}
            <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {loadingInitial ? (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <CircularProgress size={36} aria-label="Loading dependency graph" />
                    </Box>
                ) : error ? (
                    <Box sx={{ p: 3 }}>
                        <Alert
                            severity="error"
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
                    </Box>
                ) : nodes.length === 0 ? (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textAlign: 'center',
                            color: '#6B7280',
                            p: 4,
                        }}
                    >
                        <Typography variant="h6" fontWeight={600} gutterBottom>
                            No tasks to graph yet
                        </Typography>
                        <Typography variant="body2" sx={{ maxWidth: 480, mb: 3 }}>
                            Once tasks are created and linked via dependencies, they'll
                            show up here as a navigable graph.
                        </Typography>
                        <Button
                            component={RouterLink}
                            to="/crm/tasktotime/list"
                            variant="outlined"
                        >
                            Back to Task List
                        </Button>
                    </Box>
                ) : (
                    <ReactFlow
                        // `key` forces a re-mount when the task set changes —
                        // the simplest way to retrigger `fitView` without
                        // reaching for the imperative `useReactFlow` API.
                        key={fitViewKey}
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={NODE_TYPES}
                        fitView
                        fitViewOptions={{ padding: 0.15 }}
                        // Read-only graph: disable user-driven graph mutation
                        // gestures so the user can pan/zoom/select but not
                        // accidentally re-wire dependencies. Editing belongs
                        // in TaskDetailPage.
                        nodesConnectable={false}
                        edgesFocusable
                        // Selecting nodes is harmless (highlights the card)
                        // and useful for keyboard navigation, so leave it on.
                        nodesDraggable
                        // Default scroll-pan + ctrl/cmd-scroll-zoom feels
                        // wrong on a trackpad — invert so plain trackpad
                        // pinch zooms (most users' instinct).
                        panOnScroll
                        // Match the rest of the app's font for any built-in
                        // attribution / control labels @xyflow/react renders.
                        proOptions={{ hideAttribution: false }}
                        // Accessible default — viewport keyboard shortcuts
                        // are useful for power users navigating big graphs.
                        // Opting out of `selectionOnDrag` because trackpad
                        // users found it firing on accidental two-finger
                        // gestures during the spike.
                        selectionOnDrag={false}
                        // No `onNodeClick` handler at the page level — nodes
                        // own their own click→navigate behaviour inside the
                        // `<Card>` inside `TaskGraphNode`. @xyflow/react's
                        // default node-select behaviour (highlight on click)
                        // is fine to keep as-is.
                    >
                        <Background
                            variant={BackgroundVariant.Dots}
                            gap={20}
                            size={1}
                            color="#E5E7EB"
                        />
                        <Controls
                            showInteractive={false}
                            position="bottom-right"
                            aria-label="Graph viewport controls"
                        />
                    </ReactFlow>
                )}
            </Box>
        </Box>
    );
};

export default GraphPage;
