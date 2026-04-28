/**
 * @fileoverview Smoke tests for tasktotime hooks.
 *
 * Phase 4.0 minimum coverage: verify that
 *   - `useTaskList` calls the API with the right params and exposes the
 *     resulting items.
 *   - `useTaskList` short-circuits to an empty state when params is null
 *     (e.g. user without companyId).
 *   - `useTransitionTask.mutate` propagates results and surfaces errors.
 *
 * The hook layer is intentionally thin (no caching / no batching), so this
 * coverage is just a wiring sanity check — not a behavioural spec.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import {
    useTaskList,
    useTaskListPaginated,
    useTransitionTask,
    useUpdateWiki,
} from '../useTasktotime';
import type { TaskDto, TransitionTaskResult } from '../../api/tasktotimeApi';

// ─── Mocks ──────────────────────────────────────────────────────────────

const listTasks = jest.fn();
const transitionTask = jest.fn();
const updateWiki = jest.fn();

/**
 * The hook detects the conflict via
 * `instanceof TasktotimeApiError && err.isVersionConflict` — for the mock to
 * trigger the same branch the test must construct the *same* class identity
 * the hook imports. We define the mirror class inside the `jest.mock`
 * factory (so it's available at hoist-time), then re-import it through the
 * mocked module path in the test body. Both sides reference the same
 * constructor reference.
 */
jest.mock('../../api/tasktotimeApi', () => {
    class MockTasktotimeApiError extends Error {
        readonly status: number;
        readonly code: string | null;
        constructor(status: number, code: string | null, message: string) {
            super(code ? `${code}: ${message}` : message);
            this.name = 'TasktotimeApiError';
            this.status = status;
            this.code = code;
        }
        get isVersionConflict(): boolean {
            if (this.status !== 409) return false;
            return this.code === 'STALE_VERSION' || this.code === 'StaleVersion';
        }
    }
    return {
        tasktotimeApi: {
            listTasks: (...args: unknown[]) => listTasks(...args),
            transitionTask: (...args: unknown[]) => transitionTask(...args),
            updateWiki: (...args: unknown[]) => updateWiki(...args),
        },
        TasktotimeApiError: MockTasktotimeApiError,
    };
});

// Re-import the class through the mocked module so test code can construct
// the *exact* error type the hook checks `instanceof` against.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TasktotimeApiError } = require('../../api/tasktotimeApi') as {
    TasktotimeApiError: new (
        status: number,
        code: string | null,
        message: string,
    ) => Error & { status: number; code: string | null; isVersionConflict: boolean };
};

// ─── Fixtures ───────────────────────────────────────────────────────────

const sampleTask: TaskDto = {
    id: 'task_1',
    companyId: 'co_1',
    taskNumber: 'T-001',
    title: 'Sample task',
    lifecycle: 'ready',
    bucket: 'next',
    priority: 'medium',
    createdBy: { id: 'u_1', name: 'Owner' },
    assignedTo: { id: 'u_2', name: 'Worker' },
    requiredHeadcount: 1,
    createdAt: 0,
    updatedAt: 0,
    dueAt: 0,
    estimatedDurationMinutes: 60,
    actualDurationMinutes: 0,
    autoShiftEnabled: true,
    isCriticalPath: false,
    slackMinutes: 0,
    isSubtask: false,
    subtaskIds: [],
    wikiInheritsFromParent: false,
    costInternal: { amount: 0, currency: 'USD' },
    priceClient: { amount: 0, currency: 'USD' },
    totalEarnings: 0,
    materialsCostPlanned: 0,
    materialsCostActual: 0,
    source: 'web',
    aiEstimateUsed: false,
    history: [],
    clientVisible: false,
    internalOnly: false,
};

beforeEach(() => {
    listTasks.mockReset();
    transitionTask.mockReset();
    updateWiki.mockReset();
});

// ─── useTaskList ─────────────────────────────────────────────────────────

