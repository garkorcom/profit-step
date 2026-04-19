/**
 * Client Card V2 — API wrapper for KPI + insights + favorites endpoints.
 * See functions/src/agent/routes/clientInsights.ts for backend contract.
 */

import { getAuth } from 'firebase/auth';

const getApiUrl = (): string =>
  import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
  'https://us-central1-profit-step.cloudfunctions.net/agentApi';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function readErr(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error || body.message || res.statusText;
  } catch {
    return res.statusText;
  }
}

export interface ClientKPIResponse {
  clientId: string;
  kpi: {
    balance: { value: number; trend: number; trendPct: number };
    ltv: { value: number; trend: number };
    marginUsd: { value: number; pct: number | null };
    activeDeals: { count: number; totalValue: number };
    activeProjects: { count: number };
    openOverdueTasks: { count: number; overdueDays: number | null };
    nextMeeting: { id: string; type: string; startAt: string; daysUntil: number } | null;
    lastContactDaysAgo: { days: number; channel: string | null } | null;
  };
  healthScore: { score: number; trend: number; band: 'poor' | 'fair' | 'good' | 'excellent' } | null;
  churnRisk: { level: 'low' | 'medium' | 'high'; reasons: string[] };
  computedAt: string | null;
  stale: boolean;
}

export interface ClientInsightsResponse {
  clientId: string;
  nextBestAction: {
    suggestion: string | null;
    priority: 'low' | 'medium' | 'high';
    reasoning: string | null;
    confidence: number;
    computedAt: string | null;
  };
  relatedClients: Array<{ id: string; name: string; relation: string; ltv: number }>;
  aiSummary: string | null;
}

export async function fetchClientKPI(clientId: string): Promise<ClientKPIResponse> {
  const res = await fetch(`${getApiUrl()}/api/clients/${clientId}/kpi`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`fetchClientKPI: ${await readErr(res)}`);
  return (await res.json()) as ClientKPIResponse;
}

export async function fetchClientInsights(clientId: string): Promise<ClientInsightsResponse> {
  const res = await fetch(`${getApiUrl()}/api/clients/${clientId}/insights`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`fetchClientInsights: ${await readErr(res)}`);
  return (await res.json()) as ClientInsightsResponse;
}

export async function recomputeClientMetrics(clientId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/clients/${clientId}/recompute-metrics`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`recomputeClientMetrics: ${await readErr(res)}`);
}

export async function addClientToFavorites(clientId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/clients/${clientId}/favorite`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`addClientToFavorites: ${await readErr(res)}`);
}

export async function removeClientFromFavorites(clientId: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/clients/${clientId}/favorite`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`removeClientFromFavorites: ${await readErr(res)}`);
}

export async function appendClientQuickNote(clientId: string, note: string): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/clients/${clientId}/quick-note`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(`appendClientQuickNote: ${await readErr(res)}`);
}
