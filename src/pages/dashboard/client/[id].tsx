/**
 * Internal client dashboard. Mounted at /dashboard/client/:id.
 *
 * Thin wrapper around ClientDashboardLayout in "internal" mode — builds
 * the header + sections from crmApi + Firestore subscriptions + Storage
 * listings, and passes everything to the layout.
 *
 * For the client-facing (external) view of the same unified dashboard,
 * see src/pages/portal/ClientPortalPage.tsx.
 *
 * See src/pages/dashbord-for-client/SPEC.md for the unified architecture.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
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
  Alert,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  Timeline as TimelineIcon,
  Notes as NotesIcon,
  Visibility as VisibilityIcon,
  Person as ClientIcon,
  Build as BuildIcon,
  PhotoCamera as PhotoCameraIcon,
  Share as ShareIcon,
  Phone as PhoneIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, listAll, getDownloadURL } from 'firebase/storage';
import { db } from '../../../firebase/firebase';
import { InventoryTransaction } from '../../../types/inventory.types';
import { Client } from '../../../types/crm.types';
import { crmApi } from '../../../api/crmApi';

import ClientDashboardLayout, {
  type DashboardHeader,
  type DashboardSection,
} from '../../../components/client-dashboard/ClientDashboardLayout';
import GallerySection, {
  type GalleryPhoto,
} from '../../../components/client-dashboard/sections/GallerySection';

// ─── internal section content components (local, single-use) ──────────

const OverviewContent: React.FC<{
  client: Client;
  workSessions: { totalEarnings: number; sessionCount: number; loading: boolean };
}> = ({ client, workSessions }) => (
  <Grid container spacing={3}>
    <Grid size={{ xs: 12, md: 6 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Contacts
        </Typography>
        {client.contacts && client.contacts.length > 0 ? (
          <List dense>
            {client.contacts.map(contact => (
              <ListItem key={contact.id}>
                <ListItemIcon>
                  <ClientIcon />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="body1" fontWeight="bold">
                        {contact.name}
                      </Typography>
                      {contact.position && (
                        <Chip label={contact.position} size="small" variant="outlined" />
                      )}
                    </Stack>
                  }
                  secondary={
                    <Stack direction="row" spacing={2} mt={0.5}>
                      {contact.phone && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <PhoneIcon fontSize="small" />
                          <Typography
                            variant="body2"
                            component="a"
                            href={`tel:${contact.phone}`}
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            {contact.phone}
                          </Typography>
                        </Stack>
                      )}
                      {contact.email && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <EmailIcon fontSize="small" />
                          <Typography
                            variant="body2"
                            component="a"
                            href={`mailto:${contact.email}`}
                            sx={{ color: 'primary.main', textDecoration: 'none' }}
                          >
                            {contact.email}
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No contacts
          </Typography>
        )}
      </Paper>
    </Grid>

    <Grid size={{ xs: 12, md: 6 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Details
        </Typography>
        <Table size="small">
          <TableBody>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>{client.type}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell>
                <Chip label={client.status} size="small" color="primary" />
              </TableCell>
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
              <TableCell>Total Revenue (LTV)</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>
                ${(client.totalRevenue || 0).toLocaleString()}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Paper>
    </Grid>

    {/* Internal-only KPI: Work sessions earnings */}
    <Grid size={{ xs: 12 }}>
      <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fffdf5', borderColor: 'warning.light' }}>
        <Typography variant="overline" color="warning.dark" fontWeight="bold">
          🔒 Internal — Work Sessions Summary
        </Typography>
        {workSessions.loading ? (
          <CircularProgress size={20} />
        ) : workSessions.sessionCount === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No completed work sessions for this client yet.
          </Typography>
        ) : (
          <Grid container spacing={2} mt={0.5}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="body2" color="text.secondary">
                Total Labor Earnings
              </Typography>
              <Typography variant="h4" fontWeight="bold" color="warning.dark">
                ${workSessions.totalEarnings.toLocaleString()}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="body2" color="text.secondary">
                Completed Sessions
              </Typography>
              <Typography variant="h4" fontWeight="bold">
                {workSessions.sessionCount}
              </Typography>
            </Grid>
          </Grid>
        )}
      </Paper>
    </Grid>
  </Grid>
);

interface InventoryRow {
  name: string;
  category: string;
  totalQty: number;
  unitPrice: number;
  totalAmount: number;
}

