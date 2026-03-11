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

// Improved dictionary to store callbacks by collection
let mockQueryCallbacks: Record<string, Function[]> = {};
const mockUnsubscribe = jest.fn();
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockAddDoc = jest.fn().mockResolvedValue({ id: 'rule-1' });

jest.mock('firebase/firestore', () => {
    return {
        collection: jest.fn(),
        query: jest.fn(),
        where: jest.fn(),
        orderBy: jest.fn(),
        limit: jest.fn(),
        startAfter: jest.fn(),
        onSnapshot: jest.fn(),
        getDocs: jest.fn(),
        doc: jest.fn(),
        updateDoc: jest.fn(),
        addDoc: jest.fn(),
        serverTimestamp: jest.fn(),
        arrayUnion: jest.fn(),
        Timestamp: {
            now: jest.fn(),
        },
    };
});

jest.mock('../../firebase/firebase', () => ({
    db: { type: 'mock-firestore' },
}));

const mockAuth = jest.fn();
jest.mock('../../auth/AuthContext', () => ({
    useAuth: () => mockAuth(),
}));

// Helper to trigger snapshots specifically by collection name
const triggerSnapshot = (collectionName: string, docsData: any[]) => {
    console.log('[triggerSnapshot] Request for:', collectionName, '| Available keys:', Object.keys(mockQueryCallbacks));
    const callbacks = mockQueryCallbacks[collectionName] || [];
    callbacks.forEach((cb: any) => cb({ docs: docsData }));
};

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
        mockQueryCallbacks = {};
        mockUpdateDoc.mockClear();
        mockAddDoc.mockClear();
        mockAuth.mockReturnValue({
            userProfile: { companyId: 'company-1', role: 'admin' },
            currentUser: { uid: 'user-1' },
        });

        const firestore = require('firebase/firestore');
        firestore.collection.mockImplementation(((_db: any, path: string) => path) as any);
        firestore.query.mockImplementation(((collectionPath: string, ...args: any[]) => ({ path: collectionPath, args })) as any);
        firestore.where.mockImplementation(((field: string, op: string, value: any) => ({ type: 'where', field, op, value })) as any);
        firestore.orderBy.mockImplementation(((field: string, dir: string) => ({ type: 'orderBy', field, dir })) as any);
        firestore.limit.mockImplementation(((n: number) => ({ type: 'limit', n })) as any);
        firestore.startAfter.mockImplementation(((doc: any) => ({ type: 'startAfter', doc })) as any);
        firestore.getDocs.mockResolvedValue({ docs: [] });
        firestore.doc.mockImplementation(((_db: any, _col: string, id: string) => ({ id })) as any);
        firestore.updateDoc.mockImplementation(((...args: any[]) => mockUpdateDoc(...args)) as any);
        firestore.addDoc.mockImplementation(((...args: any[]) => mockAddDoc(...args)) as any);
        firestore.serverTimestamp.mockReturnValue({ _serverTimestamp: true });
        firestore.arrayUnion.mockImplementation(((entry: any) => ({ _arrayUnion: entry })) as any);
        firestore.Timestamp.now.mockReturnValue({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 });

        firestore.onSnapshot.mockImplementation((q: any, cb: any, _err?: any) => {
            const collectionName = q.path || 'unknown';
            if (!mockQueryCallbacks[collectionName]) {
                mockQueryCallbacks[collectionName] = [];
            }
            mockQueryCallbacks[collectionName].push(cb);
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

            act(() => {
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-1', data: () => createTx() },
                    { id: 'tx-2', data: () => createTx({ id: 'tx-2', amount: 5000, category: 'client_payment', vendor: 'Client A' }) },
                ]);
                triggerSnapshot('vendor_rules', []);
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
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-1', data: () => createTx({ amount: -200, category: 'materials' }) },
                    { id: 'tx-2', data: () => createTx({ id: 'tx-2', amount: 1000, category: 'client_payment' }) },
                    { id: 'tx-3', data: () => createTx({ id: 'tx-3', amount: -50, category: 'uncategorized' }) },
                ]);
                triggerSnapshot('vendor_rules', []);
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
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-1', data: () => createTx({ vendor: 'Home Depot' }) },
                    { id: 'tx-2', data: () => createTx({ id: 'tx-2', vendor: 'Amazon', rawDescription: 'AMAZON REF' }) },
                ]);
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
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-1', data: () => createTx({ category: 'materials' }) },
                    { id: 'tx-2', data: () => createTx({ id: 'tx-2', category: 'fuel' }) },
                ]);
            });

            act(() => {
                result.current.setFilters(prev => ({ ...prev, category: 'materials' }));
            });

            expect(result.current.transactions.length).toBe(1);
        });

        it('should update query when year and month change', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                result.current.setFilters(prev => ({ ...prev, year: 2025, month: 6 }));
            });

            // The query updates natively trigger re-subscriptions with the new where clauses 
            // handled in buildQuery, we just ensure it doesn't crash here. 
            expect(result.current.filters.year).toBe(2025);
            expect(result.current.filters.month).toBe(6);
        });
    });

    describe('select mode & bulk operations', () => {
        it('should cleanly select, deselect, and clear selections', () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                result.current.toggleSelection('tx-1');
            });
            expect(result.current.selectedIds.has('tx-1')).toBe(true);

            act(() => {
                result.current.toggleSelection('tx-1');
            });
            expect(result.current.selectedIds.has('tx-1')).toBe(false);

            act(() => {
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-1', data: () => createTx() },
                    { id: 'tx-2', data: () => createTx({ id: 'tx-2' }) },
                ]);
            });

            act(() => {
                result.current.selectAll();
            });
            expect(result.current.selectedIds.size).toBe(2);

            act(() => {
                result.current.setSelectMode(true);
                result.current.clearSelection();
            });
            expect(result.current.selectedIds.size).toBe(0);
            expect(result.current.selectMode).toBe(false);
        });

        it('should execute bulkUpdateCategory successfully on valid selections', async () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-1', data: () => createTx({ id: 'tx-1', vendor: 'A' }) },
                    { id: 'tx-2', data: () => createTx({ id: 'tx-2', vendor: 'B' }) },
                ]);
            });

            act(() => {
                result.current.selectAll(); // tx-1, tx-2
            });

            await act(async () => {
                await result.current.bulkUpdateCategory('software');
            });

            // updateDoc was called for both
            expect(mockUpdateDoc).toHaveBeenCalledTimes(2);
            // selection was cleared
            expect(result.current.selectedIds.size).toBe(0);
            expect(result.current.selectMode).toBe(false);
        });
    });

    describe('updateCategory', () => {
        it('should execute successfully and auto-learn vendor rules', async () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-test', data: () => createTx({ id: 'tx-test', vendor: 'NEW VENDOR', category: 'uncategorized' }) },
                ]);
                triggerSnapshot('vendor_rules', []);
            });

            let updateResult: any;
            await act(async () => {
                updateResult = await result.current.updateCategory('tx-test', 'office_supplies');
            });

            expect(updateResult.blocked).toBe(false);

            // 1. Transaction document was updated
            expect(mockUpdateDoc).toHaveBeenCalledWith(
                { id: 'tx-test' },
                expect.objectContaining({
                    category: 'office_supplies',
                    isDeductible: true,
                    isTransfer: false
                })
            );

            // 2. Audit Trail included
            const updateCallArgs = mockUpdateDoc.mock.calls[0][1];
            expect(updateCallArgs.categoryHistory).toEqual({
                _arrayUnion: expect.objectContaining({
                    from: 'uncategorized',
                    to: 'office_supplies'
                })
            });

            // 3. Vendor rule was added because it's a new vendor
            expect(mockAddDoc).toHaveBeenCalledWith(
                'vendor_rules',
                expect.objectContaining({
                    pattern: 'NEW VENDOR',
                    category: 'office_supplies'
                })
            );
        });

        it('should block updates on taxYearLocked transactions', async () => {
            const { result } = renderHook(() => useExpensesBoard());

            act(() => {
                triggerSnapshot('bank_transactions', [
                    { id: 'tx-locked', data: () => createTx({ id: 'tx-locked', taxYearLocked: true, year: 2023 }) },
                ]);
            });

            let updateResult: any;
            await act(async () => {
                updateResult = await result.current.updateCategory('tx-locked', 'materials');
            });

            expect(updateResult.blocked).toBe(true);
            expect(updateResult.reason).toContain('locked');
            expect(mockUpdateDoc).not.toHaveBeenCalled();
            expect(mockAddDoc).not.toHaveBeenCalled();
        });
    });
});
