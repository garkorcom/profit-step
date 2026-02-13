/**
 * @fileoverview ExpensesBoardPage — Main page with masonry grid
 * 
 * Zero-dependency masonry using CSS `columns`.
 * Features: infinite scroll (P0), select mode (P1),
 * responsive 1→4 columns, sticky header.
 */

import React, { useRef, useCallback, useEffect } from 'react';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import { useExpensesBoard } from '../../hooks/useExpensesBoard';
import SmartTransactionCard from '../../components/expenses/SmartTransactionCard';
import ExpensesBoardHeader from '../../components/expenses/ExpensesBoardHeader';

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

const ExpensesBoardPage: React.FC = () => {
    const {
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
        selectMode,
        setSelectMode,
        selectedIds,
        toggleSelection,
        selectAll,
        clearSelection,
        bulkUpdateCategory,
    } = useExpensesBoard();

    // ── Infinite scroll via IntersectionObserver ──
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
        const [entry] = entries;
        if (entry.isIntersecting && hasMore && !loadingMore) {
            loadMore();
        }
    }, [hasMore, loadingMore, loadMore]);

    useEffect(() => {
        const observer = new IntersectionObserver(handleObserver, {
            rootMargin: '200px',
        });
        if (sentinelRef.current) {
            observer.observe(sentinelRef.current);
        }
        return () => observer.disconnect();
    }, [handleObserver]);

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <CircularProgress size={48} sx={{ color: '#007AFF' }} />
            </Box>
        );
    }

    return (
        <Box sx={{
            maxWidth: 1400,
            mx: 'auto',
            px: { xs: 1, sm: 2, md: 3 },
            py: 2,
            fontFamily: SF_FONT,
        }}>
            {/* ── Page Title ── */}
            <Box sx={{ mb: 2 }}>
                <Typography variant="h4" sx={{
                    fontWeight: 800,
                    fontFamily: SF_FONT,
                    color: '#1d1d1f',
                    letterSpacing: '-0.02em',
                }}>
                    Smart Expenses Board
                </Typography>
                <Typography sx={{
                    fontSize: '14px',
                    color: '#86868b',
                    fontFamily: SF_FONT,
                }}>
                    {stats.transactionCount} transactions
                    {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
                </Typography>
            </Box>

            {/* ── Header with filters + stats + select toolbar ── */}
            <ExpensesBoardHeader
                stats={stats}
                filters={filters}
                sort={sort}
                onFiltersChange={setFilters}
                onSortChange={setSort}
                selectMode={selectMode}
                selectedCount={selectedIds.size}
                onToggleSelectMode={() => setSelectMode(true)}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
                onBulkCategorize={bulkUpdateCategory}
            />

            {/* ── Masonry Grid via CSS Columns ── */}
            {transactions.length > 0 ? (
                <>
                    <Box sx={{
                        columns: {
                            xs: 1,
                            sm: 2,
                            md: 3,
                            lg: 4,
                        },
                        columnGap: '16px',
                    }}>
                        {transactions.map(tx => (
                            <SmartTransactionCard
                                key={tx.id}
                                transaction={tx}
                                onCategoryChange={updateCategory}
                                selectMode={selectMode}
                                isSelected={selectedIds.has(tx.id)}
                                onToggleSelect={toggleSelection}
                            />
                        ))}
                    </Box>

                    {/* ── Infinite Scroll Sentinel ── */}
                    <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        {loadingMore && (
                            <CircularProgress size={28} sx={{ color: '#007AFF' }} />
                        )}
                        {!hasMore && transactions.length > 0 && (
                            <Typography sx={{ fontSize: '13px', color: '#86868b', fontFamily: SF_FONT }}>
                                All {transactions.length} transactions loaded
                            </Typography>
                        )}
                        {hasMore && !loadingMore && (
                            <Button
                                onClick={loadMore}
                                sx={{ fontSize: '13px', fontFamily: SF_FONT, textTransform: 'none', color: '#007AFF' }}
                            >
                                Load more...
                            </Button>
                        )}
                    </Box>
                </>
            ) : (
                /* ── Empty State ── */
                <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    py: 10,
                    opacity: 0.7,
                }}>
                    <Typography sx={{ fontSize: '48px', mb: 2 }}>📊</Typography>
                    <Typography sx={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: '#1d1d1f',
                        fontFamily: SF_FONT,
                        mb: 1,
                    }}>
                        No transactions found
                    </Typography>
                    <Typography sx={{
                        fontSize: '14px',
                        color: '#86868b',
                        fontFamily: SF_FONT,
                        textAlign: 'center',
                        maxWidth: 400,
                    }}>
                        Upload a bank statement on the Bank Statements page, or adjust your filters.
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export default ExpensesBoardPage;
