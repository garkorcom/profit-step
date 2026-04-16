/**
 * TransactionRow — Single table row rendering for a reconciliation transaction.
 *
 * Extracted from ReconciliationPage.tsx (the most complex piece of JSX).
 */
import React from 'react';
import {
  TableRow, TableCell, Box, Typography, Tooltip,
  Checkbox, IconButton, Button, Chip,
  TextField, InputAdornment, Select, MenuItem,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import UndoIcon from '@mui/icons-material/Undo';
import VerifiedIcon from '@mui/icons-material/Verified';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import RestoreIcon from '@mui/icons-material/Restore';
import TelegramIcon from '@mui/icons-material/Telegram';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CategoryChipPicker from '../crm/CategoryChipPicker';
import {
  type EnrichedTx,
  type ReconcileTx,
  type EmployeeOption,
  isTampaArea,
  renderDate,
} from './types';

interface TransactionRowProps {
  t: EnrichedTx;
  view: 'draft' | 'approved' | 'ignored';
  isSelected: boolean;
  isInlineApproved: boolean;
  isDuplicate: boolean;
  submitting: boolean;
  employees: EmployeeOption[];
  projects: { id: string; name: string }[];
  onSelect: (id: string) => void;
  onUpdate: (id: string, field: keyof ReconcileTx, value: unknown) => void;
  onApproveSingle: (id: string) => void;
  onIgnore: (id: string) => void;
  onRestore: (id: string) => void;
  onUndo: (id: string) => void;
  onVerify: (id: string, currentlyVerified: boolean) => void;
  onOpenNote: (id: string) => void;
  onOpenAskDialog: (id: string) => void;
}

const TransactionRow: React.FC<TransactionRowProps> = ({
  t, view, isSelected, isInlineApproved, isDuplicate, submitting,
  employees, projects,
  onSelect, onUpdate, onApproveSingle, onIgnore, onRestore,
  onUndo, onVerify, onOpenNote, onOpenAskDialog,
}) => {
  const isLow = view === 'draft' && t.confidence === 'low';
  const loc = t._location;
  const isTampa = isTampaArea(loc);
  const bg = isInlineApproved ? '#e8f5e9' : isLow ? '#fefce8' : isTampa ? '#fff8e1' : '#fff';

  return (
    <TableRow sx={{ backgroundColor: bg, opacity: isInlineApproved ? 0.85 : 1, transition: 'background-color 0.3s ease' }} hover>
      {view === 'draft' && (
        <TableCell padding="checkbox">
          <Checkbox size="small" checked={isSelected} onChange={() => onSelect(t.id)} />
        </TableCell>
      )}
      {/* Date */}
      <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{renderDate(t.date)}</TableCell>
      {/* Merchant + Location + Raw (merged) */}
      <TableCell>
        <Tooltip title={t.rawDescription || ''} placement="bottom-start" arrow>
          <Box sx={{ overflow: 'hidden' }}>
            <Box display="flex" alignItems="center" gap={0.5}>
              {isInlineApproved ? (
                <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
              ) : isLow ? (
                <WarningAmberIcon sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0 }} />
              ) : (
                <CheckCircleIcon sx={{ fontSize: 14, color: 'success.light', flexShrink: 0 }} />
              )}
              <Typography variant="body2" fontWeight="bold" noWrap>{t.cleanMerchant}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.3 }}>
              {loc && (
                <Chip label={loc} size="small" color={isTampa ? 'warning' : 'default'} variant={isTampa ? 'filled' : 'outlined'} sx={{ fontSize: '0.65rem', height: 18 }} />
              )}
              {isDuplicate && (
                <Chip label="Дубль?" size="small" color="warning" variant="filled" sx={{ fontSize: '0.65rem', height: 18, fontWeight: 'bold' }} />
              )}
            </Box>
          </Box>
        </Tooltip>
      </TableCell>
      {/* Amount */}
      <TableCell>
        {view === 'draft' && !isInlineApproved ? (
          <TextField
            size="small"
            type="number"
            value={t.amount}
            onChange={e => onUpdate(t.id, 'amount', parseFloat(e.target.value) || 0)}
            slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment>, style: { textAlign: 'right' } } }}
            sx={{ width: 105 }}
          />
        ) : (
          <Typography fontWeight="bold" fontSize="0.85rem" color={t.amount < 0 ? 'error.main' : 'text.primary'}>
            ${Math.abs(t.amount).toFixed(2)}
          </Typography>
        )}
      </TableCell>
      {/* Type */}
      <TableCell>
        <Select size="small" value={t.paymentType || 'cash'} onChange={e => onUpdate(t.id, 'paymentType', e.target.value)} sx={{ minWidth: 90, fontSize: '0.8rem', bgcolor: 'white' }} disabled={view !== 'draft' || isInlineApproved}>
          <MenuItem value="company">🏢 Комп.</MenuItem>
          <MenuItem value="cash">💵 Личн.</MenuItem>
        </Select>
      </TableCell>
      {/* Employee (for personal expenses) */}
      <TableCell>
        {t.paymentType === 'cash' ? (
          <Select
            size="small"
            value={t.employeeId || ''}
            onChange={e => {
              const emp = employees.find(em => em.id === e.target.value);
              onUpdate(t.id, 'employeeId', e.target.value || null);
              onUpdate(t.id, 'employeeName', emp?.name || null);
            }}
            displayEmpty
            disabled={view !== 'draft' || isInlineApproved}
            sx={{ minWidth: 110, fontSize: '0.75rem', bgcolor: 'white' }}
          >
            <MenuItem value=""><em>—</em></MenuItem>
            {employees.map(emp => <MenuItem key={emp.id} value={emp.id}>{emp.name}</MenuItem>)}
          </Select>
        ) : (
          <Typography variant="caption" color="text.disabled">—</Typography>
        )}
      </TableCell>
      {/* Category -- icon picker */}
      <TableCell>
        <CategoryChipPicker
          value={t.categoryId || 'other'}
          onChange={(val) => onUpdate(t.id, 'categoryId', val)}
          disabled={view !== 'draft' || isInlineApproved}
        />
      </TableCell>
      {/* Project */}
      <TableCell>
        <Select size="small" value={t.projectId || ''} onChange={e => onUpdate(t.id, 'projectId', e.target.value)} disabled={t.paymentType !== 'company' || view !== 'draft' || isInlineApproved} displayEmpty sx={{ minWidth: 140, fontSize: '0.8rem', bgcolor: 'white' }}>
          <MenuItem value=""><em>—</em></MenuItem>
          {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </Select>
      </TableCell>
      {/* Actions */}
      <TableCell align="center">
        {view === 'approved' ? (
          <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
            <Tooltip title={t.verifiedBy ? `Проверил: ${t.verifiedBy}` : 'Отметить'}>
              <Checkbox size="small" checked={!!t.verifiedBy} onChange={() => onVerify(t.id, !!t.verifiedBy)} icon={<VerifiedIcon color="disabled" />} checkedIcon={<VerifiedIcon color="success" />} sx={{ p: 0.3 }} />
            </Tooltip>
            <Tooltip title="Заметка">
              <IconButton size="small" onClick={() => onOpenNote(t.id)} sx={{ p: 0.3 }}>
                {t.note ? <ChatBubbleIcon fontSize="small" color="info" /> : <ChatBubbleOutlineIcon fontSize="small" color="disabled" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Отменить">
              <span><Button size="small" color="error" onClick={() => onUndo(t.id)} disabled={submitting} sx={{ minWidth: 'auto', p: 0.3 }}><UndoIcon fontSize="small" /></Button></span>
            </Tooltip>
          </Box>
        ) : view === 'ignored' ? (
          <Tooltip title="Восстановить в черновики">
            <IconButton size="small" color="primary" onClick={() => onRestore(t.id)}>
              <RestoreIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : isInlineApproved ? (
          <Tooltip title="✅ Утверждено">
            <VerifiedIcon color="success" fontSize="small" />
          </Tooltip>
        ) : (
          <Box display="flex" alignItems="center" justifyContent="center" gap={0}>
            <Tooltip title="Утвердить">
              <Checkbox size="small" checked={false} onChange={() => onApproveSingle(t.id)} icon={<VerifiedIcon color="disabled" />} checkedIcon={<VerifiedIcon color="success" />} disabled={submitting} sx={{ p: 0.3 }} />
            </Tooltip>
            <Tooltip title="Скрыть">
              <IconButton size="small" onClick={() => onIgnore(t.id)} sx={{ p: 0.3 }}>
                <VisibilityOffIcon fontSize="small" color="disabled" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Заметка">
              <IconButton size="small" onClick={() => onOpenNote(t.id)} sx={{ p: 0.3 }}>
                {t.note ? <ChatBubbleIcon fontSize="small" color="info" /> : <ChatBubbleOutlineIcon fontSize="small" color="disabled" />}
              </IconButton>
            </Tooltip>
            {t.employeeId && (
              t.clarificationStatus === 'pending' ? (
                <Tooltip title="Ожидает ответа">
                  <HourglassEmptyIcon fontSize="small" color="warning" sx={{ ml: 0.3 }} />
                </Tooltip>
              ) : (
                <Tooltip title="Спросить в Telegram">
                  <IconButton size="small" onClick={() => onOpenAskDialog(t.id)} sx={{ p: 0.3 }}>
                    <TelegramIcon fontSize="small" color="primary" />
                  </IconButton>
                </Tooltip>
              )
            )}
          </Box>
        )}
      </TableCell>
    </TableRow>
  );
};

export default TransactionRow;
