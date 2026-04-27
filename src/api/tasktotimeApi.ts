/**
 * @fileoverview Tasktotime — Frontend HTTP API client.
 *
 * Wraps the backend `/api/tasktotime/*` routes mounted on `agentApi`. Mirrors
 * the wire format from `tasktotime/adapters/http/handlers/*` and
 * `tasktotime/adapters/http/schemas.ts`.
 *
 * Auth pattern follows `src/api/dealsApi.ts`:
 *   - Firebase ID token in `Authorization: Bearer <token>`.
 *   - `x-company-id` header set to the caller's company scope (the upstream
 *     auth middleware uses this to populate `req.auth.companyId`).
 *
 * Wire types are intentionally redefined here (not imported from the
 * `tasktotime/` package) — that package has its own tsconfig + is excluded
 * from the root `src/` build. Keeping the frontend decoupled from the domain
 * source means we can change the domain implementation without rebuilding the
 * web bundle.
 */

import { getAuth } from 'firebase/auth';

const getApiUrl = (): string =>
    import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
    'https://us-central1-profit-step.cloudfunctions.net/agentApi';

async function authHeaders(companyId: string): Promise<Record<string, string>> {
    const token = await getAuth().currentUser?.getIdToken();
    if (!token) throw new Error('Not authenticated');
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-company-id': companyId,
    };
}

async function readErr(res: Response): Promise<string> {
    try {
        const body: unknown = await res.json();
        if (body && typeof body === 'object') {
            const obj = body as Record<string, unknown>;
            // tasktotime errors come as { ok: false, error: { code, message } }
            if (obj.error && typeof obj.error === 'object') {
                const err = obj.error as Record<string, unknown>;
                const message = typeof err.message === 'string' ? err.message : undefined;
                const code = typeof err.code === 'string' ? err.code : undefined;
                if (message) return code ? `${code}: ${message}` : message;
            }
            // Fallback (agentApi errors): { error, message }
            if (typeof obj.error === 'string') return obj.error;
            if (typeof obj.message === 'string') return obj.message;
        }
    } catch {
        // body wasn't JSON
    }
    return res.statusText || `HTTP ${res.status}`;
}

// ─── Wire types ─────────────────────────────────────────────────────────

export type TaskLifecycle =
    | 'draft'
    | 'ready'
    | 'started'
    | 'blocked'
    | 'completed'
    | 'accepted'
    | 'cancelled';

export type TransitionAction =
    | 'create'
    | 'ready'
    | 'start'
    | 'block'
    | 'unblock'
    | 'complete'
    | 'accept'
    | 'cancel';

export type TaskBucket = 'inbox' | 'next' | 'someday' | 'archive';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type TaskCategory = 'work' | 'punch' | 'inspection' | 'permit' | 'closeout';

export type TaskPhase = 'demo' | 'rough' | 'finish' | 'closeout';

export type TaskSource =
    | 'web'
    | 'telegram'
    | 'voice'
    | 'ai'
    | 'estimate_decompose'
    | 'api';

export type DependencyType =
    | 'finish_to_start'
    | 'start_to_start'
    | 'finish_to_finish'
    | 'start_to_finish';

export interface TaskMoney {
    amount: number;
    currency: 'USD' | 'RUB' | 'EUR';
}

export interface TaskUserRef {
    id: string;
    name: string;
    role?: 'executor' | 'reviewer' | 'observer';
}

export interface TaskDependencyDto {
    taskId: string;
    type: DependencyType;
    lagMinutes?: number;
    isHardBlock: boolean;
    reason?: string;
    createdAt: number;
    createdBy: TaskUserRef;
}

export interface SubtaskRollupDto {
    countByLifecycle: Partial<Record<TaskLifecycle, number>>;
    totalCostInternal: number;
    totalPriceClient: number;
    totalEstimatedMinutes: number;
    totalActualMinutes: number;
    completedFraction: number;
    earliestDueAt?: number;
    latestCompletedAt?: number;
    blockedCount: number;
}

export interface TaskWikiDto {
    contentMd: string;
    updatedAt: number;
    updatedBy: TaskUserRef;
    version: number;
}

export interface TaskHistoryEventDto {
    type: string;
    at: number;
    by: TaskUserRef;
    from?: TaskLifecycle | null;
    to?: TaskLifecycle;
    action?: string;
    reason?: string;
    meta?: Record<string, unknown>;
}

/**
 * Frontend-facing Task DTO. Mirrors `Task` from
 * `tasktotime/domain/Task.ts` but keeps optional fields broadly typed since
 * the wire format may evolve. Only fields used by the foundation list view
 * are mandatory — extend as more views land.
 */
export interface TaskDto {
    id: string;
    companyId: string;
    taskNumber: string;

    title: string;
    description?: string;
    memo?: string;

    lifecycle: TaskLifecycle;
    bucket: TaskBucket;
    priority: TaskPriority;
    blockedReason?: string;

