/**
 * Client-facing portal page. Mounted at /portal/:slug.
 *
 * Thin wrapper around ClientDashboardLayout in "client" mode — builds the
 * header + sections from useClientPortal hook data, filters out internal
 * estimates, and passes everything to the layout.
 *
 * For the internal (employee) view of the same dashboard, see
 * src/pages/dashboard/client/[id].tsx (to be converted separately).
 *
 * See src/pages/dashbord-for-client/SPEC.md for the unified architecture.
 */

import React, { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, Alert, CircularProgress } from '@mui/material';
import {
  AttachMoney as MoneyIcon,
  Timeline as TimelineIcon,
  Payment as PaymentIcon,
  PhotoLibrary as PhotoIcon,
  VerifiedUser as InspectionIcon,
} from '@mui/icons-material';

import { useClientPortal } from '../../hooks/useClientPortal';
import ClientDashboardLayout, {
  type DashboardSection,
  type DashboardHeader,
} from '../../components/client-dashboard/ClientDashboardLayout';
import EstimateSection from '../../components/client-dashboard/sections/EstimateSection';
import TimelineSection, { type ProjectStage } from '../../components/client-dashboard/sections/TimelineSection';
import GallerySection from '../../components/client-dashboard/sections/GallerySection';
import PaymentsSection, { type PaymentItem } from '../../components/client-dashboard/sections/PaymentsSection';
import InspectionsSection, { type Inspection } from '../../components/client-dashboard/sections/InspectionsSection';

// ─── helpers (derive section data from raw hook state) ────────────────

