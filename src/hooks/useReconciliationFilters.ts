/**
 * useReconciliationFilters — All filter/sort/pagination state and computed data
 * for the Reconciliation page.
 *
 * Extracted from ReconciliationPage.tsx to reduce file size.
 */
import { useState, useMemo, useEffect } from 'react';
import {
  type ReconcileTx,
  type EnrichedTx,
  type QuickFilter,
  type SortField,
  type SortDir,
  type FilterStats,
  type SummaryData,
  parseLocation,
  toDate,
  getMonthKey,
  fmtDollar,
  isTampaArea,
  isFuelTransaction,
} from '../components/reconciliation/types';

export function useReconciliationFilters(transactions: ReconcileTx[]) {
  // ─── Filter state ────────────────────────────────────────
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [amountMin, setAmountMin] = useState<number | ''>('');
  const [amountMax, setAmountMax] = useState<number | ''>('');

  // ─── Table state ─────────────────────────────────────────
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ─── Computed: enriched with location ────────────────────
  const enrichedTransactions: EnrichedTx[] = useMemo(() =>
    transactions.map(t => ({ ...t, _location: parseLocation(t.rawDescription) })),
    [transactions]
  );

  // ─── Computed: duplicate detection ───────────────────────
  /** Detect potential duplicates: same date + same absolute amount */
  const duplicateIds = useMemo(() => {
    const groups = new Map<string, string[]>();
    enrichedTransactions.forEach(t => {
      const d = toDate(t.date);
      const key = d
        ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${Math.abs(t.amount).toFixed(2)}`
        : `?|${Math.abs(t.amount).toFixed(2)}`;
      const arr = groups.get(key) || [];
      arr.push(t.id);
      groups.set(key, arr);
    });
    const ids = new Set<string>();
    groups.forEach(arr => { if (arr.length > 1) arr.forEach(id => ids.add(id)); });
    return ids;
  }, [enrichedTransactions]);

  // ─── Computed: available months ──────────────────────────
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    enrichedTransactions.forEach(t => { const mk = getMonthKey(t.date); if (mk) months.add(mk); });
    return Array.from(months).sort().toReversed();
  }, [enrichedTransactions]);

  // ─── Computed: month-filtered base for toggle counts ─────
  const monthFilteredTransactions = useMemo(() =>
    filterMonth !== 'all'
      ? enrichedTransactions.filter(t => getMonthKey(t.date) === filterMonth)
      : enrichedTransactions,
    [enrichedTransactions, filterMonth]
  );

  // ─── Computed: filter stats ──────────────────────────────
  const filterStats: FilterStats = useMemo(() => {
    const calc = (list: typeof monthFilteredTransactions) => ({ count: list.length, sum: fmtDollar(list.reduce((s, t) => s + Math.abs(t.amount), 0)) });
    return {
      tampa: calc(monthFilteredTransactions.filter(t => isTampaArea(t._location))),
      company: calc(monthFilteredTransactions.filter(t => t.paymentType === 'company')),
      personal: calc(monthFilteredTransactions.filter(t => t.paymentType !== 'company')),
      fuel: calc(monthFilteredTransactions.filter(t => isFuelTransaction(t))),
      unassigned: calc(monthFilteredTransactions.filter(t => t.paymentType === 'company' && !t.projectId)),
      duplicates: calc(monthFilteredTransactions.filter(t => duplicateIds.has(t.id))),
    };
  }, [monthFilteredTransactions, duplicateIds]);

  // ─── Computed: fully filtered + sorted ───────────────────
  const filteredTransactions: EnrichedTx[] = useMemo(() => {
    let result = enrichedTransactions;

    // Month filter
    if (filterMonth !== 'all') result = result.filter(t => getMonthKey(t.date) === filterMonth);

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        (t.rawDescription || '').toLowerCase().includes(q) ||
        (t.cleanMerchant || '').toLowerCase().includes(q) ||
        (t._location || '').toLowerCase().includes(q)
      );
    }

    // Amount range
    if (amountMin !== '') result = result.filter(t => Math.abs(t.amount) >= amountMin);
    if (amountMax !== '') result = result.filter(t => Math.abs(t.amount) <= amountMax);

    // Quick filter
    if (quickFilter === 'tampa') result = result.filter(t => isTampaArea(t._location));
    else if (quickFilter === 'company') result = result.filter(t => t.paymentType === 'company');
    else if (quickFilter === 'personal') result = result.filter(t => t.paymentType !== 'company');
    else if (quickFilter === 'fuel') result = result.filter(t => isFuelTransaction(t));
    else if (quickFilter === 'unassigned') result = result.filter(t => t.paymentType === 'company' && !t.projectId);
    else if (quickFilter === 'duplicates') result = result.filter(t => duplicateIds.has(t.id));

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'amount') {
        cmp = Math.abs(a.amount) - Math.abs(b.amount);
      } else if (sortField === 'date') {
        cmp = (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0);
      } else if (sortField === 'cleanMerchant') {
        cmp = (a.cleanMerchant || '').localeCompare(b.cleanMerchant || '');
      } else if (sortField === 'categoryId') {
        cmp = (a.categoryId || '').localeCompare(b.categoryId || '');
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [enrichedTransactions, quickFilter, filterMonth, searchQuery, amountMin, amountMax, sortField, sortDir, duplicateIds]);

  // ─── Computed: summary from filtered data ────────────────
  const summaryData: SummaryData = useMemo(() => {
    const src = filteredTransactions;
    const tampa = src.filter(t => isTampaArea(t._location)).reduce((s, t) => s + Math.abs(t.amount), 0);
    const company = src.filter(t => t.paymentType === 'company').reduce((s, t) => s + Math.abs(t.amount), 0);
    const personal = src.filter(t => t.paymentType !== 'company').reduce((s, t) => s + Math.abs(t.amount), 0);
    const total = src.reduce((s, t) => s + Math.abs(t.amount), 0);
    return { tampa, company, personal, total };
  }, [filteredTransactions]);

  // ─── Computed: pagination ────────────────────────────────
  const paginatedTransactions = useMemo(() =>
    filteredTransactions.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
    [filteredTransactions, page, rowsPerPage]
  );

  // ─── Reset page on filter change ─────────────────────────
  useEffect(() => { setPage(0); }, [quickFilter, filterMonth, searchQuery, amountMin, amountMax]);

  // ─── Column sort handler ─────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  return {
    // Filter state + setters
    quickFilter, setQuickFilter,
    filterMonth, setFilterMonth,
    searchQuery, setSearchQuery,
    amountMin, setAmountMin,
    amountMax, setAmountMax,

    // Table state + setters
    page, setPage,
    rowsPerPage, setRowsPerPage,
    sortField, sortDir,
    handleSort,

    // Computed values
    enrichedTransactions,
    duplicateIds,
    availableMonths,
    monthFilteredTransactions,
    filterStats,
    filteredTransactions,
    summaryData,
    paginatedTransactions,
  };
}
