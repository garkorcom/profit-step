/**
 * API client for Client Dashboard endpoints.
 *
 * Uses the same auth pattern as shareApi.ts:
 *   - Bearer token from Firebase Auth
 *   - Base URL from VITE_FIREBASE_FUNCTIONS_URL
 */

import { getAuth } from 'firebase/auth';
import type {
  ClientSummary,
  LaborLogData,
  LaborPeriod,
  TimelineData,
  CostsBreakdown,
} from '../types/clientDashboard.types';

const getApiUrl = (): string =>
  import.meta.env.VITE_FIREBASE_FUNCTIONS_URL ||
  'https://us-central1-profit-step.cloudfunctions.net/agentApi';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${getApiUrl()}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const clientDashboardApi = {
  async getSummary(clientId: string): Promise<ClientSummary> {
    return fetchJson(`/api/dashboard/client/${clientId}/summary`);
  },

  async getLaborLog(clientId: string, period: LaborPeriod = 'month'): Promise<LaborLogData> {
    return fetchJson(`/api/dashboard/client/${clientId}/labor-log?period=${period}`);
  },

  async getTimeline(
    clientId: string,
    limit = 50,
    offset = 0
  ): Promise<TimelineData> {
    return fetchJson(
      `/api/dashboard/client/${clientId}/timeline?limit=${limit}&offset=${offset}`
    );
  },

  async getCostsBreakdown(clientId: string): Promise<CostsBreakdown> {
    return fetchJson(`/api/dashboard/client/${clientId}/costs-breakdown`);
  },
};
