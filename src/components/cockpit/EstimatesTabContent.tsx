/**
 * @fileoverview EstimatesTabContent — Displays linked estimates for a task
 * Extracted from UnifiedCockpitPage inline component.
 * @module components/cockpit/EstimatesTabContent
 */

import React from 'react';
import {
  Box, Typography, Paper, Chip, Stack, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import { Receipt as EstimateIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { Estimate } from '../../types/estimate.types';
import { ESTIMATE_STATUS_COLORS, ESTIMATE_STATUS_LABELS } from './cockpit.types';
import { format as formatDate } from 'date-fns';
import { ru } from 'date-fns/locale';

interface EstimatesTabContentProps {
  estimates: Estimate[];
  loading: boolean;
  expandedId: string | null;
  onToggle: (id: string) => void;
}

const EstimatesTabContent: React.FC<EstimatesTabContentProps> = ({
  estimates, loading, expandedId, onToggle,
}) => {
  if (loading) return <Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>;

  if (estimates.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', borderStyle: 'dashed' }}>
        <EstimateIcon sx={{ fontSize: 48, color: 'grey.400', mb: 1 }} />
        <Typography color="text.secondary">Нет смет для этого клиента</Typography>
        <Typography variant="caption" color="text.secondary">
          Создайте смету на странице Estimates
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={1.5}>
      {estimates.map(est => {
        const isExpanded = expandedId === est.id;
        const createdDate = est.createdAt?.toDate ? formatDate(est.createdAt.toDate(), 'dd MMM yyyy', { locale: ru }) : '—';
        return (
          <Paper
            key={est.id}
            variant="outlined"
            sx={{
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
            }}
            onClick={() => onToggle(est.id)}
          >
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box flex={1}>
                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {est.number}
                  </Typography>
                  <Chip
                    label={ESTIMATE_STATUS_LABELS[est.status] || est.status}
                    size="small"
                    sx={{
                      bgcolor: ESTIMATE_STATUS_COLORS[est.status] || '#9e9e9e',
                      color: '#fff',
                      fontWeight: 600,
                      height: 22,
                      fontSize: '0.7rem',
                    }}
                  />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {est.clientName} · {createdDate}
                </Typography>
              </Box>
              <Typography variant="h6" fontWeight={700} color="primary.main">
                ${est.total?.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Typography>
              <ExpandMoreIcon sx={{
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform 0.2s',
              }} />
            </Box>

            {isExpanded && (
              <Box sx={{ px: 2, pb: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                <Table size="small" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Описание</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 600 }}>Кол-во</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Цена</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>Итого</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {est.items.map((item, idx) => (
                      <TableRow key={item.id || idx}>
                        <TableCell>
                          <Box>
                            <Typography variant="body2">{item.description}</Typography>
                            <Chip label={item.type} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', mt: 0.5 }} />
                          </Box>
                        </TableCell>
                        <TableCell align="center">{item.quantity}</TableCell>
                        <TableCell align="right">${item.unitPrice.toFixed(2)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>${item.total.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end', gap: 3 }}>
                  <Typography variant="body2" color="text.secondary">
                    Subtotal: <strong>${est.subtotal?.toFixed(2)}</strong>
                  </Typography>
                  {est.taxAmount > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      Tax ({est.taxRate}%): <strong>${est.taxAmount?.toFixed(2)}</strong>
                    </Typography>
                  )}
                  <Typography variant="body1" fontWeight={700} color="primary.main">
                    Total: ${est.total?.toFixed(2)}
                  </Typography>
                </Box>
                {est.notes && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    📝 {est.notes}
                  </Typography>
                )}
              </Box>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
};

export default EstimatesTabContent;
