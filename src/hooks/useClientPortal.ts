/**
 * Hook for the CLIENT-FACING portal page.
 *
 * Fetches data via GET /api/portal/:slug?token=:t — the backend
 * validates the token and returns only portal-safe data (filtered
 * through portalFilter.ts). This ensures clients NEVER receive
 * internal cost data, employee info, or financial metrics.
 *
 * ⚠️  Previously this hook read directly from Firestore, which meant
 * the client received ALL data and filtering was done on the frontend.
 * That was a security issue — see SPEC.md §1 "Why backend filtering".
 */

import { useState, useEffect, useCallback } from 'react';
import type { GalleryPhoto } from '../components/client-dashboard/sections/GallerySection';

// Portal-safe types (match backend PortalData from portalFilter.ts)
export interface PortalClient {
  id: string;
  name: string;
  address: string | null;
  projectAddress: string | null;
  contactName: string | null;
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

export interface PortalProject {
  id: string;
  name: string | null;
  status: string | null;
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

export interface ClientPortalData {
  client: PortalClient | null;
  projects: PortalProject[];
  estimates: PortalEstimate[];
  tasks: PortalTask[];
  ledger: PortalLedgerEntry[];
  photos: GalleryPhoto[];
  approvalState: Record<string, Record<string, string>>;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  /** Re-fetch data from backend */
  refresh: () => void;
}

function getApiUrl(): string {
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:5001/profit-step/us-central1/agentApi';
  }
  return '';
}

export function useClientPortal(
  slug: string | undefined,
  token: string | undefined,
): ClientPortalData {
  const [client, setClient] = useState<PortalClient | null>(null);
  const [projects, setProjects] = useState<PortalProject[]>([]);
  const [estimates, setEstimates] = useState<PortalEstimate[]>([]);
  const [tasks, setTasks] = useState<PortalTask[]>([]);
  const [ledger, setLedger] = useState<PortalLedgerEntry[]>([]);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [approvalState, setApprovalState] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!slug || !token) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    let cancelled = false;

    const fetchPortal = async () => {
      setLoading(true);
      setError(null);

      try {
        const resp = await fetch(
          `${getApiUrl()}/api/portal/${encodeURIComponent(slug)}?token=${encodeURIComponent(token)}`,
        );

        if (cancelled) return;

        if (resp.status === 401) {
          setNotFound(true);
          setError('Invalid or expired link');
          setLoading(false);
          return;
        }

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`Server error ${resp.status}: ${body}`);
        }

        const data = await resp.json();

        if (cancelled) return;

        setClient(data.client || null);
        setProjects(data.projects || []);
        setEstimates(data.estimates || []);
        setTasks(data.tasks || []);
        setLedger(data.ledger || []);
        setApprovalState(data.approvalState || {});

        // Convert portal photos to GalleryPhoto format
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
        if (!cancelled) {
          console.error('Portal fetch error:', err);
          setError((err as Error).message);
          setNotFound(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPortal();
    return () => { cancelled = true; };
  }, [slug, token, refreshKey]);

  return {
    client,
    projects,
    estimates,
    tasks,
    ledger,
    photos,
    approvalState,
    loading,
    notFound,
    error,
    refresh,
  };
}
