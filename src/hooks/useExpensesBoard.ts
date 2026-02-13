/**
 * @fileoverview useExpensesBoard — Data hook for Smart Expenses Board
 * 
 * Real-time Firestore subscription with month-level pagination (limit 50).
 * Enriches raw data into SmartTransaction with type, Schedule C, ambiguity.
 * Provides filtering, sorting, stats, category mutation with audit trail,
 * select mode for bulk actions, and taxYearLocked warnings.
 * 
 * @module hooks/useExpensesBoard
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    collection, query, orderBy, onSnapshot,
    updateDoc, doc, addDoc, serverTimestamp,
    where, limit, startAfter, getDocs,
    type DocumentSnapshot, arrayUnion,
    Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { useAuth } from '../auth/AuthContext';
import {
    type BankTransaction,
    type SmartTransaction,
    type TaxCategory,
    type VendorRule,
    type BoardStats,
    type BoardFilters,
    type BoardSort,
    INCOME_CATEGORIES,
    TRANSFER_CATEGORIES,
    CATEGORY_LABELS,
    CATEGORY_COLORS,
    SCHEDULE_C_MAP,
    DEFAULT_DEDUCTIBILITY,
    AMBIGUOUS_VENDORS,
    getTransactionType,
} from '../types/expensesBoard.types';

// ============================================
// CONSTANTS
// ============================================

const PAGE_SIZE = 50;

// ============================================
// HELPERS
// ============================================

const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
    }).format(Math.abs(amount));
};

const formatDate = (seconds: number): string => {
    const d = new Date(seconds * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const enrichTransaction = (tx: BankTransaction): SmartTransaction => {
    const type = getTransactionType(tx.category);
    const vendorUpper = tx.vendor?.toUpperCase() || '';

    return {
        ...tx,
        type,
        scheduleCLine: SCHEDULE_C_MAP[tx.category],
        isAmbiguous: AMBIGUOUS_VENDORS.some(v => vendorUpper.includes(v)),
        categoryLabel: CATEGORY_LABELS[tx.category] || tx.category,
        categoryColor: CATEGORY_COLORS[tx.category] || '#9E9E9E',
        formattedAmount: formatCurrency(tx.amount),
        formattedDate: tx.date?.seconds ? formatDate(tx.date.seconds) : '',
        isTransfer: TRANSFER_CATEGORIES.includes(tx.category),
        deductibilityPercent: tx.deductibilityPercent ?? (
            DEFAULT_DEDUCTIBILITY[tx.category] ??
            (INCOME_CATEGORIES.includes(tx.category) ? 0 :
                TRANSFER_CATEGORIES.includes(tx.category) ? 0 :
                    tx.category === 'private' ? 0 :
                        tx.category === 'uncategorized' ? 0 : 100)
        ),
    };
};

// ============================================
// HOOK
// ============================================

export const useExpensesBoard = () => {
    const { userProfile, currentUser } = useAuth();
    const companyId = userProfile?.companyId;

    // Raw data
    const [rawTransactions, setRawTransactions] = useState<BankTransaction[]>([]);
    const [vendorRules, setVendorRules] = useState<VendorRule[]>([]);
    const [loading, setLoading] = useState(true);

    // Pagination
    const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    // Select mode (bulk actions)
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Filters & sort
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const [filters, setFilters] = useState<BoardFilters>({
        year: currentYear,
        month: currentMonth,
        category: 'all',
        type: 'all',
        needsReview: false,
        searchQuery: '',
    });

    const [sort, setSort] = useState<BoardSort>({
        field: 'date',
        direction: 'desc',
    });

    // ── Build Firestore query ──
    const buildQuery = useCallback((afterDoc?: DocumentSnapshot) => {
        const constraints: any[] = [
            where('companyId', '==', companyId),
            where('year', '==', filters.year),
            orderBy('date', 'desc'),
            limit(PAGE_SIZE),
        ];

        // Month-level filter pushed to Firestore (P0: reduces reads)
        if (filters.month !== 'all') {
            // Insert month filter before orderBy
            constraints.splice(2, 0, where('month', '==', filters.month));
        }

        if (afterDoc) {
            constraints.push(startAfter(afterDoc));
        }

        return query(collection(db, 'bank_transactions'), ...constraints);
    }, [companyId, filters.year, filters.month]);

    // ── Real-time subscription: page 1 ──
    useEffect(() => {
        if (!companyId) return;

        setLoading(true);
        setLastDoc(null);
        setHasMore(true);

        const q = buildQuery();

        const unsub = onSnapshot(q, (snapshot) => {
            const txs: BankTransaction[] = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
            } as BankTransaction));
            setRawTransactions(txs);
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.docs.length >= PAGE_SIZE);
            setLoading(false);
        }, (error) => {
            console.error('[ExpensesBoard] Subscription error:', error);
            setLoading(false);
        });

        return unsub;
    }, [companyId, buildQuery]);

    // ── Load more (infinite scroll) ──
    const loadMore = useCallback(async () => {
        if (!lastDoc || !hasMore || loadingMore || !companyId) return;

        setLoadingMore(true);
        try {
            const q = buildQuery(lastDoc);
            const snapshot = await getDocs(q);
            const moreTxs: BankTransaction[] = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data(),
            } as BankTransaction));

            setRawTransactions(prev => [...prev, ...moreTxs]);
            setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
            setHasMore(snapshot.docs.length >= PAGE_SIZE);
        } catch (error) {
            console.error('[ExpensesBoard] Load more error:', error);
        }
        setLoadingMore(false);
    }, [lastDoc, hasMore, loadingMore, companyId, buildQuery]);

    // ── Load vendor rules ──
    useEffect(() => {
        if (!companyId) return;

        const q = query(
            collection(db, 'vendor_rules'),
            where('companyId', '==', companyId)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            setVendorRules(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as VendorRule)));
        });

        return unsub;
    }, [companyId]);

    // ── Enrich + client-side filter + sort ──
    const transactions = useMemo(() => {
        let enriched = rawTransactions.map(enrichTransaction);

        // Client-side filters (Firestore handles year + month)
        if (filters.category !== 'all') {
            enriched = enriched.filter(tx => tx.category === filters.category);
        }

        if (filters.type !== 'all') {
            enriched = enriched.filter(tx => tx.type === filters.type);
        }

        if (filters.needsReview) {
            enriched = enriched.filter(tx => tx.category === 'uncategorized');
        }

        if (filters.searchQuery.trim()) {
            const q = filters.searchQuery.toLowerCase();
            enriched = enriched.filter(tx =>
                tx.vendor?.toLowerCase().includes(q) ||
                tx.rawDescription?.toLowerCase().includes(q)
            );
        }

        // Sort (already sorted by date desc from Firestore, but re-sort if changed)
        if (sort.field !== 'date' || sort.direction !== 'desc') {
            enriched.sort((a, b) => {
                let cmp = 0;
                if (sort.field === 'date') {
                    cmp = (a.date?.seconds || 0) - (b.date?.seconds || 0);
                } else {
                    cmp = Math.abs(a.amount) - Math.abs(b.amount);
                }
                return sort.direction === 'desc' ? -cmp : cmp;
            });
        }

        return enriched;
    }, [rawTransactions, filters, sort]);

    // ── Board stats ──
    const stats: BoardStats = useMemo(() => {
        const result: BoardStats = {
            totalIncome: 0,
            totalExpenses: 0,
            totalTransfers: 0,
            netProfit: 0,
            taxDeductible: 0,
            uncategorizedCount: 0,
            transactionCount: transactions.length,
        };

        transactions.forEach(tx => {
            if (tx.category === 'private') return;

            const amt = Math.abs(tx.amount);
            if (tx.type === 'income') {
                result.totalIncome += amt;
            } else if (tx.type === 'transfer') {
                result.totalTransfers += amt;
            } else {
                result.totalExpenses += amt;
                result.taxDeductible += amt * (tx.deductibilityPercent / 100);
            }

            if (tx.category === 'uncategorized') {
                result.uncategorizedCount++;
            }
        });

        result.netProfit = result.totalIncome - result.totalExpenses;
        return result;
    }, [transactions]);

    // ── Update category with audit trail + taxYearLocked warning ──
    const updateCategory = useCallback(async (txId: string, newCategory: TaxCategory): Promise<{ blocked: boolean; reason?: string }> => {
        const tx = rawTransactions.find(t => t.id === txId);
        if (!tx) return { blocked: false };

        // P0: taxYearLocked check
        if (tx.taxYearLocked) {
            return {
                blocked: true,
                reason: `Tax year ${tx.year} is locked. Unlocking requires admin approval.`,
            };
        }

        const isDeductible = !TRANSFER_CATEGORIES.includes(newCategory) && newCategory !== 'private';
        const deductibilityPercent = DEFAULT_DEDUCTIBILITY[newCategory] ?? (isDeductible ? 100 : 0);

        // P1: categoryHistory audit trail
        const historyEntry = {
            from: tx.category,
            to: newCategory,
            changedAt: Timestamp.now(),
            changedBy: currentUser?.uid || 'unknown',
        };

        await updateDoc(doc(db, 'bank_transactions', txId), {
            category: newCategory,
            isDeductible,
            deductibilityPercent,
            isTransfer: TRANSFER_CATEGORIES.includes(newCategory),
            categoryHistory: arrayUnion(historyEntry),
        });

        // Auto-learn vendor rule
        if (tx.vendor && tx.vendor.trim()) {
            const pattern = tx.vendor.trim().toUpperCase();
            const existingRule = vendorRules.find(r =>
                r.pattern.toUpperCase() === pattern
            );

            if (existingRule) {
                await updateDoc(doc(db, 'vendor_rules', existingRule.id), {
                    category: newCategory,
                    updatedAt: serverTimestamp(),
                });
            } else {
                await addDoc(collection(db, 'vendor_rules'), {
                    pattern,
                    category: newCategory,
                    companyId,
                    isAutoLearned: true,
                    createdAt: serverTimestamp(),
                });
            }
        }

        return { blocked: false };
    }, [rawTransactions, vendorRules, companyId, currentUser]);

    // ── Bulk category update (Select Mode) ──
    const bulkUpdateCategory = useCallback(async (category: TaxCategory) => {
        const promises = Array.from(selectedIds).map(id => updateCategory(id, category));
        const results = await Promise.all(promises);

        // Clear selection after bulk action
        setSelectedIds(new Set());
        setSelectMode(false);

        const blocked = results.filter(r => r.blocked);
        return {
            updated: results.length - blocked.length,
            blocked: blocked.length,
        };
    }, [selectedIds, updateCategory]);

    // ── Selection helpers ──
    const toggleSelection = useCallback((txId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(txId)) {
                next.delete(txId);
            } else {
                next.add(txId);
            }
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedIds(new Set(transactions.map(tx => tx.id)));
    }, [transactions]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectMode(false);
    }, []);

    return {
        transactions,
        stats,
        loading,
        loadingMore,
        hasMore,
        loadMore,
        filters,
        setFilters,
        sort,
        setSort,
        updateCategory,
        vendorRules,
        // Select mode
        selectMode,
        setSelectMode,
        selectedIds,
        toggleSelection,
        selectAll,
        clearSelection,
        bulkUpdateCategory,
    };
};