    createdBy: TaskUserRef;
    assignedTo: TaskUserRef;
    reviewedBy?: TaskUserRef;
    coAssignees?: TaskUserRef[];
    requiredHeadcount: number;

    createdAt: number;
    updatedAt: number;
    plannedStartAt?: number;
    actualStartAt?: number;
    dueAt: number;
    completedAt?: number;
    acceptedAt?: number;
    estimatedDurationMinutes: number;
    actualDurationMinutes: number;

    dependsOn?: TaskDependencyDto[];
    blocksTaskIds?: string[];
    autoShiftEnabled: boolean;
    isCriticalPath: boolean;
    slackMinutes: number;

    parentTaskId?: string;
    isSubtask: boolean;
    subtaskIds: string[];
    subtaskRollup?: SubtaskRollupDto;
    category?: TaskCategory;
    phase?: TaskPhase;

    wiki?: TaskWikiDto;
    wikiInheritsFromParent: boolean;

    costInternal: TaskMoney;
    priceClient: TaskMoney;
    bonusOnTime?: TaskMoney;
    penaltyOverdue?: TaskMoney;
    totalEarnings: number;

    materialsCostPlanned: number;
    materialsCostActual: number;

    clientId?: string;
    clientName?: string;
    projectId?: string;
    projectName?: string;

    source: TaskSource;
    aiEstimateUsed: boolean;

    history: TaskHistoryEventDto[];

    clientVisible: boolean;
    internalOnly: boolean;

    archivedAt?: number;
    archivedBy?: string;
}

// ─── Request DTOs ───────────────────────────────────────────────────────

export interface ListTasksParams {
    companyId: string;
    lifecycle?: TaskLifecycle[];
    bucket?: TaskBucket[];
    assigneeId?: string;
    /**
     * `null` → top-level tasks only (parentTaskId is unset).
     * `string` → subtasks of that parent.
     */
    parentTaskId?: string | null;
    projectId?: string;
    clientId?: string;
    isSubtask?: boolean;
    archivedOnly?: boolean;
    dueBefore?: number;
    search?: string;
    limit?: number;
    cursor?: string;
    orderBy?: 'createdAt' | 'updatedAt' | 'dueAt' | 'priority' | 'taskNumber';
    direction?: 'asc' | 'desc';
}

export interface ListTasksResponse {
    items: TaskDto[];
    nextCursor: string | null;
}

export interface CreateTaskInput {
    idempotencyKey: string;
    companyId: string;
    title: string;
    description?: string;
    memo?: string;
    bucket: TaskBucket;
    priority: 0 | 1 | 2 | 3;
    source: TaskSource;
    requiredHeadcount: number;
    assignedTo: TaskUserRef;
    coAssignees?: TaskUserRef[];
    reviewedBy?: TaskUserRef;
    dueAt: number;
    plannedStartAt?: number;
    estimatedDurationMinutes: number;
    costInternal: TaskMoney;
    priceClient: TaskMoney;
    parentTaskId?: string;
    clientId?: string;
    clientName?: string;
    projectId?: string;
    projectName?: string;
    sourceEstimateId?: string;
    sourceEstimateItemId?: string;
    sourceNoteId?: string;
    clientVisible?: boolean;
    internalOnly?: boolean;
    initialLifecycle?: 'draft' | 'ready';
    linkedContactIds?: string[];
    category?: TaskCategory;
    phase?: TaskPhase;
}

export interface AcceptanceActInput {
    url: string;
    signedAt: number;
    signedBy: string;
    signedByName: string;
    notes?: string;
    photos?: string[];
}

export interface TransitionTaskInput {
    action: TransitionAction;
    idempotencyKey: string;
    reason?: string;
    blockedReason?: string;
    acceptance?: AcceptanceActInput;
}

export interface AddDependencyInput {
    toTaskId: string;
    type: DependencyType;
    isHardBlock: boolean;
    lagMinutes?: number;
    reason?: string;
}

export interface UpdateWikiInput {
    contentMd: string;
    expectedVersion: number;
    changeSummary?: string;
}

export interface TransitionTaskResult {
    task: TaskDto;
    events: unknown[];
    skipped?: boolean;
}

export interface RollupResponse {
    parentTaskId: string;
    rollup: SubtaskRollupDto;
}

// ─── API client ─────────────────────────────────────────────────────────

