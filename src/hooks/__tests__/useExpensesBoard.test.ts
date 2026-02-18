/**
 * @fileoverview Tests for useExpensesBoard hook
 * 
 * Verifies transaction enrichment, filtering, stats calculation,
 * category updates with audit trail, and select mode.
 */

import { renderHook, act } from '@testing-library/react';
import { useExpensesBoard } from '../useExpensesBoard';

// ============================================
// MOCKS
// ============================================

let onSnapshotCallbacks: Array<(snap: any) => void> = [];
const mockUnsubscribe = jest.fn();
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockAddDoc = jest.fn().mockResolvedValue({ id: 'rule-1' });

jest.mock('firebase/firestore', () => {
    const mockTimestamp = {
        now: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }),
    };

    return {
        collection: jest.fn(),
        query: jest.fn((...args: any[]) => args),
        where: jest.fn(),
        orderBy: jest.fn(),
        limit: jest.fn(),
        startAfter: jest.fn(),
        onSnapshot: jest.fn((_q: any, cb: any, _err?: any) => {
            onSnapshotCallbacks.push(cb);
            return mockUnsubscribe;
        }),
        getDocs: jest.fn().mockResolvedValue({ docs: [] }),
        doc: jest.fn((_db: any, _col: string, id: string) => ({ id })),
        updateDoc: (...args: any[]) => mockUpdateDoc(...args),
        addDoc: (...args: any[]) => mockAddDoc(...args),
        serverTimestamp: jest.fn(() => ({ _serverTimestamp: true })),
        arrayUnion: jest.fn((entry: any) => ({ _arrayUnion: entry })),
        Timestamp: mockTimestamp,
    };
});

jest.mock('../../firebase/firebase', () => ({
    db: { type: 'mock-firestore' },
}));

const mockAuth = jest.fn();
jest.mock('../../auth/AuthContext', () => ({
    useAuth: () => mockAuth(),
}));

// Sample transaction data
const createTx = (overrides: Record<string, any> = {}) => ({
    id: 'tx-1',
    amount: -150.00,
    vendor: 'Home Depot',
    category: 'materials',
    date: { seconds: 1700000000 },
    year: 2024,
    month: 11,
    rawDescription: 'HOME DEPOT #1234',
    companyId: 'company-1',
    ...overrides,
});

