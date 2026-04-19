import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import EventIcon from '@mui/icons-material/Event';
import WarningIcon from '@mui/icons-material/Warning';
import PersonIcon from '@mui/icons-material/Person';
import EditNoteIcon from '@mui/icons-material/EditNote';

import { Client } from '../../../types/crm.types';
import { ClientInsightsResponse, ClientKPIResponse, appendClientQuickNote } from '../../../api/clientInsightsApi';

interface Props {
  client: Client;
  kpi: ClientKPIResponse | null;
  insights: ClientInsightsResponse | null;
  insightsLoading: boolean;
}

const priorityColor = (p: 'low' | 'medium' | 'high') => {
  if (p === 'high') return 'error';
  if (p === 'medium') return 'warning';
  return 'default';
};

const ClientRightSidebar: React.FC<Props> = ({ client, kpi, insights, insightsLoading }) => {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const saveNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await appendClientQuickNote(client.id, note.trim());
      setNote('');
      setSavedMsg('Заметка сохранена');
      setTimeout(() => setSavedMsg(null), 2000);
    } catch (e) {
      setSavedMsg(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ position: 'sticky', top: 200 }}>
      {/* Next Best Action */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <LightbulbIcon fontSize="small" color="warning" />
          <Typography variant="subtitle2" fontWeight={700}>Next Best Action</Typography>
        </Stack>
        {insightsLoading && !insights ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">AI думает…</Typography>
          </Stack>
        ) : insights?.nextBestAction.suggestion ? (
          <>
            <Stack direction="row" spacing={1} mb={0.5} alignItems="center">
              <Chip
                size="small"
                label={insights.nextBestAction.priority}
                color={priorityColor(insights.nextBestAction.priority) as any}
              />
              <Typography variant="caption" color="text.secondary">
                confidence {Math.round((insights.nextBestAction.confidence ?? 0) * 100)}%
              </Typography>
            </Stack>
            <Typography variant="body2">{insights.nextBestAction.suggestion}</Typography>
            {insights.nextBestAction.reasoning && (
              <Tooltip title={insights.nextBestAction.reasoning} arrow>
                <Typography variant="caption" color="text.secondary" sx={{ cursor: 'help' }}>
                  💡 почему так
                </Typography>
              </Tooltip>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Недостаточно данных — пообщайся с клиентом, AI предложит что делать
          </Typography>
        )}
      </Paper>

      {/* Ближайшая встреча */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <EventIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" fontWeight={700}>Ближайшая встреча</Typography>
        </Stack>
        {kpi?.kpi.nextMeeting ? (
          <>
            <Typography variant="body2">
              {kpi.kpi.nextMeeting.type}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              через {kpi.kpi.nextMeeting.daysUntil} дней · {new Date(kpi.kpi.nextMeeting.startAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">Нет запланированных встреч</Typography>
        )}
      </Paper>

      {/* Overdue tasks */}
      {(kpi?.kpi.openOverdueTasks.count ?? 0) > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <WarningIcon fontSize="small" color="error" />
            <Typography variant="subtitle2" fontWeight={700}>Просроченные задачи</Typography>
          </Stack>
          <Typography variant="h5" fontWeight={700} color="error">
            {kpi?.kpi.openOverdueTasks.count}
          </Typography>
        </Paper>
      )}

      {/* Ответственные */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <PersonIcon fontSize="small" />
          <Typography variant="subtitle2" fontWeight={700}>Ответственные</Typography>
        </Stack>
        {client.assignedTo ? (
          <Chip size="small" label={client.assignedTo} variant="outlined" />
        ) : (
          <Typography variant="caption" color="text.secondary">Не назначен</Typography>
        )}
      </Paper>

      {/* Related clients */}
      {insights?.relatedClients && insights.relatedClients.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} mb={1}>Связанные клиенты</Typography>
          <Stack spacing={0.5}>
            {insights.relatedClients.map(rel => (
              <Box key={rel.id}>
                <Typography variant="body2" fontWeight={600}>{rel.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {rel.relation} · LTV ${rel.ltv.toLocaleString('en-US')}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {/* Quick note */}
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <EditNoteIcon fontSize="small" />
          <Typography variant="subtitle2" fontWeight={700}>Быстрая заметка</Typography>
        </Stack>
        <TextField
          multiline
          rows={2}
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void saveNote();
            }
          }}
          fullWidth
          size="small"
          placeholder="Enter = сохранить"
          disabled={saving}
        />
        <Button
          size="small"
          onClick={saveNote}
          disabled={!note.trim() || saving}
          sx={{ mt: 1 }}
          fullWidth
        >
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {savedMsg && <Alert severity="success" sx={{ mt: 1 }}>{savedMsg}</Alert>}
      </Paper>

      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" color="text.secondary" align="center" display="block">
        ID: {client.id.slice(0, 8)}…
      </Typography>
    </Box>
  );
};

export default ClientRightSidebar;