const InventoryContent: React.FC<{
  loading: boolean;
  summary: InventoryRow[];
}> = ({ loading, summary }) => {
  const total = summary.reduce((sum, i) => sum + i.totalAmount, 0);

  return (
    <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
      <Typography variant="h5" gutterBottom fontWeight="bold" color="primary">
        <BuildIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        Materials & Inventory
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        🔒 Internal only — materials allocated and used for this client's project.
        Real-time data from inventory transactions.
      </Alert>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : summary.length === 0 ? (
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
                {summary.map((item, idx) => (
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
                  <TableCell
                    align="right"
                    sx={{ fontWeight: 'bold', fontSize: '1.1rem', borderTop: 2, color: 'error.main' }}
                  >
                    ${total.toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          <Paper variant="outlined" sx={{ p: 2, mt: 3, backgroundColor: '#f8f9fa' }}>
            <Typography variant="h6" gutterBottom>
              Materials Cost Summary
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Total Materials Spent
                </Typography>
                <Typography variant="h6" fontWeight="bold" color="error.main">
                  ${total.toFixed(2)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="body2" color="text.secondary">
                  Unique Items
                </Typography>
                <Typography variant="h6" fontWeight="bold">
                  {summary.length}
                </Typography>
              </Grid>
            </Grid>
          </Paper>
        </>
      )}
    </Card>
  );
};

const InternalNotesContent: React.FC<{
  newNote: string;
  setNewNote: (v: string) => void;
  handleAdd: () => void;
}> = ({ newNote, setNewNote, handleAdd }) => (
  <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
    <Typography variant="h5" gutterBottom fontWeight="bold" color="error.main">
      🔒 Internal Notes (Team Only)
    </Typography>

    <Alert severity="warning" sx={{ mb: 3 }}>
      These notes are private and will never be visible to the client
    </Alert>

    <Paper variant="outlined" sx={{ p: 2, mb: 3, backgroundColor: '#f8f9fa' }}>
      <Typography variant="h6" gutterBottom>
        Add Internal Note
      </Typography>
      <Box display="flex" gap={1}>
        <TextField
          fullWidth
          multiline
          rows={2}
          placeholder="Add internal note (team observations, pricing strategy, client behavior, etc.)"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
        />
        <Button
          variant="contained"
          onClick={handleAdd}
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
);

const TimelinePlaceholderContent: React.FC = () => (
  <Card elevation={2} sx={{ borderRadius: 2, p: 3 }}>
    <Typography variant="h5" gutterBottom fontWeight="bold">
      Internal Timeline View
    </Typography>

    <Alert severity="info" sx={{ mb: 3 }}>
      Master Plan / Interactive Gantt coming per SPEC v1.1 §1.3 — unified timeline
      for all participants with plan/fact overlay and permit risk tracking.
    </Alert>

    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography variant="h6" color="text.secondary">
        Master Plan integration pending
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Will show internal deadlines, crew assignments, and material delivery schedules
      </Typography>
    </Box>
  </Card>
);

// ─── page ─────────────────────────────────────────────────────────────

const ClientDashboardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  // Work session earnings
  const [workSessionData, setWorkSessionData] = useState<{
    totalEarnings: number;
    sessionCount: number;
    loading: boolean;
  }>({ totalEarnings: 0, sessionCount: 0, loading: true });

  // Load client
  useEffect(() => {
    if (!id) {
      setClientLoading(false);
      return;
    }
    let cancelled = false;
    const loadClient = async () => {
      try {
        const data = await crmApi.getClientById(id);
        if (!cancelled) setClient(data);
      } catch (err) {
        console.error('Error loading client:', err);
      } finally {
        if (!cancelled) setClientLoading(false);
      }
    };
    loadClient();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Real-time inventory transactions
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const q = query(collection(db, 'inventory_transactions'), where('relatedClientId', '==', id));
    const unsub = onSnapshot(
      q,
      snap => {
        const txs = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryTransaction));
        setInventoryTransactions(txs);
        setInventoryLoading(false);
      },
      err => {
        console.error('Error loading inventory transactions:', err);
        setInventoryLoading(false);
      }
    );
    return () => unsub();
  }, [id, clientLoading, client]);

  // Photos from Storage
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const loadPhotos = async () => {
      try {
        const storage = getStorage();
        const photosRef = ref(storage, `projects/${id}/photos/`);
        const result = await listAll(photosRef);
        const photoData = await Promise.all(
          result.items.map(async itemRef => {
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

  // Real-time work sessions
  useEffect(() => {
    if (!id || clientLoading || !client) return;
    const q = query(
      collection(db, 'work_sessions'),
      where('clientId', '==', id),
      where('status', '==', 'completed')
    );
    const unsub = onSnapshot(
      q,
      snap => {
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
      },
      err => {
        console.error('Error loading work sessions:', err);
        setWorkSessionData(prev => ({ ...prev, loading: false }));
      }
    );
    return () => unsub();
  }, [id, clientLoading, client]);

  // Aggregate inventory by item
  const inventorySummary = useMemo((): InventoryRow[] => {
    const map = new Map<string, InventoryRow>();
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

  // Convert Storage photos to GalleryPhoto format
  const galleryPhotos = useMemo(
    (): GalleryPhoto[] =>
      photos.map(p => {
        const name = p.name;
        let category: GalleryPhoto['category'] = 'progress';
        if (name.startsWith('render_') || name.startsWith('render-')) category = 'render';
        else if (name.startsWith('before_') || name.startsWith('before-')) category = 'before';
        return {
          id: name,
          url: p.url,
          title: name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          date: '',
          category,
        };
      }),
    [photos]
  );

  const handleAddNote = () => {
    if (newNote.trim()) {
      // TODO: Phase 3.5 — persist internal notes to Firestore (client_notes collection)
      console.log('Adding internal note:', newNote);
      setNewNote('');
    }
  };

  // ─── Loading / not-found ────────────────────────────────────────
  if (clientLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
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

  // ─── Build layout props ─────────────────────────────────────────
  const header: DashboardHeader = {
    title: client.name,
    subtitle: client.workLocation?.address || client.address || '',
    caption: `${client.type === 'company' ? 'Company' : 'Person'} · ${client.status}`,
    totalAmount: `LTV $${(client.totalRevenue || 0).toLocaleString()}`,
    chips: [
      { label: client.status, color: 'primary' },
      ...(client.tags || []).slice(0, 4).map(tag => ({ label: tag })),
      ...(client.services || []).slice(0, 4).map(svc => ({ label: svc })),
    ],
    meta:
      client.contacts && client.contacts.length > 0 ? (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            Primary:
          </Typography>
          <Typography variant="body2" fontWeight="bold">
            {client.contacts[0].name}
          </Typography>
          {client.contacts[0].phone && (
            <>
              <Typography variant="body2" color="text.secondary">
                ·
              </Typography>
              <Typography
                variant="body2"
                component="a"
                href={`tel:${client.contacts[0].phone}`}
                sx={{ color: 'primary.main', textDecoration: 'none' }}
              >
                {client.contacts[0].phone}
              </Typography>
            </>
          )}
        </Stack>
      ) : undefined,
  };

  const actions = (
    <Stack direction={{ xs: 'row', md: 'row' }} spacing={1}>
      <Button
        size="small"
        variant="outlined"
        startIcon={<VisibilityIcon />}
        onClick={() => navigate(`/crm/clients/${id}`)}
      >
        Details
      </Button>
      <Button
        size="small"
        variant="contained"
        color="primary"
        startIcon={<ShareIcon />}
        disabled
        title="Phase 4 — backend portal endpoint + share-link token management"
      >
        Share
      </Button>
    </Stack>
  );

  const sections: DashboardSection[] = [
    {
      label: 'Overview',
      icon: <ClientIcon />,
      content: <OverviewContent client={client} workSessions={workSessionData} />,
    },
    {
      label: 'Inventory',
      icon: <BuildIcon />,
      content: <InventoryContent loading={inventoryLoading} summary={inventorySummary} />,
    },
    {
      label: 'Notes',
      icon: <NotesIcon />,
      content: (
        <InternalNotesContent
          newNote={newNote}
          setNewNote={setNewNote}
          handleAdd={handleAddNote}
        />
      ),
    },
    {
      label: `Photos (${galleryPhotos.length})`,
      icon: <PhotoCameraIcon />,
      content: photosLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <GallerySection photos={galleryPhotos} />
      ),
    },
    {
      label: 'Timeline',
      icon: <TimelineIcon />,
      content: <TimelinePlaceholderContent />,
    },
  ];

  return (
    <ClientDashboardLayout
      mode="internal"
      header={header}
      sections={sections}
      actions={actions}
    />
  );
};

export default ClientDashboardPage;
