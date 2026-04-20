import { useEffect, useState } from 'react';

import { ClientLite, fetchActiveClientsLite } from '../api/financeApi';

/**
 * One-shot load of the "active clients" list used by the Finance
 * "Project" dropdown in the adjustment form. Doesn't refresh — admins
 * reload the page if they need newer data. Moved out of FinancePage.tsx
 * per the Finance isolation plan.
 */
export function useActiveClientsLite(): { clients: ClientLite[]; loading: boolean } {
    const [clients, setClients] = useState<ClientLite[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await fetchActiveClientsLite();
                if (!cancelled) setClients(list);
            } catch (err) {
                console.error('useActiveClientsLite: fetch failed', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return { clients, loading };
}
