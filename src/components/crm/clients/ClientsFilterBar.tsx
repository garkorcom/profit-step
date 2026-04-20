import React from 'react';
import {
    Paper,
    Stack,
    TextField,
    InputAdornment,
    IconButton,
    Chip,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Divider,
    Box,
    Button,
    Tooltip,
    ToggleButton,
    ToggleButtonGroup,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import ViewListIcon from '@mui/icons-material/ViewList';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff';

import { DashboardFilters } from '../../../hooks/useClientDashboard';
import { ClientSegment, LifecycleStage } from '../../../types/crm.types';
import {
    LIFECYCLE_LABELS,
    LIFECYCLE_CHIP_COLOR,
    LIFECYCLE_ORDER,
    SEGMENT_COLOR,
} from './designTokens';

interface Props {
    filters: DashboardFilters;
    setFilters: React.Dispatch<React.SetStateAction<DashboardFilters>>;
    ownerOptions: Map<string, string>;
    currentUserId?: string;
    viewMode: 'list' | 'board';
    setViewMode: (m: 'list' | 'board') => void;
    isMobile: boolean;
}

const ClientsFilterBar: React.FC<Props> = ({
    filters,
    setFilters,
    ownerOptions,
    currentUserId,
    viewMode,
    setViewMode,
    isMobile,
}) => {
    const hasActive =
        filters.search ||
        filters.createdBy ||
        filters.status ||
        filters.lifecycleStage ||
        filters.segment ||
        filters.churnRisk ||
        filters.healthBand ||
        filters.atRiskOnly ||
        filters.forgottenOnly ||
        filters.modifiedToday;

    const resetAll = () =>
        setFilters(prev => ({
            ...prev,
            search: '',
            createdBy: null,
            status: null,
            lifecycleStage: null,
            segment: null,
            churnRisk: null,
            healthBand: null,
            atRiskOnly: false,
            forgottenOnly: false,
            modifiedToday: false,
        }));

    return (
        <Paper
            elevation={0}
            variant="outlined"
            sx={{
                position: 'sticky',
                top: { xs: 56, md: 64 },
                zIndex: 5,
                p: { xs: 1.25, md: 1.5 },
                mb: 2,
                borderRadius: 2,
                bgcolor: 'background.paper',
            }}
        >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                <TextField
                    size="small"
                    placeholder="Поиск: имя, тег, телефон…"
                    value={filters.search}
                    onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    sx={{ flex: { xs: '1 1 100%', md: '0 1 300px' }, minWidth: 220 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        ),
                        endAdornment: filters.search ? (
                            <InputAdornment position="end">
                                <IconButton size="small" onClick={() => setFilters(prev => ({ ...prev, search: '' }))}>
                                    <CloseIcon fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                    }}
                />

                <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Ответственный</InputLabel>
                    <Select
                        value={filters.createdBy || ''}
                        label="Ответственный"
                        onChange={e =>
                            setFilters(prev => ({ ...prev, createdBy: e.target.value || null }))
                        }
                    >
                        <MenuItem value="">Все</MenuItem>
                        {currentUserId && <MenuItem value={currentUserId}>🙋 Мои</MenuItem>}
                        <Divider />
                        {Array.from(ownerOptions).map(([id, name]) => (
                            <MenuItem key={id} value={id}>
                                {name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 110 }}>
                    <InputLabel>Сегмент</InputLabel>
                    <Select
                        value={filters.segment || ''}
                        label="Сегмент"
                        onChange={e =>
                            setFilters(prev => ({
                                ...prev,
                                segment: (e.target.value as ClientSegment) || null,
                            }))
                        }
                    >
                        <MenuItem value="">Все</MenuItem>
                        {(['A', 'B', 'C', 'VIP'] as ClientSegment[]).map(s => (
                            <MenuItem key={s} value={s}>
                                <Box
                                    component="span"
                                    sx={{
                                        display: 'inline-block',
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        bgcolor: SEGMENT_COLOR[s],
                                        mr: 1,
                                    }}
                                />
                                {s}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {!isMobile && (
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={viewMode}
                        onChange={(_, v) => v && setViewMode(v)}
                        sx={{ ml: 'auto' }}
                    >
                        <ToggleButton value="list" sx={{ textTransform: 'none', px: 1.5 }}>
                            <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
                            Список
                        </ToggleButton>
                        <ToggleButton value="board" sx={{ textTransform: 'none', px: 1.5 }}>
                            <DashboardIcon fontSize="small" sx={{ mr: 0.5 }} />
                            Канбан
                        </ToggleButton>
                    </ToggleButtonGroup>
                )}
            </Stack>

            {/* Lifecycle chip row */}
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap mt={1.25} alignItems="center">
                <Chip
                    label="Все этапы"
                    size="small"
                    color={!filters.lifecycleStage ? 'primary' : 'default'}
                    variant={!filters.lifecycleStage ? 'filled' : 'outlined'}
                    onClick={() => setFilters(prev => ({ ...prev, lifecycleStage: null }))}
                />
                {LIFECYCLE_ORDER.map(stage => {
                    const isActive = filters.lifecycleStage === stage;
                    return (
                        <Chip
                            key={stage}
                            label={LIFECYCLE_LABELS[stage]}
                            size="small"
                            color={isActive ? LIFECYCLE_CHIP_COLOR[stage] : 'default'}
                            variant={isActive ? 'filled' : 'outlined'}
                            onClick={() =>
                                setFilters(prev => ({
                                    ...prev,
                                    lifecycleStage:
                                        prev.lifecycleStage === stage ? null : (stage as LifecycleStage),
                                }))
                            }
                        />
                    );
                })}

                <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />

                <Tooltip title="Только клиенты с высоким риском оттока">
                    <Chip
                        icon={<WarningAmberIcon sx={{ fontSize: 14 }} />}
                        label="Под риском"
                        size="small"
                        color={filters.atRiskOnly ? 'error' : 'default'}
                        variant={filters.atRiskOnly ? 'filled' : 'outlined'}
                        onClick={() => setFilters(prev => ({ ...prev, atRiskOnly: !prev.atRiskOnly }))}
                    />
                </Tooltip>

                <Tooltip title="Не было контакта более 30 дней">
                    <Chip
                        icon={<BedtimeIcon sx={{ fontSize: 14 }} />}
                        label="Забытые"
                        size="small"
                        color={filters.forgottenOnly ? 'warning' : 'default'}
                        variant={filters.forgottenOnly ? 'filled' : 'outlined'}
                        onClick={() => setFilters(prev => ({ ...prev, forgottenOnly: !prev.forgottenOnly }))}
                    />
                </Tooltip>

                <Chip
                    icon={<AccessTimeIcon sx={{ fontSize: 14 }} />}
                    label="Изменено сегодня"
                    size="small"
                    color={filters.modifiedToday ? 'primary' : 'default'}
                    variant={filters.modifiedToday ? 'filled' : 'outlined'}
                    onClick={() => setFilters(prev => ({ ...prev, modifiedToday: !prev.modifiedToday }))}
                />

                {hasActive && (
                    <Button
                        size="small"
                        startIcon={<FilterAltOffIcon />}
                        onClick={resetAll}
                        sx={{ textTransform: 'none', ml: 0.5 }}
                    >
                        Сбросить
                    </Button>
                )}
            </Stack>
        </Paper>
    );
};

export default ClientsFilterBar;
