/**
 * CategoryChipPicker — compact emoji-based category selector.
 * Shows a small chip; click opens a popover grid of categories.
 */
import React, { useState } from 'react';
import { Chip, Popover, Box, Tooltip } from '@mui/material';

const CATEGORIES: { id: string; emoji: string; label: string }[] = [
  { id: 'materials', emoji: '🧱', label: 'Материалы' },
  { id: 'tools', emoji: '🛠️', label: 'Инструменты' },
  { id: 'reimbursement', emoji: '💷', label: 'Возмещение' },
  { id: 'fuel', emoji: '⛽', label: 'Топливо' },
  { id: 'housing', emoji: '🏠', label: 'Жилье' },
  { id: 'food', emoji: '🍔', label: 'Питание' },
  { id: 'permit', emoji: '📄', label: 'Документы' },
  { id: 'salary', emoji: '👷', label: 'ЗП' },
  { id: 'income', emoji: '📈', label: 'Доход' },
  { id: 'other', emoji: '📦', label: 'Прочее' },
];

interface Props {
  value: string;
  onChange: (categoryId: string) => void;
  disabled?: boolean;
}

const CategoryChipPicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const current = CATEGORIES.find(c => c.id === value) || CATEGORIES[CATEGORIES.length - 1];

  const handleSelect = (id: string) => {
    onChange(id);
    setAnchorEl(null);
  };

  return (
    <>
      <Tooltip title={current.label} arrow>
        <Chip
          label={`${current.emoji} ${current.label.slice(0, 5)}`}
          size="small"
          variant={disabled ? 'filled' : 'outlined'}
          onClick={disabled ? undefined : (e) => setAnchorEl(e.currentTarget)}
          sx={{
            cursor: disabled ? 'default' : 'pointer',
            fontSize: '0.78rem',
            fontWeight: 'bold',
            bgcolor: disabled ? '#f5f5f5' : 'white',
            '&:hover': disabled ? {} : { bgcolor: '#e3f2fd' },
          }}
        />
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { p: 1, borderRadius: 2 } } }}
      >
        <Box display="grid" gridTemplateColumns="1fr 1fr" gap={0.5} sx={{ minWidth: 200 }}>
          {CATEGORIES.map(c => (
            <Chip
              key={c.id}
              label={`${c.emoji} ${c.label}`}
              size="small"
              variant={c.id === value ? 'filled' : 'outlined'}
              color={c.id === value ? 'primary' : 'default'}
              onClick={() => handleSelect(c.id)}
              sx={{
                cursor: 'pointer',
                fontSize: '0.78rem',
                justifyContent: 'flex-start',
                '&:hover': { bgcolor: c.id === value ? undefined : '#e8f5e9' },
              }}
            />
          ))}
        </Box>
      </Popover>
    </>
  );
};

export default CategoryChipPicker;
