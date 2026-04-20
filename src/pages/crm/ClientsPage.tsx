/**
 * @fileoverview Clients list — V2 redesign aligned with Client Card V2 (PR #43).
 *
 * Shell composition:
 *  - ClientsPageHeader — title, stats chips, Add/Refresh
 *  - ClientsFilterBar — sticky filters (search, lifecycle chips, segment, owner, view toggle)
 *  - ClientsBuckets — horizontal strips for at-risk / forgotten / VIP
 *  - ClientsList (desktop) / ClientCardMobile (mobile) / ClientsKanbanLifecycle (board view)
 *  - ClientsBulkBar — sticky bottom bar for multi-select ops
 *
 * Data from useClientDashboard hook which surfaces V2 fields (healthScore, churnRisk,
 * ltv, lifecycleStage, segment) with legacy fallbacks for unmigrated clients.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Paper,
    Stack,
    Typography,
    Button,
    Alert,
    Skeleton,
    useTheme,
    useMediaQuery,
    alpha,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PeopleIcon from '@mui/icons-material/People';

import { useAuth } from '../../auth/AuthContext';
import { useClientDashboard, SortField } from '../../hooks/useClientDashboard';

import ClientsPageHeader from '../../components/crm/clients/ClientsPageHeader';
import ClientsFilterBar from '../../components/crm/clients/ClientsFilterBar';
import ClientsBuckets from '../../components/crm/clients/ClientsBuckets';
import ClientsList from '../../components/crm/clients/ClientsList';
import ClientCardMobile from '../../components/crm/clients/ClientCardMobile';
import ClientsBulkBar from '../../components/crm/clients/ClientsBulkBar';
import ClientsKanbanLifecycle from '../../components/crm/clients/ClientsKanbanLifecycle';

const ClientsPage: React.FC = () => {
    const theme = useTheme();
    const navigate = useNavigate();
    const { currentUser, userProfile } = useAuth();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const {
        clients,
        users,
        loading,
        error,
        filters,
        setFilters,
        stats,
        dashboardClusters,
        updateClientLifecycle,
        refresh,
    } = useClientDashboard(userProfile?.companyId);

    const ownerMap = useMemo(() => {
        const map = new Map<string, string>();
        users.forEach(u => {
            if (u.displayName) map.set(u.id, u.displayName);
        });
        return map;
    }, [users]);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleAll = useCallback(() => {
        setSelectedIds(prev => {
            if (clients.length > 0 && clients.every(c => prev.has(c.id))) {
                return new Set();
            }
            return new Set(clients.map(c => c.id));
        });
    }, [clients]);

    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

    const handleBulkApplied = useCallback(() => {
        clearSelection();
        refresh();
    }, [clearSelection, refresh]);

    const handleSort = useCallback(
        (field: SortField) => {
            setFilters(prev => ({
                ...prev,
                sortField: field,
                sortDir: prev.sortField === field && prev.sortDir === 'asc' ? 'desc' : 'asc',
            }));
        },
        [setFilters]
    );

    const goClient = useCallback((id: string) => navigate(`/crm/clients/${id}`), [navigate]);
    const goNewTask = useCallback((id: string) => navigate(`/crm/gtd/new?clientId=${id}`), [navigate]);

    const hasActiveFilters =
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

    // ── Loading skeleton ──
    if (loading) {
        return (
            <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, md: 3 }, py: 2 }}>
                <Skeleton variant="rectangular" height={88} sx={{ borderRadius: 2, mb: 2 }} />
                <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2, mb: 2 }} />
                {[0, 1, 2, 3, 4, 5].map(i => (
                    <Skeleton key={i} variant="rectangular" height={56} sx={{ borderRadius: 1, mb: 0.75 }} />
                ))}
            </Box>
        );
    }

    return (
        <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, md: 3 }, py: 2, pb: { xs: 12, md: 10 } }}>
            <ClientsPageHeader
                stats={stats}
                onAdd={() => navigate('/crm/clients/new')}
                onRefresh={refresh}
                isMobile={isMobile}
            />

            {error && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                    {error}
                </Alert>
            )}

            <ClientsFilterBar
                filters={filters}
                setFilters={setFilters}
                ownerOptions={ownerMap}
                currentUserId={currentUser?.uid}
                viewMode={viewMode}
                setViewMode={setViewMode}
                isMobile={isMobile}
            />

            {/* Buckets strip — hidden when user is actively filtering to avoid duplicate clients */}
            {!hasActiveFilters && viewMode === 'list' && (
                <ClientsBuckets
                    atRisk={dashboardClusters.atRisk}
                    forgotten={dashboardClusters.forgotten}
                    vip={dashboardClusters.vip}
                    onNavigate={goClient}
                    onAddTask={goNewTask}
                />
            )}

            {/* Main content */}
            {clients.length === 0 ? (
                <EmptyState hasFilters={!!hasActiveFilters} onAdd={() => navigate('/crm/clients/new')} />
            ) : viewMode === 'board' && !isMobile ? (
                <Box>
                    <Typography variant="subtitle2" fontWeight={700} color="text.secondary" mb={1.5}>
                        ПО ЭТАПАМ
                    </Typography>
                    <ClientsKanbanLifecycle
                        byLifecycle={dashboardClusters.byLifecycle}
                        onMove={updateClientLifecycle}
                        onNavigate={goClient}
                    />
                </Box>
            ) : isMobile ? (
                <Stack spacing={1.25}>
                    {!hasActiveFilters && (
                        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ pl: 0.5 }}>
                            ВСЕ КЛИЕНТЫ · {clients.length}
                        </Typography>
                    )}
                    {clients.map(client => (
                        <ClientCardMobile
                            key={client.id}
                            client={client}
                            ownerName={ownerMap.get(client.createdBy)}
                            selected={selectedIds.has(client.id)}
                            onToggleSelect={() => toggleSelect(client.id)}
                            onView={() => goClient(client.id)}
                            onAddTask={() => goNewTask(client.id)}
                        />
                    ))}
                </Stack>
            ) : (
                <>
                    <Typography variant="subtitle2" fontWeight={700} color="text.secondary" mb={1.5}>
                        ОСНОВНАЯ БАЗА · {clients.length}
                    </Typography>
                    <ClientsList
                        clients={clients}
                        ownerMap={ownerMap}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                        onToggleAll={toggleAll}
                        onNavigate={goClient}
                        onAddTask={goNewTask}
                        sortField={filters.sortField}
                        sortDir={filters.sortDir}
                        onSort={handleSort}
                    />
                </>
            )}

            <ClientsBulkBar
                selectedIds={selectedIds}
                clients={clients}
                ownerOptions={ownerMap}
                onClear={clearSelection}
                onApplied={handleBulkApplied}
            />
        </Box>
    );
};

// ─────────────────────────────────────────────

const EmptyState: React.FC<{ hasFilters: boolean; onAdd: () => void }> = ({ hasFilters, onAdd }) => {
    const theme = useTheme();
    return (
        <Paper
            variant="outlined"
            elevation={0}
            sx={{
                p: 5,
                textAlign: 'center',
                borderRadius: 2,
                bgcolor: alpha(theme.palette.background.default, 0.5),
            }}
        >
            <Box
                sx={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    bgcolor: 'primary.light',
                    color: 'primary.contrastText',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mb: 2,
                }}
            >
                <PeopleIcon sx={{ fontSize: 32 }} />
            </Box>
            <Typography variant="h6" fontWeight={700} gutterBottom>
                {hasFilters ? 'Нет клиентов по фильтрам' : 'Добавьте первого клиента'}
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={3}>
                {hasFilters
                    ? 'Попробуйте изменить параметры поиска или сбросить фильтры'
                    : 'Начните работу с клиентской базой'}
            </Typography>
            {!hasFilters && (
                <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} sx={{ textTransform: 'none' }}>
                    Добавить клиента
                </Button>
            )}
        </Paper>
    );
};

export default ClientsPage;
