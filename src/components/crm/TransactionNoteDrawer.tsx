/**
 * TransactionNoteDrawer — side panel for adding notes/comments to transactions.
 * Notes are stored as a `note` field on the bank_transaction document.
 */
import React, { useState, useEffect } from 'react';
import {
  Drawer, Box, Typography, TextField, Button, IconButton,
  Chip, Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';

const COST_CATEGORY_LABELS: Record<string, string> = {
  materials: '🧱 Материалы',
  tools: '🛠️ Инструменты',
  reimbursement: '💷 Возмещение',
  fuel: '⛽ Топливо',
  housing: '🏠 Жилье',
  food: '🍔 Питание',
  permit: '📄 Документы',
  other: '📦 Прочее',
};

interface TransactionData {
  id: string;
  cleanMerchant: string;
  rawDescription: string;
  amount: number;
  date: string;
  categoryId: string;
  paymentType: string;
  projectName?: string;
  note?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  transaction: TransactionData | null;
  onSaveNote: (txId: string, note: string) => void;
}

const TransactionNoteDrawer: React.FC<Props> = ({ open, onClose, transaction, onSaveNote }) => {
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (transaction) {
      setNoteText(transaction.note || '');
    }
  }, [transaction]);

  const handleSave = async () => {
    if (!transaction) return;
    setSaving(true);
    try {
      onSaveNote(transaction.id, noteText.trim());
    } finally {
      setSaving(false);
    }
  };

  if (!transaction) return null;

  const hasChanged = (noteText.trim()) !== (transaction.note || '').trim();

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 380, p: 0 } }}
    >
      {/* Header */}
      <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderBottom: '1px solid #e0e0e0' }}>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ textTransform: 'capitalize' }}>
              {transaction.cleanMerchant}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {transaction.date}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
      </Box>

      {/* Transaction details */}
      <Box sx={{ p: 2 }}>
        <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
          <Chip
            label={`${transaction.amount < 0 ? '' : '+'}${transaction.amount.toFixed(2)}`}
            size="small"
            color={transaction.amount < 0 ? 'error' : 'success'}
            variant="outlined"
          />
          <Chip
            label={transaction.paymentType === 'company' ? '🏢 Company' : '💵 Personal'}
            size="small"
            variant="outlined"
          />
          <Chip
            label={COST_CATEGORY_LABELS[transaction.categoryId] || transaction.categoryId}
            size="small"
            variant="outlined"
          />
        </Box>

        {transaction.projectName && (
          <Typography variant="body2" color="text.secondary" mb={1}>
            Project: <strong>{transaction.projectName}</strong>
          </Typography>
        )}

        {transaction.rawDescription && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, wordBreak: 'break-word' }}>
            {transaction.rawDescription}
          </Typography>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* Note field */}
        <Typography variant="subtitle2" fontWeight="bold" mb={1}>
          Заметка / Комментарий
        </Typography>
        <TextField
          multiline
          minRows={4}
          maxRows={10}
          fullWidth
          placeholder="Добавьте комментарий к этой транзакции..."
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Button
          variant="contained"
          size="small"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!hasChanged || saving}
          fullWidth
        >
          {saving ? 'Сохранение...' : 'Сохранить заметку'}
        </Button>

        {transaction.note && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
            Last saved note exists
          </Typography>
        )}
      </Box>
    </Drawer>
  );
};

export default TransactionNoteDrawer;
