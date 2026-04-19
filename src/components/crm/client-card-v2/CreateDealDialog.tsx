import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import { createDeal, DealPriority, DealStage } from '../../../api/dealsApi';

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName?: string;
  onCreated?: (dealId: string) => void;
}

const STAGES: { value: DealStage; label: string }[] = [
  { value: 'new', label: 'Новая' },
  { value: 'survey_scheduled', label: 'Замер назначен' },
  { value: 'survey_done', label: 'Замер выполнен' },
  { value: 'estimate_draft', label: 'КП в работе' },
  { value: 'estimate_sent', label: 'КП отправлено' },
  { value: 'negotiation', label: 'Переговоры' },
];

const CreateDealDialog: React.FC<Props> = ({ open, onClose, clientId, clientName, onCreated }) => {
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState<DealStage>('new');
  const [priority, setPriority] = useState<DealPriority>('medium');
  const [valueAmount, setValueAmount] = useState('');
  const [workAddress, setWorkAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setStage('new');
    setPriority('medium');
    setValueAmount('');
    setWorkAddress('');
    setNotes('');
    setError(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        clientId,
        title: title.trim() || `Сделка — ${clientName ?? 'клиент'}`,
        stage,
        priority,
        value: valueAmount ? { amount: parseFloat(valueAmount), currency: 'USD' } : undefined,
        workAddress: workAddress.trim() || undefined,
        notes: notes.trim() || undefined,
        source: 'manual',
      };
      const { dealId } = await createDeal(input);
      onCreated?.(dealId);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать сделку');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Создать сделку{clientName ? ` — ${clientName}` : ''}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Название"
            value={title}
            onChange={e => setTitle(e.target.value)}
            fullWidth
            autoFocus
          />
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="stage-label">Стадия</InputLabel>
              <Select
                labelId="stage-label"
                value={stage}
                label="Стадия"
                onChange={e => setStage(e.target.value as DealStage)}
              >
                {STAGES.map(s => (
                  <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="priority-label">Приоритет</InputLabel>
              <Select
                labelId="priority-label"
                value={priority}
                label="Приоритет"
                onChange={e => setPriority(e.target.value as DealPriority)}
              >
                <MenuItem value="low">Низкий</MenuItem>
                <MenuItem value="medium">Средний</MenuItem>
                <MenuItem value="high">Высокий</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <TextField
            label="Ожидаемая сумма ($)"
            type="number"
            value={valueAmount}
            onChange={e => setValueAmount(e.target.value)}
            fullWidth
          />
          <TextField
            label="Адрес работ (если отличается от клиента)"
            value={workAddress}
            onChange={e => setWorkAddress(e.target.value)}
            fullWidth
          />
          <TextField
            label="Заметка"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            fullWidth
            multiline
            rows={3}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Отмена</Button>
        <Button onClick={submit} variant="contained" disabled={submitting}>
          {submitting ? 'Создаю…' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CreateDealDialog;