describe('useExpensesBoard', () => {
    beforeEach(() => {
        onSnapshotCallbacks = [];
        mockUpdateDoc.mockClear();
        mockAddDoc.mockClear();
        mockAuth.mockReturnValue({
            userProfile: { companyId: 'company-1', role: 'admin' },
            currentUser: { uid: 'user-1' },
        });
        // Re-apply onSnapshot implementation
        const { onSnapshot } = require('firebase/firestore');
        onSnapshot.mockImplementation((_q: any, cb: any, _err?: any) => {
            onSnapshotCallbacks.push(cb);
            return mockUnsubscribe;
        });
    });

    describe('initialization', () => {
        it('should start with loading=true', () => {
            const { result } = renderHook(() => useExpensesBoard());
            expect(result.current.loading).toBe(true);
        });

        it('should not subscribe without companyId', () => {
            mockAuth.mockReturnValue({
                userProfile: { companyId: null },
                currentUser: { uid: 'user-1' },
            });

            renderHook(() => useExpensesBoard());

            const { onSnapshot } = require('firebase/firestore');
            expect(onSnapshot).not.toHaveBeenCalled();
        });
    });

    describe('transaction enrichment', () => {
        it('should enrich raw transactions with type, labels, and colors', () => {
            const { result } = renderHook(() => useExpensesBoard());

            // Emit transactions (first onSnapshot = bank_transactions, second = vendor_rules)
            act(() => {
                // First subscription: bank_transactions
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-1', data: () => createTx() },
                            { id: 'tx-2', data: () => createTx({ id: 'tx-2', amount: 5000, category: 'project_income', vendor: 'Client A' }) },
                        ],
                    });
                }
                // Second subscription: vendor_rules
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            expect(result.current.loading).toBe(false);
            expect(result.current.transactions.length).toBe(2);

            const tx1 = result.current.transactions.find(t => t.id === 'tx-1');
            expect(tx1?.type).toBe('expense');
            expect(tx1?.formattedAmount).toContain('150');
            expect(tx1?.categoryLabel).toBeDefined();
        });
    });

    describe('stats calculation', () => {
        it('should calculate correct board stats', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-1', data: () => createTx({ amount: -200, category: 'materials' }) },
                            { id: 'tx-2', data: () => createTx({ id: 'tx-2', amount: 1000, category: 'project_income' }) },
                            { id: 'tx-3', data: () => createTx({ id: 'tx-3', amount: -50, category: 'uncategorized' }) },
                        ],
                    });
                }
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            expect(result.current.stats.transactionCount).toBe(3);
            expect(result.current.stats.totalIncome).toBeGreaterThan(0);
            expect(result.current.stats.totalExpenses).toBeGreaterThan(0);
            expect(result.current.stats.uncategorizedCount).toBe(1);
        });
    });

    describe('filters', () => {
        it('should filter by search query', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-1', data: () => createTx({ vendor: 'Home Depot' }) },
                            { id: 'tx-2', data: () => createTx({ id: 'tx-2', vendor: 'Amazon' }) },
                        ],
                    });
                }
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            expect(result.current.transactions.length).toBe(2);

            act(() => {
                result.current.setFilters(prev => ({ ...prev, searchQuery: 'depot' }));
            });

            expect(result.current.transactions.length).toBe(1);
            expect(result.current.transactions[0].vendor).toBe('Home Depot');
        });

        it('should filter by category', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-1', data: () => createTx({ category: 'materials' }) },
                            { id: 'tx-2', data: () => createTx({ id: 'tx-2', category: 'fuel' }) },
                        ],
                    });
                }
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            act(() => {
                result.current.setFilters(prev => ({ ...prev, category: 'materials' }));
            });

            expect(result.current.transactions.length).toBe(1);
        });

        it('should filter needsReview (uncategorized only)', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-1', data: () => createTx({ category: 'materials' }) },
                            { id: 'tx-2', data: () => createTx({ id: 'tx-2', category: 'uncategorized' }) },
                        ],
                    });
                }
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            act(() => {
                result.current.setFilters(prev => ({ ...prev, needsReview: true }));
            });

            expect(result.current.transactions.length).toBe(1);
            expect(result.current.transactions[0].category).toBe('uncategorized');
        });
    });

    describe('select mode', () => {
        it('should toggle selection', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                result.current.toggleSelection('tx-1');
            });

            expect(result.current.selectedIds.has('tx-1')).toBe(true);

            act(() => {
                result.current.toggleSelection('tx-1');
            });

            expect(result.current.selectedIds.has('tx-1')).toBe(false);
        });

        it('should select all visible transactions', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-1', data: () => createTx() },
                            { id: 'tx-2', data: () => createTx({ id: 'tx-2' }) },
                        ],
                    });
                }
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            act(() => {
                result.current.selectAll();
            });

            expect(result.current.selectedIds.size).toBe(2);
        });

        it('should clear selection', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                result.current.toggleSelection('tx-1');
                result.current.setSelectMode(true);
            });

            act(() => {
                result.current.clearSelection();
            });

            expect(result.current.selectedIds.size).toBe(0);
            expect(result.current.selectMode).toBe(false);
        });
    });

    describe('updateCategory', () => {
        it('should block updates on taxYearLocked transactions', async () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                if (onSnapshotCallbacks[0]) {
                    onSnapshotCallbacks[0]({
                        docs: [
                            { id: 'tx-locked', data: () => createTx({ id: 'tx-locked', taxYearLocked: true, year: 2023 }) },
                        ],
                    });
                }
                if (onSnapshotCallbacks[1]) {
                    onSnapshotCallbacks[1]({ docs: [] });
                }
            });

            let updateResult: any;
            await act(async () => {
                updateResult = await result.current.updateCategory('tx-locked', 'materials');
            });

            expect(updateResult.blocked).toBe(true);
            expect(updateResult.reason).toContain('locked');
            expect(mockUpdateDoc).not.toHaveBeenCalled();
        });
    });
});
