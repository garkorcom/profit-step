import React from 'react';
import {
    Paper,
    Box,
    Typography,
    Chip,
    Avatar,
    IconButton,
    Checkbox,
    Stack,
    Tooltip,
    alpha,
    useTheme,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import PersonIcon from '@mui/icons-material/Person';
import PhoneIcon from '@mui/icons-material/Phone';
import EmailIcon from '@mui/icons-material/Email';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import VisibilityIcon from '@mui/icons-material/Visibility';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { ClientRow, SortField, SortDir } from '../../../hooks/useClientDashboard';
import {
    LIFECYCLE_LABELS,
    LIFECYCLE_CHIP_COLOR,
    SEGMENT_COLOR,
    HEALTH_BAND_COLOR,
    HEALTH_BAND_LABEL,
    formatUsd,
    daysSinceTs,
} from './designTokens';

interface Props {
    clients: ClientRow[];
    ownerMap: Map<string, string>;
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onToggleAll: () => void;
    onNavigate: (id: string) => void;
    onAddTask: (id: string) => void;
    sortField: SortField;
    sortDir: SortDir;
    onSort: (field: SortField) => void;
}

const COLS = {
    checkbox: 42,
    name: '2fr',
    lifecycle: 110,
    segment: 70,
    health: 90,
    ltv: 90,
    balance: 90,
    owner: 120,
    contact: 80,
    actions: 150,
} as const;

const gridCols = `${COLS.checkbox}px ${COLS.name} ${COLS.lifecycle}px ${COLS.segment}px ${COLS.health}px ${COLS.ltv}px ${COLS.balance}px ${COLS.owner}px ${COLS.contact}px ${COLS.actions}px`;

const ClientsList: React.FC<Props> = ({
    clients,
    ownerMap,
    selectedIds,
    onToggleSelect,
    onToggleAll,
    onNavigate,
    onAddTask,
    sortField,
    sortDir,
    onSort,
}) => {
    const theme = useTheme();
    const allSelected = clients.length > 0 && clients.every(c => selectedIds.has(c.id));
    const someSelected = clients.some(c => selectedIds.has(c.id)) && !allSelected;

    return (
        <Paper variant="outlined" elevation={0} sx={{ borderRadius: 2, overflow: 'hidden' }}>
            {/* Header */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: gridCols,
                    alignItems: 'center',
                    px: 1.5,
                    py: 1,
                    gap: 1,
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    borderBottom: `1px solid ${theme.palette.divider}`,
                }}
            >
                <Checkbox
                    size="small"
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={onToggleAll}
                />
                <SortHeader label="Клиент" field="name" current={sortField} dir={sortDir} onClick={onSort} />
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Этап
                </Typography>
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Сегмент
                </Typography>
                <SortHeader label="Health" field="healthScore" current={sortField} dir={sortDir} onClick={onSort} />
                <SortHeader label="LTV" field="ltv" current={sortField} dir={sortDir} onClick={onSort} />
                <SortHeader label="Баланс" field="balance" current={sortField} dir={sortDir} onClick={onSort} />
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Ответственный
                </Typography>
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Контакт
                </Typography>
                <Typography variant="caption" fontWeight={600} color="text.secondary" align="right">
                    Действия
                </Typography>
            </Box>

            {clients.map(client => (
                <Row
                    key={client.id}
                    client={client}
                    ownerMap={ownerMap}
                    selected={selectedIds.has(client.id)}
                    onToggleSelect={() => onToggleSelect(client.id)}
                    onNavigate={onNavigate}
                    onAddTask={onAddTask}
                />
            ))}
        </Paper>
    );
};

// ─────────────────────────────────────────────

interface RowProps {
    client: ClientRow;
    ownerMap: Map<string, string>;
    selected: boolean;
    onToggleSelect: () => void;
    onNavigate: (id: string) => void;
    onAddTask: (id: string) => void;
}

