/**
 * AskEmployeeDialog — Telegram "ask employee" dialog for transaction clarification.
 *
 * Extracted from ReconciliationPage.tsx (lines ~1268-1328).
 */
import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Paper, TextField, Button, CircularProgress,
} from '@mui/material';
import TelegramIcon from '@mui/icons-material/Telegram';
import { type ReconcileTx, renderDate } from './types';

interface AskEmployeeDialogProps {
  open: boolean;
  transaction: ReconcileTx | null;
  message: string;
  onMessageChange: (value: string) => void;
  sending: boolean;
  onSend: () => void;
  onClose: () => void;
}

const AskEmployeeDialog: React.FC<AskEmployeeDialogProps> = ({
  open, transaction, message, onMessageChange, sending, onSend, onClose,
}) => {
  return (
    <Dialog
      open={open}
      onClose={() => { if (!sending) onClose(); }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <TelegramIcon color="primary" />
          Спросить сотрудника
        </Box>
      </DialogTitle>
      <DialogContent>
        {transaction && (
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              ��тправить Telegram-сообщение сотруднику <strong>{transaction.employeeName || '—'}</strong> с вопросом о транзакции:
            </Typography>
            <Paper variant="outlined" sx={{ p: 1.5, my: 1.5, bgcolor: '#f5f5f5' }}>
              <Typography variant="body2">
                <strong>${Math.abs(transaction.amount).toFixed(2)}</strong> &bull; {transaction.cleanMerchant} &bull; {renderDate(transaction.date)}
              </Typography>
              {transaction.rawDescription && (
                <Typography variant="caption" color="text.secondary">{transaction.rawDescription}</Typography>
              )}
            </Paper>
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              placeholder="Можешь пояснить эту транзакцию? Это рабочая трата или личная?"
              value={message}
              onChange={e => onMessageChange(e.target.value)}
              disabled={sending}
              sx={{ mt: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Оставьте пустым для стандартного вопроса
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          Отмена
        </Button>
        <Button
          variant="contained"
          onClick={onSend}
          disabled={sending}
          startIcon={sending ? <CircularProgress size={16} /> : <TelegramIcon />}
        >
          {sending ? 'Отправка...' : 'Отправить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AskEmployeeDialog;
