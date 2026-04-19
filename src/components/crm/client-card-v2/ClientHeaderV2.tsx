import React from 'react';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import PersonIcon from '@mui/icons-material/Person';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import WarningIcon from '@mui/icons-material/Warning';
import EventIcon from '@mui/icons-material/Event';
import HistoryIcon from '@mui/icons-material/History';

import BusinessCenterOutlinedIcon from '@mui/icons-material/BusinessCenterOutlined';

import { Client, LifecycleStage, ClientSegment } from '../../../types/crm.types';
import { ClientKPIResponse } from '../../../api/clientInsightsApi';

interface Props {
  client: Client;
  kpi: ClientKPIResponse | null;
  kpiLoading: boolean;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onCreateDeal?: () => void;
}

const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  lead: 'Лид',
  prospect: 'Потенциал',
  active: 'Активный',
  repeat: 'Повторный',
  churned: 'Ушёл',
  vip: 'VIP',
};

const LIFECYCLE_COLORS: Record<LifecycleStage, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'secondary'> = {
  lead: 'default',
  prospect: 'primary',
  active: 'success',
  repeat: 'secondary',
  churned: 'error',
  vip: 'warning',
};

const SEGMENT_COLOR: Record<ClientSegment, string> = {
  A: '#4caf50',
  B: '#2196f3',
  C: '#9e9e9e',
  VIP: '#ff9800',
};

const BAND_COLOR = {
  excellent: '#4caf50',
  good: '#8bc34a',
  fair: '#ff9800',
  poor: '#f44336',
};

function fmtUsd(n: number | null | undefined, short = false): string {
  if (n === null || n === undefined) return '—';
  if (short && Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function KPICell({ icon, label, value, tooltip }: { icon: React.ReactNode; label: string; value: React.ReactNode; tooltip?: string }) {
  const cell = (
    <Box sx={{ px: 1.5, py: 0.75, minWidth: 92, textAlign: 'center' }}>
      <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
        {icon}
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </Stack>
      <Typography variant="body2" fontWeight={600} mt={0.25}>
        {value}
      </Typography>
    </Box>
  );
  return tooltip ? <Tooltip title={tooltip} arrow>{cell}</Tooltip> : cell;
}

const ClientHeaderV2: React.FC<Props> = ({ client, kpi, kpiLoading, isFavorite, onToggleFavorite, onCreateDeal }) => {
  const lifecycle = (client.lifecycleStage ?? 'lead') as LifecycleStage;
  const segment = (client.segment ?? 'B') as ClientSegment;
  const isCompany = client.type === 'company' || client.type === 'commercial';

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 1100,
        p: 2,
        mb: 2,
        backgroundColor: 'background.paper',
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
        <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>
          {isCompany ? <BusinessIcon /> : <PersonIcon />}
        </Avatar>

        <Box flex={1} minWidth={0}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Typography variant="h5" fontWeight={700} noWrap sx={{ maxWidth: 360 }}>
              {client.name}
            </Typography>
            <Chip
              label={LIFECYCLE_LABELS[lifecycle]}
              color={LIFECYCLE_COLORS[lifecycle]}
              size="small"
            />
            <Chip
              label={segment}
              size="small"
              sx={{ bgcolor: SEGMENT_COLOR[segment], color: 'white', fontWeight: 700 }}
            />
            {kpi?.healthScore && (
              <Tooltip title={`Health band: ${kpi.healthScore.band}`} arrow>
                <Chip
                  label={`Health ${kpi.healthScore.score}`}
                  size="small"
                  sx={{ bgcolor: BAND_COLOR[kpi.healthScore.band], color: 'white' }}
                />
              </Tooltip>
            )}
            {kpi?.churnRisk?.level && kpi.churnRisk.level !== 'low' && (
              <Chip
                icon={<WarningIcon sx={{ fontSize: '1rem !important' }} />}
                label={`Churn: ${kpi.churnRisk.level}`}
                color={kpi.churnRisk.level === 'high' ? 'error' : 'warning'}
                size="small"
              />
            )}
            <Tooltip title={isFavorite ? 'Убрать из избранного' : 'В избранное'} arrow>
              <IconButton size="small" onClick={onToggleFavorite}>
                {isFavorite ? <StarIcon sx={{ color: '#ffc107' }} /> : <StarBorderIcon />}
              </IconButton>
            </Tooltip>
            {onCreateDeal && (
              <Tooltip title="Создать сделку для клиента" arrow>
                <IconButton size="small" color="primary" onClick={onCreateDeal}>
                  <BusinessCenterOutlinedIcon />
                </IconButton>
              </Tooltip>
            )}
            {kpi?.stale && (
              <Tooltip title="Метрики устарели, обновляются…" arrow>
                <CircularProgress size={16} />
              </Tooltip>
            )}
          </Stack>
          {client.tags && client.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} mt={0.5} flexWrap="wrap">
              {client.tags.slice(0, 6).map(t => (
                <Chip key={t} label={t} size="small" variant="outlined" />
              ))}
            </Stack>
          )}
        </Box>
      </Stack>

      {/* KPI row */}
      <Box
        mt={2}
        display="flex"
        flexWrap="wrap"
        gap={0.5}
        sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}
      >
        {kpiLoading && !kpi ? (
          <Box display="flex" alignItems="center" gap={1} px={1.5}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">Загрузка метрик…</Typography>
          </Box>
        ) : (
          <>
            <KPICell
              icon={<AccountBalanceWalletIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Баланс"
              value={fmtUsd(kpi?.kpi.balance.value ?? null, true)}
            />
            <KPICell
              icon={<AttachMoneyIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="LTV"
              value={fmtUsd(kpi?.kpi.ltv.value ?? client.totalRevenue ?? 0, true)}
            />
            <KPICell
              icon={<TrendingUpIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Маржа"
              value={kpi?.kpi.marginUsd.pct != null ? `${kpi.kpi.marginUsd.pct.toFixed(1)}%` : fmtUsd(kpi?.kpi.marginUsd.value, true)}
            />
            <KPICell
              icon={<BusinessCenterIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Сделки"
              value={kpi?.kpi.activeDeals.count ?? 0}
            />
            <KPICell
              icon={<FolderOpenIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Проекты"
              value={kpi?.kpi.activeProjects.count ?? 0}
            />
            <KPICell
              icon={<WarningIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Задачи"
              value={kpi?.kpi.openOverdueTasks.count ?? 0}
              tooltip="Просроченные открытые задачи"
            />
            <KPICell
              icon={<EventIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Встреча"
              value={kpi?.kpi.nextMeeting ? `через ${kpi.kpi.nextMeeting.daysUntil}д` : '—'}
            />
            <KPICell
              icon={<HistoryIcon fontSize="inherit" sx={{ fontSize: '0.9rem' }} />}
              label="Контакт"
              value={kpi?.kpi.lastContactDaysAgo ? `${kpi.kpi.lastContactDaysAgo.days}д назад` : '—'}
            />
          </>
        )}
      </Box>
    </Paper>
  );
};

export default ClientHeaderV2;