const Row: React.FC<RowProps> = ({ client, ownerMap, selected, onToggleSelect, onNavigate, onAddTask }) => {
    const theme = useTheme();
    const lifecycle = client.lifecycleStage ?? 'lead';
    const segment = client.segment ?? 'B';
    const isCompany = client.type === 'company';
    const ownerName = ownerMap.get(client.createdBy) || '—';
    const contact = client.contacts?.[0] ?? { phone: client.phone ?? '', email: client.email ?? '' };
    const days = daysSinceTs(client.effectiveLastContactAt);
    const ltv = client.ltv ?? client.totalRevenue ?? 0;

    const healthChip =
        client.healthScore !== undefined && client.healthBand ? (
            <Tooltip title={`${HEALTH_BAND_LABEL[client.healthBand]} · ${client.healthScore}`}>
                <Chip
                    label={client.healthScore}
                    size="small"
                    sx={{
                        height: 22,
                        minWidth: 38,
                        fontWeight: 700,
                        fontSize: '0.7rem',
                        bgcolor: HEALTH_BAND_COLOR[client.healthBand],
                        color: 'white',
                    }}
                />
            </Tooltip>
        ) : (
            <LegacyHealthDot health={client.health} />
        );

    return (
        <Box
            onClick={() => onNavigate(client.id)}
            sx={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 1,
                alignItems: 'center',
                px: 1.5,
                py: 1.25,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                cursor: 'pointer',
                transition: 'background-color 0.12s',
                bgcolor: selected ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                '&:last-of-type': { borderBottom: 'none' },
            }}
        >
            <Box onClick={e => e.stopPropagation()}>
                <Checkbox size="small" checked={selected} onChange={onToggleSelect} />
            </Box>

            <Stack direction="row" alignItems="center" spacing={1.25} minWidth={0}>
                <Avatar
                    sx={{
                        width: 36,
                        height: 36,
                        bgcolor: isCompany ? 'primary.light' : 'secondary.light',
                        color: 'white',
                    }}
                >
                    {isCompany ? <BusinessIcon fontSize="small" /> : <PersonIcon fontSize="small" />}
                </Avatar>
                <Box minWidth={0}>
                    <Stack direction="row" alignItems="center" spacing={0.75}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                            {client.name}
                        </Typography>
                        {client.churnRisk === 'high' && (
                            <Tooltip title="Высокий риск оттока">
                                <WarningAmberIcon sx={{ fontSize: 14, color: 'error.main' }} />
                            </Tooltip>
                        )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {client.industry ? `${client.industry} · ` : ''}
                        {client.tags?.slice(0, 2).join(', ')}
                    </Typography>
                </Box>
            </Stack>

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
                    minWidth: 40,
                }}
            />

            {healthChip}

            <Typography variant="body2" fontWeight={ltv > 0 ? 600 : 400} color={ltv > 0 ? 'text.primary' : 'text.disabled'}>
                {formatUsd(ltv, true)}
            </Typography>

            <Typography
                variant="body2"
                fontWeight={client.balance !== 0 ? 700 : 400}
                sx={{
                    color:
                        client.balance > 0
                            ? 'error.main'
                            : client.balance < 0
                                ? 'success.main'
                                : 'text.disabled',
                }}
            >
                {client.balance !== 0 ? formatUsd(Math.abs(client.balance)) : '—'}
            </Typography>

            <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                <Avatar sx={{ width: 22, height: 22, fontSize: '0.7rem' }}>{ownerName.charAt(0)}</Avatar>
                <Typography variant="caption" noWrap color="text.secondary">
                    {ownerName}
                </Typography>
            </Stack>

            <Typography variant="caption" color={days !== null && days > 30 ? 'warning.main' : 'text.secondary'}>
                {days !== null ? `${days}д` : '—'}
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25 }} onClick={e => e.stopPropagation()}>
                {contact.phone && (
                    <Tooltip title={`Позвонить: ${contact.phone}`}>
                        <IconButton size="small" component="a" href={`tel:${contact.phone}`}>
                            <PhoneIcon sx={{ fontSize: 16, color: 'success.main' }} />
                        </IconButton>
                    </Tooltip>
                )}
                {contact.email && (
                    <Tooltip title={`Написать: ${contact.email}`}>
                        <IconButton size="small" component="a" href={`mailto:${contact.email}`}>
                            <EmailIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                        </IconButton>
                    </Tooltip>
                )}
                <Tooltip title="Добавить задачу">
                    <IconButton size="small" onClick={() => onAddTask(client.id)}>
                        <TaskAltIcon sx={{ fontSize: 16, color: 'secondary.main' }} />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Открыть карточку">
                    <IconButton size="small" onClick={() => onNavigate(client.id)}>
                        <VisibilityIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                </Tooltip>
            </Box>
        </Box>
    );
};

// ─────────────────────────────────────────────

const SortHeader: React.FC<{
    label: string;
    field: SortField;
    current: SortField;
    dir: SortDir;
    onClick: (f: SortField) => void;
}> = ({ label, field, current, dir, onClick }) => {
    const isActive = current === field;
    return (
        <Box
            onClick={() => onClick(field)}
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                cursor: 'pointer',
                userSelect: 'none',
                '&:hover': { color: 'primary.main' },
            }}
        >
            <Typography
                variant="caption"
                fontWeight={isActive ? 700 : 600}
                color={isActive ? 'primary.main' : 'text.secondary'}
            >
                {label}
            </Typography>
            {isActive &&
                (dir === 'asc' ? (
                    <ArrowUpwardIcon sx={{ fontSize: 13 }} />
                ) : (
                    <ArrowDownwardIcon sx={{ fontSize: 13 }} />
                ))}
        </Box>
    );
};

const LegacyHealthDot: React.FC<{ health: 'green' | 'yellow' | 'red' }> = ({ health }) => {
    const COLOR = { green: '#4caf50', yellow: '#ff9800', red: '#f44336' }[health];
    return (
        <Tooltip title={`Legacy health: ${health}`}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLOR }} />
        </Tooltip>
    );
};

export default ClientsList;