describe('useTaskList', () => {
    it('fetches tasks with the given params and exposes them', async () => {
        listTasks.mockResolvedValueOnce({ items: [sampleTask], nextCursor: null });

        const { result } = renderHook(() =>
            useTaskList({
                companyId: 'co_1',
                parentTaskId: null,
                orderBy: 'updatedAt',
                direction: 'desc',
                limit: 100,
            }),
        );

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(listTasks).toHaveBeenCalledWith(
            expect.objectContaining({
                companyId: 'co_1',
                parentTaskId: null,
                orderBy: 'updatedAt',
                direction: 'desc',
                limit: 100,
            }),
        );
        expect(result.current.tasks).toEqual([sampleTask]);
        expect(result.current.error).toBeNull();
    });

    it('skips fetch and resets state when params is null', () => {
        const { result } = renderHook(() => useTaskList(null));
        expect(result.current.loading).toBe(false);
        expect(result.current.tasks).toEqual([]);
        expect(result.current.error).toBeNull();
        expect(listTasks).not.toHaveBeenCalled();
    });

    it('captures an Error when the API rejects', async () => {
        listTasks.mockRejectedValueOnce(new Error('boom'));

        const { result } = renderHook(() =>
            useTaskList({ companyId: 'co_1', parentTaskId: null }),
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error?.message).toBe('boom');
        expect(result.current.tasks).toEqual([]);
    });
});

// ─── useTaskListPaginated ───────────────────────────────────────────────

