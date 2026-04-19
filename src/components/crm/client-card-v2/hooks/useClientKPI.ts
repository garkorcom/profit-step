import { useCallback, useEffect, useState } from 'react';
import { fetchClientKPI, ClientKPIResponse } from '../../../../api/clientInsightsApi';

export function useClientKPI(clientId: string | null | undefined) {
  const [data, setData] = useState<ClientKPIResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchClientKPI(clientId);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load KPI');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
