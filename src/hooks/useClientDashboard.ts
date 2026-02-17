/**
 * @fileoverview Hook for Client Dashboard — loads clients, balances, task stats, and users.
 * Provides filtering, sorting, and health computation.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    collection, getDocs, query, where, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import { Client, ClientStatus } from '../types/crm.types';
import { crmApi } from '../api/crmApi';
import { projectsApi } from '../api/projectsApi';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export type HealthStatus = 'green' | 'yellow' | 'red';
export type SortField = 'name' | 'createdAt' | 'balance' | 'health' | 'status';
export type SortDir = 'asc' | 'desc';

export interface TaskStats {
    openCount: number;
    overdueCount: number;
}

export interface UserInfo {
    id: string;
    displayName?: string;
    email?: string;
    avatarUrl?: string;
}

export interface ClientRow extends Client {
    balance: number;
    taskStats: TaskStats;
    health: HealthStatus;
}

export interface DashboardFilters {
    search: string;
    createdBy: string | null;  // null = all
    status: ClientStatus | null;
    sortField: SortField;
    sortDir: SortDir;
}

// ═══════════════════════════════════════
// HEALTH CALCULATION
// ═══════════════════════════════════════

const DAYS_MS = 24 * 60 * 60 * 1000;

export function computeHealth(
    lastContactedAt: Timestamp | undefined,
    openTasks: number
): HealthStatus {
    const now = Date.now();

    // Has open tasks → green
    if (openTasks > 0) return 'green';

    if (!lastContactedAt) return 'red'; // never contacted

    const daysSince = (now - lastContactedAt.toMillis()) / DAYS_MS;

    if (daysSince <= 7) return 'green';
    if (daysSince <= 30) return 'yellow';
    return 'red';
}

// ═══════════════════════════════════════
// HOOK
// ═══════════════════════════════════════

export function useClientDashboard(companyId: string | undefined) {
    const [clients, setClients] = useState<ClientRow[]>([]);
    const [users, setUsers] = useState<UserInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [filters, setFilters] = useState<DashboardFilters>({
        search: '',
        createdBy: null,
        status: null,
        sortField: 'name',
        sortDir: 'asc',
    });

    // ── Load all data in parallel ──
    const loadData = useCallback(async () => {
        if (!companyId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const [clientsData, balancesSummary, taskStatsMap, usersSnap] = await Promise.all([
                crmApi.getClients(companyId),
                projectsApi.getClientBalancesSummary(companyId),
                loadTaskStats(companyId),
                getDocs(collection(db, 'users')),
            ]);

            // Balance map
            const balanceMap = new Map<string, number>();
            balancesSummary.forEach((item: any) => balanceMap.set(item.clientId, item.balance));

            // Build enriched rows
            const rows: ClientRow[] = clientsData.map(client => {
                const stats = taskStatsMap.get(client.id) || { openCount: 0, overdueCount: 0 };
                return {
                    ...client,
                    balance: balanceMap.get(client.id) || 0,
                    taskStats: stats,
                    health: computeHealth(client.lastContactedAt, stats.openCount),
                };
            });

            setClients(rows);

            // Users
            setUsers(usersSnap.docs.map(doc => ({
                id: doc.id,
                displayName: doc.data().displayName,
                email: doc.data().email,
                avatarUrl: doc.data().avatarUrl,
            })));
        } catch (err) {
            console.error('Error loading dashboard:', err);
            setError('Ошибка загрузки данных');
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // ── Filter + Sort (client-side) ──
    const filteredClients = useMemo(() => {
        let result = [...clients];

        // Search
        if (filters.search) {
            const q = filters.search.toLowerCase();
            result = result.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.industry?.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q)
            );
        }

        // Owner filter
        if (filters.createdBy) {
            result = result.filter(c => c.createdBy === filters.createdBy);
        }

        // Status filter
        if (filters.status) {
            result = result.filter(c => c.status === filters.status);
        }

        // Sort
        const dir = filters.sortDir === 'asc' ? 1 : -1;
        result.sort((a, b) => {
            switch (filters.sortField) {
                case 'name':
                    return dir * a.name.localeCompare(b.name);
                case 'createdAt': {
                    const ta = a.createdAt?.seconds || 0;
                    const tb = b.createdAt?.seconds || 0;
                    return dir * (ta - tb);
                }
                case 'balance':
                    return dir * (a.balance - b.balance);
                case 'health': {
                    const order: Record<HealthStatus, number> = { red: 0, yellow: 1, green: 2 };
                    return dir * (order[a.health] - order[b.health]);
                }
                case 'status':
                    return dir * a.status.localeCompare(b.status);
                default:
                    return 0;
            }
        });

        return result;
    }, [clients, filters]);

    // ── Stats ──
    const stats = useMemo(() => ({
        total: clients.length,
        green: clients.filter(c => c.health === 'green').length,
        yellow: clients.filter(c => c.health === 'yellow').length,
        red: clients.filter(c => c.health === 'red').length,
    }), [clients]);

    return {
        clients: filteredClients,
        allClients: clients,
        users,
        loading,
        error,
        filters,
        setFilters,
        stats,
        refresh: loadData,
    };
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

async function loadTaskStats(companyId: string): Promise<Map<string, TaskStats>> {
    const map = new Map<string, TaskStats>();
    const now = Timestamp.now();

    try {
        // Get all non-done tasks
        const q = query(
            collection(db, 'gtd_tasks'),
            where('status', '!=', 'done'),
        );
        const snap = await getDocs(q);

        snap.docs.forEach(doc => {
            const data = doc.data();
            const clientId = data.clientId;
            if (!clientId) return;

            const existing = map.get(clientId) || { openCount: 0, overdueCount: 0 };
            existing.openCount++;

            // Check if overdue
            if (data.dueDate && data.dueDate.seconds < now.seconds) {
                existing.overdueCount++;
            }

            map.set(clientId, existing);
        });
    } catch (err) {
        console.error('Error loading task stats:', err);
    }

    return map;
}
