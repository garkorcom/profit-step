/**
 * Shared layout for the unified client dashboard.
 *
 * Same shell is used for both:
 *  - Internal view (`/dashboard/client/:id`) — sees everything
 *  - Client view (`/portal/:slug`) — sees only shared sections
 *
 * The caller provides the list of sections (label, icon, content) and a
 * header spec. The layout renders the outer shell (Container + header
 * + sticky tabs + panels). Visibility filtering is the caller's job —
 * this component just renders what it's given.
 *
 * See src/pages/dashbord-for-client/SPEC.md §3.3 for architecture.
 */

import React, { useState, ReactNode } from 'react';
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
  Stack,
} from '@mui/material';

// ─── Types ────────────────────────────────────────────────────────────

export type DashboardMode = 'internal' | 'client';

export interface DashboardHeader {
  /** Client/project name shown as the main title */
  title: string;
  /** Secondary line (e.g. address) */
  subtitle?: string;
  /** Optional tertiary line (e.g. project type, dates) */
  caption?: string;
  /** Overall progress 0–100 (hidden if undefined) */
  progress?: number;
  /** Current stage label (e.g. "Design", "Demo") */
  stage?: string;
  /** Total amount shown in top-right (e.g. "$184,000") */
  totalAmount?: string;
  /** Chips rendered under the title (status, type, etc.) */
  chips?: Array<{ label: string; color?: 'primary' | 'success' | 'warning' | 'error' | 'default' }>;
  /** Free-form node rendered under the title (contact info, etc.) */
  meta?: ReactNode;
}

export interface DashboardSection {
  /** Tab label text */
  label: string;
  /** Material icon element */
  icon: ReactNode;
  /** Tab panel content */
  content: ReactNode;
  /** If true, this tab is hidden (use for mode-specific sections) */
  hidden?: boolean;
}

export interface ClientDashboardLayoutProps {
  mode: DashboardMode;
  header: DashboardHeader;
  sections: DashboardSection[];
  /** Right-side header slot (e.g. "Share with client" button for internal mode, back button) */
  actions?: ReactNode;
  /** Rendered above the header (e.g. red flags banner for internal mode) */
  banner?: ReactNode;
  /** Optional initial tab index */
  initialTab?: number;
}

// ─── TabPanel ─────────────────────────────────────────────────────────

const TabPanel: React.FC<{ index: number; value: number; children?: ReactNode }> = ({
  index,
  value,
  children,
}) => (
  <div
    role="tabpanel"
    hidden={value !== index}
    id={`client-dashboard-tabpanel-${index}`}
    aria-labelledby={`client-dashboard-tab-${index}`}
  >
    {value === index && <Box sx={{ py: 2 }}>{children}</Box>}
  </div>
);

// ─── Component ────────────────────────────────────────────────────────

const ClientDashboardLayout: React.FC<ClientDashboardLayoutProps> = ({
  mode,
  header,
  sections,
  actions,
  banner,
  initialTab = 0,
}) => {
  const [tabValue, setTabValue] = useState(initialTab);

  const visibleSections = sections.filter(s => !s.hidden);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: '#f5f7fa',
        py: { xs: 2, md: 4 },
      }}
      data-dashboard-mode={mode}
    >
      <Container maxWidth="lg">
        {banner && <Box mb={2}>{banner}</Box>}

        {/* Header */}
        <Paper elevation={2} sx={{ mb: 3, p: { xs: 2, md: 3 }, borderRadius: 2 }}>
          <Grid container spacing={{ xs: 2, md: 3 }} alignItems="flex-start">
            <Grid size={{ xs: 12, md: 8 }}>
              <Typography
                variant="h4"
                gutterBottom
                sx={{
                  fontWeight: 'bold',
                  color: '#2e7d32',
                  fontSize: { xs: '1.5rem', md: '2.125rem' },
                }}
              >
                {header.title}
              </Typography>

              {header.chips && header.chips.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mb={1}>
                  {header.chips.map((c, i) => (
                    <Chip
                      key={i}
                      label={c.label}
                      size="small"
                      color={c.color || 'default'}
                      variant={c.color ? 'filled' : 'outlined'}
                    />
                  ))}
                </Stack>
              )}

              {header.subtitle && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ display: 'flex', alignItems: 'center' }}
                >
                  {header.subtitle}
                </Typography>
              )}

              {header.caption && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 1, display: 'block' }}
                >
                  {header.caption}
                </Typography>
              )}

              {header.meta && <Box mt={1}>{header.meta}</Box>}
            </Grid>

            <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: { xs: 'center', md: 'right' } }}>
              <Stack
                direction="column"
                spacing={1}
                alignItems={{ xs: 'center', md: 'flex-end' }}
              >
                {actions && <Box>{actions}</Box>}

                {header.totalAmount && (
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 'bold',
                      color: '#2e7d32',
                      fontSize: { xs: '1.25rem', md: '1.5rem' },
                    }}
                  >
                    {header.totalAmount}
                  </Typography>
                )}

                {(header.stage || typeof header.progress === 'number') && (
                  <Chip
                    label={
                      header.stage && typeof header.progress === 'number'
                        ? `${header.stage} \u2022 ${header.progress}% Complete`
                        : header.stage || `${header.progress}% Complete`
                    }
                    color="primary"
                    size="medium"
                  />
                )}
              </Stack>
            </Grid>
          </Grid>

          {typeof header.progress === 'number' && (
            <Box sx={{ mt: { xs: 2, md: 3 } }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="body2" fontWeight="medium">
                  Overall Progress
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {header.progress}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={header.progress}
                sx={{ height: { xs: 10, md: 8 }, borderRadius: 4 }}
              />
            </Box>
          )}
        </Paper>

        {/* Sticky tabs */}
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
            {visibleSections.map((s, i) => (
              <Tab key={i} icon={<>{s.icon}</>} label={s.label} iconPosition="top" />
            ))}
          </Tabs>
        </Paper>

        {/* Tab panels */}
        {visibleSections.map((s, i) => (
          <TabPanel key={i} index={i} value={tabValue}>
            {s.content}
          </TabPanel>
        ))}
      </Container>
    </Box>
  );
};

export default ClientDashboardLayout;
