/**
 * @fileoverview Client Dashboard — Premium Redesign
 *
 * Visual upgrade:
 * - Gradient hero header strip
 * - 3 KPI summary cards (gradient)
 * - Glassmorphic filter bar with blur
 * - Premium table rows with health stripe + animated dots
 * - Glass-effect mobile cards
 * - Skeleton loading + styled empty state
 */

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Typography,
    Button,
    Paper,
    IconButton,
    Alert,
    TextField,
    InputAdornment,
    Chip,
    Avatar,
    Tooltip,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    useTheme,
    alpha,
    useMediaQuery,
    Divider,
    Skeleton,
} from '@mui/material';
import {
    Add as AddIcon,
    Search as SearchIcon,
    Visibility as VisibilityIcon,
    Phone as PhoneIcon,
    Email as EmailIcon,
    TaskAlt as TaskIcon,
    ArrowUpward as ArrowUpIcon,
    ArrowDownward as ArrowDownIcon,
    Refresh as RefreshIcon,
    Close as CloseIcon,
    People as PeopleIcon,
    FavoriteBorder as HeartIcon,
    Warning as WarningIcon,
    CheckCircleOutline as CheckCircleIcon,
    ViewList as ViewListIcon,
    Dashboard as DashboardIcon,
    AccessTime as TimeIcon,
} from '@mui/icons-material';
import { useAuth } from '../../auth/AuthContext';
import {
    useClientDashboard,
    ClientRow,
    HealthStatus,
    SortField,
} from '../../hooks/useClientDashboard';
import { ClientStatus } from '../../types/crm.types';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

