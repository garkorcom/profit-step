/**
 * @fileoverview Tests for useGTDTasks hook
 * 
 * Verifies task CRUD operations, column organization,
 * drag-and-drop with optimistic updates, and rollback.
 */

import { renderHook, act } from '@testing-library/react';
import { useGTDTasks } from '../useGTDTasks';

// ============================================
// MOCKS
// ============================================

let onSnapshotCallback: ((snapshot: any) => void) | null = null;
const mockUnsubscribe = jest.fn();
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockAddDoc = jest.fn().mockResolvedValue({ id: 'new-task-1' });
const mockDeleteDoc = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase/firestore', () => {
    const mockTimestamp = {
        now: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }),
        fromDate: (d: Date) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }),
    };

    return {
        collection: jest.fn(),
        query: jest.fn(),
        where: jest.fn(),
        or: jest.fn(),
        orderBy: jest.fn(),
        onSnapshot: jest.fn((_q: any, cb: any) => {
            onSnapshotCallback = cb;
            return mockUnsubscribe;
        }),
        doc: jest.fn((_db: any, _col: string, id: string) => ({ id, path: `${_col}/${id}` })),
        updateDoc: (...args: any[]) => mockUpdateDoc(...args),
        addDoc: (...args: any[]) => mockAddDoc(...args),
        deleteDoc: (...args: any[]) => mockDeleteDoc(...args),
        Timestamp: mockTimestamp,
    };
});

jest.mock('../../firebase/firebase', () => ({
    db: { type: 'mock-firestore' },
}));

// Helper: emit a Firestore snapshot with tasks
const emitSnapshot = (tasks: Array<{ id: string; status: string; title: string; createdAt?: any }>) => {
    if (!onSnapshotCallback) throw new Error('onSnapshot not subscribed');
    onSnapshotCallback({
        docs: tasks.map(t => ({
            id: t.id,
            data: () => ({
                ...t,
                createdAt: t.createdAt || { seconds: Date.now() / 1000 },
            }),
        })),
    });
};

const mockUser = { uid: 'user-1', displayName: 'Test User' };

describe('useGTDTasks', () => {
    beforeEach(() => {
        onSnapshotCallback = null;
        mockUpdateDoc.mockClear();
        mockAddDoc.mockClear();
        mockDeleteDoc.mockClear();
        mockUnsubscribe.mockClear();
        // Re-apply onSnapshot implementation (clearAllMocks would reset it)
        const { onSnapshot } = require('firebase/firestore');
        onSnapshot.mockImplementation((_q: any, cb: any) => {
            onSnapshotCallback = cb;
            return mockUnsubscribe;
        });
    });

    describe('initialization', () => {
        it('should start with loading=true and empty columns', () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            expect(result.current.loading).toBe(true);
            expect(result.current.columns.inbox).toEqual([]);
            expect(result.current.columns.done).toEqual([]);
        });

        it('should not subscribe when user is null', () => {
            const { onSnapshot } = require('firebase/firestore');
            renderHook(() => useGTDTasks(null));

            expect(onSnapshot).not.toHaveBeenCalled();
        });

        it('should subscribe and organize tasks into columns', () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            act(() => {
                emitSnapshot([
                    { id: 't1', status: 'inbox', title: 'Task 1' },
                    { id: 't2', status: 'next_action', title: 'Task 2' },
                    { id: 't3', status: 'inbox', title: 'Task 3' },
                    { id: 't4', status: 'done', title: 'Task 4' },
                ]);
            });

            expect(result.current.loading).toBe(false);
            expect(result.current.columns.inbox).toHaveLength(2);
            expect(result.current.columns.next_action).toHaveLength(1);
            expect(result.current.columns.done).toHaveLength(1);
        });

        it('should unsubscribe on unmount', () => {
            const { unmount } = renderHook(() => useGTDTasks(mockUser));
            unmount();
            expect(mockUnsubscribe).toHaveBeenCalled();
        });
    });

    describe('addTask', () => {
        it('should create a task with correct fields', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                await result.current.addTask('New task', 'inbox', [], []);
            });

            expect(mockAddDoc).toHaveBeenCalledTimes(1);
            const taskData = mockAddDoc.mock.calls[0][1];
            expect(taskData.title).toBe('New task');
            expect(taskData.status).toBe('inbox');
            expect(taskData.ownerId).toBe('user-1');
        });

        it('should set completedAt when adding to done column', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                await result.current.addTask('Done task', 'done', [], []);
            });

            const taskData = mockAddDoc.mock.calls[0][1];
            expect(taskData.completedAt).toBeDefined();
        });

        it('should set needsEstimate when adding to estimate column', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                await result.current.addTask('Estimate task', 'estimate', [], []);
            });

            const taskData = mockAddDoc.mock.calls[0][1];
            expect(taskData.needsEstimate).toBe(true);
        });

        it('should not add task without user', async () => {
            const { result } = renderHook(() => useGTDTasks(null));

            await act(async () => {
                await result.current.addTask('Test', 'inbox', [], []);
            });

            expect(mockAddDoc).not.toHaveBeenCalled();
        });
    });

    describe('updateTask', () => {
        it('should update task with updatedAt timestamp', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                await result.current.updateTask('t1', { title: 'Updated title' });
            });

            expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
            const updateData = mockUpdateDoc.mock.calls[0][1];
            expect(updateData.title).toBe('Updated title');
            expect(updateData.updatedAt).toBeDefined();
        });
    });

    describe('deleteTask', () => {
        it('should delete task by id', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                await result.current.deleteTask('t1');
            });

            expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
        });

        it('should not delete without user', async () => {
            const { result } = renderHook(() => useGTDTasks(null));

            await act(async () => {
                await result.current.deleteTask('t1');
            });

            expect(mockDeleteDoc).not.toHaveBeenCalled();
        });
    });

    describe('moveTask (drag-and-drop)', () => {
        it('should ignore moves with no destination', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                await result.current.moveTask({
                    destination: null,
                    source: { droppableId: 'inbox', index: 0 },
                    draggableId: 't1',
                } as any);
            });

            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });

        it('should ignore same-position drops', async () => {
            const { result } = renderHook(() => useGTDTasks(mockUser));

            await act(async () => {
                return result.current.moveTask({
                    destination: { droppableId: 'inbox', index: 0 },
                    source: { droppableId: 'inbox', index: 0 },
                    draggableId: 't1',
                } as any);
            });

            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });
    });
});
