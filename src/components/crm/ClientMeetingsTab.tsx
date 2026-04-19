import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DoneAllIcon from '@mui/icons-material/DoneAll';

import {
  Meeting,
  MeetingStatus,
  MeetingType,
  MEETING_STATUS_LABELS,
  MEETING_TYPE_LABELS,
} from '../../types/meeting.types';
import {
  createMeeting,
  listMeetings,
  updateMeeting,
} from '../../api/meetingsApi';

interface Props {
  clientId: string;
  clientName?: string;
}

const TYPE_OPTIONS: MeetingType[] = [
  'first_contact',
  'site_survey',
  'estimate_review',
  'contract_signing',
  'site_visit',
  'stage_acceptance',
  'final_handover',
  'service',
];

const statusColor = (s: MeetingStatus): 'default' | 'primary' | 'success' | 'warning' | 'error' => {
  switch (s) {
    case 'scheduled': return 'primary';
    case 'in_progress': return 'warning';
    case 'completed': return 'success';
    case 'cancelled': return 'default';
    case 'no_show': return 'error';
  }
};

const fmtDate = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const ClientMeetingsTab: React.FC<Props> = ({ clientId, clientName }) => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<MeetingType>('site_survey');
  const [createTitle, setCreateTitle] = useState('');
  const [createStartAt, setCreateStartAt] = useState('');
  const [createLocation, setCreateLocation] = useState('');
  const [createAgenda, setCreateAgenda] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Complete-dialog state (outcome gate for status=completed)
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeMeetingId, setCompleteMeetingId] = useState<string | null>(null);
  const [completeOutcome, setCompleteOutcome] = useState('');
  const [completeNextSteps, setCompleteNextSteps] = useState('');
  const [completeSubmitting, setCompleteSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMeetings({ clientId, limit: 100 });
      setMeetings(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreate = async () => {
    if (!createStartAt) {
      setError('Укажи дату и время');
      return;
    }
    setCreateSubmitting(true);
    try {
      await createMeeting({
        clientId,
        type: createType,
        title: createTitle || undefined,
        startAt: new Date(createStartAt).toISOString(),
        location: createLocation || undefined,
        agenda: createAgenda || undefined,
      });
      setCreateOpen(false);
      setCreateTitle('');
      setCreateStartAt('');
      setCreateLocation('');
      setCreateAgenda('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create meeting');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const openComplete = (m: Meeting) => {
    setCompleteMeetingId(m.id);
    setCompleteOutcome(m.outcome || '');
    setCompleteNextSteps(m.nextSteps || '');
    setCompleteOpen(true);
  };

  const handleComplete = async () => {
    if (!completeMeetingId || !completeOutcome.trim()) {
      setError('Outcome обязателен для завершения встречи (§5.4)');
      return;
    }
    setCompleteSubmitting(true);
    try {
      await updateMeeting(completeMeetingId, {
        status: 'completed',
        outcome: completeOutcome.trim(),
        nextSteps: completeNextSteps.trim() || undefined,
      });
      setCompleteOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete meeting');
    } finally {
      setCompleteSubmitting(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h6">
          Встречи {clientName ? `— ${clientName}` : ''}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          Запланировать встречу
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
      ) : meetings.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <EventAvailableIcon sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
          <Typography color="text.secondary">Встреч с этим клиентом ещё нет</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Тип</TableCell>
                <TableCell>Когда</TableCell>
                <TableCell>Где</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Outcome</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {meetings.map(m => (
                <TableRow key={m.id} hover>
                  <TableCell>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2">{MEETING_TYPE_LABELS[m.type]}</Typography>
                      {m.title && <Typography variant="caption" color="text.secondary">· {m.title}</Typography>}
                    </Stack>
                  </TableCell>
                  <TableCell>{fmtDate(m.startAt)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {m.location || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={MEETING_STATUS_LABELS[m.status]}
                      color={statusColor(m.status)}
                      size="small"
                      icon={m.status === 'completed' ? <DoneAllIcon /> : undefined}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color={m.outcome ? 'text.primary' : 'text.secondary'}>
                      {m.outcome ? m.outcome.slice(0, 80) : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {m.status === 'scheduled' && (
                      <Button
                        size="small"
                        startIcon={<CheckCircleIcon />}
                        onClick={() => openComplete(m)}
                      >
                        Завершить
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Запланировать встречу</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <FormControl fullWidth>
              <InputLabel id="type-label">Тип</InputLabel>
              <Select
                labelId="type-label"
                value={createType}
                label="Тип"
                onChange={e => setCreateType(e.target.value as MeetingType)}
              >
                {TYPE_OPTIONS.map(t => (
                  <MenuItem key={t} value={t}>{MEETING_TYPE_LABELS[t]}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Название (необязательно)"
              value={createTitle}
              onChange={e => setCreateTitle(e.target.value)}
              fullWidth
            />
            <TextField
              label="Когда"
              type="datetime-local"
              value={createStartAt}
              onChange={e => setCreateStartAt(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
              required
            />
            <TextField
              label="Место (адрес / ссылка на видеозвонок)"
              value={createLocation}
              onChange={e => setCreateLocation(e.target.value)}
              fullWidth
            />
            <TextField
              label="Повестка"
              value={createAgenda}
              onChange={e => setCreateAgenda(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={createSubmitting}>Отмена</Button>
          <Button onClick={handleCreate} variant="contained" disabled={createSubmitting}>
            {createSubmitting ? 'Создаю…' : 'Запланировать'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Complete dialog */}
      <Dialog open={completeOpen} onClose={() => setCompleteOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Завершить встречу</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Outcome обязателен — без него сделку дальше двигать нельзя (§5.4).
          </Alert>
          <Stack spacing={2}>
            <TextField
              label="Что решили?"
              value={completeOutcome}
              onChange={e => setCompleteOutcome(e.target.value)}
              fullWidth
              multiline
              rows={3}
              required
              autoFocus
            />
            <TextField
              label="Следующие шаги"
              value={completeNextSteps}
              onChange={e => setCompleteNextSteps(e.target.value)}
              fullWidth
              multiline
              rows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteOpen(false)} disabled={completeSubmitting}>Отмена</Button>
          <Button
            onClick={handleComplete}
            variant="contained"
            disabled={completeSubmitting || !completeOutcome.trim()}
          >
            {completeSubmitting ? 'Сохраняю…' : 'Завершить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ClientMeetingsTab;