function buildListQuery(params: ListTasksParams): string {
    const qs = new URLSearchParams();
    qs.set('companyId', params.companyId);
    if (params.lifecycle && params.lifecycle.length > 0) {
        qs.set('lifecycle', params.lifecycle.join(','));
    }
    if (params.bucket && params.bucket.length > 0) {
        qs.set('bucket', params.bucket.join(','));
    }
    if (params.assigneeId) qs.set('assigneeId', params.assigneeId);
    if (params.parentTaskId === null) {
        qs.set('parentTaskId', 'null');
    } else if (typeof params.parentTaskId === 'string') {
        qs.set('parentTaskId', params.parentTaskId);
    }
    if (params.projectId) qs.set('projectId', params.projectId);
    if (params.clientId) qs.set('clientId', params.clientId);
    if (typeof params.isSubtask === 'boolean') {
        qs.set('isSubtask', String(params.isSubtask));
    }
    if (params.archivedOnly) qs.set('archivedOnly', 'true');
    if (typeof params.dueBefore === 'number') {
        qs.set('dueBefore', String(params.dueBefore));
    }
    if (params.search) qs.set('search', params.search);
    if (typeof params.limit === 'number') qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    if (params.orderBy) qs.set('orderBy', params.orderBy);
    if (params.direction) qs.set('direction', params.direction);
    return qs.toString();
}

export const tasktotimeApi = {
    /** `GET /api/tasktotime/tasks` */
    async listTasks(params: ListTasksParams): Promise<ListTasksResponse> {
        const url = `${getApiUrl()}/api/tasktotime/tasks?${buildListQuery(params)}`;
        const res = await fetch(url, { headers: await authHeaders(params.companyId) });
        if (!res.ok) throw new Error(await readErr(res));
        const body = (await res.json()) as {
            ok: boolean;
            items: TaskDto[];
            nextCursor: string | null;
        };
        return { items: body.items ?? [], nextCursor: body.nextCursor ?? null };
    },

    /** `GET /api/tasktotime/tasks/:id` */
    async getTask(taskId: string, companyId: string): Promise<TaskDto> {
        const url = `${getApiUrl()}/api/tasktotime/tasks/${encodeURIComponent(taskId)}`;
        const res = await fetch(url, { headers: await authHeaders(companyId) });
        if (!res.ok) throw new Error(await readErr(res));
        const body = (await res.json()) as { ok: boolean; task: TaskDto };
        return body.task;
    },

    /** `POST /api/tasktotime/tasks` */
    async createTask(input: CreateTaskInput): Promise<TaskDto> {
        const url = `${getApiUrl()}/api/tasktotime/tasks`;
        const res = await fetch(url, {
            method: 'POST',
            headers: await authHeaders(input.companyId),
            body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(await readErr(res));
        const body = (await res.json()) as { ok: boolean; task: TaskDto };
        return body.task;
    },

    /** `POST /api/tasktotime/tasks/:id/transition` */
    async transitionTask(
        taskId: string,
        companyId: string,
        input: TransitionTaskInput,
    ): Promise<TransitionTaskResult> {
        const url = `${getApiUrl()}/api/tasktotime/tasks/${encodeURIComponent(taskId)}/transition`;
        const res = await fetch(url, {
            method: 'POST',
            headers: await authHeaders(companyId),
            body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(await readErr(res));
        const body = (await res.json()) as TransitionTaskResult & { ok: boolean };
        return { task: body.task, events: body.events ?? [], skipped: body.skipped };
    },

    /** `POST /api/tasktotime/tasks/:id/dependencies` */
    async addDependency(
        fromTaskId: string,
        companyId: string,
        input: AddDependencyInput,
    ): Promise<void> {
        const url = `${getApiUrl()}/api/tasktotime/tasks/${encodeURIComponent(fromTaskId)}/dependencies`;
        const res = await fetch(url, {
            method: 'POST',
            headers: await authHeaders(companyId),
            body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(await readErr(res));
    },

    /** `PUT /api/tasktotime/tasks/:id/wiki` */
    async updateWiki(
        taskId: string,
        companyId: string,
        input: UpdateWikiInput,
    ): Promise<TaskDto> {
        const url = `${getApiUrl()}/api/tasktotime/tasks/${encodeURIComponent(taskId)}/wiki`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: await authHeaders(companyId),
            body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(await readErr(res));
        const body = (await res.json()) as { ok: boolean; task: TaskDto };
        return body.task;
    },

    /** `GET /api/tasktotime/tasks/:id/rollup` */
    async getRollup(
        taskId: string,
        companyId: string,
        opts: { includeArchived?: boolean } = {},
    ): Promise<RollupResponse> {
        const qs = new URLSearchParams();
        if (opts.includeArchived) qs.set('includeArchived', 'true');
        const url = `${getApiUrl()}/api/tasktotime/tasks/${encodeURIComponent(taskId)}/rollup${
            qs.toString() ? `?${qs}` : ''
        }`;
        const res = await fetch(url, { headers: await authHeaders(companyId) });
        if (!res.ok) throw new Error(await readErr(res));
        const body = (await res.json()) as {
            ok: boolean;
            parentTaskId: string;
            rollup: SubtaskRollupDto;
        };
        return { parentTaskId: body.parentTaskId, rollup: body.rollup };
    },
};

export type TasktotimeApi = typeof tasktotimeApi;
