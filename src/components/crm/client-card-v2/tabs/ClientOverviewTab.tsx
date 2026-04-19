import React from 'react';
import { Box, Grid, Paper, Stack, Typography, LinearProgress } from '@mui/material';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import EventIcon from '@mui/icons-material/Event';
import { Client } from '../../../../types/crm.types';
import { ClientKPIResponse } from '../../../../api/clientInsightsApi';

interface Props {
  client: Client;
  kpi: ClientKPIResponse | null;
}

const ClientOverviewTab: React.FC<Props> = ({ client, kpi }) => {
  const healthBand = kpi?.healthScore?.band ?? 'poor';
  const healthColor = {
    excellent: 'success.main',
    good: '#8bc34a',
    fair: 'warning.main',
    poor: 'error.main',
  }[healthBand];

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Обзор</Typography>

      <Grid container spacing={2}>
        {/* Health card */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Health score</Typography>
            {kpi?.healthScore ? (
              <>
                <Typography variant="h3" fontWeight={700} sx={{ color: healthColor }}>
                  {kpi.healthScore.score}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={kpi.healthScore.score}
                  sx={{ height: 8, borderRadius: 4, mt: 1 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {healthBand} · {kpi.churnRisk.level === 'low' ? 'низкий риск' : kpi.churnRisk.level === 'medium' ? 'средний риск' : 'высокий риск оттока'}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">Ещё не рассчитан</Typography>
            )}
          </Paper>
        </Grid>

        {/* Finance summary */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <AttachMoneyIcon fontSize="small" />
              <Typography variant="subtitle2" color="text.secondary">Финансы</Typography>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="body2">LTV: <strong>${(kpi?.kpi.ltv.value ?? client.totalRevenue ?? 0).toLocaleString('en-US')}</strong></Typography>
              <Typography variant="body2">Маржа: <strong>${(kpi?.kpi.marginUsd.value ?? 0).toLocaleString('en-US')}</strong></Typography>
              <Typography variant="body2">Баланс: <strong>${(kpi?.kpi.balance.value ?? 0).toLocaleString('en-US')}</strong></Typography>
            </Stack>
          </Paper>
        </Grid>

        {/* Funnel + next meeting */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1}>
              <BusinessCenterIcon fontSize="small" />
              <Typography variant="subtitle2" color="text.secondary">Воронка</Typography>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="body2">Активных сделок: <strong>{kpi?.kpi.activeDeals.count ?? 0}</strong></Typography>
              <Typography variant="body2">Активных проектов: <strong>{kpi?.kpi.activeProjects.count ?? 0}</strong></Typography>
              <Typography variant="body2">Просроченных задач: <strong>{kpi?.kpi.openOverdueTasks.count ?? 0}</strong></Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" mt={1}>
              <EventIcon fontSize="small" color="primary" />
              <Typography variant="caption" color="text.secondary">
                {kpi?.kpi.nextMeeting ? `Встреча через ${kpi.kpi.nextMeeting.daysUntil}д` : 'Нет встреч запланировано'}
              </Typography>
            </Stack>
          </Paper>
        </Grid>

        {/* Identity block */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Клиент</Typography>
            <Grid container spacing={1}>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Тип</Typography>
                <Typography variant="body2">{client.type}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Индустрия</Typography>
                <Typography variant="body2">{client.industry ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Предпочтительный канал</Typography>
                <Typography variant="body2">{client.preferredChannel ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Язык</Typography>
                <Typography variant="body2">{client.preferredLanguage ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Timezone</Typography>
                <Typography variant="body2">{client.timezone ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Payment terms</Typography>
                <Typography variant="body2">{client.billingInfo?.paymentTerms ?? '—'}</Typography>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ClientOverviewTab;
