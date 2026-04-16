/**
 * FilterBar — Search input, month picker, amount range, and quick filter buttons.
 *
 * Extracted from ReconciliationPage.tsx.
 */
import React from 'react';
import {
  Box, Typography, TextField, InputAdornment,
  Select, MenuItem, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import FilterListIcon from '@mui/icons-material/FilterList';
import {
  type QuickFilter,
  type EnrichedTx,
  type FilterStats,
  MONTH_LABELS,
  getMonthKey,
} from './types';

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  filterMonth: string;
  onFilterMonthChange: (value: string) => void;
  availableMonths: string[];
  enrichedTransactions: EnrichedTx[];
  amountMin: number | '';
  onAmountMinChange: (value: number | '') => void;
  amountMax: number | '';
  onAmountMaxChange: (value: number | '') => void;
  quickFilter: QuickFilter;
  onQuickFilterChange: (value: QuickFilter) => void;
  monthFilteredTransactions: EnrichedTx[];
  filterStats: FilterStats;
  view: 'draft' | 'approved' | 'ignored';
}

const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery, onSearchChange,
  filterMonth, onFilterMonthChange,
  availableMonths, enrichedTransactions,
  amountMin, onAmountMinChange,
  amountMax, onAmountMaxChange,
  quickFilter, onQuickFilterChange,
  monthFilteredTransactions,
  filterStats,
  view,
}) => {
  return (
    <Box mb={2} display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
      {/* Search */}
      <TextField
        size="small"
        placeholder="Поиск по контрагенту..."
        value={searchQuery}
        onChange={e => onSearchChange(e.target.value)}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        sx={{ width: 220, bgcolor: 'white' }}
      />

      {/* Month */}
      <Box display="flex" alignItems="center" gap={0.5}>
        <CalendarMonthIcon color="action" fontSize="small" />
        <Select size="small" value={filterMonth} onChange={e => onFilterMonthChange(e.target.value)} sx={{ minWidth: 170, bgcolor: 'white' }}>
          <MenuItem value="all">Все месяцы</MenuItem>
          {availableMonths.map(mk => {
            const [y, m] = mk.split('-');
            const count = enrichedTransactions.filter(t => getMonthKey(t.date) === mk).length;
            return <MenuItem key={mk} value={mk}>{MONTH_LABELS[parseInt(m, 10) - 1]} {y} ({count})</MenuItem>;
          })}
        </Select>
      </Box>

      {/* Amount Range */}
      <Box display="flex" alignItems="center" gap={0.5}>
        <TextField
          size="small"
          type="number"
          placeholder="От $"
          value={amountMin}
          onChange={e => onAmountMinChange(e.target.value === '' ? '' : Number(e.target.value))}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
          sx={{ width: 95, bgcolor: 'white' }}
        />
        <Typography variant="caption" color="text.secondary">–</Typography>
        <TextField
          size="small"
          type="number"
          placeholder="До $"
          value={amountMax}
          onChange={e => onAmountMaxChange(e.target.value === '' ? '' : Number(e.target.value))}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }}
          sx={{ width: 95, bgcolor: 'white' }}
        />
      </Box>

      {/* Quick Filters -- scrollable */}
      {view === 'draft' && (
        <Box display="flex" alignItems="center" gap={0.5} sx={{ overflowX: 'auto', flexShrink: 0 }}>
          <FilterListIcon color="action" fontSize="small" />
          <ToggleButtonGroup size="small" value={quickFilter} exclusive onChange={(_, v) => v && onQuickFilterChange(v)}>
            <ToggleButton value="all">All ({monthFilteredTransactions.length})</ToggleButton>
            <ToggleButton value="tampa">🏗️ Tampa ({filterStats.tampa.count})</ToggleButton>
            <ToggleButton value="company">🏢 Комп. ({filterStats.company.count})</ToggleButton>
            <ToggleButton value="personal">👤 Личн. ({filterStats.personal.count})</ToggleButton>
            <ToggleButton value="fuel">⛽ Топливо ({filterStats.fuel.count})</ToggleButton>
            <ToggleButton value="unassigned">❓ Без кат. ({filterStats.unassigned.count})</ToggleButton>
            {filterStats.duplicates.count > 0 && (
              <ToggleButton value="duplicates" sx={{ color: 'warning.main' }}>
                ⚠️ Дубли ({filterStats.duplicates.count})
              </ToggleButton>
            )}
          </ToggleButtonGroup>
        </Box>
      )}
    </Box>
  );
};

export default FilterBar;
