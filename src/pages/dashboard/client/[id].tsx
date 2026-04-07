import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Paper,
  Grid,
  Card,
  Divider,
  Chip,
  Button,
  TextField,
  Table,
  TableContainer,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Tab,
  Tabs,
  Alert,
  CircularProgress,
  ImageList,
  ImageListItem,
} from '@mui/material';
import {
  Timeline as TimelineIcon,
  Notes as NotesIcon,
  Visibility as VisibilityIcon,
  TrendingUp as ProfitIcon,
  Business as InternalIcon,
  Person as ClientIcon,
  Build as BuildIcon,
  PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, listAll, getDownloadURL } from 'firebase/storage';
import { db } from '../../../firebase/firebase';
import { InventoryTransaction } from '../../../types/inventory.types';
import { Client } from '../../../types/crm.types';
import { crmApi } from '../../../api/crmApi';

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
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

const ClientDashboardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);
  const [newNote, setNewNote] = useState('');

  // Client from Firestore
  const [client, setClient] = useState<Client | null>(null);
  const [clientLoading, setClientLoading] = useState(true);

  // Inventory state
  const [inventoryTransactions, setInventoryTransactions] = useState<InventoryTransaction[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  // Photos state
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);

  // WorkSession profit state
  const [workSessionData, setWorkSessionData] = useState<{
    totalEarnings: number;
    sessionCount: number;
    loading: boolean;
  }>({ totalEarnings: 0, sessionCount: 0, loading: true });

  // Load client from Firestore
  useEffect(() => {
    if (!id) {
      setClientLoading(false);
      return;
    }
    let cancelled = false;
    const loadClient = async () => {
      try {
        const data = await crmApi.getClientById(id);
        if (!cancelled) {
          setClient(data);
        }
      } catch (err) {
        console.error('Error loading client:', err);
      } finally {
        if (!cancelled) {
          setClientLoading(false);
        }
      }
    };
    loadClient();
    return () => { cancelled = true; };
  }, [id]);

  // Real-time inventory transactions for this client
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const q = query(
      collection(db, 'inventory_transactions'),
      where('relatedClientId', '==', id)
    );
    const unsub = onSnapshot(q, (snap) => {
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction));
      setInventoryTransactions(txs);
      setInventoryLoading(false);
    }, (err) => {
      console.error('Error loading inventory transactions:', err);
      setInventoryLoading(false);
    });
    return () => unsub();
  }, [id, clientLoading, client]);

  // Load photos from Firebase Storage
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const loadPhotos = async () => {
      try {
        const storage = getStorage();
        const photosRef = ref(storage, `projects/${id}/photos/`);
        const result = await listAll(photosRef);
        const photoData = await Promise.all(
          result.items.map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            return { name: itemRef.name, url };
          })
        );
        setPhotos(photoData);
      } catch (err) {
        console.error('Error loading photos:', err);
      } finally {
        setPhotosLoading(false);
      }
    };
    loadPhotos();
  }, [id, clientLoading, client]);

  // Real-time work sessions for profit calculation
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const q = query(
      collection(db, 'work_sessions'),
      where('clientId', '==', id),
      where('status', '==', 'completed')
    );
    const unsub = onSnapshot(q, (snap) => {
      let total = 0;
      snap.docs.forEach(d => {
        const data = d.data();
        total += data.sessionEarnings || 0;
      });
      setWorkSessionData({
        totalEarnings: total,
        sessionCount: snap.docs.length,
        loading: false,
      });
    }, (err) => {
      console.error('Error loading work sessions:', err);
      setWorkSessionData(prev => ({ ...prev, loading: false }));
    });
    return () => unsub();
  }, [id, clientLoading, client]);

  // Aggregated inventory summary by item name
  const inventorySummary = React.useMemo(() => {
    const map = new Map<string, {
      name: string;
      category: string;
      totalQty: number;
      unitPrice: number;
      totalAmount: number;
    }>();
    inventoryTransactions.forEach(tx => {
      const existing = map.get(tx.catalogItemId);
      if (existing) {
        existing.totalQty += tx.qty;
        existing.totalAmount += tx.totalAmount;
        existing.unitPrice = existing.totalAmount / existing.totalQty;
      } else {
        map.set(tx.catalogItemId, {
          name: tx.catalogItemName,
          category: tx.category,
          totalQty: tx.qty,
          unitPrice: tx.unitPrice,
          totalAmount: tx.totalAmount,
        });
      }
    });
    return Array.from(map.values());
  }, [inventoryTransactions]);

  if (clientLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (!client) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Client not found (ID: {id})</Alert>
      </Box>
    );
  }

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleAddNote = () => {
    if (newNote.trim()) {
      // In real app, this would be an API call
      console.log('Adding internal note:', newNote);
      setNewNote('');
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      backgroundColor: '#f5f7fa',
      py: { xs: 2, md: 4 }
    }}>
      <Container maxWidth="lg">
        {/* Header */}
        <Paper elevation={2} sx={{ mb: 3, p: { xs: 2, md: 3 }, borderRadius: 2 }}>
          <Grid container spacing={{ xs: 2, md: 3 }} alignItems="center">
            <Grid size={{ xs: 12, md: 6 }}>
              <Box display="flex" alignItems="center" mb={1}>
                <InternalIcon sx={{ mr: 1, color: '#1976d2' }} />
                <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#1976d2' }}>
                  INTERNAL DASHBOARD
                </Typography>
              </Box>
              <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: '#2e7d32' }}>
                {client.name}
              </Typography>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                {client.type === 'company' ? 'Company' : 'Person'} · {client.status}
              </Typography>
              {(client.address || client.workLocation?.address) && (
                <Typography variant="body2" color="text.secondary">
                  📍 {client.workLocation?.address || client.address}
                </Typography>
              )}
            </Grid>
            <Grid size={{ xs: 12, md: 6 }} sx={{ textAlign: { xs: 'center', md: 'right' } }}>
              <Box display="flex" flexDirection={{ xs: 'column', md: 'column' }} gap={2}>
                <Button
                  variant="outlined"
                  startIcon={<VisibilityIcon />}
                  onClick={() => navigate(`/crm/clients/${id}`)}
                  sx={{ alignSelf: { xs: 'center', md: 'flex-end' } }}
                >
                  View Client Details
                </Button>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Total Revenue (LTV):
                  </Typography>
                  <Typography variant="h6" color="success.main" fontWeight="bold">
                    ${(client.totalRevenue || 0).toLocaleString()}
                  </Typography>
                </Box>
                {client.contacts && client.contacts.length > 0 && (
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Primary Contact:
                    </Typography>
                    <Typography variant="body1" fontWeight="bold">
                      {client.contacts[0].name} {client.contacts[0].phone && `· ${client.contacts[0].phone}`}
                    </Typography>
                  </Box>
                )}
                <Divider sx={{ my: 1 }} />
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Work Sessions:
                  </Typography>
                  {workSessionData.loading ? (
                    <CircularProgress size={20} />
                  ) : (
                    <Typography variant="h6" color="warning.main" fontWeight="bold">
                      ${workSessionData.totalEarnings.toLocaleString()}
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        ({workSessionData.sessionCount} sessions)
                      </Typography>
                    </Typography>
                  )}
                </Box>
              </Box>
            </Grid>
          </Grid>

          {/* Client Info Chips */}
          <Box sx={{ mt: { xs: 2, md: 3 }, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip label={`Status: ${client.status}`} color="primary" variant="outlined" />
            {client.tags && client.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" />
            ))}
            {client.services && client.services.map((svc) => (
              <Chip key={svc} label={svc} size="small" variant="outlined" color="secondary" />
            ))}
          </Box>
        </Paper>

        {/* Navigation Tabs */}
        <Paper elevation={1} sx={{ mb: 3 }}>
          <Tabs
            value={tabValue}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
          >
            <Tab icon={<ClientIcon />} label="Client Info" iconPosition="top" />
            <Tab icon={<ProfitIcon />} label="Work Sessions" iconPosition="top" />
            <Tab icon={<NotesIcon />} label="Internal Notes" iconPosition="top" />
            <Tab icon={<TimelineIcon />} label="Timeline" iconPosition="top" />
            <Tab icon={<BuildIcon />} label="Inventory" iconPosition="top" />
            <Tab icon={<PhotoCameraIcon />} label="Photos" iconPosition="top" />
          </Tabs>
        </Paper>

        {/* Client Info Tab */}
        <TabPanel value={tabValue} index={0}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
              Client Information
            </Typography>

            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6" gutterBottom>Contacts</Typography>
                  {client.contacts && client.contacts.length > 0 ? (
                    <List dense>
                      {client.contacts.map((contact) => (
                        <ListItem key={contact.id}>
                          <ListItemIcon><ClientIcon /></ListItemIcon>
                          <ListItemText
                            primary={contact.name}
                            secondary={`${contact.phone || ''}${contact.email ? ` · ${contact.email}` : ''}${contact.position ? ` · ${contact.position}` : ''}`}
                          />
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">No contacts</Typography>
                  )}
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6" gutterBottom>Details</Typography>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell>Type</TableCell>
                        <TableCell>{client.type}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Status</TableCell>
                        <TableCell><Chip label={client.status} size="small" color="primary" /></TableCell>
                      </TableRow>
                      {client.source && (
                        <TableRow>
                          <TableCell>Source</TableCell>
                          <TableCell>{client.sourceName || client.source}</TableCell>
                        </TableRow>
                      )}
                      {client.industry && (
                        <TableRow>
                          <TableCell>Industry</TableCell>
                          <TableCell>{client.industry}</TableCell>
                        </TableRow>
                      )}
                      <TableRow>
                        <TableCell>Total Revenue</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>${(client.totalRevenue || 0).toLocaleString()}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>
              </Grid>
            </Grid>
          </Card>
        </TabPanel>

        {/* Work Sessions Tab */}
        <TabPanel value={tabValue} index={1}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
              Work Sessions Summary
            </Typography>

            {workSessionData.loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : workSessionData.sessionCount === 0 ? (
              <Alert severity="info">No completed work sessions for this client yet.</Alert>
            ) : (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Total Earnings</Typography>
                    <Typography variant="h4" fontWeight="bold" color="success.main">
                      ${workSessionData.totalEarnings.toLocaleString()}
                    </Typography>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Completed Sessions</Typography>
                    <Typography variant="h4" fontWeight="bold" color="primary.main">
                      {workSessionData.sessionCount}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            )}
          </Card>
        </TabPanel>

        {/* Internal Notes Tab */}
        <TabPanel value={tabValue} index={2}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="error.main">
              🔒 Internal Notes (Team Only)
            </Typography>

            <Alert severity="warning" sx={{ mb: 3 }}>
              These notes are private and will never be visible to the client
            </Alert>

            {/* Add new note */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#f8f9fa' }}>
              <Typography variant="h6" gutterBottom>Add Internal Note</Typography>
              <Box display="flex" gap={1}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  placeholder="Add internal note (team observations, pricing strategy, client behavior, etc.)"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                />
                <Button
                  variant="contained"
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  sx={{ minWidth: 100 }}
                >
                  Add
                </Button>
              </Box>
            </Paper>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Notes will be stored in Firestore. Add a note above to start.
            </Typography>
          </Card>
        </TabPanel>

        {/* Timeline Tab */}
        <TabPanel value={tabValue} index={3}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold">
              Internal Timeline View
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              This is the same timeline as shown to the client, but with internal completion targets and notes
            </Alert>

            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" color="text.secondary">
                Internal timeline integration coming soon...
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Will show internal deadlines, crew assignments, and material delivery schedules
              </Typography>
            </Box>
          </Card>
        </TabPanel>

        {/* Inventory Tab */}
        <TabPanel value={tabValue} index={4}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
              <BuildIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              Materials & Inventory
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              Materials allocated and used for this client's project. Data sourced from inventory transactions in real-time.
            </Alert>

            {inventoryLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : inventorySummary.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="h6" color="text.secondary">
                  No materials allocated to this project yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Materials will appear here when inventory transactions reference this client
                </Typography>
              </Box>
            ) : (
              <>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Category</TableCell>
                        <TableCell align="right">Qty Used</TableCell>
                        <TableCell align="right">Unit Price</TableCell>
                        <TableCell align="right">Total</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {inventorySummary.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell>
                            <Chip label={item.category} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell align="right">{item.totalQty}</TableCell>
                          <TableCell align="right">${item.unitPrice.toFixed(2)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            ${item.totalAmount.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={4} sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2 }}>
                          TOTAL MATERIALS COST
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2, color: 'error.main' }}>
                          ${inventorySummary.reduce((sum, i) => sum + i.totalAmount, 0).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Total materials cost summary */}
                <Paper variant="outlined" sx={{ p: 2, mt: 3, backgroundColor: '#f8f9fa' }}>
                  <Typography variant="h6" gutterBottom>
                    Materials Cost Summary
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">Total Materials Spent</Typography>
                      <Typography variant="h6" fontWeight="bold" color="error.main">
                        ${inventorySummary.reduce((sum, i) => sum + i.totalAmount, 0).toFixed(2)}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">Unique Items</Typography>
                      <Typography variant="h6" fontWeight="bold">
                        {inventorySummary.length}
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </>
            )}
          </Card>
        </TabPanel>

        {/* Photos Tab */}
        <TabPanel value={tabValue} index={5}>
          <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
            <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
              <PhotoCameraIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              Project Photos
            </Typography>

            <Alert severity="info" sx={{ mb: 3 }}>
              Photos from the project site stored in Firebase Storage at projects/{id}/photos/
            </Alert>

            {photosLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : photos.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <PhotoCameraIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                  No photos uploaded yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Upload project photos to Firebase Storage at projects/{id}/photos/
                </Typography>
              </Box>
            ) : (
              <ImageList
                sx={{ width: '100%' }}
                cols={3}
                gap={12}
                variant="quilted"
              >
                {photos.map((photo, idx) => (
                  <ImageListItem key={idx}>
                    <img
                      src={photo.url}
                      alt={photo.name}
                      loading="lazy"
                      style={{
                        borderRadius: 8,
                        objectFit: 'cover',
                        width: '100%',
                        height: 'auto',
                        minHeight: 200,
                        maxHeight: 350,
                        cursor: 'pointer',
                      }}
                      onClick={() => window.open(photo.url, '_blank')}
                    />
                    <Box sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      bgcolor: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      px: 1,
                      py: 0.5,
                      borderRadius: '0 0 8px 8px',
                    }}>
                      <Typography variant="caption" noWrap>
                        {photo.name}
                      </Typography>
                    </Box>
                  </ImageListItem>
                ))}
              </ImageList>
            )}
          </Card>
        </TabPanel>
      </Container>
    </Box>
  );
};

export default ClientDashboardPage;