/**
 * BulkActionToolbar — Selected count, bulk category/type, approve/ignore buttons.
 *
 * Extracted from ReconciliationPage.tsx.
 */
import React from 'react';
import { Paper, Typography, Select, MenuItem, Button } from '@mui/material';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { COST_CATEGORY_LABELS } from './types';

interface BulkActionToolbarProps {
  selectedCount: number;
  submitting: boolean;
  onBulkUpdate: (field: 'categoryId' | 'paymentType', value: string) => void;
  onApproveSelected: () => void;
  onBulkIgnore: () => void;
  onClearSelection: () => void;
}

const BulkActionToolbar: React.FC<BulkActionToolbarProps> = ({
  selectedCount,
  submitting,
  onBulkUpdate,
  onApproveSelected,
  onBulkIgnore,
  onClearSelection,
}) => {
  return (
    <Paper sx={{ p: 1.5, mb: 2, display: 'flex', alignItems: 'center', gap: 2, bgcolor: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 2 }} elevation={0}>
      <Typography variant="body2" fontWeight="bold">Выбрано: {selectedCount}</Typography>
      <Select size="small" displayEmpty value="" onChange={e => { if (e.target.value) onBulkUpdate('categoryId', e.target.value); }} sx={{ minWidth: 150, bgcolor: 'white' }}>
        <MenuItem value="" disabled><em>Категория...</em></MenuItem>
        {Object.keys(COST_CATEGORY_LABELS).map(c => <MenuItem key={c} value={c}>{COST_CATEGORY_LABELS[c]}</MenuItem>)}
      </Select>
      <Select size="small" displayEmpty value="" onChange={e => { if (e.target.value) onBulkUpdate('paymentType', e.target.value); }} sx={{ minWidth: 140, bgcolor: 'white' }}>
        <MenuItem value="" disabled><em>Тип...</em></MenuItem>
        <MenuItem value="company">🏢 Компания</MenuItem>
        <MenuItem value="cash">💵 Личные</MenuItem>
      </Select>
      <Button size="small" variant="contained" color="success" onClick={onApproveSelected} disabled={submitting}>
        ✅ Утвердить ({selectedCount})
      </Button>
      <Button size="small" variant="outlined" color="warning" startIcon={<VisibilityOffIcon />} onClick={onBulkIgnore} disabled={submitting}>
        Скрыть ({selectedCount})
      </Button>
      <Button size="small" variant="text" onClick={onClearSelection}>Сбросить</Button>
    </Paper>
  );
};

export default BulkActionToolbar;
