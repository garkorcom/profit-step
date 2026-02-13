/**
 * @fileoverview ExpensesBoardHeader — Glassmorphism control bar
 * 
 * Sticky header with:
 * - 4 stat cards (Income, Expenses, Net Profit, Tax Deductible) — collapse on mobile
 * - Filter row (Year, Month, Type chips, Category, Search)
 * - Sort control + Needs Review badge
 * - Select Mode bulk actions toolbar
 * 
 * P2: On mobile (<600px) stat cards collapse into a single summary line.
 */

import React, { useState } from 'react';
import {
    Box,
    Typography,
    Select,
    MenuItem,
    Chip,
    TextField,
    InputAdornment,
    Badge,
    Button,
    useMediaQuery,
    type SelectChangeEvent,
} from '@mui/material';
import {
    Search as SearchIcon,
    TrendingUp as IncomeIcon,
    TrendingDown as ExpenseIcon,
    SwapHoriz as TransferIcon,
    CheckCircle as SelectAllIcon,
    Close as CloseIcon,
} from '@mui/icons-material';
import {
    type BoardFilters,
    type BoardStats,
    type BoardSort,
    type TaxCategory,
    DROPDOWN_CATEGORIES,
    CATEGORY_LABELS,
} from '../../types/expensesBoard.types';

interface ExpensesBoardHeaderProps {
    stats: BoardStats;
    filters: BoardFilters;
    sort: BoardSort;
    onFiltersChange: (f: BoardFilters) => void;
    onSortChange: (s: BoardSort) => void;
    // Select mode
    selectMode: boolean;
    selectedCount: number;
    onToggleSelectMode: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onBulkCategorize: (category: TaxCategory) => void;
}

const SF_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

const formatCurrency = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const MONTHS = [
    { value: 'all', label: 'All Months' },
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
];

const TYPE_CHIPS: { value: BoardFilters['type']; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'transfer', label: 'Transfer' },
];

