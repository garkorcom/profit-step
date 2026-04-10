/**
 * @fileoverview Fetches aggregated dashboard data for a single client from
 * GET /api/clients/:id (functions/src/agent/routes/clients.ts:183).
 *
 * The endpoint already aggregates 6 collections in a single call:
 *   clients, projects, gtd_tasks, costs, work_sessions, estimates, sites
 *
 * This hook is a typed thin wrapper. It is offered as an ALTERNATIVE to
 * the existing direct-Firestore subscription pattern in
 * src/pages/dashboard/client/[id].tsx — consumers can opt in per-page.
 * The existing page-level implementation is unchanged in this commit.
 *
 * Origin: adapted from claude/confident-lewin@072cc9b with these changes:
 *   - Added Firebase Auth Bearer token headers (original called fetch()
 *     without auth, which would have failed against authMiddleware)
 *   - Added getApiUrl() base resolution from VITE_FIREBASE_FUNCTIONS_URL
 *     (same pattern as src/api/shareApi.ts)
 *   - Narrowed 'any' types in the response shape
 */

import { useEffect, useState, useCallback } from 'react';
import { getAuth } from 'firebase/auth';

// ─── Config ──────────────────────────────────────────────────────────
// Kept local to this file to match the pattern used by src/api/shareApi.ts.
// If a third consumer appears, extract into src/api/apiClient.ts.

const getApiUrl = (): string =>
  import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
  'https://us-central1-profit-step.cloudfunctions.net/agentApi';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) {
    throw new Error('Not authenticated. Please sign in again.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ─── Response shape ──────────────────────────────────────────────────

export interface ClientDashboardClient {
  id: string;
  name?: string;
  type?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: string;
  industry?: string;
  totalRevenue?: number;
  tags?: string[];
  contacts?: Array<{ name?: string; email?: string; phone?: string; role?: string }>;
  [key: string]: unknown;
}

export interface ClientDashboardProject {
  id: string;
  name?: string;
  status?: string;
}

export interface ClientDashboardTaskItem {
  id: string;
  title?: string;
  status?: string;
  priority?: string;
}

export interface ClientDashboardTasks {
  total: number;
  byStatus: Record<string, number>;
  items: ClientDashboardTaskItem[];
}

export interface ClientDashboardCosts {
  total: number;
  count: number;
  byCategory: Record<string, number>;
}

export interface ClientDashboardTimeTracking {
  totalMinutes: number;
  totalHours: number;
  totalEarnings: number;
  sessionCount: number;
}

export interface ClientDashboardEstimate {
  id: string;
  status?: string;
  total?: number;
}

export interface ClientDashboardSite {
  id: string;
  address?: string;
  status?: string;
}

export interface ClientDashboardData {
  client: ClientDashboardClient;
  projects: ClientDashboardProject[];
  tasks: ClientDashboardTasks;
  costs: ClientDashboardCosts;
  timeTracking: ClientDashboardTimeTracking;
  estimates: ClientDashboardEstimate[];
  sites: ClientDashboardSite[];
}

interface UseClientDashboardDataResult {
  data: ClientDashboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useClientDashboardData(
  clientId: string | undefined
): UseClientDashboardDataResult {
  const [data, setData] = useState<ClientDashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      setData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${getApiUrl()}/api/clients/${encodeURIComponent(clientId)}`,
          { headers }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }
        const json = (await res.json()) as ClientDashboardData;
        if (cancelled) return;
        setData(json);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('useClientDashboardData fetch error:', err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, reloadKey]);

  return { data, loading, error, refetch };
}

// ─── Derived helpers ────────────────────────────────────────────────

/**
 * Real-time profit = sum of estimates - (costs + labor earnings).
 *
 * Returns null if there are no estimates — we cannot compute a margin
 * without a revenue baseline and showing 0% would be misleading.
 */
export function computeProfit(data: ClientDashboardData | null): {
  revenue: number;
  spend: number;
  profit: number;
  marginPct: number;
} | null {
  if (!data) return null;
  const revenue = data.estimates.reduce((sum, e) => sum + (e.total || 0), 0);
  if (revenue <= 0) return null;
  const spend = data.costs.total + data.timeTracking.totalEarnings;
  const profit = revenue - spend;
  const marginPct = (profit / revenue) * 100;
  return { revenue, spend, profit, marginPct };
}

export type MarginTier = 'green' | 'yellow' | 'red';

/**
 * Margin health thresholds used by the client dashboard summary cards.
 * - green: healthy (> 30%)
 * - yellow: tight but positive (20–30%)
 * - red: at-risk or loss (< 20%)
 */
export function marginTier(marginPct: number): MarginTier {
  if (marginPct > 30) return 'green';
  if (marginPct >= 20) return 'yellow';
  return 'red';
}
