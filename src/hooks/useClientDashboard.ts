/**
 * @fileoverview Hook for Client Dashboard — loads clients, balances, task stats, and users.
 *
 * Post Client Card V2 (PR #43): surfaces `lifecycleStage`, `segment`, `healthScore`,
 * `churnRisk`, `ltv`, `totalMargin` as first-class filter + bucket dimensions.
 * Legacy `health` (green/yellow/red) stays as a fallback for unmigrated clients.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    collection, getDocs, query, where, Timestamp
} from 'firebase/firestore';
import { db } from '../firebase/firebase';
import {
    Client,
    ClientStatus,
    LifecycleStage,
    ClientSegment,
    ChurnRisk,
} from '../types/crm.types';
import { crmApi } from '../api/crmApi';
import { projectsApi } from '../api/projectsApi';

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export type HealthStatus = 'green' | 'yellow' | 'red';
export type HealthBand = 'poor' | 'fair' | 'good' | 'excellent';
export type SortField =
    | 'name'
    | 'createdAt'
    | 'updatedAt'
    | 'balance'
    | 'health'
    | 'status'
    | 'healthScore'
    | 'ltv';
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
    /** Legacy coarse bucket — kept for back-compat with callers. */
    health: HealthStatus;
    /** V2 band derived from healthScore (0-100). undefined if score missing. */
    healthBand?: HealthBand;
    /** Most recent contact timestamp — uses `lastContactAt` (V2) with fallback to legacy `lastContactedAt`. */
    effectiveLastContactAt?: Timestamp;
}

export interface DashboardFilters {
    search: string;
    createdBy: string | null;  // null = all
    status: ClientStatus | null;
    lifecycleStage: LifecycleStage | null;
    segment: ClientSegment | null;
    churnRisk: Exclude<ChurnRisk, 'low'> | null; // 'medium' or 'high' only (low = no badge)
    healthBand: HealthBand | null;
    sortField: SortField;
    sortDir: SortDir;
    modifiedToday?: boolean;
    atRiskOnly?: boolean;
    forgottenOnly?: boolean;
}

// ═══════════════════════════════════════
// HEALTH CALCULATION
// ═══════════════════════════════════════

const DAYS_MS = 24 * 60 * 60 * 1000;
const FORGOTTEN_DAYS = 30;

export function computeHealth(
    lastContactedAt: Timestamp | undefined,
    openTasks: number
): HealthStatus {
    const now = Date.now();

    if (openTasks > 0) return 'green';
    if (!lastContactedAt) return 'red';

    const daysSince = (now - lastContactedAt.toMillis()) / DAYS_MS;
    if (daysSince <= 7) return 'green';
    if (daysSince <= 30) return 'yellow';
    return 'red';
}

/** Map healthScore (0-100) to a 4-band categorical. Matches ClientHeaderV2 palette. */
export function healthBandFromScore(score: number | undefined): HealthBand | undefined {
    if (score === undefined || score === null) return undefined;
    if (score >= 81) return 'excellent';
    if (score >= 61) return 'good';
    if (score >= 41) return 'fair';
    return 'poor';
}