const ExpensesBoardHeader: React.FC<ExpensesBoardHeaderProps> = ({
    stats,
    filters,
    sort,
    onFiltersChange,
    onSortChange,
    selectMode,
    selectedCount,
    onToggleSelectMode,
    onSelectAll,
    onClearSelection,
    onBulkCategorize,
}) => {
    const isMobile = useMediaQuery('(max-width:600px)');
    const [bulkCategory, setBulkCategory] = useState<TaxCategory | ''>('');

    const update = (partial: Partial<BoardFilters>) => {
        onFiltersChange({ ...filters, ...partial });
    };

    return (
        <Box sx={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            backdropFilter: 'blur(20px)',
            backgroundColor: 'rgba(255,255,255,0.85)',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            mb: 3,
            borderRadius: '0 0 16px 16px',
        }}>
            {/* ── Select Mode Toolbar ── */}
            {selectMode && (
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    background: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)',
                    borderBottom: '1px solid #90CAF9',
                }}>
                    <Typography sx={{ fontFamily: SF_FONT, fontWeight: 700, fontSize: '14px', color: '#1565C0' }}>
                        {selectedCount} selected
                    </Typography>
                    <Button size="small" startIcon={<SelectAllIcon />} onClick={onSelectAll}
                        sx={{ fontFamily: SF_FONT, fontSize: '12px', textTransform: 'none' }}>
                        Select All
                    </Button>
                    <Select
                        size="small"
                        value={bulkCategory}
                        displayEmpty
                        onChange={(e: SelectChangeEvent<string>) => setBulkCategory(e.target.value as TaxCategory)}
                        sx={{ minWidth: 160, height: 32, fontSize: '12px', fontFamily: SF_FONT, bgcolor: '#fff', borderRadius: '8px' }}
                    >
                        <MenuItem value="" sx={{ fontSize: '12px' }}>Categorize as...</MenuItem>
                        {DROPDOWN_CATEGORIES.map(cat => (
                            <MenuItem key={cat} value={cat} sx={{ fontSize: '12px' }}>
                                {CATEGORY_LABELS[cat]}
                            </MenuItem>
                        ))}
                    </Select>
                    <Button
                        size="small"
                        variant="contained"
                        disabled={!bulkCategory || selectedCount === 0}
                        onClick={() => {
                            if (bulkCategory) {
                                onBulkCategorize(bulkCategory);
                                setBulkCategory('');
                            }
                        }}
                        sx={{
                            fontFamily: SF_FONT, fontSize: '12px', textTransform: 'none',
                            borderRadius: '8px', boxShadow: 'none',
                        }}
                    >
                        Apply ({selectedCount})
                    </Button>
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" startIcon={<CloseIcon />} onClick={onClearSelection}
                        sx={{ fontFamily: SF_FONT, fontSize: '12px', textTransform: 'none', color: '#666' }}>
                        Cancel
                    </Button>
                </Box>
            )}

            {/* ── Stat Cards ── */}
            {!selectMode && (
                isMobile ? (
                    /* P2: Mobile collapsed stats — single line */
                    <Box sx={{ display: 'flex', gap: 2, px: 2, py: 1.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <Typography sx={{ fontSize: '13px', fontWeight: 600, fontFamily: SF_FONT, color: '#2E7D32' }}>
                            ↑ {formatCurrency(stats.totalIncome)}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', fontWeight: 600, fontFamily: SF_FONT, color: '#C62828' }}>
                            ↓ {formatCurrency(stats.totalExpenses)}
                        </Typography>
                        <Typography sx={{ fontSize: '13px', fontWeight: 600, fontFamily: SF_FONT, color: stats.netProfit >= 0 ? '#2E7D32' : '#C62828' }}>
                            Net: {formatCurrency(stats.netProfit)}
                        </Typography>
                    </Box>
                ) : (
                    /* Desktop: Full stat cards */
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, p: 2 }}>
                        <StatCard label="INCOME" value={formatCurrency(stats.totalIncome)} color="#E8F5E9" icon={<IncomeIcon sx={{ color: '#2E7D32', fontSize: 20 }} />} />
                        <StatCard label="EXPENSES" value={formatCurrency(stats.totalExpenses)} color="#FFEBEE" icon={<ExpenseIcon sx={{ color: '#C62828', fontSize: 20 }} />} />
                        <StatCard label="NET PROFIT" value={formatCurrency(stats.netProfit)} color={stats.netProfit >= 0 ? '#E8F5E9' : '#FFEBEE'} icon={<IncomeIcon sx={{ color: stats.netProfit >= 0 ? '#2E7D32' : '#C62828', fontSize: 20 }} />} />
                        <StatCard label="TAX DEDUCTIBLE" value={formatCurrency(stats.taxDeductible)} color="#E0F7FA" icon={<TransferIcon sx={{ color: '#00695C', fontSize: 20 }} />} />
                    </Box>
                )
            )}

            {/* ── Filters Row ── */}
            <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                px: 2,
                pb: 1.5,
                alignItems: 'center',
            }}>
                {/* Year */}
                <Select
                    size="small"
                    value={filters.year}
                    onChange={(e) => update({ year: Number(e.target.value) })}
                    sx={{ minWidth: 80, height: 36, fontSize: '13px', fontFamily: SF_FONT, borderRadius: '10px', bgcolor: '#f5f5f7' }}
                >
                    {[2024, 2025, 2026, 2027].map(y => (
                        <MenuItem key={y} value={y}>{y}</MenuItem>
                    ))}
                </Select>

                {/* Month */}
                <Select
                    size="small"
                    value={filters.month}
                    onChange={(e) => update({ month: e.target.value === 'all' ? 'all' : Number(e.target.value) })}
                    sx={{ minWidth: 100, height: 36, fontSize: '13px', fontFamily: SF_FONT, borderRadius: '10px', bgcolor: '#f5f5f7' }}
                >
                    {MONTHS.map(m => (
                        <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                    ))}
                </Select>

                {/* Type chips */}
                {TYPE_CHIPS.map(tc => (
                    <Chip
                        key={tc.value}
                        label={tc.label}
                        onClick={() => update({ type: tc.value })}
                        variant={filters.type === tc.value ? 'filled' : 'outlined'}
                        color={filters.type === tc.value ? 'primary' : 'default'}
                        size="small"
                        sx={{ fontSize: '12px', fontFamily: SF_FONT }}
                    />
                ))}

                {/* Category */}
                <Select
                    size="small"
                    value={filters.category}
                    onChange={(e) => update({ category: e.target.value as TaxCategory | 'all' })}
                    sx={{ minWidth: 140, height: 36, fontSize: '12px', fontFamily: SF_FONT, borderRadius: '10px', bgcolor: '#f5f5f7' }}
                >
                    <MenuItem value="all">All Categories</MenuItem>
                    {DROPDOWN_CATEGORIES.map(cat => (
                        <MenuItem key={cat} value={cat} sx={{ fontSize: '12px' }}>
                            {CATEGORY_LABELS[cat]}
                        </MenuItem>
                    ))}
                </Select>

                {/* Search */}
                <TextField
                    size="small"
                    placeholder="Search vendor..."
                    value={filters.searchQuery}
                    onChange={(e) => update({ searchQuery: e.target.value })}
                    InputProps={{
                        startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: '#86868b' }} /></InputAdornment>,
                    }}
                    sx={{
                        flex: isMobile ? '1 1 100%' : '0 1 180px',
                        '& .MuiOutlinedInput-root': {
                            height: 36, fontSize: '13px', fontFamily: SF_FONT, borderRadius: '10px', bgcolor: '#f5f5f7',
                        },
                    }}
                />

                {/* Sort */}
                <Select
                    size="small"
                    value={`${sort.field}_${sort.direction}`}
                    onChange={(e) => {
                        const [field, direction] = e.target.value.split('_') as [BoardSort['field'], BoardSort['direction']];
                        onSortChange({ field, direction });
                    }}
                    sx={{ minWidth: 140, height: 36, fontSize: '12px', fontFamily: SF_FONT, borderRadius: '10px', bgcolor: '#f5f5f7' }}
                >
                    <MenuItem value="date_desc">🗓️ Newest First</MenuItem>
                    <MenuItem value="date_asc">🗓️ Oldest First</MenuItem>
                    <MenuItem value="amount_desc">💰 Largest First</MenuItem>
                    <MenuItem value="amount_asc">💰 Smallest First</MenuItem>
                </Select>

                {/* Needs Review */}
                {stats.uncategorizedCount > 0 && (
                    <Badge badgeContent={stats.uncategorizedCount} color="warning"
                        sx={{ '& .MuiBadge-badge': { fontSize: '10px', height: 18, minWidth: 18 } }}>
                        <Chip
                            label="Needs Review"
                            onClick={() => update({ needsReview: !filters.needsReview })}
                            variant={filters.needsReview ? 'filled' : 'outlined'}
                            color={filters.needsReview ? 'warning' : 'default'}
                            size="small"
                            sx={{ fontSize: '12px', fontFamily: SF_FONT }}
                        />
                    </Badge>
                )}

                {/* Select Mode Toggle */}
                {!selectMode && (
                    <Button
                        size="small"
                        variant="outlined"
                        onClick={onToggleSelectMode}
                        sx={{
                            fontSize: '12px', fontFamily: SF_FONT, textTransform: 'none',
                            borderRadius: '10px', height: 36,
                        }}
                    >
                        ☑ Select
                    </Button>
                )}
            </Box>
        </Box>
    );
};

// ── Stat Card mini-component ──
const StatCard: React.FC<{ label: string; value: string; color: string; icon: React.ReactNode }> = ({ label, value, color, icon }) => (
    <Box sx={{
        bgcolor: color,
        borderRadius: '12px',
        px: 2,
        py: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
    }}>
        {icon}
        <Box>
            <Typography sx={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', color: '#86868b', fontFamily: '-apple-system, system-ui, sans-serif' }}>
                {label}
            </Typography>
            <Typography sx={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', color: '#1d1d1f', fontFamily: '-apple-system, system-ui, sans-serif' }}>
                {value}
            </Typography>
        </Box>
    </Box>
);

export default ExpensesBoardHeader;
