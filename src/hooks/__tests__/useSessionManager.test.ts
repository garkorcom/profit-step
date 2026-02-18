/**
 * @fileoverview Tests for useSessionManager hook
 * 
 * Verifies session lifecycle: start, stop, auto-switch,
 * earnings calculation, and rate resolution.
 */

import { renderHook, act } from '@testing-library/react';
import { useSessionManager } from '../useSessionManager';

// ============================================
// MOCKS
// ============================================

const mockActiveSession = { current: null as any };
const mockLoading = { current: false };

jest.mock('../useActiveSession', () => ({
    useActiveSession: () => ({
        activeSession: mockActiveSession.current,
        loading: mockLoading.current,
    }),
}));

const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockAddDoc = jest.fn().mockResolvedValue({ id: 'new-session-1' });
const mockGetDocs = jest.fn().mockResolvedValue({ empty: true, docs: [] });

jest.mock('firebase/firestore', () => {
    const mockTimestamp = {
        now: () => ({
            seconds: Math.floor(Date.now() / 1000),
            nanoseconds: 0,
            toMillis: () => Date.now(),
        }),
        fromDate: (d: Date) => ({
            seconds: Math.floor(d.getTime() / 1000),
            nanoseconds: 0,
            toMillis: () => d.getTime(),
        }),
    };

    return {
        doc: jest.fn((_db: any, _col: string, _id: string) => ({ id: _id, path: `${_col}/${_id}` })),
        updateDoc: (...args: any[]) => mockUpdateDoc(...args),
        addDoc: (...args: any[]) => mockAddDoc(...args),
        collection: jest.fn((_db: any, name: string) => ({ path: name })),
        Timestamp: mockTimestamp,
        query: jest.fn((...args: any[]) => args),
        where: jest.fn(),
        getDocs: (...args: any[]) => mockGetDocs(...args),
        getDoc: jest.fn().mockResolvedValue({ exists: () => false, data: () => null }),
        increment: jest.fn((n: number) => ({ _increment: n }),),
    };
});

jest.mock('../../firebase/firebase', () => ({
    db: { type: 'mock-firestore' },
}));

describe('useSessionManager', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockActiveSession.current = null;
        mockLoading.current = false;
    });

    describe('initialization', () => {
        it('should return null activeSession when no session exists', () => {
            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User', '12345')
            );

            expect(result.current.activeSession).toBeNull();
            expect(result.current.loading).toBe(false);
        });

        it('should return loading=true when session is loading', () => {
            mockLoading.current = true;

            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User')
            );

            expect(result.current.loading).toBe(true);
        });
    });

    describe('stopSession', () => {
        it('should complete session with correct earnings', async () => {
            const startTime = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
            mockActiveSession.current = {
                id: 'session-1',
                startTime: { toMillis: () => startTime },
                hourlyRate: 50,
                status: 'active',
            };

            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User')
            );

            await act(async () => {
                await result.current.stopSession();
            });

            expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
            const updateCall = mockUpdateDoc.mock.calls[0];
            const updateData = updateCall[1];

            expect(updateData.status).toBe('completed');
            expect(updateData.durationMinutes).toBeGreaterThan(0);
            expect(updateData.sessionEarnings).toBeGreaterThan(0);
        });

        it('should do nothing when no active session', async () => {
            mockActiveSession.current = null;

            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User')
            );

            await act(async () => {
                await result.current.stopSession();
            });

            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });

        it('should handle zero hourlyRate gracefully', async () => {
            const startTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
            mockActiveSession.current = {
                id: 'session-2',
                startTime: { toMillis: () => startTime },
                hourlyRate: 0,
                status: 'active',
            };

            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User')
            );

            await act(async () => {
                await result.current.stopSession();
            });

            const updateData = mockUpdateDoc.mock.calls[0][1];
            expect(updateData.sessionEarnings).toBe(0);
        });
    });

    describe('startSession', () => {
        it('should create new session with correct data', async () => {
            mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });

            const task = {
                id: 'task-1',
                title: 'Fix plumbing',
                clientId: 'client-1',
                clientName: 'Client A',
            } as any;

            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User', '12345')
            );

            await act(async () => {
                await result.current.startSession(task);
            });

            expect(mockAddDoc).toHaveBeenCalledTimes(1);
            const addedData = mockAddDoc.mock.calls[0][1];

            expect(addedData.employeeName).toBe('Test User');
            expect(addedData.status).toBe('active');
            expect(addedData.description).toBe('Fix plumbing');
            expect(addedData.clientId).toBe('client-1');
            expect(addedData.relatedTaskId).toBe('task-1');
        });

        it('should auto-close previous active session', async () => {
            const prevSessionRef = { id: 'old-session', path: 'work_sessions/old-session' };
            mockGetDocs.mockResolvedValueOnce({
                empty: false,
                docs: [{
                    ref: prevSessionRef,
                    data: () => ({
                        startTime: { toMillis: () => Date.now() - 3600000 },
                        hourlyRate: 40,
                    }),
                }],
            });

            const task = { id: 'task-2', title: 'New task' } as any;

            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User')
            );

            await act(async () => {
                await result.current.startSession(task);
            });

            // First call: close old session, Second: should not happen (addDoc is separate)
            expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
            const closeData = mockUpdateDoc.mock.calls[0][1];
            expect(closeData.status).toBe('completed');

            // New session created
            expect(mockAddDoc).toHaveBeenCalledTimes(1);
        });

        it('should not start session without userId', async () => {
            const task = { id: 'task-3', title: 'Test' } as any;

            const { result } = renderHook(() =>
                useSessionManager(undefined, 'Test User')
            );

            await act(async () => {
                await result.current.startSession(task);
            });

            expect(mockAddDoc).not.toHaveBeenCalled();
        });
    });

    describe('snackbar state', () => {
        it('should manage snackbar state', () => {
            const { result } = renderHook(() =>
                useSessionManager('user-1', 'Test User')
            );

            expect(result.current.sessionSnackbarOpen).toBe(false);

            act(() => {
                result.current.setSessionSnackbarOpen(true);
            });

            expect(result.current.sessionSnackbarOpen).toBe(true);
        });
    });
});
