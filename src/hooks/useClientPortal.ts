/**
 * useClientPortal — fetches client portal data via the SECURE backend endpoint.
 *
 * SECURITY: This hook NEVER accesses Firestore directly. All data comes
 * from GET /api/portal/:slug?token=... which validates the token and runs
 * through portalFilter.ts (the security boundary).
 *
 * The token is read from the URL query parameter `?token=...`.
 *
 * Previous version (pre-Phase 2) used direct Firestore onSnapshot calls
 * which bypassed the visibility filter — that code has been replaced.
 */

import { useState, useEffect } from 'react';
import type { GalleryPhoto } from '../components/client-dashboard/sections/GallerySection';

// ─── Types matching backend PortalData (portalFilter.ts output) ─────

export interface PortalClient {
  id: string;
  name: string;
  address: string | null;
  projectAddress: string | null;
  contactName: string | null;
}

export interface PortalProject {
  id: string;
  name: string | null;
  status: string | null;
}

export interface PortalEstimateItem {
  id: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
  notes: string | null;
}

export interface PortalEstimate {
  id: string;
  number: string | null;
  status: string | null;
  total: number | null;
  notes: string | null;
  items: PortalEstimateItem[];
}

export interface PortalTask {
  id: string;
  title: string | null;
  status: string | null;
  context: string | null;
  description: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PortalLedgerEntry {
  id: string;
  type: 'credit' | 'debit' | null;
  amount: number | null;
  description: string | null;
  date: unknown;
}

export interface PortalPhoto {
  name: string;
  url: string;
  category: 'render' | 'progress' | 'before' | null;
}

// ─── Approval state ────────────────────────────────────────────────

export interface ApprovalState {
  [estimateId: string]: {
    [sectionId: string]: 'approved' | 'questioned' | 'pending';
  };
}

// ─── Hook return type ──────────────────────────────────────────────

export interface ClientPortalData {
  client: PortalClient | null;
  projects: PortalProject[];
  estimates: PortalEstimate[];
  tasks: PortalTask[];
  ledger: PortalLedgerEntry[];
  photos: GalleryPhoto[];
  approvalState: ApprovalState;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  /** Re-fetch data from the server */
  refresh: () => void;
}

// ─── API base URL ──────────────────────────────────────────────────

const getApiUrl = (): string =>
  import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
  'https://us-central1-profit-step.cloudfunctions.net/agentApi';

// ─── Hook ──────────────────────────────────────────────────────────

export function useClientPortal(slug: string | undefined): ClientPortalData {
  const [client, setClient] = useState<PortalClient | null>(null);
  const [projects, setProjects] = useState<PortalProject[]>([]);
  const [estimates, setEstimates] = useState<PortalEstimate[]>([]);
  const [tasks, setTasks] = useState<PortalTask[]>([]);
  const [ledger, setLedger] = useState<PortalLedgerEntry[]>([]);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [approvalState, setApprovalState] = useState<ApprovalState>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    // Extract token from URL query params
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setLoading(false);
      setNotFound(true);
      setError('No access token provided. Please use the link shared with you.');
      return;
    }

    let cancelled = false;

    const fetchPortalData = async () => {
      setLoading(true);
      setError(null);

      try {
        const url = `${getApiUrl()}/api/portal/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`;
        const res = await fetch(url);

        if (cancelled) return;

        if (res.status === 401) {
          setNotFound(true);
          setError('This link is invalid or has expired. Please request a new link.');
          setLoading(false);
          return;
        }

        if (res.status === 404) {
          setNotFound(true);
          setError('Client not found.');
          setLoading(false);
          return;
        }

        if (!res.ok) {
          throw new Error(`Server error: ${res.status}`);
        }

        const data = await res.json();

        setClient(data.client || null);
        setProjects(data.projects || []);
        setEstimates(data.estimates || []);
        setTasks(data.tasks || []);
        setLedger(data.ledger || []);
        setApprovalState(data.approvalState || {});

        // Convert PortalPhoto[] to GalleryPhoto[]
        const galleryPhotos: GalleryPhoto[] = (data.photos || []).map((p: PortalPhoto) => ({
          id: p.name,
          url: p.url,
          title: p.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
          date: '',
          category: p.category || 'progress',
        }));
        setPhotos(galleryPhotos);

        setNotFound(false);
      } catch (err) {
        console.error('Portal data fetch error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load portal data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPortalData();
    return () => { cancelled = true; };
  }, [slug, refreshKey]);

  return {
    client, projects, estimates, tasks, ledger, photos,
    approvalState, loading, notFound, error, refresh,
  };
}
