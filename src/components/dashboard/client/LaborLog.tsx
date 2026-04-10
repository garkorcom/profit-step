/**
 * LaborLog — table of employees with hours, cost, efficiency.
 * Sortable columns + period filter (Week/Month/All).
 */

import React, { useState, useMemo } from 'react';
import {
  Paper,
  Typography,
  Table,
  TableContainer,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup,
  Box,
  Skeleton,
} from '@mui/material';
import type { LaborLogData, LaborPeriod, LaborEmployee } from '../../../types/clientDashboard.types';

interface LaborLogProps {
  data: LaborLogData | null;
  loading: boolean;
  period: LaborPeriod;
  onPeriodChange: (period: LaborPeriod) => void;
}

type SortKey = 'employeeName' | 'totalHours' | 'totalCost' | 'lastVisit' | 'sessionCount';
type SortDir = 'asc' | 'desc';

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function timeAgo(isoDate: string): string {
  if (!isoDate) return '—';
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

const LaborLog: React.FC<LaborLogProps> = ({ data, loading, period, onPeriodChange }) => {
  const [sortKey, setSortKey] = useState<SortKey>('totalCost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.employees];
    arr.sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return arr;
  }, [data, sortKey, sortDir]);

  if (loading) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="rounded" height={200} sx={{ mt: 1 }} />
      </Paper>
    );
  }

  const columns: Array<{ key: SortKey; label: string; align?: 'right' | 'left' }> = [
    { key: 'employeeName', label: 'Employee' },
    { key: 'totalHours', label: 'Hours', align: 'right' },
    { key: 'totalCost', label: 'Cost', align: 'right' },
    { key: 'lastVisit', label: 'Last Visit' },
    { key: 'sessionCount', label: 'Sessions', align: 'right' },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2">Labor Log</Typography>
        <ToggleButtonGroup
          size="small"
          value={period}
          exclusive
          onChange={(_, val) => val && onPeriodChange(val as LaborPeriod)}
        >
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {sorted.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          No work sessions for this period
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {columns.map(col => (
                  <TableCell key={col.key} align={col.align}>
                    <TableSortLabel
                      active={sortKey === col.key}
                      direction={sortKey === col.key ? sortDir : 'asc'}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((emp: LaborEmployee) => (
                <TableRow key={emp.employeeId} hover>
                  <TableCell>{emp.employeeName}</TableCell>
                  <TableCell align="right">{formatHours(emp.totalMinutes)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>
                    ${emp.totalCost.toLocaleString()}
                  </TableCell>
                  <TableCell>{timeAgo(emp.lastVisit)}</TableCell>
                  <TableCell align="right">{emp.sessionCount}</TableCell>
                </TableRow>
              ))}
              {/* Totals row */}
              {data && (
                <TableRow sx={{ '& td': { fontWeight: 'bold', borderTop: 2 } }}>
                  <TableCell>TOTAL</TableCell>
                  <TableCell align="right">{data.totals.hours.toFixed(1)}h</TableCell>
                  <TableCell align="right">${data.totals.cost.toLocaleString()}</TableCell>
                  <TableCell />
                  <TableCell align="right">{data.totals.sessions}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default LaborLog;
