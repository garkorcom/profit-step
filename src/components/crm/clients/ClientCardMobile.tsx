import React from 'react';
import { Paper, Box, Stack, Avatar, Typography, Chip, IconButton, Checkbox, Tooltip } from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import PersonIcon from '@mui/icons-material/Person';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

import { ClientRow } from '../../../hooks/useClientDashboard';
import {
    LIFECYCLE_LABELS,
    LIFECYCLE_CHIP_COLOR,
    SEGMENT_COLOR,
    HEALTH_BAND_COLOR,
    formatUsd,
    daysSinceTs,
} from './designTokens';

interface Props {
    client: ClientRow;
    ownerName?: string;
    selected: boolean;
    onToggleSelect: () => void;
    onView: () => void;
    onAddTask: () => void;
}

const ClientCardMobile: React.FC<Props> = ({ client, ownerName, selected, onToggleSelect, onView, onAddTask }) => {
    const lifecycle = client.lifecycleStage ?? 'lead';
    const segment = client.segment ?? 'B';
    const isCompany = client.type === 'company';
    const contact = client.contacts?.[0] ?? { phone: client.phone ?? '', email: client.email ?? '' };
    const days = daysSinceTs(client.effectiveLastContactAt);
    const ltv = client.ltv ?? client.totalRevenue ?? 0;

    return (
        <Paper
            variant="outlined"
            elevation={0}
            onClick={onView}
            sx={{
                p: 1.5,
                borderRadius: 2,
                cursor: 'pointer',
                position: 'relative',
                bgcolor: selected ? 'action.selected' : 'background.paper',
                '&:active': { transform: 'scale(0.99)' },
            }}
        >
            <Stack direction="row" alignItems="flex-start" spacing={1.25}>
                <Box onClick={e => e.stopPropagation()} sx={{ pt: 0.25 }}>
                    <Checkbox size="small" checked={selected} onChange={onToggleSelect} />
                </Box>
                <Avatar
                    sx={{
                        width: 40,
                        height: 40,
                        bgcolor: isCompany ? 'primary.light' : 'secondary.light',
                        color: 'white',
                    }}
                >
                    {isCompany ? <BusinessIcon fontSize="small" /> : <PersonIcon fontSize="small" />}
                </Avatar>
                <Box flex={1} minWidth={0}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography variant="subtitle2" fontWeight={700} noWrap>
                            {client.name}
                        </Typography>
                        {client.churnRisk === 'high' && (
                            <WarningAmberIcon sx={{ fontSize: 14, color: 'error.main' }} />
                        )}
                    </Stack>
                    {client.industry && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                            {client.industry}
                        </Typography>
                    )}
                </Box>
                {client.healthScore !== undefined && client.healthBand && (
                    <Chip
                        label={client.healthScore}
                        size="small"
                        sx={{
                            height: 22,
                            fontWeight: 700,
                            fontSize: '0.7rem',
                            bgcolor: HEALTH_BAND_COLOR[client.healthBand],
                            color: 'white',
                        }}
                    />
                )}
            </Stack>

            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mt={1}>
                <Chip
                    label={LIFECYCLE_LABELS[lifecycle]}
                    size="small"
                    color={LIFECYCLE_CHIP_COLOR[lifecycle]}
                    sx={{ height: 22, fontSize: '0.7rem' }}
                />
                <Chip
                    label={segment}
                    size="small"
                    sx={{
                        height: 22,
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        bgcolor: SEGMENT_COLOR[segment],
                        color: 'white',
                    }}
                />
                {ltv > 0 && (
                    <Chip
                        label={`LTV ${formatUsd(ltv, true)}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 22, fontSize: '0.7rem' }}
                    />
                )}
                {client.balance !== 0 && (
                    <Chip
                        label={`${client.balance > 0 ? 'долг' : 'переплата'} ${formatUsd(Math.abs(client.balance))}`}
                        size="small"
                        color={client.balance > 0 ? 'error' : 'success'}
                        variant="outlined"
                        sx={{ height: 22, fontSize: '0.7rem' }}
                    />
                )}
                {client.taskStats.overdueCount > 0 && (
                    <Chip
                        label={`${client.taskStats.overdueCount} просрочено`}
                        size="small"
                        color="error"
                        sx={{ height: 22, fontSize: '0.7rem' }}
                    />
                )}
            </Stack>

            <Stack direction="row" alignItems="center" justifyContent="space-between" mt={1.25}>
                <Typography variant="caption" color="text.secondary">
                    {ownerName ? `${ownerName} · ` : ''}
                    {days !== null ? `контакт ${days}д назад` : 'без контакта'}
                </Typography>
                <Stack direction="row" spacing={0.25} onClick={e => e.stopPropagation()}>
                    {contact.phone && (
                        <Tooltip title={`Позвонить: ${contact.phone}`}>
                            <IconButton size="small" component="a" href={`tel:${contact.phone}`}>
                                <PhoneIcon sx={{ fontSize: 18, color: 'success.main' }} />
                            </IconButton>
                        </Tooltip>
                    )}
                    {contact.email && (
                        <Tooltip title={`Написать: ${contact.email}`}>
                            <IconButton size="small" component="a" href={`mailto:${contact.email}`}>
                                <EmailIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title="Добавить задачу">
                        <IconButton size="small" onClick={onAddTask}>
                            <TaskAltIcon sx={{ fontSize: 18, color: 'secondary.main' }} />
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Stack>
        </Paper>
    );
};

export default ClientCardMobile;
