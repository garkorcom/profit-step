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

/**
 * Parsed error payload returned by tasktotime / agentApi error responses.
 *
 * Both the tasktotime adapter shape (`{ ok: false, error: { code, message } }`)
 * and the agentApi fallback (`{ error, message }`) collapse to this object so
 * the call sites can switch on `code` without a second parser.
 */
interface ParsedApiError {
    message: string;
    /** Server-supplied error code. Non-null when the response shape exposed
     * one — e.g. tasktotime's `STALE_VERSION` / `NOT_FOUND` / `StaleVersion`. */
    code: string | null;
}

async function parseApiError(res: Response): Promise<ParsedApiError> {
    try {
        const body: unknown = await res.json();
        if (body && typeof body === 'object') {
            const obj = body as Record<string, unknown>;
            // tasktotime errors come as { ok: false, error: { code, message } }
            if (obj.error && typeof obj.error === 'object') {
                const err = obj.error as Record<string, unknown>;
                const message = typeof err.message === 'string' ? err.message : undefined;
                const code = typeof err.code === 'string' ? err.code : null;
                if (message) return { message, code };
            }
            // Fallback (agentApi errors): { error, message }
            if (typeof obj.error === 'string') return { message: obj.error, code: null };
            if (typeof obj.message === 'string') {
                return { message: obj.message, code: null };
            }
        }
    } catch {
        // body wasn't JSON
    }
    return {
        message: res.statusText || `HTTP ${res.status}`,
        code: null,
    };
}

/** Convenience wrapper retained for the existing throw-string call sites that
 * don't need the structured `code` (e.g. listTasks, getTask, transitionTask).
 * New call sites that need to distinguish error kinds should use
 * {@link parseApiError} + {@link TasktotimeApiError} instead. */
async function readErr(res: Response): Promise<string> {
    const parsed = await parseApiError(res);
    return parsed.code ? `${parsed.code}: ${parsed.message}` : parsed.message;
}

function mintIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `update-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Typed error thrown by API methods that need their callers to distinguish
 * outcomes by HTTP status / server-supplied `code`. Currently used by
 * {@link tasktotimeApi.updateWiki} so the wiki edit flow in `TaskDetailPage`
 * can detect a 409 `STALE_VERSION` / `StaleVersion` collision and prompt the
 * user to reload, instead of silently surfacing the message-as-string.
 *
 * Other call sites continue to throw a vanilla `Error` (string message); we
 * only pay the typed-error tax where it materially changes UX.
 */
export class TasktotimeApiError extends Error {
    /** HTTP status from the response. */
    readonly status: number;
    /** Server-supplied error code (e.g. `STALE_VERSION`, `StaleVersion`,
     * `NOT_FOUND`); `null` when the response didn't include one. */
    readonly code: string | null;

    constructor(status: number, code: string | null, message: string) {
        super(code ? `${code}: ${message}` : message);
        this.name = 'TasktotimeApiError';
        this.status = status;
        this.code = code;
    }

    /**
     * `true` when the response represents an optimistic-concurrency conflict
     * for a wiki update — i.e. HTTP 409 with a `STALE_VERSION` / `StaleVersion`
     * code. The two codes both reach 409 (adapter vs domain layer); we treat
     * them as the same UX-wise.
     */
    get isVersionConflict(): boolean {
        if (this.status !== 409) return false;
        return this.code === 'STALE_VERSION' || this.code === 'StaleVersion';
    }
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
    /**
     * Backend `parseCreateTaskBody` accepts either an integer 0..3 or the
     * string union (`'low' | 'medium' | 'high' | 'critical'`) — see
     * `tasktotime/adapters/http/schemas.ts`. Frontend dialogs send the
     * string form (per PR #82) since that's what the domain Task uses
     * internally; the int form remains for legacy callers / scripts.
     */
    priority: TaskPriority | 0 | 1 | 2 | 3;
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

/**
 * Wire-format for the `accept` transition payload. Mirrors the backend
 * `AcceptanceAct` in `tasktotime/domain/Task.ts`.
 *
 * Fields:
 *   - `signedAt` — epoch ms; usually `Date.now()` from the dialog.
 *   - `signedBy` — `{ id, name }` — collected from the current user OR
 *     entered by the operator on behalf of the client (PM signing while
 *     phoning the client, etc).
 *   - `signature` — optional free-form string. Today this is a placeholder
 *     URL; once we ship a real signing flow it'll be the URL of the uploaded
 *     PDF / image. Intentionally optional so the act can be filed first and
 *     the artefact attached later.
 */
export interface AcceptanceActInput {
    signedAt: number;
    signedBy: TaskUserRef;
    signature?: string;
}

export interface TransitionTaskInput {
    action: TransitionAction;
    idempotencyKey: string;
    reason?: string;
    /** Required when `action === 'block'`. Min length 5 chars (validated server-side). */
    blockedReason?: string;
    /** Required when `action === 'accept'`. */
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

/**
 * Whitelist of fields that may be patched via `PATCH /api/tasktotime/tasks/:id`.
 * Mirrors `tasktotime/adapters/http/schemas.ts:PATCHABLE_KEYS`. Lifecycle and
 * identity fields go through dedicated endpoints (`/transition`, `/wiki`).
 */
export interface PatchTaskUpdates {
    title?: string;
    description?: string;
    memo?: string;
    bucket?: TaskBucket;
    priority?: TaskPriority;
    blockedReason?: string;
    assignedTo?: TaskUserRef;
    reviewedBy?: TaskUserRef;
    coAssignees?: TaskUserRef[];
    requiredHeadcount?: number;
    linkedContactIds?: string[];
    plannedStartAt?: number | null;
    dueAt?: number | null;
    estimatedDurationMinutes?: number | null;
    autoShiftEnabled?: boolean;
    parentTaskId?: string | null;
    category?: string | null;
    phase?: string | null;
    clientId?: string | null;
    clientName?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    sourceEstimateId?: string | null;
    sourceEstimateItemId?: string | null;
    sourceNoteId?: string | null;
    linkedTaskIds?: string[];
    clientVisible?: boolean;
    internalOnly?: boolean;
}

export interface UpdateTaskInput {
    companyId: string;
    taskId: string;
    updates: PatchTaskUpdates;
    /** Caller may supply a key for de-duplication; otherwise we mint one. */
    idempotencyKey?: string;
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

    /**
     * `PUT /api/tasktotime/tasks/:id/wiki` — patch with optimistic concurrency.
     *
     * Throws {@link TasktotimeApiError} (not a plain Error) so the caller can
     * detect a 409 `STALE_VERSION` / `StaleVersion` collision via
     * `err.isVersionConflict` and prompt the user to reload the task. All
     * other failure modes still surface a typed error with the same shape —
     * call sites that don't care about the conflict path can read `err.message`
     * exactly like they would on a plain Error.
     */
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
        if (!res.ok) {
            const { code, message } = await parseApiError(res);
            throw new TasktotimeApiError(res.status, code, message);
        }
        const body = (await res.json()) as { ok: boolean; task: TaskDto };
        return body.task;
    },

    /**
     * `PATCH /api/tasktotime/tasks/:id` — partial update for non-state-machine
     * fields. Lifecycle transitions go through `transitionTask`; wiki edits
     * through `updateWiki`.
     *
     * The backend requires `idempotencyKey` (header or body). We generate one
     * when the caller doesn't supply it so a double-click on a Gantt drag
     * doesn't create two updates.
     */
    async updateTask(input: UpdateTaskInput): Promise<TaskDto> {
        const idempotencyKey = input.idempotencyKey ?? mintIdempotencyKey();
        const url = `${getApiUrl()}/api/tasktotime/tasks/${encodeURIComponent(input.taskId)}`;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: await authHeaders(input.companyId),
            body: JSON.stringify({ ...input.updates, idempotencyKey }),
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
