/**
 * ClientHeader — client info + KPI cards (Balance, Profit, Margin)
 * + quick action buttons.
 */

import React from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Chip,
  Button,
  Stack,
  Skeleton,
} from '@mui/material';
import {
  Phone as PhoneIcon,
  Add as AddIcon,
  Calculate as EstimateIcon,
} from '@mui/icons-material';
import type { ClientSummary, MarginColor } from '../../../types/clientDashboard.types';

interface ClientHeaderProps {
  summary: ClientSummary | null;
  loading: boolean;
  onNewTask?: () => void;
  onNewEstimate?: () => void;
}

const marginColorMap: Record<MarginColor, string> = {
  green: '#4caf50',
  yellow: '#ff9800',
  red: '#f44336',
};

const ClientHeader: React.FC<ClientHeaderProps> = ({
  summary,
  loading,
  onNewTask,
  onNewEstimate,
}) => {
  if (loading) {
    return (
      <Paper sx={{ p: 3, mb: 2 }}>
        <Skeleton variant="text" width="60%" height={40} />
        <Skeleton variant="text" width="40%" />
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {[1, 2, 3].map(i => (
            <Grid key={i} size={{ xs: 12, md: 4 }}>
              <Skeleton variant="rounded" height={80} />
            </Grid>
          ))}
        </Grid>
      </Paper>
    );
  }

  if (!summary) return null;

  const kpis = [
    {
      label: 'Balance',
      value: `$${summary.balance.toLocaleString()}`,
      color: summary.balance > 0 ? '#f44336' : '#4caf50',
      subtitle: summary.balance > 0 ? 'Outstanding' : 'Paid up',
    },
    {
      label: 'Profit',
      value: `$${summary.profit.toLocaleString()}`,
      color: marginColorMap[summary.marginColor],
      subtitle: `${summary.marginPercent.toFixed(1)}% margin`,
    },
    {
      label: 'Total Spent',
      value: `$${summary.totalSpent.toLocaleString()}`,
      color: '#1976d2',
      subtitle: `of $${summary.estimateTotal.toLocaleString()} estimated`,
    },
  ];

  return (
    <Paper sx={{ p: 3, mb: 2 }}>
      {/* Client info */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight="bold">
          {summary.clientName}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {summary.clientAddress}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Chip label={summary.clientType} size="small" />
          {summary.clientPhone && (
            <Chip
              icon={<PhoneIcon />}
              label={summary.clientPhone}
              size="small"
              component="a"
              href={`tel:${summary.clientPhone}`}
              clickable
            />
          )}
        </Stack>
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={2}>
        {kpis.map(kpi => (
          <Grid key={kpi.label} size={{ xs: 12, sm: 4 }}>
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderLeft: 4,
                borderLeftColor: kpi.color,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {kpi.label}
              </Typography>
              <Typography variant="h5" fontWeight="bold" sx={{ color: kpi.color }}>
                {kpi.value}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {kpi.subtitle}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* Quick Actions */}
      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        {summary.clientPhone && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<PhoneIcon />}
            component="a"
            href={`tel:${summary.clientPhone}`}
          >
            Call
          </Button>
        )}
        {onNewTask && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={onNewTask}
          >
            New Task
          </Button>
        )}
        {onNewEstimate && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<EstimateIcon />}
            onClick={onNewEstimate}
          >
            New Estimate
          </Button>
        )}
      </Stack>
    </Paper>
  );
};

export default ClientHeader;
