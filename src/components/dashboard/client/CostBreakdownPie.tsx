/**
 * CostBreakdownPie — donut chart showing cost categories.
 * Clickable sectors open a detail list.
 */

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Skeleton,
  IconButton,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { CostsBreakdown, CostCategory } from '../../../types/clientDashboard.types';

interface CostBreakdownPieProps {
  data: CostsBreakdown | null;
  loading: boolean;
}

const COLORS: Record<string, string> = {
  materials: '#1976d2',
  labor: '#4caf50',
  subcontractors: '#ff9800',
  other: '#9e9e9e',
};

const LABELS: Record<string, string> = {
  materials: 'Materials',
  labor: 'Labor',
  subcontractors: 'Subcontractors',
  other: 'Other',
};

const CostBreakdownPie: React.FC<CostBreakdownPieProps> = ({ data, loading }) => {
  const [selectedCategory, setSelectedCategory] = useState<CostCategory | null>(null);

  if (loading) {
    return <Skeleton variant="circular" width={200} height={200} sx={{ mx: 'auto' }} />;
  }

  if (!data || data.total === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No costs recorded yet
        </Typography>
      </Paper>
    );
  }

  const chartData = data.categories.map(c => ({
    name: LABELS[c.category] || c.category,
    value: c.amount,
    category: c,
  }));

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Cost Breakdown
        </Typography>

        <Box sx={{ position: 'relative', width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
                style={{ cursor: 'pointer' }}
                onClick={(_data, index) => {
                  setSelectedCategory(chartData[index]?.category ?? null);
                }}
              >
                {chartData.map((entry, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={COLORS[entry.category.category] || '#ccc'}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => `$${value.toLocaleString()}`}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Center label */}
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography variant="h6" fontWeight="bold">
              ${data.total.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total
            </Typography>
          </Box>
        </Box>

        {/* Legend */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1, justifyContent: 'center' }}>
          {chartData.map(entry => (
            <Box
              key={entry.name}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: 'pointer',
              }}
              onClick={() => setSelectedCategory(entry.category)}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  bgcolor: COLORS[entry.category.category] || '#ccc',
                }}
              />
              <Typography variant="caption">
                {entry.name} ({entry.category.percent}%)
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      {/* Drill-down dialog */}
      <Dialog
        open={!!selectedCategory}
        onClose={() => setSelectedCategory(null)}
        maxWidth="sm"
        fullWidth
      >
        {selectedCategory && (
          <>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {LABELS[selectedCategory.category]} — ${selectedCategory.amount.toLocaleString()}
              <IconButton size="small" onClick={() => setSelectedCategory(null)}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              {selectedCategory.items.length === 0 ? (
                <Typography color="text.secondary">No items</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Amount</TableCell>
                      <TableCell>Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedCategory.items.map(item => (
                      <TableRow key={item.id}>
                        <TableCell>{item.description}</TableCell>
                        <TableCell align="right">${item.amount.toLocaleString()}</TableCell>
                        <TableCell>
                          {item.date ? new Date(item.date).toLocaleDateString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </>
  );
};

export default CostBreakdownPie;
