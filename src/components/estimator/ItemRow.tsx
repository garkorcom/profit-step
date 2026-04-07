/**
 * @fileoverview ItemRow + Section — reusable grid components for the estimator.
 * Extracted from ElectricalEstimatorPage inline components.
 * @module components/estimator/ItemRow
 */

import React from 'react';
import {
  Box, Typography, Paper, TextField, IconButton, Tooltip,
  Chip, InputAdornment, Grid,
} from '@mui/material';
import {
  Add as AddIcon, Remove as RemoveIcon, Warning as WarningIcon,
} from '@mui/icons-material';
import { ElectricalItem } from './estimator.types';

// ─── ItemRow ──────────────────────────────────────────────

interface ItemRowProps {
  item: ElectricalItem;
  qty: number;
  onChange: (id: string, value: string) => void;
  category: string;
  isMobile: boolean;
  isEditingRates: boolean;
  onRateChange: (category: string, id: string, field: 'matRate' | 'laborRate', value: string) => void;
  confidence?: number;
  anomaly?: string | null;
  onShowLineage?: (e: React.MouseEvent<HTMLElement>) => void;
}

export const ItemRow = React.memo<ItemRowProps>(({
  item, qty, onChange, category, isMobile, isEditingRates, onRateChange, confidence, anomaly, onShowLineage,
}) => {
  const hasQty = qty > 0;
  const bg = hasQty ? 'primary.50' : 'background.paper';

  const handleIncrement = () => onChange(item.id, (parseInt(String(qty || '0')) + 1).toString());
  const handleDecrement = () => onChange(item.id, Math.max(0, (parseInt(String(qty || '0')) - 1)).toString());

  if (isMobile) {
    return (
      <Paper variant="outlined" sx={{ p: 1, mb: 1, bgcolor: bg, borderColor: hasQty ? 'primary.main' : undefined }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Box display="flex" alignItems="center" gap={1}>
            {anomaly && (
              <Tooltip title={anomaly}>
                <IconButton color="error" size="small" sx={{ p: 0 }} onClick={onShowLineage}>
                  <WarningIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Typography variant="body2" fontWeight="medium">{item.name}</Typography>
            {!!confidence && confidence > 0 && hasQty && (
              <Chip size="small" label={`${confidence}%`} color={confidence > 85 ? 'success' : confidence > 60 ? 'warning' : 'error'} sx={{ height: 16, fontSize: '0.65rem' }} onClick={onShowLineage} />
            )}
          </Box>
          {hasQty && <Chip label={qty} size="small" color="primary" />}
        </Box>

        {isEditingRates ? (
          <Box display="flex" gap={1} mb={1}>
            <TextField label="Mat $" type="number" size="small" value={item.matRate} onChange={(e) => onRateChange(category, item.id, 'matRate', e.target.value)} sx={{ width: 80 }} InputProps={{ style: { fontSize: '0.75rem' } }} />
            <TextField label="Labor Hr" type="number" size="small" value={item.laborRate} onChange={(e) => onRateChange(category, item.id, 'laborRate', e.target.value)} sx={{ width: 80 }} InputProps={{ style: { fontSize: '0.75rem' } }} />
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            Mat: ${item.matRate} | Labor: {item.laborRate}h
          </Typography>
        )}

        <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1}>
          <IconButton size="small" onClick={handleDecrement} disabled={!qty}><RemoveIcon fontSize="small" /></IconButton>
          <TextField type="number" size="small" value={qty || ''} onChange={(e) => onChange(item.id, e.target.value)} placeholder="0" sx={{ width: 60 }} inputProps={{ min: 0, style: { textAlign: 'center' } }} />
          <IconButton size="small" onClick={handleIncrement} color="primary"><AddIcon fontSize="small" /></IconButton>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1, mb: 1, display: 'flex', alignItems: 'center', bgcolor: bg,
        borderColor: hasQty ? 'primary.main' : 'divider',
        transition: 'all 0.2s',
        '&:hover': { bgcolor: hasQty ? 'primary.100' : 'action.hover' }
      }}
    >
      <Box flex={1} mr={2} display="flex" alignItems="center" gap={1}>
        {anomaly && (
          <Tooltip title={anomaly}>
            <IconButton color="error" size="small" sx={{ p: 0 }} onClick={onShowLineage}>
              <WarningIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Typography variant="body2" fontWeight={hasQty ? "bold" : "medium"}>{item.name}</Typography>
        {!!confidence && confidence > 0 && hasQty && (
          <Chip size="small" label={`${confidence}%`} color={confidence > 85 ? 'success' : confidence > 60 ? 'warning' : 'error'} sx={{ height: 16, fontSize: '0.65rem', cursor: 'pointer' }} onClick={onShowLineage} />
        )}
      </Box>

      {isEditingRates ? (
        <>
          <TextField type="number" size="small" value={item.matRate} onChange={(e) => onRateChange(category, item.id, 'matRate', e.target.value)} sx={{ width: 90, mr: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment>, style: { fontSize: '0.875rem' } }} />
          <TextField type="number" size="small" value={item.laborRate} onChange={(e) => onRateChange(category, item.id, 'laborRate', e.target.value)} sx={{ width: 90, mr: 1 }}
            InputProps={{ endAdornment: <InputAdornment position="end">h</InputAdornment>, style: { fontSize: '0.875rem' } }} />
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>${item.matRate}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>{item.laborRate}h</Typography>
        </>
      )}

      <Box display="flex" alignItems="center" sx={{ width: 140, justifyContent: 'center' }}>
        <IconButton size="small" onClick={handleDecrement} disabled={!qty} sx={{ p: 0.5 }}><RemoveIcon fontSize="small" /></IconButton>
        <TextField type="number" size="small" value={qty || ''} onChange={(e) => onChange(item.id, e.target.value)} placeholder="0" sx={{ width: 60, mx: 0.5 }}
          inputProps={{ min: 0, style: { textAlign: 'center', fontWeight: hasQty ? 'bold' : 'normal' } }} />
        <IconButton size="small" onClick={handleIncrement} color="primary" sx={{ p: 0.5 }}><AddIcon fontSize="small" /></IconButton>
      </Box>
    </Paper>
  );
});

ItemRow.displayName = 'ItemRow';

// ─── Section ──────────────────────────────────────────────

interface SectionProps {
  items: ElectricalItem[];
  qtyMap: Record<string, number>;
  onChange: (id: string, value: string) => void;
  title: string;
  icon: React.ReactNode;
  category: string;
  isMobile: boolean;
  isEditingRates: boolean;
  onRateChange: (category: string, id: string, field: 'matRate' | 'laborRate', value: string) => void;
  getConfidence?: (itemId: string) => number;
  getAnomaly?: (itemId: string) => string | null;
  onShowLineage?: (e: React.MouseEvent<HTMLElement>, itemId: string) => void;
}

export const Section = React.memo<SectionProps>(({
  items, qtyMap, onChange, title, icon, category, isMobile, isEditingRates, onRateChange, getConfidence, getAnomaly, onShowLineage,
}) => (
  <Box mb={4}>
    <Box display="flex" alignItems="center" gap={1} mb={2}>
      {icon}
      <Typography variant="h6" color="primary">{title}</Typography>
    </Box>
    {!isMobile && (
      <Box display="flex" px={2} mb={1}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Item</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>Material</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ width: 90, mr: 1, textAlign: 'right' }}>Labor</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ width: 140, textAlign: 'center' }}>Quantity</Typography>
      </Box>
    )}
    <Grid container spacing={1}>
      {items.map((item) => (
        <Grid size={{ xs: 12 }} key={item.id}>
          <ItemRow
            item={item}
            qty={qtyMap[item.id] || 0}
            onChange={onChange}
            category={category}
            isMobile={isMobile}
            isEditingRates={isEditingRates}
            onRateChange={onRateChange}
            confidence={getConfidence ? getConfidence(item.id) : 0}
            anomaly={getAnomaly ? getAnomaly(item.id) : null}
            onShowLineage={(e) => onShowLineage && onShowLineage(e, item.id)}
          />
        </Grid>
      ))}
    </Grid>
  </Box>
));

Section.displayName = 'Section';