const formatSmartDate = (timestampSecs?: number) => {
    if (!timestampSecs) return '';
    const date = new Date(timestampSecs * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (date.toDateString() === today.toDateString()) {
        return `Сегодня ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return `Вчера ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

// ═══════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════

const GRADIENTS = {
    hero: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    total: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    healthy: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    forgotten: 'linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; gradient: string }> = {
    new: { label: 'Новый', color: '#3b82f6', gradient: 'linear-gradient(135deg, #667eea, #764ba2)' },
    contacted: { label: 'Контакт', color: '#f59e0b', gradient: 'linear-gradient(135deg, #f093fb, #f5576c)' },
    qualified: { label: 'Квалиф.', color: '#8b5cf6', gradient: 'linear-gradient(135deg, #a18cd1, #fbc2eb)' },
    customer: { label: 'Клиент', color: '#22c55e', gradient: 'linear-gradient(135deg, #11998e, #38ef7d)' },
    churned: { label: 'Ушёл', color: '#ef4444', gradient: 'linear-gradient(135deg, #FF6B6B, #FF8E53)' },
    done: { label: 'Закрыт', color: '#6b7280', gradient: 'linear-gradient(135deg, #373B44, #4286f4)' },
};

const HEALTH_CONFIG: Record<HealthStatus, { label: string; color: string; glow: string }> = {
    green: { label: 'Активный', color: '#22c55e', glow: 'rgba(34,197,94,0.4)' },
    yellow: { label: 'Внимание', color: '#eab308', glow: 'rgba(234,179,8,0.4)' },
    red: { label: 'Забытый', color: '#ef4444', glow: 'rgba(239,68,68,0.5)' },
};

// Keyframes for animated health dot
const PULSE_KEYFRAMES = {
    '@keyframes healthPulse': {
        '0%': { boxShadow: '0 0 0 0 var(--glow-color)' },
        '70%': { boxShadow: '0 0 0 6px transparent' },
        '100%': { boxShadow: '0 0 0 0 transparent' },
    },
    '@keyframes shimmer': {
        '0%': { backgroundPosition: '-200% 0' },
        '100%': { backgroundPosition: '200% 0' },
    },
};

// ═══════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════

const ClientsPage: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const { currentUser, userProfile } = useAuth();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [viewMode, setViewMode] = useState<'list' | 'board'>('list');

    const {
        clients,
        users,
        loading,
        error,
        filters,
        setFilters,
        stats,
        dashboardClusters,
        updateClientStatus,
        refresh,
    } = useClientDashboard(userProfile?.companyId);

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const sourceStatus = result.source.droppableId as ClientStatus;
        const destStatus = result.destination.droppableId as ClientStatus;
        if (sourceStatus === destStatus) return; // Handled sorting locally if needed, but DB status is unchanged
        updateClientStatus(result.draggableId, destStatus);
    };

    const ownerOptions = useMemo(() => {
        const map = new Map<string, string>();
        users.forEach(u => {
            if (u.displayName) map.set(u.id, u.displayName);
        });
        return map;
    }, [users]);

    const toggleSort = (field: SortField) => {
        setFilters(prev => ({
            ...prev,
            sortField: field,
            sortDir: prev.sortField === field && prev.sortDir === 'asc' ? 'desc' : 'asc',
        }));
    };

    const getFirstContact = (client: ClientRow) => {
        if (client.contacts?.length > 0) return client.contacts[0];
        return { phone: client.phone || '', email: client.email || '', name: '' };
    };

    // Count health stats for KPI cards
    const healthCounts = useMemo(() => {
        const counts = { green: 0, yellow: 0, red: 0 };
        clients.forEach(c => { counts[c.health]++; });
        return counts;
    }, [clients]);

    // ═══════ LOADING STATE ═══════
    if (loading) {
        return (
            <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, md: 3 }, py: 2, ...PULSE_KEYFRAMES }}>
                {/* Skeleton Hero */}
                <Skeleton
                    variant="rectangular"
                    height={100}
                    sx={{ borderRadius: 4, mb: 3 }}
                />
                {/* Skeleton KPI cards */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
                    {[0, 1, 2].map(i => (
                        <Skeleton
                            key={i}
                            variant="rectangular"
                            height={120}
                            sx={{ borderRadius: 3 }}
                        />
                    ))}
                </Box>
                {/* Skeleton filter bar */}
                <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 3, mb: 2 }} />
                {/* Skeleton rows */}
                {[0, 1, 2, 3, 4].map(i => (
                    <Skeleton
                        key={i}
                        variant="rectangular"
                        height={60}
                        sx={{ borderRadius: 2, mb: 1 }}
                    />
                ))}
            </Box>
        );
    }

    return (
        <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, md: 3 }, py: 2, ...PULSE_KEYFRAMES }}>

            {/* ═══════════════════════════════════════
                HERO HEADER STRIP
            ═══════════════════════════════════════ */}
            <Paper
                elevation={0}
                sx={{
                    background: GRADIENTS.hero,
                    borderRadius: 4,
                    px: { xs: 2.5, md: 4 },
                    py: { xs: 2.5, md: 3 },
                    mb: 3,
                    color: 'white',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: { xs: 'stretch', md: 'center' },
                    flexDirection: { xs: 'column', md: 'row' },
                    gap: 2,
                    position: 'relative',
                    overflow: 'hidden',
                    // Decorative circle
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        top: -40,
                        right: -40,
                        width: 160,
                        height: 160,
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.08)',
                    },
                    '&::after': {
                        content: '""',
                        position: 'absolute',
                        bottom: -30,
                        right: 80,
                        width: 100,
                        height: 100,
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.05)',
                    },
                }}
            >
                <Box sx={{ position: 'relative', zIndex: 1 }}>
                    <Typography variant="h5" fontWeight={800} sx={{ letterSpacing: '-0.02em' }}>
                        Клиенты
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip
                            label={`${stats.total} всего`}
                            size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 600 }}
                        />
                        {stats.green > 0 && (
                            <Chip
                                icon={<Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4ade80', ml: '8px !important' }} />}
                                label={`${stats.green} активных`}
                                size="small"
                                sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: 'white', fontWeight: 600 }}
                            />
                        )}
                        {stats.red > 0 && (
                            <Chip
                                icon={
                                    <Box sx={{
                                        width: 8, height: 8, borderRadius: '50%', bgcolor: '#FF6B6B',
                                        ml: '8px !important',
                                        animation: 'healthPulse 2s infinite',
                                        '--glow-color': 'rgba(255,107,107,0.6)',
                                    } as any}
                                    />
                                }
                                label={`${stats.red} забытых`}
                                size="small"
                                sx={{ bgcolor: 'rgba(255,107,107,0.25)', color: 'white', fontWeight: 700 }}
                            />
                        )}
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 1, position: 'relative', zIndex: 1, alignItems: 'center' }}>
                    <IconButton
                        onClick={refresh}
                        sx={{
                            color: 'rgba(255,255,255,0.7)',
                            '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.15)' },
                        }}
                    >
                        <RefreshIcon />
                    </IconButton>
                    <Button
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => navigate('/crm/clients/new')}
                        sx={{
                            borderRadius: 3,
                            textTransform: 'none',
                            fontWeight: 700,
                            bgcolor: 'rgba(255,255,255,0.2)',
                            backdropFilter: 'blur(10px)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            boxShadow: 'none',
                            '&:hover': {
                                bgcolor: 'rgba(255,255,255,0.3)',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                            },
                        }}
                    >
                        {isMobile ? 'Новый' : 'Добавить клиента'}
                    </Button>
                </Box>
            </Paper>

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>{error}</Alert>}

            {/* ═══════════════════════════════════════
                KPI SUMMARY CARDS
            ═══════════════════════════════════════ */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 2,
                mb: 3,
            }}>
                {/* Total Clients */}
                <Paper elevation={0} sx={{
                    p: 2.5,
                    background: GRADIENTS.total,
                    color: 'white',
                    borderRadius: 3,
                    position: 'relative',
                    overflow: 'hidden',
                    '&::after': {
                        content: '""', position: 'absolute', top: -20, right: -20,
                        width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)',
                    },
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <PeopleIcon sx={{ fontSize: 20, opacity: 0.9 }} />
                        <Typography variant="body2" fontWeight={600} sx={{ opacity: 0.9 }}>
                            Всего клиентов
                        </Typography>
                    </Box>
                    <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em' }}>
                        {stats.total}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7, mt: 0.5, display: 'block' }}>
                        в вашей базе
                    </Typography>
                </Paper>

                {/* Healthy Clients */}
                <Paper elevation={0} sx={{
                    p: 2.5,
                    background: GRADIENTS.healthy,
                    color: 'white',
                    borderRadius: 3,
                    position: 'relative',
                    overflow: 'hidden',
                    '&::after': {
                        content: '""', position: 'absolute', top: -20, right: -20,
                        width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)',
                    },
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <CheckCircleIcon sx={{ fontSize: 20, opacity: 0.9 }} />
                        <Typography variant="body2" fontWeight={600} sx={{ opacity: 0.9 }}>
                            Активные
                        </Typography>
                    </Box>
                    <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em' }}>
                        {healthCounts.green}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7, mt: 0.5, display: 'block' }}>
                        на связи
                    </Typography>
                </Paper>

                {/* Forgotten Clients */}
                <Paper elevation={0} sx={{
                    p: 2.5,
                    background: GRADIENTS.forgotten,
                    color: 'white',
                    borderRadius: 3,
                    position: 'relative',
                    overflow: 'hidden',
                    '&::after': {
                        content: '""', position: 'absolute', top: -20, right: -20,
                        width: 80, height: 80, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.1)',
                    },
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                        <WarningIcon sx={{ fontSize: 20, opacity: 0.9 }} />
                        <Typography variant="body2" fontWeight={600} sx={{ opacity: 0.9 }}>
                            Забытые
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                        <Typography variant="h3" fontWeight={800} sx={{ letterSpacing: '-0.03em' }}>
                            {healthCounts.red}
                        </Typography>
                        {healthCounts.red > 0 && (
                            <Box sx={{
                                width: 10, height: 10, borderRadius: '50%', bgcolor: 'white',
                                animation: 'healthPulse 2s infinite',
                                '--glow-color': 'rgba(255,255,255,0.6)',
                            } as any}
                            />
                        )}
                    </Box>
                    <Typography variant="caption" sx={{ opacity: 0.7, mt: 0.5, display: 'block' }}>
                        требуют внимания
                    </Typography>
                </Paper>
            </Box>

            {/* ═══════════════════════════════════════
                GLASSMORPHIC FILTER BAR
            ═══════════════════════════════════════ */}
            <Paper
                elevation={0}
                sx={{
                    p: 2,
                    mb: 2,
                    borderRadius: 3,
                    background: alpha(theme.palette.background.paper, 0.7),
                    backdropFilter: 'blur(20px)',
                    border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                    boxShadow: `0 4px 30px ${alpha(theme.palette.common.black, 0.04)}`,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1.5,
                    alignItems: 'center',
                }}
            >
                {/* Search */}
                <TextField
                    size="small"
                    placeholder="Поиск клиента..."
                    value={filters.search}
                    onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    sx={{
                        flex: { xs: '1 1 100%', md: '0 1 260px' },
                        '& .MuiOutlinedInput-root': {
                            borderRadius: 2.5,
                            bgcolor: alpha(theme.palette.background.default, 0.6),
                            '&.Mui-focused': {
                                boxShadow: `0 0 0 3px ${alpha('#667eea', 0.2)}`,
                            },
                        },
                    }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" sx={{ color: alpha(theme.palette.text.primary, 0.4) }} />
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

                {/* Owner Filter */}
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Ответственный</InputLabel>
                    <Select
                        value={filters.createdBy || ''}
                        label="Ответственный"
                        onChange={e => setFilters(prev => ({
                            ...prev,
                            createdBy: e.target.value || null,
                        }))}
                        sx={{
                            borderRadius: 2.5,
                            bgcolor: alpha(theme.palette.background.default, 0.6),
                        }}
                    >
                        <MenuItem value="">Все</MenuItem>
                        {currentUser && (
                            <MenuItem value={currentUser.uid}>🙋 Мои</MenuItem>
                        )}
                        <Divider />
                        {Array.from(ownerOptions).map(([id, name]) => (
                            <MenuItem key={id} value={id}>{name}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {/* Status Filter — Gradient Chips */}
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', flex: 1 }}>
                    <Chip
                        label="Все"
                        size="small"
                        variant={!filters.status ? 'filled' : 'outlined'}
                        onClick={() => setFilters(prev => ({ ...prev, status: null }))}
                        sx={{
                            fontWeight: !filters.status ? 700 : 400,
                            ...(!filters.status && {
                                background: GRADIENTS.hero,
                                color: 'white',
                                '&:hover': { background: GRADIENTS.hero, opacity: 0.9 },
                            }),
                            borderRadius: 2,
                            transition: 'all 0.2s ease',
                        }}
                    />
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                        const isActive = filters.status === key;
                        return (
                            <Chip
                                key={key}
                                label={cfg.label}
                                size="small"
                                variant={isActive ? 'filled' : 'outlined'}
                                onClick={() => setFilters(prev => ({
                                    ...prev,
                                    status: prev.status === key ? null : key as ClientStatus,
                                }))}
                                sx={{
                                    fontWeight: isActive ? 700 : 400,
                                    borderRadius: 2,
                                    transition: 'all 0.2s ease',
                                    ...(isActive && {
                                        background: cfg.gradient,
                                        color: '#fff',
                                        border: 'none',
                                        boxShadow: `0 2px 8px ${alpha(cfg.color, 0.35)}`,
                                        '&:hover': { background: cfg.gradient },
                                    }),
                                }}
                            />
                        );
                    })}
                    
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />

                    {/* NEW: Modified Today Quick Filter */}
                    <Chip
                        icon={<TimeIcon sx={{ fontSize: '14px !important', color: filters.modifiedToday ? 'white !important' : 'inherit' }} />}
                        label="Изменено сегодня"
                        size="small"
                        variant={filters.modifiedToday ? 'filled' : 'outlined'}
                        onClick={() => setFilters(prev => ({ ...prev, modifiedToday: !prev.modifiedToday }))}
                        sx={{
                            fontWeight: filters.modifiedToday ? 700 : 500,
                            borderRadius: 2,
                            transition: 'all 0.2s ease',
                            ...(filters.modifiedToday && {
                                bgcolor: '#1e293b',
                                color: 'white',
                                border: 'none',
                                '&:hover': { bgcolor: '#0f172a' },
                            }),
                        }}
                    />
                </Box>

                {/* List / Board Toggle */}
                {!isMobile && (
                    <Box sx={{ display: 'flex', bgcolor: alpha(theme.palette.background.default, 0.6), borderRadius: 2, p: 0.5 }}>
                        <Button
                            size="small"
                            onClick={() => setViewMode('list')}
                            sx={{
                                minWidth: 40, px: 1, borderRadius: 1.5,
                                color: viewMode === 'list' ? 'primary.main' : 'text.secondary',
                                bgcolor: viewMode === 'list' ? 'background.paper' : 'transparent',
                                boxShadow: viewMode === 'list' ? `0 2px 8px ${alpha(theme.palette.common.black, 0.05)}` : 'none',
                            }}
                        >
                            <ViewListIcon fontSize="small" />
                        </Button>
                        <Button
                            size="small"
                            onClick={() => setViewMode('board')}
                            sx={{
                                minWidth: 40, px: 1, borderRadius: 1.5,
                                color: viewMode === 'board' ? 'primary.main' : 'text.secondary',
                                bgcolor: viewMode === 'board' ? 'background.paper' : 'transparent',
                                boxShadow: viewMode === 'board' ? `0 2px 8px ${alpha(theme.palette.common.black, 0.05)}` : 'none',
                            }}
                        >
                            <DashboardIcon fontSize="small" />
                        </Button>
                    </Box>
                )}
            </Paper>

            {/* ═══════════════════════════════════════
                DASHBOARD CLUSTERS (HORIZONTAL STRIPS)
            ═══════════════════════════════════════ */}
            {/* Needs Attention Panel */}
            {dashboardClusters?.needsAttention?.length > 0 && !filters.search && !filters.status && (
                <Box sx={{ mb: 4 }}>
                    <Typography variant="subtitle2" fontWeight={700} color="error.main" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <WarningIcon fontSize="small" /> ТРЕБУЮТ ВНИМАНИЯ (Красная зона)
                    </Typography>
                    <Box sx={{
                        display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1,
                        '&::-webkit-scrollbar': { height: 6 },
                        '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.error.main, 0.3), borderRadius: 3 },
                    }}>
                        {dashboardClusters.needsAttention.map(client => (
                            <DashboardCard
                                key={client.id}
                                client={client}
                                ownerName={ownerOptions.get(client.createdBy)}
                                onNavigate={(id) => navigate(`/crm/clients/${id}`)}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            {/* Recent Activity Panel */}
            {dashboardClusters?.recentActivity?.length > 0 && !filters.search && !filters.status && (
                <Box sx={{ mb: 4 }}>
                    <Typography variant="subtitle2" fontWeight={700} color="primary.main" sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                        🔥 АКТИВНОСТЬ СЕГОДНЯ
                    </Typography>
                    <Box sx={{
                        display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1,
                        '&::-webkit-scrollbar': { height: 4 },
                        '&::-webkit-scrollbar-thumb': { bgcolor: alpha(theme.palette.primary.main, 0.2), borderRadius: 3 },
                    }}>
                        {dashboardClusters.recentActivity.map(client => (
                            <DashboardCard
                                key={client.id}
                                client={client}
                                ownerName={ownerOptions.get(client.createdBy)}
                                onNavigate={(id) => navigate(`/crm/clients/${id}`)}
                            />
                        ))}
                    </Box>
                </Box>
            )}

            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5 }}>
                ОСНОВНАЯ БАЗА
            </Typography>

            {/* ═══════════════════════════════════════
                CONTENT (LIST OR KANBAN)
            ═══════════════════════════════════════ */}
            {clients.length === 0 ? (
                /* ═══════ STYLED EMPTY STATE ═══════ */
                <Paper
                    elevation={0}
                    sx={{
                        p: 6,
                        textAlign: 'center',
                        borderRadius: 4,
                        border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                        background: alpha(theme.palette.background.paper, 0.7),
                        backdropFilter: 'blur(10px)',
                    }}
                >
                    <Box sx={{
                        width: 80, height: 80, borderRadius: '50%', mx: 'auto', mb: 3,
                        background: GRADIENTS.hero,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <PeopleIcon sx={{ fontSize: 40, color: 'white' }} />
                    </Box>
                    <Typography variant="h6" fontWeight={700} gutterBottom>
                        {filters.search || filters.createdBy || filters.status || filters.modifiedToday
                            ? 'Нет клиентов по фильтрам'
                            : 'Добавьте первого клиента'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        {filters.search || filters.createdBy || filters.status || filters.modifiedToday
                            ? 'Попробуйте изменить параметры поиска'
                            : 'Начните работу с клиентской базой'}
                    </Typography>
                    {!(filters.search || filters.createdBy || filters.status || filters.modifiedToday) && (
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => navigate('/crm/clients/new')}
                            sx={{
                                borderRadius: 3,
                                textTransform: 'none',
                                fontWeight: 700,
                                background: GRADIENTS.hero,
                                px: 4, py: 1.2,
                            }}
                        >
                            Добавить клиента
                        </Button>
                    )}
                </Paper>
            ) : isMobile ? (
                /* ═══════ MOBILE GLASS CARDS ═══════ */
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {clients.map(client => (
                        <MobileClientCard
                            key={client.id}
                            client={client}
                            ownerName={ownerOptions.get(client.createdBy)}
                            onView={() => navigate(`/crm/clients/${client.id}`)}
                            onAddTask={() => navigate(`/crm/gtd/new?clientId=${client.id}`)}
                        />
                    ))}
                </Box>
            ) : viewMode === 'board' && dashboardClusters?.board ? (
                /* ═══════ KANBAN BOARD VIEW ═══════ */
                <DragDropContext onDragEnd={onDragEnd}>
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: 'repeat(4, minmax(280px, 1fr))', md: 'repeat(4, 1fr)' },
                        gap: 2,
                        alignItems: 'start',
                        minHeight: 500,
                        overflowX: 'auto',
                        pb: 2
                    }}>
                        <KanbanColumn statusId="new" title="Новые" clients={dashboardClusters.board.new} ownerMap={ownerOptions} />
                        <KanbanColumn statusId="contacted" title="В работе" clients={dashboardClusters.board.contacted} ownerMap={ownerOptions} />
                        <KanbanColumn statusId="qualified" title="Квалифицированы" clients={dashboardClusters.board.qualified} ownerMap={ownerOptions} />
                        <KanbanColumn statusId="customer" title="Клиенты" clients={dashboardClusters.board.customer} ownerMap={ownerOptions} />
                    </Box>
                </DragDropContext>
            ) : (
                /* ═══════ PREMIUM DESKTOP TABLE ═══════ */
                <Paper
                    elevation={0}
                    sx={{
                        borderRadius: 4,
                        border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                        overflow: 'hidden',
                        background: alpha(theme.palette.background.paper, 0.85),
                        backdropFilter: 'blur(10px)',
                        boxShadow: `0 4px 30px ${alpha(theme.palette.common.black, 0.04)}`,
                    }}
                >
                    {/* Table Header */}
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 100px 80px 120px 130px 100px 140px',
                        gap: 1,
                        px: 2,
                        py: 1.5,
                        background: alpha(theme.palette.primary.main, 0.03),
                        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                        alignItems: 'center',
                    }}>
                        <SortHeader label="Клиент" field="name" current={filters.sortField} dir={filters.sortDir} onClick={toggleSort} />
                        <SortHeader label="Статус" field="status" current={filters.sortField} dir={filters.sortDir} onClick={toggleSort} />
                        <SortHeader label="" field="health" current={filters.sortField} dir={filters.sortDir} onClick={toggleSort} icon="❤️" />
                        <Typography variant="caption" fontWeight={600} color="text.secondary">Задачи</Typography>
                        <Typography variant="caption" fontWeight={600} color="text.secondary">Ответственный</Typography>
                        <SortHeader label="Баланс" field="balance" current={filters.sortField} dir={filters.sortDir} onClick={toggleSort} />
                        <Typography variant="caption" fontWeight={600} color="text.secondary">Действия</Typography>
                    </Box>

                    {/* Data Rows */}
                    {clients.map(client => {
                        const contact = getFirstContact(client);
                        const healthCfg = HEALTH_CONFIG[client.health];
                        const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.new;

                        return (
                            <Box
                                key={client.id}
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '2fr 100px 80px 120px 130px 100px 140px',
                                    gap: 1,
                                    px: 2,
                                    py: 1.5,
                                    alignItems: 'center',
                                    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                                    cursor: 'pointer',
                                    position: 'relative',
                                    transition: 'all 0.2s ease',
                                    // Health stripe on left
                                    '&::before': {
                                        content: '""',
                                        position: 'absolute',
                                        left: 0,
                                        top: 4,
                                        bottom: 4,
                                        width: 3,
                                        borderRadius: '0 4px 4px 0',
                                        background: healthCfg.color,
                                        opacity: 0.7,
                                        transition: 'opacity 0.2s',
                                    },
                                    '&:hover': {
                                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                                        boxShadow: `0 2px 12px ${alpha(theme.palette.common.black, 0.06)}`,
                                        '&::before': { opacity: 1 },
                                    },
                                    '&:last-child': { borderBottom: 'none' },
                                }}
                                onClick={() => navigate(`/crm/clients/${client.id}`)}
                            >
                                {/* Client */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                                    <Avatar
                                        sx={{
                                            width: 40, height: 40,
                                            background: statusCfg.gradient,
                                            color: 'white',
                                            fontWeight: 700,
                                            fontSize: '0.95rem',
                                            boxShadow: `0 2px 8px ${alpha(statusCfg.color, 0.3)}`,
                                        }}
                                    >
                                        {client.name.charAt(0).toUpperCase()}
                                    </Avatar>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="body2" fontWeight={600} noWrap>
                                            {client.name}
                                        </Typography>
                                        {client.industry && (
                                            <Typography variant="caption" color="text.secondary" noWrap>
                                                {client.industry}
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>

                                {/* Status — Gradient Chip */}
                                <Chip
                                    label={statusCfg.label}
                                    size="small"
                                    sx={{
                                        background: statusCfg.gradient,
                                        color: 'white',
                                        fontWeight: 600,
                                        fontSize: '0.7rem',
                                        height: 24,
                                        boxShadow: `0 2px 6px ${alpha(statusCfg.color, 0.25)}`,
                                    }}
                                />

                                {/* Health — Animated Dot */}
                                <Tooltip title={healthCfg.label}>
                                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                                        <Box
                                            sx={{
                                                width: 12,
                                                height: 12,
                                                borderRadius: '50%',
                                                bgcolor: healthCfg.color,
                                                boxShadow: `0 0 8px ${healthCfg.glow}`,
                                                animation: client.health === 'red' ? 'healthPulse 2s infinite' : 'none',
                                                '--glow-color': healthCfg.glow,
                                            } as any}
                                        />
                                    </Box>
                                </Tooltip>

                                {/* Tasks — Pill badges */}
                                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                    {client.taskStats.overdueCount > 0 && (
                                        <Box sx={{
                                            display: 'flex', alignItems: 'center', gap: 0.3,
                                            px: 1, py: 0.25, borderRadius: 10,
                                            bgcolor: alpha('#ef4444', 0.1),
                                        }}>
                                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ef4444' }} />
                                            <Typography variant="caption" sx={{ color: '#ef4444', fontWeight: 700, fontSize: '0.7rem' }}>
                                                {client.taskStats.overdueCount}
                                            </Typography>
                                        </Box>
                                    )}
                                    {client.taskStats.openCount > 0 && (
                                        <Box sx={{
                                            display: 'flex', alignItems: 'center', gap: 0.3,
                                            px: 1, py: 0.25, borderRadius: 10,
                                            bgcolor: alpha('#3b82f6', 0.08),
                                        }}>
                                            <Typography variant="caption" sx={{ color: '#3b82f6', fontWeight: 600, fontSize: '0.7rem' }}>
                                                {client.taskStats.openCount} откр.
                                            </Typography>
                                        </Box>
                                    )}
                                    {client.taskStats.openCount === 0 && client.taskStats.overdueCount === 0 && (
                                        <Typography variant="caption" color="text.disabled">—</Typography>
                                    )}
                                </Box>

                                {/* Owner */}
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Avatar sx={{
                                        width: 24, height: 24, fontSize: '0.65rem',
                                        background: 'linear-gradient(135deg, #667eea, #764ba2)',
                                        color: 'white',
                                    }}>
                                        {(ownerOptions.get(client.createdBy) || '?').charAt(0)}
                                    </Avatar>
                                    <Typography variant="caption" noWrap color="text.secondary">
                                        {ownerOptions.get(client.createdBy) || '—'}
                                    </Typography>
                                </Box>

                                {/* Balance */}
                                <Typography
                                    variant="body2"
                                    fontWeight={client.balance !== 0 ? 700 : 400}
                                    sx={{
                                        color: client.balance > 0 ? '#ef4444' : client.balance < 0 ? '#22c55e' : alpha(theme.palette.text.primary, 0.3),
                                    }}
                                >
                                    {client.balance !== 0
                                        ? `$${Math.abs(client.balance).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                                        : '—'}
                                </Typography>

                                {/* Actions — Ghost buttons */}
                                <Box sx={{ display: 'flex', gap: 0.3 }} onClick={e => e.stopPropagation()}>
                                    {contact.phone && (
                                        <Tooltip title={`Позвонить: ${contact.phone}`}>
                                            <IconButton
                                                size="small"
                                                component="a"
                                                href={`tel:${contact.phone}`}
                                                sx={{
                                                    width: 32, height: 32,
                                                    color: '#22c55e',
                                                    transition: 'all 0.2s',
                                                    '&:hover': {
                                                        background: 'linear-gradient(135deg, #11998e, #38ef7d)',
                                                        color: 'white',
                                                        boxShadow: '0 2px 8px rgba(17,153,142,0.3)',
                                                    },
                                                }}
                                            >
                                                <PhoneIcon sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    {contact.email && (
                                        <Tooltip title={`Написать: ${contact.email}`}>
                                            <IconButton
                                                size="small"
                                                component="a"
                                                href={`mailto:${contact.email}`}
                                                sx={{
                                                    width: 32, height: 32,
                                                    color: '#3b82f6',
                                                    transition: 'all 0.2s',
                                                    '&:hover': {
                                                        background: 'linear-gradient(135deg, #667eea, #764ba2)',
                                                        color: 'white',
                                                        boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
                                                    },
                                                }}
                                            >
                                                <EmailIcon sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <Tooltip title="Добавить задачу">
                                        <IconButton
                                            size="small"
                                            onClick={() => navigate(`/crm/gtd/new?clientId=${client.id}`)}
                                            sx={{
                                                width: 32, height: 32,
                                                color: '#8b5cf6',
                                                transition: 'all 0.2s',
                                                '&:hover': {
                                                    background: 'linear-gradient(135deg, #a18cd1, #fbc2eb)',
                                                    color: 'white',
                                                    boxShadow: '0 2px 8px rgba(139,92,246,0.3)',
                                                },
                                            }}
                                        >
                                            <TaskIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Детали">
                                        <IconButton
                                            size="small"
                                            onClick={() => navigate(`/crm/clients/${client.id}`)}
                                            sx={{
                                                width: 32, height: 32,
                                                color: alpha(theme.palette.text.primary, 0.4),
                                                transition: 'all 0.2s',
                                                '&:hover': {
                                                    background: GRADIENTS.hero,
                                                    color: 'white',
                                                    boxShadow: '0 2px 8px rgba(102,126,234,0.3)',
                                                },
                                            }}
                                        >
                                            <VisibilityIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Box>
                        );
                    })}
                </Paper>
            )}
        </Box>
    );
};

// ═══════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════

/** Sortable column header */
const SortHeader: React.FC<{
    label: string;
    field: SortField;
    current: SortField;
    dir: 'asc' | 'desc';
    onClick: (f: SortField) => void;
    icon?: string;
}> = ({ label, field, current, dir, onClick, icon }) => {
    const isActive = current === field;
    return (
        <Box
            onClick={() => onClick(field)}
            sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                cursor: 'pointer', userSelect: 'none',
                transition: 'color 0.15s',
                '&:hover': { color: 'primary.main' },
            }}
        >
            <Typography
                variant="caption"
                fontWeight={isActive ? 700 : 600}
                color={isActive ? 'primary.main' : 'text.secondary'}
            >
                {icon || label}
            </Typography>
            {isActive && (
                dir === 'asc' ? <ArrowUpIcon sx={{ fontSize: 14 }} /> : <ArrowDownIcon sx={{ fontSize: 14 }} />
            )}
        </Box>
    );
};

/** Mobile card for a single client — Glass design */
const MobileClientCard: React.FC<{
    client: ClientRow;
    ownerName?: string;
    onView: () => void;
    onAddTask: () => void;
}> = ({ client, ownerName, onView, onAddTask }) => {
    const theme = useTheme();
    const contact = client.contacts?.length > 0 ? client.contacts[0] : { phone: client.phone, email: client.email };
    const healthCfg = HEALTH_CONFIG[client.health];
    const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.new;

    return (
        <Paper
            elevation={0}
            onClick={onView}
            sx={{
                p: 2,
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                background: alpha(theme.palette.background.paper, 0.75),
                backdropFilter: 'blur(10px)',
                boxShadow: `0 2px 16px ${alpha(theme.palette.common.black, 0.04)}`,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden',
                '&:active': { transform: 'scale(0.98)' },
                // Top gradient accent bar
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: `linear-gradient(90deg, ${healthCfg.color}, ${alpha(healthCfg.color, 0.3)})`,
                },
            }}
        >
            {/* Top row: avatar + name + health dot */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Avatar
                    sx={{
                        width: 44, height: 44,
                        background: statusCfg.gradient,
                        color: 'white',
                        fontWeight: 700,
                        boxShadow: `0 2px 8px ${alpha(statusCfg.color, 0.3)}`,
                    }}
                >
                    {client.name.charAt(0).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>
                        {client.name}
                    </Typography>
                    {client.industry && (
                        <Typography variant="caption" color="text.secondary" noWrap>
                            {client.industry}
                        </Typography>
                    )}
                </Box>
                {/* Animated health dot */}
                <Box sx={{
                    width: 14, height: 14, borderRadius: '50%',
                    bgcolor: healthCfg.color,
                    boxShadow: `0 0 10px ${healthCfg.glow}`,
                    animation: client.health === 'red' ? 'healthPulse 2s infinite' : 'none',
                    '--glow-color': healthCfg.glow,
                } as any}
                />
            </Box>

            {/* Badges row */}
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                <Chip
                    label={statusCfg.label}
                    size="small"
                    sx={{
                        background: statusCfg.gradient,
                        color: 'white',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                        height: 24,
                        boxShadow: `0 1px 4px ${alpha(statusCfg.color, 0.25)}`,
                    }}
                />
                {client.taskStats.overdueCount > 0 && (
                    <Chip
                        icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#ef4444', ml: '8px !important' }} />}
                        label={`${client.taskStats.overdueCount} просрочено`}
                        size="small"
                        sx={{ bgcolor: alpha('#ef4444', 0.1), color: '#ef4444', fontWeight: 600, height: 24, fontSize: '0.7rem' }}
                    />
                )}
                {client.taskStats.openCount > 0 && (
                    <Chip
                        label={`${client.taskStats.openCount} задач`}
                        size="small"
                        sx={{ bgcolor: alpha('#3b82f6', 0.08), color: '#3b82f6', fontWeight: 600, height: 24, fontSize: '0.7rem' }}
                    />
                )}
                {client.balance !== 0 && (
                    <Chip
                        label={`$${Math.abs(client.balance).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                        size="small"
                        sx={{
                            bgcolor: alpha(client.balance > 0 ? '#ef4444' : '#22c55e', 0.1),
                            color: client.balance > 0 ? '#ef4444' : '#22c55e',
                            fontWeight: 700, height: 24, fontSize: '0.7rem',
                        }}
                    />
                )}
            </Box>

            {/* Footer: owner + quick actions */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Avatar sx={{
                        width: 20, height: 20, fontSize: '0.55rem',
                        background: 'linear-gradient(135deg, #667eea, #764ba2)',
                        color: 'white',
                    }}>
                        {(ownerName || '?').charAt(0)}
                    </Avatar>
                    <Typography variant="caption" color="text.secondary">
                        {ownerName || '—'}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.3 }} onClick={e => e.stopPropagation()}>
                    {contact?.phone && (
                        <IconButton
                            size="small"
                            component="a"
                            href={`tel:${contact.phone}`}
                            sx={{
                                width: 36, height: 36, color: '#22c55e',
                                '&:hover': { background: 'linear-gradient(135deg, #11998e, #38ef7d)', color: 'white' },
                            }}
                        >
                            <PhoneIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    )}
                    {contact?.email && (
                        <IconButton
                            size="small"
                            component="a"
                            href={`mailto:${contact.email}`}
                            sx={{
                                width: 36, height: 36, color: '#3b82f6',
                                '&:hover': { background: 'linear-gradient(135deg, #667eea, #764ba2)', color: 'white' },
                            }}
                        >
                            <EmailIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    )}
                    <IconButton
                        size="small"
                        onClick={onAddTask}
                        sx={{
                            width: 36, height: 36, color: '#8b5cf6',
                            '&:hover': { background: 'linear-gradient(135deg, #a18cd1, #fbc2eb)', color: 'white' },
                        }}
                    >
                        <TaskIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                </Box>
            </Box>
        </Paper>
    );
};

/** Dashboard Card for Horizontal Strips (Recent Activity & Needs Attention) */
const DashboardCard: React.FC<{ client: ClientRow; ownerName?: string; onNavigate: (id: string) => void }> = ({ client, ownerName, onNavigate }) => {
    const theme = useTheme();
    const navigate = useNavigate();
    const healthCfg = HEALTH_CONFIG[client.health];
    const statusCfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.new;

    return (
        <Paper
            onClick={() => onNavigate(client.id)}
            elevation={0}
            sx={{
                minWidth: 260, maxWidth: 300, flexShrink: 0,
                p: 2,
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
                bgcolor: alpha(theme.palette.background.paper, 0.8),
                backdropFilter: 'blur(8px)',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.2s ease',
                '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: `0 8px 24px ${alpha(theme.palette.common.black, 0.08)}`,
                    borderColor: healthCfg.color,
                },
                // Top accent stripe
                '&::before': {
                    content: '""', position: 'absolute', top: 0, left: 0, right: 0, height: 4,
                    background: healthCfg.color,
                }
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Chip label={statusCfg.label} size="small" sx={{ background: statusCfg.gradient, color: 'white', fontWeight: 600, height: 20, fontSize: '0.65rem' }} />
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                    {ownerName || '—'}
                </Typography>
            </Box>
            <Typography variant="subtitle2" fontWeight={700} noWrap gutterBottom>
                {client.name}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <Typography variant="caption" color="text.secondary">
                    {formatSmartDate(client.updatedAt?.seconds || client.createdAt?.seconds)}
                 </Typography>
                 <Box sx={{ display: 'flex', gap: 0.5 }} onClick={e => e.stopPropagation()}>
                    {client.contacts?.[0]?.phone && (
                        <IconButton size="small" component="a" href={`tel:${client.contacts[0].phone}`} sx={{ p: 0.5, color: '#22c55e' }}>
                            <PhoneIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                    )}
                    <IconButton size="small" onClick={() => navigate(`/crm/gtd/new?clientId=${client.id}`)} sx={{ p: 0.5, color: '#8b5cf6' }}>
                        <TaskIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                 </Box>
                 {client.balance !== 0 && (
                    <Typography variant="caption" fontWeight={700} color={client.balance > 0 ? 'error.main' : 'success.main'}>
                        {client.balance > 0 ? '-' : '+'}${Math.abs(client.balance)}
                    </Typography>
                 )}
            </Box>
        </Paper>
    );
};

/** Kanban Column & Cards */
const KanbanColumn: React.FC<{ statusId: string; title: string; clients: ClientRow[]; ownerMap: Map<string, string> }> = ({ statusId, title, clients, ownerMap }) => {
    const theme = useTheme();
    const navigate = useNavigate();
    return (
        <Box sx={{
            bgcolor: alpha(theme.palette.background.paper, 0.4),
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
            p: 1.5,
            display: 'flex', flexDirection: 'column', gap: 1.5,
            minHeight: 200,
        }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1 }}>
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary">{title}</Typography>
                <Chip label={clients.length} size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700 }} />
            </Box>
            <Droppable droppableId={statusId}>
                {(provided, snapshot) => (
                    <Box
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        sx={{
                            display: 'flex', flexDirection: 'column', gap: 1.5,
                            minHeight: 150,
                            bgcolor: snapshot.isDraggingOver ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                            borderRadius: 2,
                            transition: 'background-color 0.2s ease',
                        }}
                    >
                        {clients.map((client, index) => (
                            <Draggable key={client.id} draggableId={client.id} index={index}>
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        style={{
                                            ...provided.draggableProps.style,
                                            boxShadow: snapshot.isDragging ? `0 12px 24px ${alpha(theme.palette.common.black, 0.15)}` : 'none',
                                            borderRadius: 12,
                                        }}
                                    >
                                        <DashboardCard client={client} ownerName={ownerMap.get(client.createdBy)} onNavigate={(id) => navigate(`/crm/clients/${id}`)}/>
                                    </div>
                                )}
                            </Draggable>
                        ))}
                        {provided.placeholder}
                    </Box>
                )}
            </Droppable>
        </Box>
    );
};

export default ClientsPage;
