/**
 * SiteDashboardPage — Thin orchestrator for the Site Dashboard.
 * All tab panels, data loading, and types are delegated to `components/siteDashboard`.
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Button, CircularProgress, Alert, Container,
  Tabs, Tab, Paper, Chip, TextField, Grid, IconButton, Snackbar,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import LocationOnIcon from '@mui/icons-material/LocationOn';

import { useAuth } from '../../auth/AuthContext';
import { sitesApi, SiteData } from '../../api/sitesApi';
import { useSiteDashboard, STATUS_CONFIG, TYPE_LABELS } from '../../components/siteDashboard';
import {
  TabPanel, TasksTab, EstimatesTab, BudgetTab, FinanceTab,
  QualityTab, TimeTab, ContactsTab, PaymentScheduleCard, NpsCard,
} from '../../components/siteDashboard';

const SiteDashboardPage: React.FC = () => {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const [tabValue, setTabValue] = useState(0);

  // ─── Data Hook ──────────────────────────────────────────
  const {
    site, setSite, client, loading, error,
    tasks, estimates, costs, sessions, contacts,
    punchLists, workActs, paymentSchedules, warrantyTasks,
    npsRequests, planVsFact, purchaseOrders, changeOrders,
    costsSummary, sessionsSummary,
  } = useSiteDashboard({
    siteId, companyId: userProfile?.companyId, tabValue,
  });

  // ─── Edit Mode ──────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SiteData>>({});
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState('');

  const startEditing = () => {
    if (!site) return;
    setEditForm({
      name: site.name, address: site.address, city: site.city,
      state: site.state, zip: site.zip, sqft: site.sqft,
      permitNumber: site.permitNumber, type: site.type,
      status: site.status, geo: site.geo,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!siteId || !site) return;
    setSaving(true);
    try {
      await sitesApi.updateSite(siteId, editForm);
      setSite({ ...site, ...editForm });
      setEditing(false);
      setSnackbar('Site updated successfully');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('Error saving site:', e);
      setSnackbar('Error saving: ' + message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading / Error ────────────────────────────────────

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error || !site) {
    return (
      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">{error || 'Site not found'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mt: 2 }}>Go Back</Button>
      </Container>
    );
  }

  const st = STATUS_CONFIG[site.status] || STATUS_CONFIG.active;

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* Header */}
      <Button startIcon={<ArrowBackIcon />} onClick={() => client ? navigate(`/crm/clients/${client.id}`) : navigate(-1)} sx={{ mb: 2 }}>
        ← Back to {client?.name || 'Client'}
      </Button>

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h4" fontWeight={700}>{site.name}</Typography>
            <Chip label={st.label} color={st.color} size="small" />
            {site.type && <Chip label={TYPE_LABELS[site.type] || site.type} size="small" variant="outlined" />}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            <LocationOnIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
            {site.address}{site.city && `, ${site.city}`}{site.state && `, ${site.state}`}{site.zip && ` ${site.zip}`}
          </Typography>
        </Box>
      </Box>

      {/* Tabs */}
      <Paper sx={{ width: '100%', mb: 2 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} variant="scrollable" scrollButtons="auto">
          <Tab label="📋 Info" />
          <Tab label={`✅ Tasks (${tasks.length})`} />
          <Tab label={`📐 Estimates (${estimates.length})`} />
          <Tab label="📊 Процентовка" />
          <Tab label="💰 Finance" />
          <Tab label="🔍 Quality" />
          <Tab label="⏱️ Time" />
          <Tab label="👥 Contacts" />
        </Tabs>
      </Paper>

      {/* TAB 0: INFO */}
      <TabPanel value={tabValue} index={0}>
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Site Information</Typography>
            {!editing ? (
              <IconButton onClick={startEditing} size="small"><EditIcon /></IconButton>
            ) : (
              <Box display="flex" gap={1}>
                <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={handleSave} disabled={saving}>Save</Button>
                <Button size="small" startIcon={<CancelIcon />} onClick={() => { setEditing(false); setEditForm({}); }}>Cancel</Button>
              </Box>
            )}
          </Box>

          {!editing ? (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Name</Typography><Typography>{site.name}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Address</Typography><Typography>{site.address}{site.city ? `, ${site.city}` : ''}{site.state ? `, ${site.state}` : ''}{site.zip ? ` ${site.zip}` : ''}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Type</Typography><Typography>{site.type ? TYPE_LABELS[site.type] || site.type : 'N/A'}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Sqft</Typography><Typography>{site.sqft ? site.sqft.toLocaleString() : 'N/A'}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Permit Number</Typography><Typography>{site.permitNumber || 'N/A'}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">GPS</Typography><Typography>{site.geo ? `${site.geo.lat.toFixed(6)}, ${site.geo.lng.toFixed(6)}` : 'N/A'}</Typography></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Status</Typography><Chip label={st.label} color={st.color} size="small" /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Client</Typography>
                <Typography sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => client && navigate(`/crm/clients/${client.id}`)}>
                  {client?.name || site.clientId}
                </Typography>
              </Grid>
            </Grid>
          ) : (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Name" fullWidth size="small" value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Address" fullWidth size="small" value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="City" fullWidth size="small" value={editForm.city || ''} onChange={e => setEditForm({ ...editForm, city: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="State" fullWidth size="small" value={editForm.state || ''} onChange={e => setEditForm({ ...editForm, state: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="ZIP" fullWidth size="small" value={editForm.zip || ''} onChange={e => setEditForm({ ...editForm, zip: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select value={editForm.type || ''} label="Type" onChange={e => setEditForm({ ...editForm, type: e.target.value as SiteData['type'] })}>
                    <MenuItem value="residential">Residential</MenuItem>
                    <MenuItem value="commercial">Commercial</MenuItem>
                    <MenuItem value="industrial">Industrial</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="Sqft" fullWidth size="small" type="number" value={editForm.sqft ?? ''} onChange={e => setEditForm({ ...editForm, sqft: e.target.value ? Number(e.target.value) : null })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="Permit Number" fullWidth size="small" value={editForm.permitNumber || ''} onChange={e => setEditForm({ ...editForm, permitNumber: e.target.value })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select value={editForm.status || 'active'} label="Status" onChange={e => setEditForm({ ...editForm, status: e.target.value as SiteData['status'] })}>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                    <MenuItem value="on_hold">On Hold</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="Latitude" fullWidth size="small" type="number" value={editForm.geo?.lat ?? ''} onChange={e => setEditForm({ ...editForm, geo: { lat: Number(e.target.value), lng: editForm.geo?.lng || 0 } })} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}><TextField label="Longitude" fullWidth size="small" type="number" value={editForm.geo?.lng ?? ''} onChange={e => setEditForm({ ...editForm, geo: { lat: editForm.geo?.lat || 0, lng: Number(e.target.value) } })} /></Grid>
            </Grid>
          )}
        </Paper>
        <PaymentScheduleCard paymentSchedules={paymentSchedules} />
        <NpsCard npsRequests={npsRequests} />
      </TabPanel>

      {/* TAB 1: TASKS */}
      <TabPanel value={tabValue} index={1}>
        <TasksTab tasks={tasks} site={site} siteId={siteId!} navigate={navigate} />
      </TabPanel>

      {/* TAB 2: ESTIMATES */}
      <TabPanel value={tabValue} index={2}>
        <EstimatesTab estimates={estimates} site={site} siteId={siteId!} navigate={navigate} />
      </TabPanel>

      {/* TAB 3: BUDGET */}
      <TabPanel value={tabValue} index={3}>
        <BudgetTab tasks={tasks} />
      </TabPanel>

      {/* TAB 4: FINANCE */}
      <TabPanel value={tabValue} index={4}>
        <FinanceTab planVsFact={planVsFact} purchaseOrders={purchaseOrders} changeOrders={changeOrders} costs={costs} costsSummary={costsSummary} />
      </TabPanel>

      {/* TAB 5: QUALITY */}
      <TabPanel value={tabValue} index={5}>
        <QualityTab workActs={workActs} punchLists={punchLists} warrantyTasks={warrantyTasks} />
      </TabPanel>

      {/* TAB 6: TIME */}
      <TabPanel value={tabValue} index={6}>
        <TimeTab sessions={sessions} sessionsSummary={sessionsSummary} />
      </TabPanel>

      {/* TAB 7: CONTACTS */}
      <TabPanel value={tabValue} index={7}>
        <ContactsTab contacts={contacts} site={site} navigate={navigate} />
      </TabPanel>

      {/* Snackbar */}
      <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar('')} message={snackbar} />
    </Container>
  );
};

export default SiteDashboardPage;
