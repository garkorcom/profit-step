import { useEffect, useState } from 'react';
import { fetchClientInsights, ClientInsightsResponse } from '../../../../api/clientInsightsApi';

export function useClientInsights(clientId: string | null | undefined) {
  const [data, setData] = useState<ClientInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchClientInsights(clientId)
      .then(res => { if (!cancelled) setData(res); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return { data, loading, error };
}
