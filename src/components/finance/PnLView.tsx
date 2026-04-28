import React, { useEffect, useState, useMemo } from 'react';
import {
    Box, Typography, Paper, Card, CardContent, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/firebase';
import { useAuth } from '../../auth/AuthContext';
import { startOfDay, endOfDay } from 'date-fns';
import type { Invoice } from '../../types/invoice.types';
import type { WorkSession } from '../../types/timeTracking.types';
import type { CostEntry } from '../../types/finance.types';

// ── Props ────────────────────────────────────────────────────────────────────

interface PnLViewProps {
    startDate: Date;
    endDate: Date;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface PnLRow {
    clientId: string;
    clientName: string;
    revenue: number;
    labor: number;
    materials: number;
    profit: number;
    margin: number; // percentage
}

// ── Component ────────────────────────────────────────────────────────────────

const PnLView: React.FC<PnLViewProps> = ({ startDate, endDate }) => {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [sessions, setSessions] = useState<WorkSession[]>([]);
    const [costs, setCosts] = useState<CostEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const { userProfile } = useAuth();
    const companyId = userProfile?.companyId;

    // ── Fetch all 3 collections in parallel ──────────────────────────────────

    useEffect(() => {
        const fetchAll = async () => {
            if (!companyId) {
                setLoading(false);
                return;
            }
            setLoading(true);
            const start = Timestamp.fromDate(startOfDay(startDate));
            const end = Timestamp.fromDate(endOfDay(endDate));

            try {
                const [invSnap, sessSnap, costsSnap] = await Promise.all([
                    // Revenue: invoices (non-cancelled) within date range
                    getDocs(
                        query(
                            collection(db, 'invoices'),
                            where('date', '>=', start),
                            where('date', '<=', end),
                            orderBy('date', 'desc'),
                        ),
                    ),
                    // Labor: finalized work_sessions within date range
                    // companyId filter REQUIRED — RLS read rule (PR #95).
                    getDocs(
                        query(
                            collection(db, 'work_sessions'),
                            where('companyId', '==', companyId),
                            where('startTime', '>=', start),
                            where('startTime', '<=', end),
                            orderBy('startTime', 'desc'),
                        ),
                    ),
                    // Materials: costs within date range
                    getDocs(
                        query(
                            collection(db, 'costs'),
                            where('createdAt', '>=', start),
                            where('createdAt', '<=', end),
                            orderBy('createdAt', 'desc'),
                        ),
                    ),
                ]);

                setInvoices(invSnap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)));
                setSessions(sessSnap.docs.map(d => ({ id: d.id, ...d.data() } as WorkSession)));
                setCosts(costsSnap.docs.map(d => ({ id: d.id, ...d.data() } as CostEntry)));
            } catch (err) {
                console.error('PnL fetch error:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchAll();
    }, [startDate, endDate, companyId]);

    // ── Build P&L rows ───────────────────────────────────────────────────────

    const { rows, totals } = useMemo(() => {
        const clientMap = new Map<string, { clientName: string; revenue: number; labor: number; materials: number }>();

        const getOrCreate = (clientId: string, clientName: string) => {
            const key = clientId || clientName || 'unknown';
            if (!clientMap.has(key)) {
                clientMap.set(key, { clientName: clientName || 'Unknown', revenue: 0, labor: 0, materials: 0 });
            }
            return clientMap.get(key)!;
        };

        // Revenue from invoices (exclude cancelled)
        invoices.forEach(inv => {
            if (inv.status === 'cancelled') return;
            const row = getOrCreate(inv.clientId, inv.clientName);
            row.revenue += inv.total || 0;
        });

        // Labor from work_sessions (only regular & finalized, exclude payments/corrections/voided)
        sessions.forEach(sess => {
            if (sess.isVoided) return;
            if (sess.type === 'payment') return;
            // Include regular, correction, manual_adjustment for accurate payroll
            const clientId = sess.clientId || '';
            const clientName = sess.clientName || '';
            // Skip synthetic clients
            if (['Manual Adjustment', 'Payment', 'Voided Record'].includes(clientName)) return;
            const row = getOrCreate(clientId, clientName);
            row.labor += Math.abs(sess.sessionEarnings || 0);
        });

        // Materials from costs (exclude reimbursements — they reduce costs)
        costs.forEach(cost => {
            const row = getOrCreate(cost.clientId, cost.clientName);
            if (cost.category === 'reimbursement') {
                row.materials -= Math.abs(cost.amount);
            } else {
                row.materials += Math.abs(cost.amount);
            }
        });

        // Convert to rows
        const pnlRows: PnLRow[] = [];
        let totalRevenue = 0;
        let totalLabor = 0;
        let totalMaterials = 0;

        clientMap.forEach((data, clientId) => {
            const profit = data.revenue - data.labor - Math.max(0, data.materials);
            const margin = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
            totalRevenue += data.revenue;
            totalLabor += data.labor;
            totalMaterials += Math.max(0, data.materials);

            pnlRows.push({
                clientId,
                clientName: data.clientName,
                revenue: data.revenue,
                labor: data.labor,
                materials: Math.max(0, data.materials),
                profit,
                margin,
            });
        });

        // Sort by revenue descending
        pnlRows.sort((a, b) => b.revenue - a.revenue);

        const totalProfit = totalRevenue - totalLabor - totalMaterials;
        const totalMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

        return {
            rows: pnlRows,
            totals: {
                revenue: totalRevenue,
                labor: totalLabor,
                materials: totalMaterials,
                profit: totalProfit,
                margin: totalMargin,
            },
        };
    }, [invoices, sessions, costs]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <Box sx={{ mt: 4, textAlign: 'center' }}>
                <CircularProgress />
                <Typography sx={{ mt: 2 }} color="text.secondary">
                    Loading P&L data…
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ mt: 2 }}>
            {/* ── Summary Cards ─────────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', gap: 3, mb: 4, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Card sx={{ bgcolor: '#2196f3', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Revenue</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                ${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Card sx={{ bgcolor: '#ff9800', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Labor</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                ${totals.labor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Card sx={{ bgcolor: '#9c27b0', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Total Materials</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                ${totals.materials.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Card sx={{ bgcolor: totals.profit >= 0 ? '#4caf50' : '#f44336', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>Gross Profit</Typography>
                            <Typography variant="h4" fontWeight="bold">
                                ${totals.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
                <Box sx={{ flex: 1, minWidth: 160 }}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography color="textSecondary" variant="body2">Margin</Typography>
                            <Typography
                                variant="h4"
                                fontWeight="bold"
                                color={totals.margin >= 0 ? 'success.main' : 'error.main'}
                            >
                                {totals.margin.toFixed(1)}%
                            </Typography>
                        </CardContent>
                    </Card>
                </Box>
            </Box>

            {/* ── P&L Table ────────────────────────────────────────────────── */}
            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                            <TableCell>Client / Project</TableCell>
                            <TableCell align="right">Revenue</TableCell>
                            <TableCell align="right">Labor</TableCell>
                            <TableCell align="right">Materials</TableCell>
                            <TableCell align="right">Gross Profit</TableCell>
                            <TableCell align="right">Margin %</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center">
                                    <Typography color="text.secondary" sx={{ py: 4 }}>
                                        No data for this period
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            <>
                                {rows.map((row) => (
                                    <TableRow key={row.clientId} hover>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight="bold">
                                                {row.clientName}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography variant="body2" color="primary.main" fontWeight="bold">
                                                ${row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            ${row.labor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell align="right">
                                            ${row.materials.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography
                                                variant="body2"
                                                fontWeight="bold"
                                                color={row.profit >= 0 ? 'success.main' : 'error.main'}
                                            >
                                                ${row.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title={`Profit / Revenue × 100`}>
                                                <Chip
                                                    label={`${row.margin.toFixed(1)}%`}
                                                    color={row.margin >= 30 ? 'success' : row.margin >= 10 ? 'warning' : 'error'}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {/* Totals row */}
                                <TableRow sx={{ bgcolor: '#fafafa' }}>
                                    <TableCell>
                                        <Typography variant="subtitle2" fontWeight="bold">
                                            TOTAL ({rows.length} {rows.length === 1 ? 'client' : 'clients'})
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="subtitle2" fontWeight="bold" color="primary.main">
                                            ${totals.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="subtitle2" fontWeight="bold">
                                            ${totals.labor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="subtitle2" fontWeight="bold">
                                            ${totals.materials.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography
                                            variant="subtitle2"
                                            fontWeight="bold"
                                            color={totals.profit >= 0 ? 'success.main' : 'error.main'}
                                        >
                                            ${totals.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Chip
                                            label={`${totals.margin.toFixed(1)}%`}
                                            color={totals.margin >= 30 ? 'success' : totals.margin >= 10 ? 'warning' : 'error'}
                                            size="small"
                                        />
                                    </TableCell>
                                </TableRow>
                            </>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default PnLView;
