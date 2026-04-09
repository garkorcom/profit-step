/**
 * Hook: useClientSummary
 * Fetches aggregated financial summary for a client dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { clientDashboardApi } from '../../api/clientDashboardApi';
import type { ClientSummary } from '../../types/clientDashboard.types';

interface UseClientSummaryResult {
  data: ClientSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useClientSummary(clientId: string | undefined): UseClientSummaryResult {
  const [data, setData] = useState<ClientSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await clientDashboardApi.getSummary(clientId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load summary');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
