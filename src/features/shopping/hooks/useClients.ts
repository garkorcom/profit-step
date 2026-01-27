/**
 * @fileoverview useClients Hook
 * 
 * Load clients for selection in shopping lists.
 */

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import { ShoppingClient } from '../types';

interface UseClientsReturn {
    clients: ShoppingClient[];
    loading: boolean;
    refresh: () => Promise<void>;
}

export function useClients(): UseClientsReturn {
    const [clients, setClients] = useState<ShoppingClient[]>([]);
    const [loading, setLoading] = useState(true);

    const loadClients = async () => {
        setLoading(true);
        try {
            // Simple query - just get all clients, filter done on client side
            const q = query(
                collection(db, 'clients'),
                orderBy('name'),
                limit(200)
            );
            const snapshot = await getDocs(q);
            const data = snapshot.docs
                .map(doc => ({
                    id: doc.id,
                    name: doc.data().name || 'Unknown',
                    status: doc.data().status,
                }))
                .filter(c => c.status !== 'done') // Filter done clients on client side
                .map(({ id, name }) => ({ id, name })); // Remove status from final result
            setClients(data);
        } catch (error) {
            console.error('Error loading clients:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadClients();
    }, []);

    return {
        clients,
        loading,
        refresh: loadClients,
    };
}

