/**
 * Hook: useClientTimeline
 * Fetches paginated timeline events for a client.
 */

import { useState, useEffect, useCallback } from 'react';
import { clientDashboardApi } from '../../api/clientDashboardApi';
import type { TimelineEvent } from '../../types/clientDashboard.types';

interface UseClientTimelineResult {
  events: TimelineEvent[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number;
  loadMore: () => void;
  refetch: () => void;
}

const PAGE_SIZE = 20;

export function useClientTimeline(
  clientId: string | undefined,
  initialLimit = PAGE_SIZE
): UseClientTimelineResult {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (loadOffset = 0, append = false) => {
      if (!clientId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await clientDashboardApi.getTimeline(
          clientId,
          initialLimit,
          loadOffset
        );
        setEvents(prev => (append ? [...prev, ...result.events] : result.events));
        setHasMore(result.hasMore);
        setTotal(result.total);
        setOffset(loadOffset + result.events.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load timeline');
      } finally {
        setLoading(false);
      }
    },
    [clientId, initialLimit]
  );

  useEffect(() => {
    setEvents([]);
    setOffset(0);
    load(0, false);
  }, [load]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      load(offset, true);
    }
  }, [loading, hasMore, offset, load]);

  const refetch = useCallback(() => {
    setEvents([]);
    setOffset(0);
    load(0, false);
  }, [load]);

  return { events, loading, error, hasMore, total, loadMore, refetch };
}
