/**
 * @fileoverview Summary cards showing income, expenses, transfers, net, and category breakdown.
 * @module components/bank-statements/BankSummaryCards
 */

import React from 'react';
import { Card, CardContent, Typography, Stack } from '@mui/material';
import { TaxCategory, CATEGORY_COLORS, CATEGORY_LABELS } from './bankStatements.types';

interface BankSummaryCardsProps {
    totals: Record<string, number>;
    filterCategory: TaxCategory | 'all';
    setFilterCategory: (cat: TaxCategory | 'all') => void;
}

export const BankSummaryCards: React.FC<BankSummaryCardsProps> = ({
    totals,
    filterCategory,
    setFilterCategory,
}) => (
    <>
        {/* Main Totals */}
        <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Card sx={{ minWidth: 140, bgcolor: '#E8F5E9' }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">💰 Income</Typography>
                    <Typography variant="h5" sx={{ color: '#2E7D32', fontWeight: 600 }}>
                        ${(totals.income || 0).toFixed(0)}
                    </Typography>
                </CardContent>
            </Card>
            <Card sx={{ minWidth: 140, bgcolor: '#FFEBEE' }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">💸 Expenses</Typography>
                    <Typography variant="h5" sx={{ color: '#C62828', fontWeight: 600 }}>
                        ${(totals.expenses || 0).toFixed(0)}
                    </Typography>
                </CardContent>
            </Card>
            <Card sx={{ minWidth: 140, bgcolor: '#E3F2FD' }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">🔄 Transfers</Typography>
                    <Typography variant="h5" sx={{ color: '#1565C0', fontWeight: 600 }}>
                        ${(totals.transfers || 0).toFixed(0)}
                    </Typography>
                </CardContent>
            </Card>
            <Card sx={{ minWidth: 140 }}>
                <CardContent sx={{ textAlign: 'center', py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">📊 Net</Typography>
                    <Typography variant="h5" sx={{
                        color: (totals.income || 0) - (totals.expenses || 0) >= 0 ? '#2E7D32' : '#C62828',
                        fontWeight: 600
                    }}>
                        ${((totals.income || 0) - (totals.expenses || 0)).toFixed(0)}
                    </Typography>
                </CardContent>
            </Card>
        </Stack>

        {/* Category Breakdown Cards */}
        <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1, overflowX: 'auto' }}>
            {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                const amount = totals[cat] || 0;
                if (amount === 0) return null;
                return (
                    <Card
                        key={cat}
                        sx={{
                            minWidth: 100,
                            cursor: 'pointer',
                            border: filterCategory === cat ? 2 : 0,
                            borderColor: CATEGORY_COLORS[cat as TaxCategory],
                        }}
                        onClick={() => setFilterCategory(filterCategory === cat ? 'all' : cat as TaxCategory)}
                    >
                        <CardContent sx={{ textAlign: 'center', py: 1, px: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                {label}
                            </Typography>
                            <Typography variant="body1" sx={{ color: CATEGORY_COLORS[cat as TaxCategory], fontWeight: 500 }}>
                                ${amount.toFixed(0)}
                            </Typography>
                        </CardContent>
                    </Card>
                );
            })}
        </Stack>
    </>
);

export default BankSummaryCards;
