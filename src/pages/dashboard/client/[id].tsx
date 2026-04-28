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
  Button,
  CircularProgress,
  Stack,
  Alert,
} from '@mui/material';
import {
  Timeline as TimelineIcon,
  Notes as NotesIcon,
  Visibility as VisibilityIcon,
  Person as ClientIcon,
  Build as BuildIcon,
  PhotoCamera as PhotoCameraIcon,
} from '@mui/icons-material';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, listAll, getDownloadURL } from 'firebase/storage';
import { db } from '../../../firebase/firebase';
import { useAuth } from '../../../auth/AuthContext';
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
import ShareWithClientButton from '../../../components/client-dashboard/sharing/ShareWithClientButton';

import {
  OverviewSection,
  CostBreakdownSection,
  InternalNotesSection,
  TimelinePlaceholder,
  type InventoryRow,
} from '../../../components/client-dashboard/internal-only';

// ─── page ─────────────────────────────────────────────────────────────

const ClientDashboardPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const companyId = userProfile?.companyId;
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
    if (!id || clientLoading || !client || !companyId) return;
    // companyId filter REQUIRED — RLS read rule (PR #95).
    const q = query(
      collection(db, 'work_sessions'),
      where('companyId', '==', companyId),
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
  }, [id, clientLoading, client, companyId]);

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
      {id && (
        <ShareWithClientButton
          clientId={id}
          clientName={client.name}
          size="small"
          variant="contained"
        />
      )}
    </Stack>
  );

  const sections: DashboardSection[] = [
    {
      label: 'Overview',
      icon: <ClientIcon />,
      content: <OverviewSection client={client} workSessions={workSessionData} />,
    },
    {
      label: 'Inventory',
      icon: <BuildIcon />,
      content: <CostBreakdownSection loading={inventoryLoading} summary={inventorySummary} />,
    },
    {
      label: 'Notes',
      icon: <NotesIcon />,
      content: (
        <InternalNotesSection
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
      content: <TimelinePlaceholder />,
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
