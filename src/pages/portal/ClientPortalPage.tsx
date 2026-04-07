import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Chip,
  LinearProgress,
  Tab,
  Tabs,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  AttachMoney as MoneyIcon,
  Timeline as TimelineIcon,
  Payment as PaymentIcon,
  PhotoLibrary as PhotoIcon,
  VerifiedUser as InspectionIcon,
} from '@mui/icons-material';

import { useClientPortal } from '../../hooks/useClientPortal';
import EstimateSection from '../../components/client-dashboard/sections/EstimateSection';
import TimelineSection, { type ProjectStage } from '../../components/client-dashboard/sections/TimelineSection';
import GallerySection from '../../components/client-dashboard/sections/GallerySection';
import PaymentsSection, { type PaymentItem } from '../../components/client-dashboard/sections/PaymentsSection';
import InspectionsSection, { type Inspection } from '../../components/client-dashboard/sections/InspectionsSection';

// --- Helpers ---

function buildStagesFromTasks(
  tasks: ReturnType<typeof useClientPortal>['tasks']
): ProjectStage[] {
  if (tasks.length === 0) {
    return [
      { name: 'Getting Started', status: 'current', progress: 0, icon: '\uD83D\uDD35', description: 'Project setup in progress' },
    ];
  }

  // Group tasks by context or derive phases
  const phases = new Map<string, { done: number; total: number; earliest: number; latest: number }>();

  tasks.forEach((t) => {
    const phase = t.context?.replace('@', '') || 'general';
    const entry = phases.get(phase) || { done: 0, total: 0, earliest: Infinity, latest: 0 };
    entry.total++;
    if (t.status === 'done') entry.done++;

    const created = t.createdAt?.seconds || 0;
    const updated = t.updatedAt?.seconds || 0;
    if (created < entry.earliest) entry.earliest = created;
    if (updated > entry.latest) entry.latest = updated;

    phases.set(phase, entry);
  });

  const stages: ProjectStage[] = [];
  let foundCurrent = false;

  phases.forEach((data, phase) => {
    const progress = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
    let status: ProjectStage['status'] = 'upcoming';

    if (progress === 100) {
      status = 'completed';
    } else if (!foundCurrent && progress < 100) {
      status = 'current';
      foundCurrent = true;
    }

    stages.push({
      name: phase.charAt(0).toUpperCase() + phase.slice(1),
      status,
      progress,
      icon: status === 'completed' ? '\u2705' : status === 'current' ? '\uD83D\uDD35' : '\u2B1C',
      description: `${data.done}/${data.total} tasks complete`,
    });
  });

  return stages;
}

function buildPaymentsFromLedger(
  ledger: ReturnType<typeof useClientPortal>['ledger'],
  estimates: ReturnType<typeof useClientPortal>['estimates']
): { payments: PaymentItem[]; totalEstimate: string } {
  const totalFromEstimates = estimates.reduce((sum, e) => sum + (e.total || 0), 0);

  // Group ledger credits (payments received) as "paid" rows
  const payments: PaymentItem[] = [];

  // Income entries from ledger
  const credits = ledger.filter((e) => e.type === 'credit');
  credits.forEach((entry) => {
    const pct = totalFromEstimates > 0 ? Math.round((entry.amount / totalFromEstimates) * 100) : 0;
    const dateStr = entry.date?.seconds
      ? new Date(entry.date.seconds * 1000).toISOString().split('T')[0]
      : '';
    payments.push({
      stage: entry.description || 'Payment',
      amount: entry.amount,
      percentage: pct,
      status: 'paid',
      dueDate: dateStr,
    });
  });

  // If no payments yet, show estimate-based schedule placeholder
  if (payments.length === 0 && totalFromEstimates > 0) {
    payments.push(
      { stage: 'Deposit (15%)', amount: Math.round(totalFromEstimates * 0.15), percentage: 15, status: 'pending', dueDate: '' },
      { stage: 'Materials (35%)', amount: Math.round(totalFromEstimates * 0.35), percentage: 35, status: 'upcoming', dueDate: '' },
      { stage: 'Mid-Construction (25%)', amount: Math.round(totalFromEstimates * 0.25), percentage: 25, status: 'upcoming', dueDate: '' },
      { stage: 'Completion (25%)', amount: Math.round(totalFromEstimates * 0.25), percentage: 25, status: 'upcoming', dueDate: '' },
    );
  }

  return {
    payments,
    totalEstimate: totalFromEstimates > 0 ? `$${totalFromEstimates.toLocaleString()}` : '$0',
  };
}

function buildInspectionsFromTasks(
  tasks: ReturnType<typeof useClientPortal>['tasks']
): Inspection[] {
  return tasks
    .filter((t) => {
      const title = (t.title || '').toLowerCase();
      const context = (t.context || '').toLowerCase();
      return title.includes('inspect') || context.includes('inspection');
    })
    .map((t, idx) => {
      let status: Inspection['status'] = 'scheduled';
      if (t.status === 'done') status = 'passed';
      else if (t.status === 'next_action') status = 'in-progress';

      const dateStr = t.createdAt?.seconds
        ? new Date(t.createdAt.seconds * 1000).toISOString().split('T')[0]
        : '';

      return {
        id: idx + 1,
        name: t.title,
        date: dateStr,
        status,
        notes: (t as any).description || undefined,
      };
    });
}

