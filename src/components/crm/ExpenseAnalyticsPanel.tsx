/**
 * ExpenseAnalyticsPanel — compact analytics cards for the Reconciliation page.
 * Pure CSS bars (no chart library needed). Shows category breakdown, top merchants, monthly trend.
 */
import React, { useMemo } from 'react';
import { Box, Typography, Paper, Chip, LinearProgress, Collapse, Button } from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';

const CATEGORY_META: Record<string, { emoji: string; label: string; color: string }> = {
  materials: { emoji: '🧱', label: 'Материалы', color: '#ef6c00' },
  tools: { emoji: '🛠️', label: 'Инструменты', color: '#5d4037' },
  reimbursement: { emoji: '💷', label: 'Возмещение', color: '#7b1fa2' },
  fuel: { emoji: '⛽', label: 'Топливо', color: '#1565c0' },
  housing: { emoji: '🏠', label: 'Жилье', color: '#2e7d32' },
  food: { emoji: '🍔', label: 'Питание', color: '#c62828' },
  permit: { emoji: '📄', label: 'Документы', color: '#00838f' },
  other: { emoji: '📦', label: 'Прочее', color: '#546e7a' },
};

interface Transaction {
  amount: number;
  categoryId: string;
  cleanMerchant: string;
  date: string; // normalized YYYY-MM-DD
  paymentType: string;
}

interface Props {
  transactions: Transaction[];
  expanded: boolean;
  onToggle: () => void;
}

const fmtUsd = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const ExpenseAnalyticsPanel: React.FC<Props> = ({ transactions, expanded, onToggle }) => {
  // Category breakdown
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(t => {
      const cat = t.categoryId || 'other';
      map[cat] = (map[cat] || 0) + Math.abs(t.amount);
    });
    const total = Object.values(map).reduce((a, b) => a + b, 0);
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([id, val]) => ({
        id,
        value: val,
        pct: total > 0 ? (val / total) * 100 : 0,
        meta: CATEGORY_META[id] || CATEGORY_META.other,
      }));
  }, [transactions]);

  // Top 8 merchants by spend
  const topMerchants = useMemo(() => {
    const map: Record<string, { total: number; count: number }> = {};
    transactions.forEach(t => {
      const m = t.cleanMerchant || 'unknown';
      if (!map[m]) map[m] = { total: 0, count: 0 };
      map[m].total += Math.abs(t.amount);
      map[m].count++;
    });
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([name, d]) => ({ name, ...d }));
  }, [transactions]);

  // Monthly trend (last 6 months)
  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.forEach(t => {
      if (!t.date) return;
      const month = t.date.slice(0, 7); // YYYY-MM
      map[month] = (map[month] || 0) + Math.abs(t.amount);
    });
    return Object.entries(map)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6);
  }, [transactions]);
  const maxMonthly = Math.max(...monthlyData.map(d => d[1]), 1);

  // Company vs personal split
  const splitData = useMemo(() => {
    let company = 0, personal = 0;
    transactions.forEach(t => {
      const abs = Math.abs(t.amount);
      if (t.paymentType === 'company') company += abs;
      else personal += abs;
    });
    return { company, personal, total: company + personal };
  }, [transactions]);

  if (transactions.length === 0) return null;

  return (
    <Box mb={2}>
      <Button
        size="small"
        startIcon={<BarChartIcon />}
        onClick={onToggle}
        sx={{ mb: 1, textTransform: 'none', color: 'text.secondary' }}
      >
        {expanded ? 'Скрыть аналитику' : 'Показать аналитику'}
      </Button>

      <Collapse in={expanded}>
        <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr 1fr' }} gap={2}>
          {/* Category breakdown */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight="bold" mb={1.5}>
              По категориям
            </Typography>
            {categoryData.map(c => (
              <Box key={c.id} mb={1}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.3}>
                  <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                    {c.meta.emoji} {c.meta.label}
                  </Typography>
                  <Typography variant="caption" fontWeight="bold" sx={{ fontSize: '0.75rem' }}>
                    {fmtUsd(c.value)} ({c.pct.toFixed(0)}%)
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={c.pct}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: '#f0f0f0',
                    '& .MuiLinearProgress-bar': { bgcolor: c.meta.color, borderRadius: 3 },
                  }}
                />
              </Box>
            ))}
            {/* Company / Personal split */}
            <Box mt={2} display="flex" gap={1}>
              <Chip
                label={`🏢 ${fmtUsd(splitData.company)} (${splitData.total > 0 ? ((splitData.company / splitData.total) * 100).toFixed(0) : 0}%)`}
                size="small" variant="outlined"
                sx={{ fontSize: '0.7rem' }}
              />
              <Chip
                label={`💵 ${fmtUsd(splitData.personal)} (${splitData.total > 0 ? ((splitData.personal / splitData.total) * 100).toFixed(0) : 0}%)`}
                size="small" variant="outlined"
                sx={{ fontSize: '0.7rem' }}
              />
            </Box>
          </Paper>

          {/* Top merchants */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight="bold" mb={1.5}>
              Топ контрагенты
            </Typography>
            {topMerchants.map((m, i) => {
              const maxVal = topMerchants[0]?.total || 1;
              return (
                <Box key={m.name} mb={0.8}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.2}>
                    <Typography variant="caption" sx={{ fontSize: '0.72rem', textTransform: 'capitalize', maxWidth: '55%' }} noWrap>
                      {i + 1}. {m.name}
                    </Typography>
                    <Typography variant="caption" fontWeight="bold" sx={{ fontSize: '0.72rem' }}>
                      {fmtUsd(m.total)} ({m.count})
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={(m.total / maxVal) * 100}
                    sx={{
                      height: 5,
                      borderRadius: 3,
                      bgcolor: '#f0f0f0',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: i < 3 ? '#1976d2' : '#90caf9',
                        borderRadius: 3,
                      },
                    }}
                  />
                </Box>
              );
            })}
          </Paper>

          {/* Monthly trend */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight="bold" mb={1.5}>
              По месяцам
            </Typography>
            <Box display="flex" alignItems="flex-end" gap={0.8} sx={{ height: 120 }}>
              {monthlyData.map(([month, val]) => {
                const heightPct = (val / maxMonthly) * 100;
                const label = month.slice(5); // MM
                const monthNames = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
                const monthLabel = monthNames[parseInt(label, 10)] || label;
                return (
                  <Box key={month} flex={1} textAlign="center">
                    <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 'bold' }}>
                      {fmtUsd(val)}
                    </Typography>
                    <Box
                      sx={{
                        height: `${Math.max(heightPct, 5)}%`,
                        bgcolor: '#42a5f5',
                        borderRadius: '4px 4px 0 0',
                        minHeight: 4,
                        transition: 'height 0.3s',
                      }}
                    />
                    <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                      {monthLabel}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
            <Box mt={1.5} textAlign="center">
              <Typography variant="caption" color="text.secondary">
                Всего: {fmtUsd(transactions.reduce((s, t) => s + Math.abs(t.amount), 0))} за {transactions.length} транзакций
              </Typography>
            </Box>
          </Paper>
        </Box>
      </Collapse>
    </Box>
  );
};

export default ExpenseAnalyticsPanel;
