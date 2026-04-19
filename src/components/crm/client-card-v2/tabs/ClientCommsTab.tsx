import React from 'react';
import { Alert, Box, Paper, Typography } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import { Client } from '../../../../types/crm.types';

interface Props {
  client: Client;
}

const ClientCommsTab: React.FC<Props> = ({ client }) => {
  // MVP stub: показывает контакты + заметки. Full Telegram/email inbox —
  // в Module 8 из CRM_OVERHAUL_SPEC_V1.
  return (
    <Box>
      <Typography variant="h6" gutterBottom>Коммуникации</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        Unified Telegram/email/Notes timeline придёт с Module 8 переписки. Пока — сводка контактов.
      </Alert>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>Контакты</Typography>
        {(client.contacts ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">Контактов не добавлено</Typography>
        ) : (
          client.contacts.map(c => (
            <Box key={c.id} mb={1}>
              <Typography variant="body2" fontWeight={600}>{c.name}{c.position ? ` — ${c.position}` : ''}</Typography>
              <Typography variant="caption" color="text.secondary">
                {c.phone}{c.email ? ` · ${c.email}` : ''}
              </Typography>
            </Box>
          ))
        )}
      </Paper>

      {client.decisionMakers && client.decisionMakers.length > 0 && (
        <Paper sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Decision makers</Typography>
          {client.decisionMakers.map((dm, i) => (
            <Box key={i} mb={1}>
              <Typography variant="body2" fontWeight={600}>
                {dm.name}{dm.isPrimary ? ' ⭐' : ''}{dm.role ? ` — ${dm.role}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {dm.phone}{dm.email ? ` · ${dm.email}` : ''}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}

      <Paper sx={{ p: 2, mt: 2, textAlign: 'center' }}>
        <ChatIcon color="disabled" sx={{ fontSize: 48, mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          Timeline сообщений будет здесь когда подключим Module 8
        </Typography>
      </Paper>
    </Box>
  );
};

export default ClientCommsTab;
