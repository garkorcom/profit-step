/**
 * BudgetProgressBar — stacked bar showing estimated vs spent vs invoiced.
 * Over-budget state turns the bar red with a badge.
 */

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Tooltip,
  Chip,
  Skeleton,
} from '@mui/material';

interface BudgetProgressBarProps {
  estimated: number;
  spent: number;
  invoiced: number;
  loading?: boolean;
}

const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({
  estimated,
  spent,
  invoiced,
  loading = false,
}) => {
  if (loading) {
    return <Skeleton variant="rounded" height={80} />;
  }

  if (estimated <= 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No estimate available
        </Typography>
      </Paper>
    );
  }

  const isOverBudget = spent > estimated;
  const maxVal = Math.max(estimated, spent, invoiced);
  const spentPct = Math.min((spent / maxVal) * 100, 100);
  const invoicedPct = Math.min((invoiced / maxVal) * 100, 100);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2">Budget</Typography>
        {isOverBudget && (
          <Chip
            label={`OVER BUDGET +$${(spent - estimated).toLocaleString()}`}
            color="error"
            size="small"
          />
        )}
      </Box>

      {/* Stacked bar */}
      <Tooltip
        title={
          <Box>
            <div>Estimated: ${estimated.toLocaleString()}</div>
            <div>Spent: ${spent.toLocaleString()}</div>
            <div>Invoiced: ${invoiced.toLocaleString()}</div>
          </Box>
        }
      >
        <Box
          sx={{
            position: 'relative',
            height: 24,
            bgcolor: '#e0e0e0',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          {/* Spent bar */}
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${spentPct}%`,
              bgcolor: isOverBudget ? '#f44336' : '#1976d2',
              transition: 'width 0.5s ease',
              borderRadius: 1,
            }}
          />
          {/* Invoiced bar (overlay) */}
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${invoicedPct}%`,
              bgcolor: 'rgba(76, 175, 80, 0.4)',
              borderRight: invoicedPct > 0 ? '2px solid #4caf50' : 'none',
              transition: 'width 0.5s ease',
              borderRadius: 1,
            }}
          />
        </Box>
      </Tooltip>

      {/* Labels */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Spent: ${spent.toLocaleString()} ({estimated > 0 ? Math.round((spent / estimated) * 100) : 0}%)
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Estimated: ${estimated.toLocaleString()}
        </Typography>
      </Box>
    </Paper>
  );
};

export default BudgetProgressBar;
