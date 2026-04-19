import React from 'react';
import { Box, Typography, Paper, Chip, IconButton, Stack, Tooltip, alpha, useTheme } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import StarIcon from '@mui/icons-material/Star';
import PhoneIcon from '@mui/icons-material/Phone';
import TaskAltIcon from '@mui/icons-material/TaskAlt';

import { ClientRow } from '../../../hooks/useClientDashboard';
import {
    LIFECYCLE_LABELS,
    LIFECYCLE_CHIP_COLOR,
    SEGMENT_COLOR,
    HEALTH_BAND_COLOR,
    daysSinceTs,
    formatUsd,
} from './designTokens';

interface Props {
    atRisk: ClientRow[];
    forgotten: ClientRow[];
    vip: ClientRow[];
    onNavigate: (clientId: string) => void;
    onAddTask: (clientId: string) => void;
}

const ClientsBuckets: React.FC<Props> = ({ atRisk, forgotten, vip, onNavigate, onAddTask }) => {
    if (atRisk.length === 0 && forgotten.length === 0 && vip.length === 0) return null;

    return (
        <Box sx={{ mb: 3 }}>
            {atRisk.length > 0 && (
                <BucketStrip
                    title="Требуют внимания"
                    accent="#f44336"
                    icon={<WarningAmberIcon fontSize="small" />}
                    clients={atRisk}
                    onNavigate={onNavigate}
                    onAddTask={onAddTask}
                    subtitle="Высокий риск оттока"
                />
            )}
            {forgotten.length > 0 && (
                <BucketStrip
                    title="Забытые"
                    accent="#ff9800"
                    icon={<BedtimeIcon fontSize="small" />}
                    clients={forgotten}
                    onNavigate={onNavigate}
                    onAddTask={onAddTask}
                    subtitle="Не было контакта >30 дней"
                />
            )}
            {vip.length > 0 && (
                <BucketStrip
                    title="VIP"
                    accent="#ff9800"
                    icon={<StarIcon fontSize="small" />}
                    clients={vip}
                    onNavigate={onNavigate}
                    onAddTask={onAddTask}
                    subtitle="Сегмент VIP / стратегические"
                />
            )}
        </Box>
    );
};

interface StripProps {
    title: string;
    subtitle?: string;
    accent: string;
    icon: React.ReactNode;
    clients: ClientRow[];
    onNavigate: (id: string) => void;
    onAddTask: (id: string) => void;
}

const BucketStrip: React.FC<StripProps> = ({ title, subtitle, accent, icon, clients, onNavigate, onAddTask }) => {
    const theme = useTheme();
    return (
        <Box sx={{ mb: 2.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <Box sx={{ color: accent, display: 'flex', alignItems: 'center' }}>{icon}</Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: accent }}>
                    {title.toUpperCase()}
                </Typography>
                <Chip label={clients.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                {subtitle && (
                    <Typography variant="caption" color="text.secondary">
                        · {subtitle}
                    </Typography>
                )}
            </Stack>
            <Box
                sx={{
                    display: 'flex',
                    gap: 1.25,
                    overflowX: 'auto',
                    pb: 1,
                    '&::-webkit-scrollbar': { height: 6 },
                    '&::-webkit-scrollbar-thumb': { bgcolor: alpha(accent, 0.3), borderRadius: 3 },
                }}
            >
                {clients.map(client => (
                    <BucketCard
                        key={client.id}
                        client={client}
                        accent={accent}
                        onNavigate={onNavigate}
                        onAddTask={onAddTask}
                        dividerColor={alpha(theme.palette.divider, 0.6)}
                    />
                ))}
            </Box>
        </Box>
    );
};

interface CardProps {
    client: ClientRow;
    accent: string;
    onNavigate: (id: string) => void;
    onAddTask: (id: string) => void;
    dividerColor: string;
}

const BucketCard: React.FC<CardProps> = ({ client, accent, onNavigate, onAddTask, dividerColor }) => {
    const lifecycle = client.lifecycleStage ?? 'lead';
    const segment = client.segment ?? 'B';
    const healthScore = client.healthScore;
    const primaryPhone = client.contacts?.[0]?.phone || client.phone;
    const days = daysSinceTs(client.effectiveLastContactAt);

    return (
        <Paper
            elevation={0}
            variant="outlined"
            onClick={() => onNavigate(client.id)}
            sx={{
                minWidth: 240,
                maxWidth: 280,
                flexShrink: 0,
                p: 1.5,
                pt: 1.75,
                borderRadius: 2,
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.15s ease',
                '&:hover': {
                    borderColor: accent,
                    boxShadow: `0 2px 10px ${dividerColor}`,
                },
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: accent,
                },
            }}
        >
            <Stack direction="row" alignItems="center" spacing={0.75} mb={0.75}>
                <Chip
                    label={LIFECYCLE_LABELS[lifecycle]}
                    size="small"
                    color={LIFECYCLE_CHIP_COLOR[lifecycle]}
                    sx={{ height: 20, fontSize: '0.65rem' }}
                />
                <Box
                    sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: SEGMENT_COLOR[segment],
                    }}
                    title={`Сегмент ${segment}`}
                />
                {healthScore !== undefined && client.healthBand && (
                    <Chip
                        label={healthScore}
                        size="small"
                        sx={{
                            height: 20,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            bgcolor: HEALTH_BAND_COLOR[client.healthBand],
                            color: 'white',
                        }}
                    />
                )}
            </Stack>
            <Typography variant="body2" fontWeight={700} noWrap gutterBottom>
                {client.name}
            </Typography>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="caption" color="text.secondary">
                    {days !== null ? `контакт ${days}д назад` : 'без контакта'}
                </Typography>
                <Stack direction="row" spacing={0.25} onClick={e => e.stopPropagation()}>
                    {primaryPhone && (
                        <Tooltip title={`Позвонить: ${primaryPhone}`}>
                            <IconButton size="small" component="a" href={`tel:${primaryPhone}`} sx={{ p: 0.5 }}>
                                <PhoneIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title="Добавить задачу">
                        <IconButton size="small" onClick={() => onAddTask(client.id)} sx={{ p: 0.5 }}>
                            <TaskAltIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Stack>
            {client.balance !== 0 && (
                <Typography
                    variant="caption"
                    fontWeight={700}
                    sx={{ color: client.balance > 0 ? 'error.main' : 'success.main', display: 'block', mt: 0.5 }}
                >
                    {client.balance > 0 ? 'должен ' : 'переплата '}
                    {formatUsd(Math.abs(client.balance))}
                </Typography>
            )}
        </Paper>
    );
};

export default ClientsBuckets;
