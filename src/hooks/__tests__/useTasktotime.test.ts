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

import { useTaskList, useTransitionTask } from '../useTasktotime';
import type { TaskDto, TransitionTaskResult } from '../../api/tasktotimeApi';

// ─── Mocks ──────────────────────────────────────────────────────────────

const listTasks = jest.fn();
const transitionTask = jest.fn();

jest.mock('../../api/tasktotimeApi', () => ({
    tasktotimeApi: {
        listTasks: (...args: unknown[]) => listTasks(...args),
        transitionTask: (...args: unknown[]) => transitionTask(...args),
    },
}));

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
});