function daysSince(ts: Timestamp | undefined | null): number | null {
    if (!ts) return null;
    return (Date.now() - ts.toMillis()) / DAYS_MS;
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
        lifecycleStage: null,
        segment: null,
        churnRisk: null,
        healthBand: null,
        sortField: 'updatedAt',
        sortDir: 'desc',
        modifiedToday: false,
        atRiskOnly: false,
        forgottenOnly: false,
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

            const balanceMap = new Map<string, number>();
            balancesSummary.forEach(item => balanceMap.set(item.clientId, item.balance));

            const rows: ClientRow[] = clientsData.map(client => {
                const stats = taskStatsMap.get(client.id) || { openCount: 0, overdueCount: 0 };
                const effectiveLast = client.lastContactAt ?? client.lastContactedAt;
                return {
                    ...client,
                    balance: balanceMap.get(client.id) || 0,
                    taskStats: stats,
                    health: computeHealth(effectiveLast ?? undefined, stats.openCount),
                    healthBand: healthBandFromScore(client.healthScore),
                    effectiveLastContactAt: effectiveLast ?? undefined,
                };
            });

            setClients(rows);

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

    const updateClientStatus = useCallback(async (clientId: string, newStatus: ClientStatus) => {
        setClients(prev => prev.map(c => {
            if (c.id === clientId) {
                return { ...c, status: newStatus, updatedAt: Timestamp.now() } as ClientRow;
            }
            return c;
        }));
        try {
            await crmApi.updateClient(clientId, { status: newStatus });
        } catch (err) {
            console.error('Failed to update status:', err);
            loadData();
        }
    }, [loadData]);

    const updateClientLifecycle = useCallback(async (clientId: string, lifecycleStage: LifecycleStage) => {
        setClients(prev => prev.map(c => {
            if (c.id === clientId) {
                return { ...c, lifecycleStage, updatedAt: Timestamp.now() } as ClientRow;
            }
            return c;
        }));
        try {
            await crmApi.updateClient(clientId, { lifecycleStage });
        } catch (err) {
            console.error('Failed to update lifecycleStage:', err);
            loadData();
        }
    }, [loadData]);

    // ── Filter + Sort (client-side) ──
    const filteredClients = useMemo(() => {
        let result = [...clients];

        if (filters.search) {
            const q = filters.search.toLowerCase();
            result = result.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.industry?.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q) ||
                c.phone?.toLowerCase().includes(q) ||
                c.tags?.some(t => t.toLowerCase().includes(q)) ||
                c.contacts?.some(ct => ct.phone?.toLowerCase().includes(q) || ct.email?.toLowerCase().includes(q))
            );
        }

        if (filters.createdBy) {
            result = result.filter(c => c.createdBy === filters.createdBy);
        }

        if (filters.status) {
            result = result.filter(c => c.status === filters.status);
        }

        if (filters.lifecycleStage) {
            result = result.filter(c => c.lifecycleStage === filters.lifecycleStage);
        }

        if (filters.segment) {
            result = result.filter(c => c.segment === filters.segment);
        }

        if (filters.churnRisk) {
            result = result.filter(c => c.churnRisk === filters.churnRisk);
        }

        if (filters.healthBand) {
            result = result.filter(c => c.healthBand === filters.healthBand);
        }

        if (filters.atRiskOnly) {
            result = result.filter(c => c.churnRisk === 'high');
        }

        if (filters.forgottenOnly) {
            result = result.filter(c => {
                if (c.lifecycleStage === 'churned' || c.status === 'churned' || c.status === 'done') return false;
                const days = daysSince(c.effectiveLastContactAt);
                return days === null || days > FORGOTTEN_DAYS;
            });
        }

        if (filters.modifiedToday) {
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            result = result.filter(c => {
                const updated = c.updatedAt?.seconds ? c.updatedAt.seconds * 1000
                    : (c.createdAt?.seconds ? c.createdAt.seconds * 1000 : 0);
                return updated >= todayStart.getTime();
            });
        }

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
                case 'updatedAt': {
                    const ta = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
                    const tb = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
                    return dir * (ta - tb);
                }
                case 'balance':
                    return dir * (a.balance - b.balance);
                case 'health': {
                    const order: Record<HealthStatus, number> = { red: 0, yellow: 1, green: 2 };
                    return dir * (order[a.health] - order[b.health]);
                }
                case 'healthScore': {
                    const sa = a.healthScore ?? -1;
                    const sb = b.healthScore ?? -1;
                    return dir * (sa - sb);
                }
                case 'ltv': {
                    const la = a.ltv ?? a.totalRevenue ?? 0;
                    const lb = b.ltv ?? b.totalRevenue ?? 0;
                    return dir * (la - lb);
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
    const stats = useMemo(() => {
        const counts = {
            total: clients.length,
            green: 0, yellow: 0, red: 0,              // legacy health
            active: 0, vip: 0, churned: 0, atRisk: 0, // V2
        };
        clients.forEach(c => {
            counts[c.health]++;
            if (c.lifecycleStage === 'active') counts.active++;
            if (c.lifecycleStage === 'vip' || c.segment === 'VIP') counts.vip++;
            if (c.lifecycleStage === 'churned') counts.churned++;
            if (c.churnRisk === 'high') counts.atRisk++;
        });
        return counts;
    }, [clients]);

    // ── Pre-computed Dashboard Clusters ──
    const dashboardClusters = useMemo(() => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();

        const recentActivity = filteredClients.filter(c => {
            const ms = c.updatedAt?.seconds ? c.updatedAt.seconds * 1000
                : (c.createdAt?.seconds ? c.createdAt.seconds * 1000 : 0);
            return ms >= todayMs;
        });

        // V2: at-risk = high churn risk + not churned
        const atRisk = filteredClients
            .filter(c => c.churnRisk === 'high' && c.lifecycleStage !== 'churned')
            .sort((a, b) => (a.healthScore ?? 0) - (b.healthScore ?? 0))
            .slice(0, 8);

        // Forgotten = >30 days since last contact, not churned/done
        const forgotten = filteredClients
            .filter(c => {
                if (c.lifecycleStage === 'churned' || c.status === 'churned' || c.status === 'done') return false;
                const d = daysSince(c.effectiveLastContactAt);
                return d === null || d > FORGOTTEN_DAYS;
            })
            .sort((a, b) => {
                const da = daysSince(a.effectiveLastContactAt) ?? Number.POSITIVE_INFINITY;
                const db = daysSince(b.effectiveLastContactAt) ?? Number.POSITIVE_INFINITY;
                return db - da;
            })
            .slice(0, 8);

        // VIP = explicitly VIP lifecycleStage or segment
        const vip = filteredClients
            .filter(c => c.lifecycleStage === 'vip' || c.segment === 'VIP')
            .sort((a, b) => (b.ltv ?? b.totalRevenue ?? 0) - (a.ltv ?? a.totalRevenue ?? 0))
            .slice(0, 8);

        // Legacy bucket (needs attention by legacy health) — kept for back-compat.
        const needsAttention = filteredClients
            .filter(c => c.health === 'red' && c.status !== 'done' && c.status !== 'churned')
            .slice(0, 8);

        // Kanban columns keyed by lifecycleStage. Legacy status fallback if lifecycle missing.
        const byLifecycle = {
            lead: filteredClients.filter(c => (c.lifecycleStage ?? mapStatusToLifecycle(c.status)) === 'lead'),
            prospect: filteredClients.filter(c => (c.lifecycleStage ?? mapStatusToLifecycle(c.status)) === 'prospect'),
            active: filteredClients.filter(c => (c.lifecycleStage ?? mapStatusToLifecycle(c.status)) === 'active'),
            repeat: filteredClients.filter(c => (c.lifecycleStage ?? mapStatusToLifecycle(c.status)) === 'repeat'),
        };

        return { recentActivity, atRisk, forgotten, vip, needsAttention, byLifecycle };
    }, [filteredClients]);

    return {
        clients: filteredClients,
        allClients: clients,
        users,
        loading,
        error,
        filters,
        setFilters,
        stats,
        dashboardClusters,
        updateClientStatus,
        updateClientLifecycle,
        refresh: loadData,
    };
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

/** Best-effort mapping from legacy `status` onto a lifecycleStage for unmigrated clients. */
function mapStatusToLifecycle(status: ClientStatus | undefined): LifecycleStage {
    switch (status) {
        case 'new': return 'lead';
        case 'contacted': return 'lead';
        case 'qualified': return 'prospect';
        case 'customer': return 'active';
        case 'churned': return 'churned';
        case 'done': return 'repeat';
        default: return 'lead';
    }
}

async function loadTaskStats(_companyId: string): Promise<Map<string, TaskStats>> {
    const map = new Map<string, TaskStats>();
    const now = Timestamp.now();

    try {
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