// --- Component ---

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`portal-tabpanel-${index}`}
      aria-labelledby={`portal-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 2 }}>{children}</Box>}
    </div>
  );
}

const ClientPortalPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [tabValue, setTabValue] = useState(0);

  const { client, estimates: allEstimates, tasks, ledger, photos, loading, notFound } = useClientPortal(slug);

  // Filter out internal (cost) estimates — only show commercial ones to the client
  const estimates = useMemo(() => {
    const internalPattern = /internal|внутренн/i;
    return allEstimates.filter((e) => {
      if (e.estimateType === 'internal') return false;
      if (e.notes && internalPattern.test(e.notes)) return false;
      if (e.number && internalPattern.test(e.number)) return false;
      return true;
    });
  }, [allEstimates]);

  const stages = useMemo(() => buildStagesFromTasks(tasks), [tasks]);
  const { payments, totalEstimate } = useMemo(
    () => buildPaymentsFromLedger(ledger, estimates),
    [ledger, estimates]
  );
  const inspections = useMemo(() => buildInspectionsFromTasks(tasks), [tasks]);

  const overallProgress = useMemo(() => {
    if (tasks.length === 0) return 0;
    const done = tasks.filter((t) => t.status === 'done').length;
    return Math.round((done / tasks.length) * 100);
  }, [tasks]);

  const totalEstimateAmount = useMemo(
    () => estimates.reduce((sum, e) => sum + (e.total || 0), 0),
    [estimates]
  );

  // Loading state
  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' }}>
        <Box textAlign="center">
          <CircularProgress color="success" size={48} />
          <Typography variant="body1" color="text.secondary" mt={2}>
            Loading your project portal...
          </Typography>
        </Box>
      </Box>
    );
  }

  // Not found state
  if (notFound || !client) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' }}>
        <Alert severity="error" sx={{ maxWidth: 480 }}>
          <Typography variant="h6" gutterBottom>Project not found</Typography>
          <Typography variant="body2">
            The link you followed may be incorrect. Please contact your project manager for the correct portal link.
          </Typography>
        </Alert>
      </Box>
    );
  }

  const currentStage = stages.find((s) => s.status === 'current')?.name || 'Setup';

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f7fa', py: { xs: 2, md: 4 } }}>
      <Container maxWidth="lg">
        {/* Header */}
        <Paper elevation={2} sx={{ mb: 3, p: { xs: 2, md: 3 }, borderRadius: 2 }}>
          <Grid container spacing={{ xs: 2, md: 3 }} alignItems="center">
            <Grid size={{ xs: 12, md: 8 }}>
              <Typography
                variant="h4"
                gutterBottom
                sx={{ fontWeight: 'bold', color: '#2e7d32', fontSize: { xs: '1.5rem', md: '2.125rem' } }}
              >
                {client.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {client.address || client.workLocation?.address || ''}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: { xs: 'center', md: 'right' } }}>
              <Typography
                variant="h5"
                sx={{ fontWeight: 'bold', color: '#2e7d32', mb: 1, fontSize: { xs: '1.25rem', md: '1.5rem' } }}
              >
                {totalEstimateAmount > 0 ? `$${totalEstimateAmount.toLocaleString()}` : ''}
              </Typography>
              <Chip
                label={`${currentStage} \u2022 ${overallProgress}% Complete`}
                color="primary"
                size="medium"
                sx={{ mb: { xs: 2, md: 0 } }}
              />
            </Grid>
          </Grid>

          <Box sx={{ mt: { xs: 2, md: 3 } }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" fontWeight="medium">Overall Progress</Typography>
              <Typography variant="body2" fontWeight="medium">{overallProgress}%</Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={overallProgress}
              sx={{ height: { xs: 10, md: 8 }, borderRadius: 4 }}
            />
          </Box>
        </Paper>

        {/* Navigation Tabs */}
        <Paper elevation={1} sx={{ mb: 3, position: 'sticky', top: 0, zIndex: 10 }}>
          <Tabs
            value={tabValue}
            onChange={(_e, v) => setTabValue(v)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{
              '& .MuiTab-root': {
                minHeight: { xs: 56, md: 72 },
                fontSize: { xs: '0.75rem', md: '0.875rem' },
              },
            }}
          >
            <Tab icon={<MoneyIcon />} label="Estimate" iconPosition="top" />
            <Tab icon={<TimelineIcon />} label="Timeline" iconPosition="top" />
            <Tab icon={<PaymentIcon />} label="Payments" iconPosition="top" />
            <Tab icon={<PhotoIcon />} label="Gallery" iconPosition="top" />
            <Tab icon={<InspectionIcon />} label="Inspections" iconPosition="top" />
          </Tabs>
        </Paper>

        {/* Tab Panels */}
        <TabPanel value={tabValue} index={0}>
          <EstimateSection estimates={estimates} />
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <TimelineSection stages={stages} />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <PaymentsSection payments={payments} totalEstimate={totalEstimate} />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <GallerySection
            photos={photos}
            designerName="Designer"
            expectedDesignDate="TBD"
          />
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <InspectionsSection inspections={inspections} />
        </TabPanel>
      </Container>
    </Box>
  );
};

export default ClientPortalPage;
