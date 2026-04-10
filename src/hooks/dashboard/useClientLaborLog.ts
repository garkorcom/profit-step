/**
 * Hook: useClientLaborLog
 * Fetches labor log (employees, hours, costs) for a client.
 */

import { useState, useEffect, useCallback } from 'react';
import { clientDashboardApi } from '../../api/clientDashboardApi';
import type { LaborLogData, LaborPeriod } from '../../types/clientDashboard.types';

interface UseClientLaborLogResult {
  data: LaborLogData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useClientLaborLog(
  clientId: string | undefined,
  period: LaborPeriod = 'month'
): UseClientLaborLogResult {
  const [data, setData] = useState<LaborLogData | null>(null);
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
      const result = await clientDashboardApi.getLaborLog(clientId, period);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load labor log');
    } finally {
      setLoading(false);
    }
  }, [clientId, period]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
