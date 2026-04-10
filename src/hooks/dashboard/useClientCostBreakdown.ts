/**
 * Hook: useClientCostBreakdown
 * Fetches cost breakdown by category for a client.
 */

import { useState, useEffect, useCallback } from 'react';
import { clientDashboardApi } from '../../api/clientDashboardApi';
import type { CostsBreakdown } from '../../types/clientDashboard.types';

interface UseClientCostBreakdownResult {
  data: CostsBreakdown | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useClientCostBreakdown(
  clientId: string | undefined
): UseClientCostBreakdownResult {
  const [data, setData] = useState<CostsBreakdown | null>(null);
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
      const result = await clientDashboardApi.getCostsBreakdown(clientId);
      setData(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load cost breakdown'
      );
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
