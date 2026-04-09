/**
 * Internal client dashboard — financial analytics + project activity.
 * Mounted at /dashboard/client/:id.
 *
 * Refactored in v2.1: thin wrapper that loads data via server-side API
 * hooks and delegates rendering to modular components in
 * src/components/dashboard/client/.
 *
 * Previous monolith: 688 lines → now < 200 lines.
 *
 * For the client-facing (external) view, see ClientPortalPage.tsx.
 * See src/pages/dashbord-for-client/SPEC.md for the unified architecture.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Grid,
  Button,
  Alert,
  CircularProgress,
  Stack,
} from '@mui/material';
import { Visibility as VisibilityIcon } from '@mui/icons-material';
import { getStorage, ref, listAll, getDownloadURL } from 'firebase/storage';
import { Client } from '../../../types/crm.types';
import type { LaborPeriod } from '../../../types/clientDashboard.types';
import { crmApi } from '../../../api/crmApi';

// ─── Dashboard hooks (API-backed) ─────────────────────────────────
import {
  useClientSummary,
  useClientLaborLog,
  useClientTimeline,
  useClientCostBreakdown,
} from '../../../hooks/dashboard';

// ─── Dashboard components ──────────────────────────────────────────
import {
  ClientHeader,
  BudgetProgressBar,
  CostBreakdownPie,
  LaborLog,
  RedFlagsBanner,
  ProjectTimeline,
} from '../../../components/dashboard/client';

// ─── Existing layout + sections (reused from Phase 2) ──────────────
import ClientDashboardLayout, {
  type DashboardHeader,
  type DashboardSection,
} from '../../../components/client-dashboard/ClientDashboardLayout';
import GallerySection, {
  type GalleryPhoto,
} from '../../../components/client-dashboard/sections/GallerySection';
import ShareWithClientButton from '../../../components/client-dashboard/sharing/ShareWithClientButton';

// ─── Page Component ────────────────────────────────────────────────

const ClientDashboardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Client base data (Firestore direct — for header/layout)
  const [client, setClient] = useState<Client | null>(null);
  const [clientLoading, setClientLoading] = useState(true);

  // Photos from Firebase Storage
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);

  // API-backed hooks for financial data
  const { data: summary, loading: summaryLoading } = useClientSummary(id);
  const [laborPeriod, setLaborPeriod] = useState<LaborPeriod>('month');
  const { data: laborData, loading: laborLoading } = useClientLaborLog(id, laborPeriod);
  const { events, loading: timelineLoading, hasMore, total, loadMore } = useClientTimeline(id);
  const { data: costsData, loading: costsLoading } = useClientCostBreakdown(id);

  // Load client
  useEffect(() => {
    if (!id) { setClientLoading(false); return; }
    let cancelled = false;
    crmApi.getClientById(id)
      .then(data => { if (!cancelled) setClient(data); })
      .catch(err => console.error('Error loading client:', err))
      .finally(() => { if (!cancelled) setClientLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // Load photos from Storage
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const storage = getStorage();
    const photosRef = ref(storage, `projects/${id}/photos/`);
    listAll(photosRef)
      .then(result =>
        Promise.all(result.items.map(async itemRef => ({
          name: itemRef.name,
          url: await getDownloadURL(itemRef),
        })))
      )
      .then(setPhotos)
      .catch(err => console.error('Error loading photos:', err))
      .finally(() => setPhotosLoading(false));
  }, [id, clientLoading, client]);

  const galleryPhotos = useMemo((): GalleryPhoto[] =>
    photos.map(p => ({
      id: p.name,
      url: p.url,
      title: p.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      date: '',
      category: p.name.startsWith('render') ? 'render' as const
        : p.name.startsWith('before') ? 'before' as const
        : 'progress' as const,
    })), [photos]);

  // ─── Loading / error ───────────────────────────────────────────
  if (clientLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }
  if (!client) {
    return <Box sx={{ p: 3 }}><Alert severity="error">Client not found (ID: {id})</Alert></Box>;
  }

  // ─── Layout header ─────────────────────────────────────────────
  const header: DashboardHeader = {
    title: client.name,
    subtitle: client.workLocation?.address || client.address || '',
    caption: `${client.type === 'company' ? 'Company' : 'Person'} · ${client.status}`,
    totalAmount: summary
      ? `Profit $${summary.profit.toLocaleString()}`
      : `LTV $${(client.totalRevenue || 0).toLocaleString()}`,
    chips: [
      { label: client.status, color: 'primary' },
      ...(client.tags || []).slice(0, 4).map(tag => ({ label: tag })),
    ],
  };

  const actions = (
    <Stack direction="row" spacing={1}>
      <Button size="small" variant="outlined" startIcon={<VisibilityIcon />}
        onClick={() => navigate(`/crm/clients/${id}`)}>Details</Button>
      {id && <ShareWithClientButton clientId={id} clientName={client.name}
        size="small" variant="contained" />}
    </Stack>
  );

  // ─── Sections (tab panels) ─────────────────────────────────────
  const sections: DashboardSection[] = [
    {
      label: 'Finance',
      icon: <VisibilityIcon />,
      content: (
        <Box>
          <RedFlagsBanner flags={summary?.redFlags || []} />
          <ClientHeader summary={summary} loading={summaryLoading}
            onNewTask={() => navigate(`/gtd/create?clientId=${id}`)}
            onNewEstimate={() => navigate(`/estimates/new?clientId=${id}`)} />
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <BudgetProgressBar estimated={summary?.estimateTotal || 0}
                spent={summary?.totalSpent || 0} invoiced={summary?.invoiced || 0}
                loading={summaryLoading} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <CostBreakdownPie data={costsData} loading={costsLoading} />
            </Grid>
          </Grid>
        </Box>
      ),
    },
    {
      label: 'Labor',
      icon: <VisibilityIcon />,
      content: <LaborLog data={laborData} loading={laborLoading}
        period={laborPeriod} onPeriodChange={setLaborPeriod} />,
    },
    {
      label: 'Timeline',
      icon: <VisibilityIcon />,
      content: <ProjectTimeline events={events} loading={timelineLoading}
        hasMore={hasMore} total={total} onLoadMore={loadMore} />,
    },
    {
      label: `Photos (${galleryPhotos.length})`,
      icon: <VisibilityIcon />,
      content: photosLoading
        ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        : <GallerySection photos={galleryPhotos} />,
    },
  ];

  return (
    <ClientDashboardLayout mode="internal" header={header}
      sections={sections} actions={actions} />
  );
};

export default ClientDashboardPage;
