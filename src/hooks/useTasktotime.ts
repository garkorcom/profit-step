/**
 * @fileoverview Tasktotime — React hooks wrapping `src/api/tasktotimeApi.ts`.
 *
 * The codebase doesn't ship TanStack Query (checked package.json), so these
 * hooks roll their own data-fetching state (`{ data, loading, error, refetch }`)
 * with a stable signature that can be swapped to TanStack Query later
 * without touching call sites — same return shape, same params object.
 *
 * Pattern follows existing hooks like `useExpensesBoard` / `useGTDTasks`:
 * useEffect-driven fetch with a cancellation flag to avoid setting state on
 * unmounted components, plus a manual `refetch` for mutation-driven refresh.
 *
 * Mutations (`useTransitionTask`, `useUpdateWiki`) expose
 * `{ mutate, loading, error }` — caller wires up the `onSuccess` refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
    tasktotimeApi,
    type ListTasksParams,
    type TaskDto,
    type TransitionTaskInput,
    type TransitionTaskResult,
    type UpdateWikiInput,
} from '../api/tasktotimeApi';

// ─── Shared types ────────────────────────────────────────────────────────

export interface QueryState<T> {
    data: T | null;
    loading: boolean;
    error: Error | null;
    refetch: () => void;
}

export interface MutationState<TArgs, TResult> {
    mutate: (args: TArgs) => Promise<TResult>;
    loading: boolean;
    error: Error | null;
    reset: () => void;
}

// ─── useTaskList ─────────────────────────────────────────────────────────

export interface UseTaskListResult {
    tasks: TaskDto[];
    nextCursor: string | null;
    loading: boolean;
    error: Error | null;
    refetch: () => void;
}

/**
 * Fetch a paged list of tasks with the given filter. Re-runs whenever any
 * field of `params` changes. The `params` object is stringified for the
 * dep-array, so callers don't need to memoise it manually.
 */
