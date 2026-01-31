/**
 * @fileoverview Receipts Tab View
 * 
 * Financial dashboard for receipts with 3 report views:
 * - By Client (Object Economics)
 * - By Employee (Reimbursements)
 * - Audit Log (All receipts)
 */

import React, { useEffect, useState, useMemo } from 'react';
import {
    Box, Typography, Tabs, Tab, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Paper, Chip, CircularProgress, TextField, MenuItem,
    Card, CardContent, Grid, Avatar, IconButton, Tooltip, Link
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../../firebase/firebase';
import ReceiptIcon from '@mui/icons-material/Receipt';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import ImageIcon from '@mui/icons-material/Image';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PendingIcon from '@mui/icons-material/Pending';
import WarningIcon from '@mui/icons-material/Warning';

interface Receipt {
    id: string;
    uploadedBy: number;
    uploadedByName: string;
    clientId: string;
    clientName: string;
    listId: string;
    photoUrl: string;
    goodsPhotoUrl?: string;
    createdAt: Timestamp;
    status: 'awaiting_goods_photo' | 'needs_review' | 'approved';
    totalAmount?: number;
    paymentSource?: 'personal' | 'company_card' | 'cash_advance';
    costCenter?: 'billable' | 'internal' | 'personal';
    billingStatus?: 'pending' | 'verified' | 'invoiced' | 'paid';
    reimbursementStatus?: 'pending' | 'paid';
}

type ReportView = 'clients' | 'employees' | 'audit';

export function ReceiptsTabView() {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [loading, setLoading] = useState(true);
    const [reportView, setReportView] = useState<ReportView>('audit');
    const [startDate, setStartDate] = useState<Dayjs | null>(dayjs().startOf('month'));
    const [endDate, setEndDate] = useState<Dayjs | null>(dayjs().endOf('month'));
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // Fetch receipts
    useEffect(() => {
        const fetchReceipts = async () => {
            setLoading(true);
            try {
                const receiptsRef = collection(db, 'receipts');
                // Simple query - avoid compound index issues
                // Filter on client side for date range
                const q = query(receiptsRef, orderBy('createdAt', 'desc'));

                const snapshot = await getDocs(q);
                console.log('[ReceiptsTabView] Fetched receipts:', snapshot.docs.length); // Debug

                let data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Receipt[];

                // Filter by date range on client side
                if (startDate) {
                    const startTs = startDate.startOf('day').valueOf();
                    data = data.filter(r => r.createdAt?.toMillis?.() >= startTs);
                }
                if (endDate) {
                    const endTs = endDate.endOf('day').valueOf();
                    data = data.filter(r => r.createdAt?.toMillis?.() <= endTs);
                }

                console.log('[ReceiptsTabView] Filtered receipts:', data.length); // Debug
                setReceipts(data);
            } catch (error) {
                console.error('Error fetching receipts:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchReceipts();
    }, [startDate, endDate]);

    // Filter by status
    const filteredReceipts = useMemo(() => {
        if (statusFilter === 'all') return receipts;
        return receipts.filter(r => r.status === statusFilter);
    }, [receipts, statusFilter]);

    // Aggregate by client
    const byClient = useMemo(() => {
        const map = new Map<string, { clientName: string; billable: number; internal: number; personal: number; count: number }>();

        filteredReceipts.forEach(r => {
            const existing = map.get(r.clientId) || { clientName: r.clientName, billable: 0, internal: 0, personal: 0, count: 0 };
            const amount = r.totalAmount || 0;

            if (r.costCenter === 'billable') existing.billable += amount;
            else if (r.costCenter === 'internal') existing.internal += amount;
            else if (r.costCenter === 'personal') existing.personal += amount;
            existing.count++;

            map.set(r.clientId, existing);
        });

        return Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));
    }, [filteredReceipts]);

    // Aggregate by employee (reimbursements)
    const byEmployee = useMemo(() => {
        const map = new Map<string, { name: string; spent: number; toReimburse: number; count: number }>();

        filteredReceipts.forEach(r => {
            const key = String(r.uploadedBy);
            const existing = map.get(key) || { name: r.uploadedByName, spent: 0, toReimburse: 0, count: 0 };
            const amount = r.totalAmount || 0;

            existing.spent += amount;
            // Personal payment + costCenter is billable/internal = reimbursement needed
            if (r.paymentSource === 'personal' && r.costCenter !== 'personal') {
                existing.toReimburse += amount;
            }
            existing.count++;

            map.set(key, existing);
        });

        return Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));
    }, [filteredReceipts]);

    // Totals
    const totals = useMemo(() => {
        const total = filteredReceipts.reduce((sum, r) => sum + (r.totalAmount || 0), 0);
        const billable = filteredReceipts.filter(r => r.costCenter === 'billable').reduce((sum, r) => sum + (r.totalAmount || 0), 0);
        const internal = filteredReceipts.filter(r => r.costCenter === 'internal').reduce((sum, r) => sum + (r.totalAmount || 0), 0);
        const toReimburse = filteredReceipts.filter(r => r.paymentSource === 'personal' && r.costCenter !== 'personal').reduce((sum, r) => sum + (r.totalAmount || 0), 0);
        return { total, billable, internal, toReimburse };
    }, [filteredReceipts]);

    const getStatusChip = (status: string) => {
        switch (status) {
            case 'approved':
                return <Chip size="small" icon={<CheckCircleIcon />} label="Одобрен" color="success" />;
            case 'needs_review':
                return <Chip size="small" icon={<PendingIcon />} label="На проверке" color="warning" />;
            case 'awaiting_goods_photo':
                return <Chip size="small" icon={<WarningIcon />} label="Ждёт фото" color="error" />;
            default:
                return <Chip size="small" label={status} />;
        }
    };

    const getPaymentSourceLabel = (source?: string) => {
        switch (source) {
            case 'personal': return '💳 Личные';
            case 'company_card': return '🏢 Корп.';
            case 'cash_advance': return '💰 Подотчёт';
            default: return '—';
        }
    };

    const getCostCenterLabel = (center?: string) => {
        switch (center) {
            case 'billable': return '🏗 Клиент';
            case 'internal': return '🏢 Компания';
            case 'personal': return '🍔 Личное';
            default: return '—';
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={300}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box>
            {/* Summary Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card>
                        <CardContent sx={{ textAlign: 'center', py: 2 }}>
                            <Typography variant="h4" color="primary">${totals.total.toFixed(2)}</Typography>
                            <Typography variant="body2" color="text.secondary">Всего расходов</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card>
                        <CardContent sx={{ textAlign: 'center', py: 2 }}>
                            <Typography variant="h4" color="success.main">${totals.billable.toFixed(2)}</Typography>
                            <Typography variant="body2" color="text.secondary">Выставить клиенту</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card>
                        <CardContent sx={{ textAlign: 'center', py: 2 }}>
                            <Typography variant="h4" color="warning.main">${totals.internal.toFixed(2)}</Typography>
                            <Typography variant="body2" color="text.secondary">Расходы компании</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                    <Card>
                        <CardContent sx={{ textAlign: 'center', py: 2 }}>
                            <Typography variant="h4" color="error.main">${totals.toReimburse.toFixed(2)}</Typography>
                            <Typography variant="body2" color="text.secondary">К возврату сотрудникам</Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Filters & View Tabs */}
            <Paper sx={{ p: 2, mb: 2 }}>
                <Box display="flex" flexWrap="wrap" gap={2} alignItems="center">
                    <LocalizationProvider dateAdapter={AdapterDayjs}>
                        <DatePicker
                            label="С"
                            value={startDate}
                            onChange={(value) => setStartDate(value ? dayjs(value) : null)}
                            slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
                        />
                        <DatePicker
                            label="По"
                            value={endDate}
                            onChange={(value) => setEndDate(value ? dayjs(value) : null)}
                            slotProps={{ textField: { size: 'small', sx: { width: 150 } } }}
                        />
                    </LocalizationProvider>

                    <TextField
                        select
                        label="Статус"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        size="small"
                        sx={{ width: 150 }}
                    >
                        <MenuItem value="all">Все</MenuItem>
                        <MenuItem value="approved">Одобрен</MenuItem>
                        <MenuItem value="needs_review">На проверке</MenuItem>
                        <MenuItem value="awaiting_goods_photo">Ждёт фото</MenuItem>
                    </TextField>

                    <Box flex={1} />

                    <Tabs value={reportView} onChange={(_, v) => setReportView(v)}>
                        <Tab icon={<BusinessIcon />} label="По объектам" value="clients" />
                        <Tab icon={<PersonIcon />} label="По сотрудникам" value="employees" />
                        <Tab icon={<ReceiptIcon />} label="Аудит лог" value="audit" />
                    </Tabs>
                </Box>
            </Paper>

            {/* Report Content */}
            {reportView === 'clients' && (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Клиент</TableCell>
                                <TableCell align="right">Чеков</TableCell>
                                <TableCell align="right">🏗 Billable</TableCell>
                                <TableCell align="right">🏢 Internal</TableCell>
                                <TableCell align="right">🍔 Personal</TableCell>
                                <TableCell align="right">Итого</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {byClient.map(row => (
                                <TableRow key={row.id}>
                                    <TableCell>{row.clientName || 'Без клиента'}</TableCell>
                                    <TableCell align="right">{row.count}</TableCell>
                                    <TableCell align="right" sx={{ color: 'success.main' }}>${row.billable.toFixed(2)}</TableCell>
                                    <TableCell align="right" sx={{ color: 'warning.main' }}>${row.internal.toFixed(2)}</TableCell>
                                    <TableCell align="right">${row.personal.toFixed(2)}</TableCell>
                                    <TableCell align="right"><strong>${(row.billable + row.internal + row.personal).toFixed(2)}</strong></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {reportView === 'employees' && (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Сотрудник</TableCell>
                                <TableCell align="right">Чеков</TableCell>
                                <TableCell align="right">Потрачено</TableCell>
                                <TableCell align="right">К возврату</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {byEmployee.map(row => (
                                <TableRow key={row.id}>
                                    <TableCell>
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <Avatar sx={{ width: 24, height: 24, fontSize: 12 }}>{row.name?.charAt(0)}</Avatar>
                                            {row.name}
                                        </Box>
                                    </TableCell>
                                    <TableCell align="right">{row.count}</TableCell>
                                    <TableCell align="right">${row.spent.toFixed(2)}</TableCell>
                                    <TableCell align="right" sx={{ color: row.toReimburse > 0 ? 'error.main' : 'inherit', fontWeight: row.toReimburse > 0 ? 'bold' : 'normal' }}>
                                        ${row.toReimburse.toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {reportView === 'audit' && (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Дата</TableCell>
                                <TableCell>Сотрудник</TableCell>
                                <TableCell>Клиент</TableCell>
                                <TableCell align="right">Сумма</TableCell>
                                <TableCell>Оплата</TableCell>
                                <TableCell>Счёт</TableCell>
                                <TableCell>Статус</TableCell>
                                <TableCell align="center">Фото</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredReceipts.map(receipt => (
                                <TableRow key={receipt.id}>
                                    <TableCell>
                                        {receipt.createdAt?.toDate?.()
                                            ? dayjs(receipt.createdAt.toDate()).format('DD.MM.YY HH:mm')
                                            : '—'}
                                    </TableCell>
                                    <TableCell>{receipt.uploadedByName}</TableCell>
                                    <TableCell>{receipt.clientName}</TableCell>
                                    <TableCell align="right">${(receipt.totalAmount || 0).toFixed(2)}</TableCell>
                                    <TableCell>{getPaymentSourceLabel(receipt.paymentSource)}</TableCell>
                                    <TableCell>{getCostCenterLabel(receipt.costCenter)}</TableCell>
                                    <TableCell>{getStatusChip(receipt.status)}</TableCell>
                                    <TableCell align="center">
                                        <Box display="flex" gap={0.5} justifyContent="center">
                                            {receipt.photoUrl && (
                                                <Tooltip title="Чек">
                                                    <IconButton size="small" component="a" href={receipt.photoUrl} target="_blank">
                                                        <ReceiptIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                            {receipt.goodsPhotoUrl && (
                                                <Tooltip title="Товары">
                                                    <IconButton size="small" component="a" href={receipt.goodsPhotoUrl} target="_blank">
                                                        <ImageIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {filteredReceipts.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                                        <Typography color="text.secondary">Нет чеков за выбранный период</Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
}

export default ReceiptsTabView;
