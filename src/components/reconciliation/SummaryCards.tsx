/**
 * SummaryCards — The 4 summary cards (Tampa, Company, Personal, Total)
 * with click-to-filter functionality.
 *
 * Extracted from ReconciliationPage.tsx.
 */
import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';
import { type QuickFilter, type SummaryData } from './types';

interface SummaryCardsProps {
  summaryData: SummaryData;
  quickFilter: QuickFilter;
  onQuickFilterChange: (filter: QuickFilter) => void;
}

const fmtCard = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SummaryCards: React.FC<SummaryCardsProps> = ({ summaryData, quickFilter, onQuickFilterChange }) => {
  const clickableCards: { key: QuickFilter; label: string; value: number; bg: string; border: string; color: string }[] = [
    { key: 'tampa', label: '🏗️ Tampa', value: summaryData.tampa, bg: '#fff3e0', border: '#ffe0b2', color: 'warning.dark' },
    { key: 'company', label: '🏢 Company', value: summaryData.company, bg: '#e3f2fd', border: '#bbdefb', color: 'primary.dark' },
    { key: 'personal', label: '👤 Personal', value: summaryData.personal, bg: '#fce4ec', border: '#f8bbd0', color: 'error.dark' },
  ];

  return (
    <Box display="flex" gap={1.5} mb={2} flexWrap="wrap">
      {clickableCards.map(c => (
        <Card
          key={c.key}
          onClick={() => onQuickFilterChange(quickFilter === c.key ? 'all' : c.key)}
          sx={{
            minWidth: 130, cursor: 'pointer', transition: 'all 0.15s',
            bgcolor: c.bg,
            border: quickFilter === c.key ? `2px solid ${c.border}` : `1px solid ${c.border}`,
            boxShadow: quickFilter === c.key ? 3 : 0,
            transform: quickFilter === c.key ? 'scale(1.03)' : 'none',
            '&:hover': { boxShadow: 2 },
          }}
          elevation={0}
        >
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary">{c.label}</Typography>
            <Typography variant="h6" fontWeight="bold" color={c.color}>{fmtCard(c.value)}</Typography>
          </CardContent>
        </Card>
      ))}
      <Card sx={{ minWidth: 130, bgcolor: '#f5f5f5', border: '1px solid #e0e0e0' }} elevation={0}>
        <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
          <Typography variant="caption" color="text.secondary">📊 Total</Typography>
          <Typography variant="h6" fontWeight="bold">{fmtCard(summaryData.total)}</Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SummaryCards;