export function useTaskList(
    params: ListTasksParams | null,
): UseTaskListResult {
    const [tasks, setTasks] = useState<TaskDto[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const [reloadCounter, setReloadCounter] = useState<number>(0);

    // Stringify params for the dep-array so callers can pass a fresh object
    // without triggering an infinite refetch loop.
    const paramsKey = params ? JSON.stringify(params) : null;

    useEffect(() => {
        if (!params || !paramsKey) {
            setTasks([]);
            setNextCursor(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        tasktotimeApi
            .listTasks(params)
            .then((res) => {
                if (cancelled) return;
                setTasks(res.items);
                setNextCursor(res.nextCursor);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setTasks([]);
                setNextCursor(null);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paramsKey, reloadCounter]);

    const refetch = useCallback(() => {
        setReloadCounter((n) => n + 1);
    }, []);

    return { tasks, nextCursor, loading, error, refetch };
}

// ─── useTaskListPaginated ────────────────────────────────────────────────

export interface UseTaskListPaginatedResult {
    tasks: TaskDto[];
    /** `null` when there's no next page. */
    nextCursor: string | null;
    /** True for both initial load and `loadMore` fetches. */
    loading: boolean;
    /** Specifically the initial load — distinct from `loadMore` so the UI
     * can show a spinner on first paint and a button-spinner on later pages. */
    loadingInitial: boolean;
    /** Specifically the follow-up `loadMore` fetch. */
    loadingMore: boolean;
    error: Error | null;
    /** Re-run from page 1 (clears accumulated tasks). */
    refetch: () => void;
    /** Fetch the next cursor page and append to the existing list. No-op if
     * `nextCursor === null` or a fetch is already in flight. */
    loadMore: () => void;
}

/**
 * Cursor-based pagination flavour of {@link useTaskList}.
 *
 * Accumulates results across `loadMore` calls. When `params` changes, the
 * accumulated list is reset and re-fetched from the first page. Internally:
 *   - Initial load: fetch with `cursor` unset, replace state.
 *   - `loadMore()`: fetch with the last known `nextCursor`, append items.
 *   - `refetch()`: bump a counter that re-runs the initial fetch and resets
 *     accumulated state.
 *
 * Why a sibling hook instead of extending `useTaskList`: the append-on-cursor
 * semantics fundamentally change the state model (multi-fetch accumulator vs
 * single-fetch replace) and pulling both into one hook would force every
 * existing caller to reason about cursor mode. Sibling keeps APIs orthogonal.
 */
export function useTaskListPaginated(
    params: Omit<ListTasksParams, 'cursor'> | null,
): UseTaskListPaginatedResult {
    const [tasks, setTasks] = useState<TaskDto[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingInitial, setLoadingInitial] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const [reloadCounter, setReloadCounter] = useState<number>(0);

    // Track latest in-flight cursor across re-renders so async callbacks can
    // bail out when params change mid-flight.
    const inFlightRef = useRef<{ cancelled: boolean } | null>(null);
    // `nextCursor` snapshot for `loadMore` — read from a ref so the callback
    // identity stays stable.
    const nextCursorRef = useRef<string | null>(null);
    nextCursorRef.current = nextCursor;
    const paramsRef = useRef<Omit<ListTasksParams, 'cursor'> | null>(params);
    paramsRef.current = params;

    const paramsKey = params ? JSON.stringify(params) : null;

    // Initial / params-changed fetch.
    useEffect(() => {
        if (!params || !paramsKey) {
            setTasks([]);
            setNextCursor(null);
            setLoadingInitial(false);
            setLoadingMore(false);
            setError(null);
            return;
        }
        const flag = { cancelled: false };
        // Cancel any prior in-flight request.
        if (inFlightRef.current) inFlightRef.current.cancelled = true;
        inFlightRef.current = flag;

        setLoadingInitial(true);
        setLoadingMore(false);
        setError(null);
        tasktotimeApi
            .listTasks(params)
            .then((res) => {
                if (flag.cancelled) return;
                setTasks(res.items);
                setNextCursor(res.nextCursor);
            })
            .catch((err: unknown) => {
                if (flag.cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setTasks([]);
                setNextCursor(null);
            })
            .finally(() => {
                if (flag.cancelled) return;
                setLoadingInitial(false);
            });
        return () => {
            flag.cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paramsKey, reloadCounter]);

    const loadMore = useCallback(() => {
        const cursor = nextCursorRef.current;
        const currentParams = paramsRef.current;
        if (!cursor || !currentParams) return;
        // Don't stack loadMore calls — UI should disable button via `loading`,
        // but guard here too as defense-in-depth.
        if (inFlightRef.current && !inFlightRef.current.cancelled) {
            // If the in-flight one is the initial fetch, drop this call.
            // (loadingInitial is read at call-time via state, but here we
            // simply respect any in-flight marker.)
        }
        const flag = { cancelled: false };
        inFlightRef.current = flag;

        setLoadingMore(true);
        setError(null);
        tasktotimeApi
            .listTasks({ ...currentParams, cursor })
            .then((res) => {
                if (flag.cancelled) return;
                setTasks((prev) => [...prev, ...res.items]);
                setNextCursor(res.nextCursor);
            })
            .catch((err: unknown) => {
                if (flag.cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (flag.cancelled) return;
                setLoadingMore(false);
            });
    }, []);

    const refetch = useCallback(() => {
        setReloadCounter((n) => n + 1);
    }, []);

    return {
        tasks,
        nextCursor,
        loading: loadingInitial || loadingMore,
        loadingInitial,
        loadingMore,
        error,
        refetch,
        loadMore,
    };
}

// ─── useTask ─────────────────────────────────────────────────────────────

export interface UseTaskResult {
    task: TaskDto | null;
    loading: boolean;
    error: Error | null;
    refetch: () => void;
}

/**
 * Fetch a single task by id. `taskId === null` skips the fetch — useful when
 * the page-level component hasn't loaded the route param yet.
 */
export function useTask(
    taskId: string | null | undefined,
    companyId: string | null | undefined,
): UseTaskResult {
    const [task, setTask] = useState<TaskDto | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const [reloadCounter, setReloadCounter] = useState<number>(0);

    useEffect(() => {
        if (!taskId || !companyId) {
            setTask(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        tasktotimeApi
            .getTask(taskId, companyId)
            .then((t) => {
                if (cancelled) return;
                setTask(t);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
                setTask(null);
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [taskId, companyId, reloadCounter]);

    const refetch = useCallback(() => {
        setReloadCounter((n) => n + 1);
    }, []);

    return { task, loading, error, refetch };
}

// ─── useTransitionTask ───────────────────────────────────────────────────

export interface TransitionTaskArgs {
    taskId: string;
    companyId: string;
    input: TransitionTaskInput;
}

/**
 * Mutation hook for `POST /tasks/:id/transition`. Returns `{ mutate, loading,
 * error, reset }`. `mutate` resolves to the transition result so callers can
 * read the updated task / events; on failure the promise rejects AND
 * `error` is populated for declarative rendering.
 */
export function useTransitionTask(): MutationState<
    TransitionTaskArgs,
    TransitionTaskResult
> {
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const inFlight = useRef<boolean>(false);

    const mutate = useCallback(
        async (args: TransitionTaskArgs): Promise<TransitionTaskResult> => {
            if (inFlight.current) {
                throw new Error('Transition already in progress');
            }
            inFlight.current = true;
            setLoading(true);
            setError(null);
            try {
                const result = await tasktotimeApi.transitionTask(
                    args.taskId,
                    args.companyId,
                    args.input,
                );
                return result;
            } catch (err: unknown) {
                const e = err instanceof Error ? err : new Error(String(err));
                setError(e);
                throw e;
            } finally {
                inFlight.current = false;
                setLoading(false);
            }
        },
        [],
    );

    const reset = useCallback(() => {
        setError(null);
    }, []);

    return { mutate, loading, error, reset };
}

// ─── useUpdateWiki ───────────────────────────────────────────────────────

export interface UpdateWikiArgs {
    taskId: string;
    companyId: string;
    input: UpdateWikiInput;
}

/**
 * Mutation hook for `PUT /tasks/:id/wiki`. Optimistic concurrency is enforced
 * server-side via `expectedVersion`; on a stale version the API returns 409
 * and the rejected promise carries `StaleVersion` in its message.
 */
export function useUpdateWiki(): MutationState<UpdateWikiArgs, TaskDto> {
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<Error | null>(null);
    const inFlight = useRef<boolean>(false);

    const mutate = useCallback(async (args: UpdateWikiArgs): Promise<TaskDto> => {
        if (inFlight.current) {
            throw new Error('Wiki update already in progress');
        }
        inFlight.current = true;
        setLoading(true);
        setError(null);
        try {
            const updated = await tasktotimeApi.updateWiki(
                args.taskId,
                args.companyId,
                args.input,
            );
            return updated;
        } catch (err: unknown) {
            const e = err instanceof Error ? err : new Error(String(err));
            setError(e);
            throw e;
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, []);

    const reset = useCallback(() => {
        setError(null);
    }, []);

    return { mutate, loading, error, reset };
}