describe('useTaskListPaginated', () => {
    it('dedupes by id when loadMore returns an overlapping page', async () => {
        // Initial fetch: two tasks
        const a = { ...sampleTask, id: 'a', taskNumber: 'T-001' };
        const b = { ...sampleTask, id: 'b', taskNumber: 'T-002' };
        // Cursor page overlaps `b` (race / retry / concurrent edit) and adds `c`.
        // The overlapping `b` carries a *newer* updatedAt to verify the dedupe
        // keeps the latest revision (Map insert order: prev first, then new).
        const bUpdated = { ...b, updatedAt: 999 };
        const c = { ...sampleTask, id: 'c', taskNumber: 'T-003' };

        listTasks
            .mockResolvedValueOnce({ items: [a, b], nextCursor: 'cur1' })
            .mockResolvedValueOnce({ items: [bUpdated, c], nextCursor: null });

        const { result } = renderHook(() =>
            useTaskListPaginated({
                companyId: 'co_1',
                parentTaskId: null,
                orderBy: 'updatedAt',
                direction: 'desc',
                limit: 50,
            }),
        );

        await waitFor(() => expect(result.current.loadingInitial).toBe(false));
        expect(result.current.tasks.map((t) => t.id)).toEqual(['a', 'b']);

        await act(async () => {
            result.current.loadMore();
        });
        await waitFor(() => expect(result.current.loadingMore).toBe(false));

        // Three distinct items, no duplicate `b`.
        expect(result.current.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
        // Latest revision wins.
        expect(result.current.tasks.find((t) => t.id === 'b')?.updatedAt).toBe(999);
    });

    it('drops a stacked loadMore call while a prior one is still in flight', async () => {
        const a = { ...sampleTask, id: 'a' };
        const b = { ...sampleTask, id: 'b' };
        const c = { ...sampleTask, id: 'c' };

        // Initial settles immediately. The first loadMore is gated on a manual
        // promise resolver so we can fire a second loadMore while it's
        // pending — the guard should drop the second.
        let resolveFirstLoadMore: (v: { items: TaskDto[]; nextCursor: string | null }) => void = () => {};
        const firstLoadMorePromise = new Promise<{
            items: TaskDto[];
            nextCursor: string | null;
        }>((resolve) => {
            resolveFirstLoadMore = resolve;
        });

        listTasks
            .mockResolvedValueOnce({ items: [a], nextCursor: 'cur1' })
            .mockReturnValueOnce(firstLoadMorePromise)
            .mockResolvedValueOnce({ items: [c], nextCursor: null });

        const { result } = renderHook(() =>
            useTaskListPaginated({
                companyId: 'co_1',
                parentTaskId: null,
                limit: 50,
            }),
        );

        await waitFor(() => expect(result.current.loadingInitial).toBe(false));
        expect(listTasks).toHaveBeenCalledTimes(1);

        // First loadMore: enters in-flight, awaits firstLoadMorePromise.
        act(() => {
            result.current.loadMore();
        });
        await waitFor(() => expect(result.current.loadingMore).toBe(true));
        expect(listTasks).toHaveBeenCalledTimes(2);

        // Second loadMore while the first is still pending — should be dropped
        // by the guard, no third API call.
        act(() => {
            result.current.loadMore();
        });
        expect(listTasks).toHaveBeenCalledTimes(2);

        // Resolve the first one and confirm the list grew correctly with no
        // duplicate fetch.
        await act(async () => {
            resolveFirstLoadMore({ items: [b], nextCursor: null });
        });
        await waitFor(() => expect(result.current.loadingMore).toBe(false));
        expect(result.current.tasks.map((t) => t.id)).toEqual(['a', 'b']);
        expect(listTasks).toHaveBeenCalledTimes(2);
    });
});

// ─── useTransitionTask ───────────────────────────────────────────────────

describe('useTransitionTask', () => {
    it('returns the transition result on success', async () => {
        const expected: TransitionTaskResult = {
            task: { ...sampleTask, lifecycle: 'started' },
            events: [],
            skipped: false,
        };
        transitionTask.mockResolvedValueOnce(expected);

        const { result } = renderHook(() => useTransitionTask());

        let res: TransitionTaskResult | undefined;
        await act(async () => {
            res = await result.current.mutate({
                taskId: 'task_1',
                companyId: 'co_1',
                input: { action: 'start', idempotencyKey: 'k_1' },
            });
        });

        expect(res).toEqual(expected);
        expect(transitionTask).toHaveBeenCalledWith('task_1', 'co_1', {
            action: 'start',
            idempotencyKey: 'k_1',
        });
        expect(result.current.error).toBeNull();
    });

    it('surfaces the error and rethrows when the API rejects', async () => {
        transitionTask.mockRejectedValueOnce(new Error('TransitionNotAllowed'));

        const { result } = renderHook(() => useTransitionTask());

        const caught: { err: Error | null } = { err: null };
        await act(async () => {
            try {
                await result.current.mutate({
                    taskId: 'task_1',
                    companyId: 'co_1',
                    input: { action: 'start', idempotencyKey: 'k_2' },
                });
            } catch (err) {
                caught.err = err instanceof Error ? err : new Error(String(err));
            }
        });

        expect(caught.err).toBeInstanceOf(Error);
        expect(caught.err?.message).toBe('TransitionNotAllowed');
        expect(result.current.error?.message).toBe('TransitionNotAllowed');
    });

    // Coverage for block / accept payloads added to fix the silent-400 bug
    // in `TaskDetailPage`. The hook itself is just a passthrough — these
    // tests exist to lock the wire shape so a future schema rename breaks
    // them loudly instead of silently returning 400 again.
    it('forwards a `block` payload with `blockedReason` to the API', async () => {
        transitionTask.mockResolvedValueOnce({
            task: { ...sampleTask, lifecycle: 'blocked' },
            events: [],
            skipped: false,
        });

        const { result } = renderHook(() => useTransitionTask());

        await act(async () => {
            await result.current.mutate({
                taskId: 'task_1',
                companyId: 'co_1',
                input: {
                    action: 'block',
                    idempotencyKey: 'k_block',
                    blockedReason: 'Waiting on permit committee approval',
                },
            });
        });

        expect(transitionTask).toHaveBeenCalledWith('task_1', 'co_1', {
            action: 'block',
            idempotencyKey: 'k_block',
            blockedReason: 'Waiting on permit committee approval',
        });
    });

    it('forwards an `accept` payload with `acceptance` to the API', async () => {
        transitionTask.mockResolvedValueOnce({
            task: { ...sampleTask, lifecycle: 'accepted' },
            events: [],
            skipped: false,
        });

        const { result } = renderHook(() => useTransitionTask());

        const acceptance = {
            signedAt: 1_700_000_000_000,
            signedBy: { id: 'client_jim', name: 'Jim Dvorkin' },
            signature: 'https://example.com/act.pdf',
        };

        await act(async () => {
            await result.current.mutate({
                taskId: 'task_1',
                companyId: 'co_1',
                input: {
                    action: 'accept',
                    idempotencyKey: 'k_accept',
                    acceptance,
                },
            });
        });

        expect(transitionTask).toHaveBeenCalledWith('task_1', 'co_1', {
            action: 'accept',
            idempotencyKey: 'k_accept',
            acceptance,
        });
    });
});

// ─── useUpdateWiki ──────────────────────────────────────────────────────

describe('useUpdateWiki', () => {
    it('returns the updated task on success and forwards the wire payload', async () => {
        const updated: TaskDto = {
            ...sampleTask,
            wiki: {
                contentMd: '# Hello',
                version: 2,
                updatedAt: 1_700_000_000_000,
                updatedBy: { id: 'u_1', name: 'Owner' },
            },
        };
        updateWiki.mockResolvedValueOnce(updated);

        const { result } = renderHook(() => useUpdateWiki());

        let res: TaskDto | undefined;
        await act(async () => {
            res = await result.current.mutate({
                taskId: 'task_1',
                companyId: 'co_1',
                input: { contentMd: '# Hello', expectedVersion: 1 },
            });
        });

        expect(res).toBe(updated);
        expect(updateWiki).toHaveBeenCalledWith('task_1', 'co_1', {
            contentMd: '# Hello',
            expectedVersion: 1,
        });
        expect(result.current.error).toBeNull();
        expect(result.current.conflict).toBe(false);
    });

    it('flags `conflict` when the API rejects with a 409 STALE_VERSION', async () => {
        // Adapter-layer code path (`STALE_VERSION` upper-snake).
        updateWiki.mockRejectedValueOnce(
            new TasktotimeApiError(
                409,
                'STALE_VERSION',
                'expectedVersion 1 is stale; current is 3',
            ),
        );

        const { result } = renderHook(() => useUpdateWiki());

        const caught: { err: Error | null } = { err: null };
        await act(async () => {
            try {
                await result.current.mutate({
                    taskId: 'task_1',
                    companyId: 'co_1',
                    input: { contentMd: '# stale', expectedVersion: 1 },
                });
            } catch (err) {
                caught.err = err instanceof Error ? err : new Error(String(err));
            }
        });

        expect(caught.err).toBeInstanceOf(TasktotimeApiError);
        expect(result.current.conflict).toBe(true);
        expect(result.current.error?.message).toContain('STALE_VERSION');
    });

    it('also recognises the domain-layer `StaleVersion` code as a conflict', async () => {
        // Domain-layer code path (`StaleVersion` PascalCase) — same 409
        // status, different code spelling. UX should be identical.
        updateWiki.mockRejectedValueOnce(
            new TasktotimeApiError(409, 'StaleVersion', 'version mismatch'),
        );

        const { result } = renderHook(() => useUpdateWiki());

        await act(async () => {
            try {
                await result.current.mutate({
                    taskId: 'task_1',
                    companyId: 'co_1',
                    input: { contentMd: '# stale', expectedVersion: 1 },
                });
            } catch {
                // expected
            }
        });

        expect(result.current.conflict).toBe(true);
    });

    it('does NOT flag `conflict` for non-409 failures', async () => {
        updateWiki.mockRejectedValueOnce(
            new TasktotimeApiError(403, 'PERMISSION_DENIED', 'no access'),
        );

        const { result } = renderHook(() => useUpdateWiki());

        await act(async () => {
            try {
                await result.current.mutate({
                    taskId: 'task_1',
                    companyId: 'co_1',
                    input: { contentMd: '# x', expectedVersion: 0 },
                });
            } catch {
                // expected
            }
        });

        expect(result.current.conflict).toBe(false);
        expect(result.current.error?.message).toContain('PERMISSION_DENIED');
    });

    it('clears `conflict` and `error` on `reset()`', async () => {
        updateWiki.mockRejectedValueOnce(
            new TasktotimeApiError(409, 'STALE_VERSION', 'stale'),
        );

        const { result } = renderHook(() => useUpdateWiki());

        await act(async () => {
            try {
                await result.current.mutate({
                    taskId: 'task_1',
                    companyId: 'co_1',
                    input: { contentMd: '# x', expectedVersion: 1 },
                });
            } catch {
                // expected
            }
        });

        expect(result.current.conflict).toBe(true);
        expect(result.current.error).not.toBeNull();

        act(() => {
            result.current.reset();
        });

        expect(result.current.conflict).toBe(false);
        expect(result.current.error).toBeNull();
    });
});