function buildStagesFromTasks(
  tasks: ReturnType<typeof useClientPortal>['tasks']
): ProjectStage[] {
  if (tasks.length === 0) {
    return [
      {
        name: 'Getting Started',
        status: 'current',
        progress: 0,
        icon: '\uD83D\uDD35',
        description: 'Project setup in progress',
      },
    ];
  }

  // Group tasks by context → phase with done/total counts
  const phases = new Map<
    string,
    { done: number; total: number; earliest: number; latest: number }
  >();

  tasks.forEach(t => {
    const phase = t.context?.replace('@', '') || 'general';
    const entry = phases.get(phase) || {
      done: 0,
      total: 0,
      earliest: Infinity,
      latest: 0,
    };
    entry.total++;
    if (t.status === 'done') entry.done++;

    const created = (t.createdAt as { seconds?: number } | null)?.seconds || 0;
    const updated = (t.updatedAt as { seconds?: number } | null)?.seconds || 0;
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
      icon:
        status === 'completed' ? '\u2705' : status === 'current' ? '\uD83D\uDD35' : '\u2B1C',
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

  const payments: PaymentItem[] = [];

  // Real payments: credits from ledger
  const credits = ledger.filter(e => e.type === 'credit');
  credits.forEach(entry => {
    const amt = entry.amount || 0;
    const pct =
      totalFromEstimates > 0 ? Math.round((amt / totalFromEstimates) * 100) : 0;
    const dateObj = entry.date as { seconds?: number } | null;
    const dateStr = dateObj?.seconds
      ? new Date(dateObj.seconds * 1000).toISOString().split('T')[0]
      : '';
    payments.push({
      stage: entry.description || 'Payment',
      amount: amt,
      percentage: pct,
      status: 'paid',
      dueDate: dateStr,
    });
  });

  // Placeholder schedule if nothing paid yet and we have an estimate total
  if (payments.length === 0 && totalFromEstimates > 0) {
    payments.push(
      {
        stage: 'Deposit (15%)',
        amount: Math.round(totalFromEstimates * 0.15),
        percentage: 15,
        status: 'pending',
        dueDate: '',
      },
      {
        stage: 'Materials (35%)',
        amount: Math.round(totalFromEstimates * 0.35),
        percentage: 35,
        status: 'upcoming',
        dueDate: '',
      },
      {
        stage: 'Mid-Construction (25%)',
        amount: Math.round(totalFromEstimates * 0.25),
        percentage: 25,
        status: 'upcoming',
        dueDate: '',
      },
      {
        stage: 'Completion (25%)',
        amount: Math.round(totalFromEstimates * 0.25),
        percentage: 25,
        status: 'upcoming',
        dueDate: '',
      }
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
    .filter(t => {
      const title = (t.title || '').toLowerCase();
      const context = (t.context || '').toLowerCase();
      return title.includes('inspect') || context.includes('inspection');
    })
    .map((t, idx) => {
      let status: Inspection['status'] = 'scheduled';
      if (t.status === 'done') status = 'passed';
      else if (t.status === 'next_action') status = 'in-progress';

      const createdAt = t.createdAt as { seconds?: number } | null;
      const dateStr = createdAt?.seconds
        ? new Date(createdAt.seconds * 1000).toISOString().split('T')[0]
        : '';

      return {
        id: idx + 1,
        name: t.title || 'Inspection',
        date: dateStr,
        status,
        notes: t.description || undefined,
      };
    });
}

// ─── page ─────────────────────────────────────────────────────────────

const ClientPortalPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const {
    client,
    estimates,
    tasks,
    ledger,
    photos,
    loading,
    notFound,
    error,
  } = useClientPortal(slug);

  // NOTE: estimates are already filtered by the backend portalFilter —
  // internal estimates are stripped server-side. No client-side filtering needed.

  const stages = useMemo(() => buildStagesFromTasks(tasks), [tasks]);
  const { payments, totalEstimate } = useMemo(
    () => buildPaymentsFromLedger(ledger, estimates),
    [ledger, estimates]
  );
  const inspections = useMemo(() => buildInspectionsFromTasks(tasks), [tasks]);

  const overallProgress = useMemo(() => {
    if (tasks.length === 0) return 0;
    const done = tasks.filter(t => t.status === 'done').length;
    return Math.round((done / tasks.length) * 100);
  }, [tasks]);

  const totalEstimateAmount = useMemo(
    () => estimates.reduce((sum, e) => sum + (e.total || 0), 0),
    [estimates]
  );

  // ─── Loading state ──────────────────────────────────────
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f7fa',
        }}
      >
        <Box textAlign="center">
          <CircularProgress color="success" size={48} />
          <Typography variant="body1" color="text.secondary" mt={2}>
            Loading your project portal...
          </Typography>
        </Box>
      </Box>
    );
  }

  // ─── Not found state ────────────────────────────────────
  if (notFound || !client) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f5f7fa',
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 480 }}>
          <Typography variant="h6" gutterBottom>
            {error ? 'Access Denied' : 'Project not found'}
          </Typography>
          <Typography variant="body2">
            {error || 'The link you followed may be incorrect. Please contact your project manager for the correct portal link.'}
          </Typography>
        </Alert>
      </Box>
    );
  }

  // ─── Build layout props ─────────────────────────────────
  const currentStage = stages.find(s => s.status === 'current')?.name || 'Setup';

  const header: DashboardHeader = {
    title: client.name,
    subtitle: client.projectAddress || client.address || '',
    totalAmount: totalEstimateAmount > 0 ? `$${totalEstimateAmount.toLocaleString()}` : undefined,
    stage: currentStage,
    progress: overallProgress,
  };

  const sections: DashboardSection[] = [
    {
      label: 'Estimate',
      icon: <MoneyIcon />,
      content: <EstimateSection estimates={estimates as Parameters<typeof EstimateSection>[0]['estimates']} />,
    },
    {
      label: 'Timeline',
      icon: <TimelineIcon />,
      content: <TimelineSection stages={stages} />,
    },
    {
      label: 'Payments',
      icon: <PaymentIcon />,
      content: <PaymentsSection payments={payments} totalEstimate={totalEstimate} />,
    },
    {
      label: 'Gallery',
      icon: <PhotoIcon />,
      content: (
        <GallerySection photos={photos} designerName="Designer" expectedDesignDate="TBD" />
      ),
    },
    {
      label: 'Inspections',
      icon: <InspectionIcon />,
      content: <InspectionsSection inspections={inspections} />,
    },
  ];

  return <ClientDashboardLayout mode="client" header={header} sections={sections} />;
};

export default ClientPortalPage;
