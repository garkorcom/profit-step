/**
 * SiteDashboardPage — Dashboard for a single Site with 7 tabs
 * Sites Phase 2
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  Container,
  Tabs,
  Tab,
  Paper,
  Chip,
  TextField,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  IconButton,
  Snackbar,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CancelIcon from '@mui/icons-material/Cancel';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import PersonIcon from '@mui/icons-material/Person';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import AccessTimeIcon from '@mui/icons-material/AccessTime';

import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { sitesApi, SiteData } from '../../api/sitesApi';
import { crmApi } from '../../api/crmApi';
import { Client } from '../../types/crm.types';
import { GTDTask } from '../../types/gtd.types';
import { Estimate } from '../../types/estimate.types';
import { Contact } from '../../types/contact.types';
// GTDSubtasksTable requires full task management callbacks — we show a simplified budget view instead

// ─── Tab Panel ─────────────────────────────────────────────────────

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`site-tabpanel-${index}`}
      aria-labelledby={`site-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

// ─── Status helpers ────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; color: 'success' | 'default' | 'warning' }> = {
  active: { label: 'Active', color: 'success' },
  completed: { label: 'Completed', color: 'default' },
  on_hold: { label: 'On Hold', color: 'warning' },
};

const typeLabels: Record<string, string> = {
  residential: '🏠 Residential',
  commercial: '🏢 Commercial',
  industrial: '🏭 Industrial',
};

const priorityColors: Record<string, string> = {
  urgent: '#f44336',
  high: '#ff9800',
  normal: '#2196f3',
  low: '#9e9e9e',
};

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

const SiteDashboardPage: React.FC = () => {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const { userProfile } = useAuth();

  // Core state
  const [site, setSite] = useState<SiteData | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);

  // Tab data
  const [tasks, setTasks] = useState<GTDTask[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);

  // Edit mode for INFO tab
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SiteData>>({});
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState('');

  // ─── Load site + client ────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      if (!siteId) return;
      setLoading(true);
      try {
        const siteData = await sitesApi.getSiteById(siteId);
        if (!siteData) {
          setError('Site not found');
          return;
        }
        setSite(siteData);

        // Load client
        const clientData = await crmApi.getClientById(siteData.clientId);
        if (clientData) setClient(clientData);
      } catch (e: any) {
        console.error('Error loading site:', e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [siteId]);

  // ─── Load tab data on tab switch ──────────────────────────────

  useEffect(() => {
    if (!site || !userProfile?.companyId) return;

    const loadTabData = async () => {
      try {
        switch (tabValue) {
          case 1: // TASKS
            await loadTasks();
            break;
          case 2: // ESTIMATES
            await loadEstimates();
            break;
          case 3: // ПРОЦЕНТОВКА — uses tasks already
            if (tasks.length === 0) await loadTasks();
            break;
          case 4: // FINANCE
            await loadCosts();
            break;
          case 5: // TIME TRACKING
            await loadSessions();
            break;
          case 6: // CONTACTS
            await loadContacts();
            break;
        }
      } catch (e) {
        console.error('Error loading tab data:', e);
      }
    };
    loadTabData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabValue, site]);

  const loadTasks = async () => {
    if (!site) return;
    // Try siteId first, fallback to clientId
    const q = query(
      collection(db, 'gtd_tasks'),
      where('clientId', '==', site.clientId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    const allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() } as GTDTask));
    // Filter by siteId if tasks have it
    const filtered = allTasks.filter(t => (t as any).siteId === siteId || !(t as any).siteId);
    setTasks(filtered);
  };

  const loadEstimates = async () => {
    if (!site || !userProfile?.companyId) return;
    const q = query(
      collection(db, 'estimates'),
      where('companyId', '==', userProfile.companyId),
      where('clientId', '==', site.clientId)
    );
    const snap = await getDocs(q);
    setEstimates(snap.docs.map(d => ({ id: d.id, ...d.data() } as Estimate)));
  };

  const loadCosts = async () => {
    if (!site) return;
    const q = query(
      collection(db, 'costs'),
      where('clientId', '==', site.clientId)
    );
    const snap = await getDocs(q);
    setCosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const loadSessions = async () => {
    if (!site) return;
    const q = query(
      collection(db, 'work_sessions'),
      where('clientId', '==', site.clientId),
      where('status', '==', 'completed')
    );
    const snap = await getDocs(q);
    setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const loadContacts = async () => {
    if (!site) return;
    const q = query(
      collection(db, 'contacts'),
      where('linkedProjects', 'array-contains', site.clientId)
    );
    const snap = await getDocs(q);
    setContacts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Contact)));
  };

  // ─── Edit handlers ─────────────────────────────────────────────

  const startEditing = () => {
    if (!site) return;
    setEditForm({
      name: site.name,
      address: site.address,
      city: site.city,
      state: site.state,
      zip: site.zip,
      sqft: site.sqft,
      permitNumber: site.permitNumber,
      type: site.type,
      status: site.status,
      geo: site.geo,
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditForm({});
  };

  const handleSave = async () => {
    if (!siteId || !site) return;
    setSaving(true);
    try {
      await sitesApi.updateSite(siteId, editForm);
      setSite({ ...site, ...editForm });
      setEditing(false);
      setSnackbar('Site updated successfully');
    } catch (e: any) {
      console.error('Error saving site:', e);
      setSnackbar('Error saving: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ─── Computed values ──────────────────────────────────────────

  const costsSummary = useMemo(() => {
    const total = costs.reduce((sum, c) => sum + (c.amount || 0), 0);
    const byCategory: Record<string, number> = {};
    costs.forEach(c => {
      const cat = c.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + (c.amount || 0);
    });
    return { total, byCategory };
  }, [costs]);

  const sessionsSummary = useMemo(() => {
    let totalMinutes = 0;
    let totalEarnings = 0;
    const byEmployee: Record<string, { name: string; minutes: number; earnings: number }> = {};

    sessions.forEach(s => {
      const mins = s.durationMinutes || 0;
      const rate = s.hourlyRate || 0;
      const earnings = (mins / 60) * rate;
      totalMinutes += mins;
      totalEarnings += earnings;

      const empName = s.employeeName || 'Unknown';
      if (!byEmployee[empName]) {
        byEmployee[empName] = { name: empName, minutes: 0, earnings: 0 };
      }
      byEmployee[empName].minutes += mins;
      byEmployee[empName].earnings += earnings;
    });

    return { totalMinutes, totalEarnings, byEmployee };
  }, [sessions]);

  // ─── Render ─────────────────────────────────────────────────────

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
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mt: 2 }}>
          Go Back
        </Button>
      </Container>
    );
  }

  const st = statusConfig[site.status] || statusConfig.active;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => client ? navigate(`/crm/clients/${client.id}`) : navigate(-1)}
        sx={{ mb: 2 }}
      >
        ← Back to {client?.name || 'Client'}
      </Button>

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Box>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h4" fontWeight={700}>
              {site.name}
            </Typography>
            <Chip label={st.label} color={st.color} size="small" />
            {site.type && (
              <Chip label={typeLabels[site.type] || site.type} size="small" variant="outlined" />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            <LocationOnIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
            {site.address}
            {site.city && `, ${site.city}`}
            {site.state && `, ${site.state}`}
            {site.zip && ` ${site.zip}`}
          </Typography>
        </Box>
      </Box>

      {/* ─── Tabs ───────────────────────────────────────────────── */}
      <Paper sx={{ width: '100%', mb: 2 }}>
        <Tabs
          value={tabValue}
          onChange={(_, v) => setTabValue(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="📋 Info" />
          <Tab label={`✅ Tasks (${tasks.length})`} />
          <Tab label={`📐 Estimates (${estimates.length})`} />
          <Tab label="📊 Процентовка" />
          <Tab label="💰 Finance" />
          <Tab label="⏱️ Time" />
          <Tab label="👥 Contacts" />
        </Tabs>
      </Paper>

      {/* ═══ TAB 0: INFO ══════════════════════════════════════════ */}
      <TabPanel value={tabValue} index={0}>
        <Paper sx={{ p: 3 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">Site Information</Typography>
            {!editing ? (
              <IconButton onClick={startEditing} size="small">
                <EditIcon />
              </IconButton>
            ) : (
              <Box display="flex" gap={1}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  disabled={saving}
                >
                  Save
                </Button>
                <Button
                  size="small"
                  startIcon={<CancelIcon />}
                  onClick={cancelEditing}
                >
                  Cancel
                </Button>
              </Box>
            )}
          </Box>

          {!editing ? (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Name</Typography>
                <Typography>{site.name}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Address</Typography>
                <Typography>{site.address}{site.city ? `, ${site.city}` : ''}{site.state ? `, ${site.state}` : ''}{site.zip ? ` ${site.zip}` : ''}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Type</Typography>
                <Typography>{site.type ? typeLabels[site.type] || site.type : 'N/A'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Sqft</Typography>
                <Typography>{site.sqft ? site.sqft.toLocaleString() : 'N/A'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Permit Number</Typography>
                <Typography>{site.permitNumber || 'N/A'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">GPS</Typography>
                <Typography>
                  {site.geo ? `${site.geo.lat.toFixed(6)}, ${site.geo.lng.toFixed(6)}` : 'N/A'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Status</Typography>
                <Chip label={st.label} color={st.color} size="small" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="body2" color="text.secondary">Client</Typography>
                <Typography
                  sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
                  onClick={() => client && navigate(`/crm/clients/${client.id}`)}
                >
                  {client?.name || site.clientId}
                </Typography>
              </Grid>
            </Grid>
          ) : (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Name"
                  fullWidth
                  size="small"
                  value={editForm.name || ''}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Address"
                  fullWidth
                  size="small"
                  value={editForm.address || ''}
                  onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="City"
                  fullWidth
                  size="small"
                  value={editForm.city || ''}
                  onChange={e => setEditForm({ ...editForm, city: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="State"
                  fullWidth
                  size="small"
                  value={editForm.state || ''}
                  onChange={e => setEditForm({ ...editForm, state: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="ZIP"
                  fullWidth
                  size="small"
                  value={editForm.zip || ''}
                  onChange={e => setEditForm({ ...editForm, zip: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Type</InputLabel>
                  <Select
                    value={editForm.type || ''}
                    label="Type"
                    onChange={e => setEditForm({ ...editForm, type: e.target.value as any })}
                  >
                    <MenuItem value="residential">Residential</MenuItem>
                    <MenuItem value="commercial">Commercial</MenuItem>
                    <MenuItem value="industrial">Industrial</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Sqft"
                  fullWidth
                  size="small"
                  type="number"
                  value={editForm.sqft ?? ''}
                  onChange={e => setEditForm({ ...editForm, sqft: e.target.value ? Number(e.target.value) : null })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Permit Number"
                  fullWidth
                  size="small"
                  value={editForm.permitNumber || ''}
                  onChange={e => setEditForm({ ...editForm, permitNumber: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={editForm.status || 'active'}
                    label="Status"
                    onChange={e => setEditForm({ ...editForm, status: e.target.value as any })}
                  >
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                    <MenuItem value="on_hold">On Hold</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Latitude"
                  fullWidth
                  size="small"
                  type="number"
                  value={editForm.geo?.lat ?? ''}
                  onChange={e => setEditForm({
                    ...editForm,
                    geo: { lat: Number(e.target.value), lng: editForm.geo?.lng || 0 },
                  })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Longitude"
                  fullWidth
                  size="small"
                  type="number"
                  value={editForm.geo?.lng ?? ''}
                  onChange={e => setEditForm({
                    ...editForm,
                    geo: { lat: editForm.geo?.lat || 0, lng: Number(e.target.value) },
                  })}
                />
              </Grid>
            </Grid>
          )}
        </Paper>
      </TabPanel>

      {/* ═══ TAB 1: TASKS ═════════════════════════════════════════ */}
      <TabPanel value={tabValue} index={1}>
        {tasks.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No tasks found for this site</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>Due Date</TableCell>
                  <TableCell>Type</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tasks.map(task => (
                  <TableRow
                    key={task.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/crm/cockpit/${task.id}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {task.title}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={task.status}
                        size="small"
                        color={task.status === 'done' ? 'success' : task.status === 'next_action' ? 'primary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={task.priority || 'normal'}
                        size="small"
                        sx={{
                          bgcolor: priorityColors[task.priority || 'normal'] + '22',
                          color: priorityColors[task.priority || 'normal'],
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {task.dueDate
                        ? (typeof task.dueDate === 'string'
                            ? task.dueDate
                            : (task.dueDate as any)?.toDate?.()?.toLocaleDateString() || '—')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {(task as any).taskType || (task as any).category || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ═══ TAB 2: ESTIMATES ═════════════════════════════════════ */}
      <TabPanel value={tabValue} index={2}>
        {estimates.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No estimates found</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Number</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Total</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {estimates.map(est => (
                  <TableRow key={est.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {est.number || est.id.slice(0, 8)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={est.status}
                        size="small"
                        color={
                          est.status === 'approved' ? 'success' :
                          est.status === 'sent' ? 'primary' :
                          est.status === 'rejected' ? 'error' : 'default'
                        }
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        ${est.total?.toLocaleString() || '0'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {est.createdAt?.toDate?.()?.toLocaleDateString() || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ═══ TAB 3: ПРОЦЕНТОВКА (Budget) ══════════════════════════ */}
      <TabPanel value={tabValue} index={3}>
        {(() => {
          const parentTasks = tasks.filter(t => (t as any).isSubtask !== true);
          const subtasks = tasks.filter(t => (t as any).isSubtask === true);

          if (parentTasks.length === 0) {
            return (
              <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">No tasks with budget data found</Typography>
              </Paper>
            );
          }

          return (
            <Box>
              <Typography variant="h6" gutterBottom>Budget Breakdown (Процентовка)</Typography>
              {parentTasks.map(task => {
                const children = subtasks.filter(st => (st as any).parentTaskId === task.id);
                const totalBudget = children.reduce((s, c) => s + ((c as any).budgetAmount || 0), 0);
                const totalSpent = children.reduce((s, c) => s + ((c as any).totalEarnings || 0), 0);

                return (
                  <Paper key={task.id} sx={{ p: 2, mb: 2 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {task.title}
                      </Typography>
                      <Box display="flex" gap={2}>
                        <Typography variant="body2" color="text.secondary">
                          Budget: <strong>${totalBudget.toLocaleString()}</strong>
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Spent: <strong>${totalSpent.toLocaleString()}</strong>
                        </Typography>
                      </Box>
                    </Box>
                    {children.length > 0 ? (
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Subtask</TableCell>
                              <TableCell>Category</TableCell>
                              <TableCell align="right">Budget</TableCell>
                              <TableCell align="right">Spent</TableCell>
                              <TableCell>Status</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {children.map(st => (
                              <TableRow key={st.id}>
                                <TableCell>{st.title}</TableCell>
                                <TableCell>
                                  <Chip label={(st as any).budgetCategory || '—'} size="small" variant="outlined" />
                                </TableCell>
                                <TableCell align="right">${((st as any).budgetAmount || 0).toLocaleString()}</TableCell>
                                <TableCell align="right">${((st as any).totalEarnings || 0).toLocaleString()}</TableCell>
                                <TableCell>
                                  <Chip label={st.status} size="small" color={st.status === 'done' ? 'success' : 'default'} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    ) : (
                      <Typography variant="body2" color="text.secondary">No subtasks</Typography>
                    )}
                  </Paper>
                );
              })}
            </Box>
          );
        })()}
      </TabPanel>

      {/* ═══ TAB 4: FINANCE ═══════════════════════════════════════ */}
      <TabPanel value={tabValue} index={4}>
        {/* Summary Cards */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1}>
                  <AttachMoneyIcon color="primary" />
                  <Typography variant="body2" color="text.secondary">Total Costs</Typography>
                </Box>
                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                  ${costsSummary.total.toLocaleString()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {costs.length} transactions
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          {Object.entries(costsSummary.byCategory).slice(0, 4).map(([cat, amount]) => (
            <Grid size={{ xs: 12, sm: 4 }} key={cat}>
              <Card>
                <CardContent>
                  <Typography variant="body2" color="text.secondary">{cat}</Typography>
                  <Typography variant="h5" fontWeight={600}>
                    ${(amount as number).toLocaleString()}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Costs Table */}
        {costs.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No costs recorded</Typography>
          </Paper>
        ) : (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Description</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {costs.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>{c.description || c.notes || '—'}</TableCell>
                    <TableCell>
                      <Chip label={c.category || 'Other'} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Typography fontWeight={600}>${(c.amount || 0).toLocaleString()}</Typography>
                    </TableCell>
                    <TableCell>
                      {c.date || c.createdAt?.toDate?.()?.toLocaleDateString() || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ═══ TAB 5: TIME TRACKING ═════════════════════════════════ */}
      <TabPanel value={tabValue} index={5}>
        {/* Summary Cards */}
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1}>
                  <AccessTimeIcon color="primary" />
                  <Typography variant="body2" color="text.secondary">Total Hours</Typography>
                </Box>
                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                  {(sessionsSummary.totalMinutes / 60).toFixed(1)}h
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1}>
                  <AttachMoneyIcon color="success" />
                  <Typography variant="body2" color="text.secondary">Total Earnings</Typography>
                </Box>
                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                  ${sessionsSummary.totalEarnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <Card>
              <CardContent>
                <Typography variant="body2" color="text.secondary">Sessions</Typography>
                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                  {sessions.length}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* By Employee */}
        {Object.values(sessionsSummary.byEmployee).length > 0 && (
          <Paper sx={{ mb: 3 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Employee</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right">Earnings</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.values(sessionsSummary.byEmployee).map((emp: any) => (
                    <TableRow key={emp.name}>
                      <TableCell>{emp.name}</TableCell>
                      <TableCell align="right">{(emp.minutes / 60).toFixed(1)}h</TableCell>
                      <TableCell align="right">${emp.earnings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}

        {sessions.length === 0 && (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No time tracking sessions found</Typography>
          </Paper>
        )}
      </TabPanel>

      {/* ═══ TAB 6: CONTACTS ══════════════════════════════════════ */}
      <TabPanel value={tabValue} index={6}>
        {contacts.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">No contacts linked to this project</Typography>
          </Paper>
        ) : (
          <List>
            {contacts.map(c => (
              <ListItem
                key={c.id}
                sx={{
                  bgcolor: 'background.default',
                  mb: 1,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <ListItemAvatar>
                  <Avatar sx={{ bgcolor: 'secondary.main' }}>
                    <PersonIcon />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Typography variant="body2" fontWeight={700}>
                      {c.name}
                    </Typography>
                  }
                  secondary={
                    <Box>
                      {c.roles && c.roles.length > 0 && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {c.roles.join(', ')}
                        </Typography>
                      )}
                      {c.phones && c.phones.length > 0 && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          📞 {c.phones.map((p: any) => p.number || p).join(', ')}
                        </Typography>
                      )}
                      {c.emails && c.emails.length > 0 && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          ✉️ {c.emails.map((e: any) => e.address || e).join(', ')}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </TabPanel>

      {/* Snackbar */}
      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar('')}
        message={snackbar}
      />
    </Container>
  );
};

export default SiteDashboardPage;
